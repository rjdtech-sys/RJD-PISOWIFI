#!/usr/bin/env node
/**
 * RJD PisoWiFi - Update Package Builder + Auto Upload to Supabase
 * 
 * Creates a .nxs update file and automatically uploads it
 * to Supabase Storage along with update_release.json.
 * 
 * Usage:
 *   node scripts/build-update.js --version 3.7.0 --code 2 --all --upload --notes "New features"
 *   node scripts/build-update.js --version 3.7.0 --code 2 --since HEAD~3 --upload
 *   node scripts/build-update.js --version 3.7.0 --code 2 --all          # Local only, no upload
 *   node scripts/build-update.js --version 3.7.0 --code 2 --all --upload --promote  # Also update latest_release.json
 */

const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── EXCLUSION RULES ─────────────────────────────────────────────
const ALWAYS_EXCLUDE = [
    /\.sqlite$/, /\.sqlite-shm$/, /\.sqlite-wal$/,
    /^data\//,
    /^node_modules\//, /^dist\//, /^\.git\//,
    /^uploads\//,
    'package-lock.json',
    '.env', '.env.local', '.env.production',
    /^\.trae\//, /^\.qoder\//, /^\.vscode\//,
    /\.apk$/,
    /^firmware\//,
    /^scripts\//,
    /\.log$/, /\.tmp$/,
    '.gitignore',
    /\.md$/,
    /\.nxs$/,
    'latest_release.json', 'update_release.json',
];

// ─── INCLUSION RULES ─────────────────────────────────────────────
const INCLUDE_PATTERNS = [
    'server.js', 'index.tsx', 'App.tsx', 'types.ts',
    'metadata.json', 'package.json', 'tsconfig.json',
    'vite.config.ts', 'index.html',
    'lib/', 'components/', 'migrations/', 'supabase/',
];

function isExcluded(filePath) {
    const relativePath = filePath.replace(/\\/g, '/');
    return ALWAYS_EXCLUDE.some(pattern => {
        if (pattern instanceof RegExp) return pattern.test(relativePath);
        return relativePath === pattern || relativePath.startsWith(pattern + '/');
    });
}

function isIncluded(filePath) {
    const relativePath = filePath.replace(/\\/g, '/');
    return INCLUDE_PATTERNS.some(pattern => {
        if (pattern.endsWith('/')) return relativePath.startsWith(pattern) || relativePath === pattern.slice(0, -1);
        return relativePath === pattern || relativePath.startsWith(pattern + '/');
    });
}

function getChangedFilesSince(ref) {
    try {
        const output = execSync(`git diff --name-only ${ref}`, { cwd: PROJECT_ROOT, encoding: 'utf8' });
        return output.trim().split('\n').filter(f => f.trim());
    } catch (e) {
        console.error('Git diff failed:', e.message);
        return [];
    }
}

function getAllEligibleFiles() {
    const files = [];
    function walkDir(dir, baseDir = '') {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = baseDir ? `${baseDir}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walkDir(fullPath, relativePath);
            } else if (isIncluded(relativePath) && !isExcluded(relativePath)) {
                files.push(relativePath);
            }
        }
    }
    walkDir(PROJECT_ROOT);
    return files;
}

function buildUpdatePackage(files, versionName, versionCode) {
    const zip = new AdmZip();
    let addedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
        if (isExcluded(file)) {
            console.log(`  ⏭  Excluded: ${file}`);
            skippedCount++;
            continue;
        }
        const fullPath = path.join(PROJECT_ROOT, file);
        if (!fs.existsSync(fullPath)) {
            console.log(`  ⚠  Missing: ${file}`);
            skippedCount++;
            continue;
        }
        if (fs.statSync(fullPath).isDirectory()) continue;

        zip.addLocalFile(fullPath, path.dirname(file));
        console.log(`  ✅ Added: ${file}`);
        addedCount++;
    }

    // Add update manifest
    const manifest = {
        type: 'rjd-pisowifi-update',
        version: versionName || 'unknown',
        version_code: versionCode || null,
        created_at: new Date().toISOString(),
        files_count: addedCount,
        excludes: ['*.sqlite', '*.sqlite-shm', '*.sqlite-wal', 'data/*'],
    };
    zip.addFile('UPDATE_MANIFEST.json', Buffer.from(JSON.stringify(manifest, null, 2)));

    const outputFilename = `RJD-PisoWiFi-v${versionName || 'update'}-Update.nxs`;
    const outputPath = path.join(PROJECT_ROOT, outputFilename);
    zip.writeZip(outputPath);

    const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);

    console.log('\n' + '═'.repeat(50));
    console.log(`📦 Update package created: ${outputFilename}`);
    console.log(`   Size: ${sizeMB} MB`);
    console.log(`   Files added: ${addedCount}`);
    console.log(`   Files skipped: ${skippedCount}`);
    console.log(`   Path: ${outputPath}`);
    console.log('═'.repeat(50));

    return { outputPath, outputFilename, sizeMB, filesCount: addedCount };
}

// ─── SUPABASE UPLOAD ─────────────────────────────────────────────
async function uploadToSupabase(options) {
    const { versionName, versionCode, nxsPath, nxsFilename, notes, bucket, folder, promote } = options;

    // Load .env
    const envPath = path.join(PROJECT_ROOT, '.env');
    if (!fs.existsSync(envPath)) {
        console.error('❌ No .env file found. Cannot upload to Supabase.');
        process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    const SUPABASE_URL = envContent.match(/^SUPABASE_URL=(.+)$/m)?.[1]?.trim();
    const SUPABASE_ANON_KEY = envContent.match(/^SUPABASE_ANON_KEY=(.+)$/m)?.[1]?.trim();
    const SUPABASE_SERVICE_ROLE_KEY = envContent.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim();

    if (!SUPABASE_URL) {
        console.error('❌ SUPABASE_URL missing in .env');
        process.exit(1);
    }

    // Prefer service_role key for upload (bypasses RLS)
    const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    if (!supabaseKey) {
        console.error('❌ SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY missing in .env');
        process.exit(1);
    }

    if (SUPABASE_SERVICE_ROLE_KEY) {
        console.log('   Using service_role key (bypasses RLS)');
    } else {
        console.log('   Using anon key (may need RLS policy for uploads)');
    }

    // Dynamic import for ESM compatibility
    let createClient;
    try {
        const supabaseModule = require('@supabase/supabase-js');
        createClient = supabaseModule.createClient;
    } catch {
        console.error('❌ @supabase/supabase-js not installed. Run: npm install @supabase/supabase-js');
        process.exit(1);
    }

    const supabase = createClient(SUPABASE_URL, supabaseKey);
    const bucketName = bucket || 'UPDATE FILE';
    const folderPath = folder || 'system';

    console.log(`\n☁️  Uploading to Supabase Storage...`);
    console.log(`   Bucket: ${bucketName}`);
    console.log(`   Folder: ${folderPath}/`);

    // 0. Ensure bucket exists
    console.log(`\n   [0/3] Ensuring bucket "${bucketName}" exists...`);
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.name === bucketName);
    if (!bucketExists) {
        const { error: createError } = await supabase.storage.createBucket(bucketName, {
            public: false,
            fileSizeLimit: '100MB',
        });
        if (createError) {
            console.error(`   ❌ Failed to create bucket:`, createError.message);
            process.exit(1);
        }
        console.log(`   ✅ Created bucket: ${bucketName}`);
    } else {
        console.log(`   ✅ Bucket exists: ${bucketName}`);
    }

    // 1. Upload the .nxs file
    console.log(`\n   [1/3] Uploading ${nxsFilename}...`);
    const nxsBuffer = fs.readFileSync(nxsPath);
    const nxsPath2 = `${folderPath}/${nxsFilename}`;
    const { error: nxsError } = await supabase.storage
        .from(bucketName)
        .upload(nxsPath2, nxsBuffer, {
            contentType: 'application/octet-stream',
            upsert: true,
        });

    if (nxsError) {
        console.error(`   ❌ Failed to upload .nxs:`, nxsError.message);
        process.exit(1);
    }
    console.log(`   ✅ Uploaded: ${nxsPath2}`);

    // 2. Upload update_release.json
    console.log(`\n   [2/3] Uploading update_release.json...`);
    const updateRelease = {
        version_code: versionCode,
        version_name: versionName,
        filename: nxsFilename,
        release_notes: notes || `System update v${versionName}`,
        published_at: new Date().toISOString(),
        bucket: bucketName,
    };
    const updateReleasePath = `${folderPath}/update_release.json`;
    const { error: updateError } = await supabase.storage
        .from(bucketName)
        .upload(updateReleasePath, Buffer.from(JSON.stringify(updateRelease, null, 2)), {
            contentType: 'application/json',
            upsert: true,
        });

    if (updateError) {
        console.error(`   ❌ Failed to upload update_release.json:`, updateError.message);
        process.exit(1);
    }
    console.log(`   ✅ Uploaded: ${updateReleasePath}`);

    // 3. If --promote, also update latest_release.json
    if (promote) {
        console.log(`\n   [3/3] Promoting to latest_release.json...`);
        const latestRelease = {
            version_code: versionCode,
            version_name: versionName,
            filename: '',
            release_notes: notes || `RJD PisoWiFi System v${versionName}`,
            published_at: new Date().toISOString(),
            bucket: bucketName,
        };
        const latestReleasePath = `${folderPath}/latest_release.json`;
        const { error: latestError } = await supabase.storage
            .from(bucketName)
            .upload(latestReleasePath, Buffer.from(JSON.stringify(latestRelease, null, 2)), {
                contentType: 'application/json',
                upsert: true,
            });

        if (latestError) {
            console.error(`   ❌ Failed to upload latest_release.json:`, latestError.message);
            process.exit(1);
        }
        console.log(`   ✅ Uploaded: ${latestReleasePath}`);

        // Also update local metadata.json
        const metaPath = path.join(PROJECT_ROOT, 'metadata.json');
        try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            meta.version_code = versionCode;
            meta.version_name = versionName;
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
            console.log(`   ✅ Updated local metadata.json → v${versionName} (code ${versionCode})`);
        } catch (e) {
            console.log(`   ⚠  Could not update local metadata.json: ${e.message}`);
        }
    } else {
        console.log(`\n   [3/3] Skipping latest_release.json (use --promote to update it too)`);
    }

    console.log('\n' + '═'.repeat(50));
    console.log('☁️  Upload complete!');
    console.log(`   ${folderPath}/${nxsFilename}`);
    console.log(`   ${folderPath}/update_release.json`);
    if (promote) console.log(`   ${folderPath}/latest_release.json`);
    console.log('');
    console.log(`   Machines on v${versionName} (code ${versionCode}) will see "Already up to date"`);
    console.log(`   Machines below code ${versionCode} will see "Update Available!"`);
    console.log('═'.repeat(50));

    // Clean up local .nxs after successful upload
    try {
        fs.unlinkSync(nxsPath);
        console.log(`\n🗑️  Cleaned up local ${nxsFilename}`);
    } catch {}
}

// ─── PARSE ARGS ──────────────────────────────────────────────────
const args = process.argv.slice(2);

let versionName = '';
let versionCode = 0;
let notes = '';
let bucket = '';
let folder = 'system';
let doUpload = false;
let doPromote = false;
let files = [];

// Parse flags
const versionIdx = args.indexOf('--version');
if (versionIdx !== -1 && args[versionIdx + 1]) versionName = args[versionIdx + 1];

const codeIdx = args.indexOf('--code');
if (codeIdx !== -1 && args[codeIdx + 1]) versionCode = parseInt(args[codeIdx + 1], 10);

const notesIdx = args.indexOf('--notes');
if (notesIdx !== -1 && args[notesIdx + 1]) notes = args[notesIdx + 1];

const bucketIdx = args.indexOf('--bucket');
if (bucketIdx !== -1 && args[bucketIdx + 1]) bucket = args[bucketIdx + 1];

const folderIdx = args.indexOf('--folder');
if (folderIdx !== -1 && args[folderIdx + 1]) folder = args[folderIdx + 1];

if (args.includes('--upload')) doUpload = true;
if (args.includes('--promote')) doPromote = true;

// Fallback version from metadata.json
if (!versionName) {
    try {
        const meta = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'metadata.json'), 'utf8'));
        versionName = meta.version_name || '';
        if (!versionCode) versionCode = (meta.version_code || 0) + 1;
    } catch {}
}

// ─── HELP ────────────────────────────────────────────────────────
if (!args.includes('--all') && !args.includes('--files') && !args.includes('--since')) {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║   RJD PisoWiFi - Update Package Builder + Auto Upload    ║
╚══════════════════════════════════════════════════════════╝

Usage:
  node scripts/build-update.js --version 3.7.0 --code 2 --all --upload --notes "What's new"
  node scripts/build-update.js --version 3.7.0 --code 2 --since HEAD~3 --upload
  node scripts/build-update.js --version 3.7.0 --code 2 --all --upload --promote

Required:
  --version <ver>     Version name (e.g. 3.7.0)
  --code <num>        Version code (must be higher than current)

File Selection:
  --all               Include all eligible project files
  --since <ref>       Include files changed since git ref (e.g. HEAD~3)
  --files <list>      Comma-separated list of specific files

Upload Options:
  --upload            Auto-upload .nxs + update_release.json to Supabase
  --promote           Also update latest_release.json (use after install)
  --bucket <name>     Supabase bucket name (default: "UPDATE FILE")
  --folder <path>     Folder path in bucket (default: "system")

Other:
  --notes <text>      Release notes text
                      (auto-incremented from metadata.json if omitted)

Examples:
  # Build + upload update (most common):
  node scripts/build-update.js --version 3.7.0 --code 2 --all --upload --notes "Bug fixes"

  # Build + upload + promote as current version (after install):
  node scripts/build-update.js --version 3.7.0 --code 2 --all --upload --promote --notes "New release"

  # Build only (no upload):
  node scripts/build-update.js --version 3.7.0 --code 2 --all

  # Only git-changed files:
  node scripts/build-update.js --version 3.7.0 --code 2 --since HEAD~3 --upload

Upload Flow:
  --upload uploads these files to Supabase Storage:
    system/RJD-PisoWiFi-v3.7.0-Update.nxs
    system/update_release.json

  --promote also uploads:
    system/latest_release.json

  After upload, machines with version_code < your --code
  will see "Update Available" when they click "Scan Update".
`);
    process.exit(0);
}

// Validate
if (!versionName) {
    console.error('❌ --version is required (e.g. --version 3.7.0)');
    process.exit(1);
}
if (!versionCode) {
    console.error('❌ --code is required (e.g. --code 2). Must be higher than current version code.');
    process.exit(1);
}

// Collect files
if (args.includes('--all')) {
    console.log(`📋 Collecting all eligible files...\n`);
    files = getAllEligibleFiles();
} else if (args.includes('--files')) {
    const filesIdx2 = args.indexOf('--files');
    const filesArg = args[filesIdx2 + 1];
    if (filesArg) files = filesArg.split(',').map(f => f.trim());
} else if (args.includes('--since')) {
    const sinceIdx = args.indexOf('--since');
    const ref = args[sinceIdx + 1] || 'HEAD~1';
    console.log(`📋 Collecting files changed since ${ref}...\n`);
    files = getChangedFilesSince(ref);
}

if (files.length === 0) {
    console.error('❌ No files to package. Check your flags.');
    process.exit(1);
}

// ─── BUILD + UPLOAD ──────────────────────────────────────────────
(async () => {
    console.log(`Building update package v${versionName} (code ${versionCode}) with ${files.length} file(s)...\n`);

    const result = buildUpdatePackage(files, versionName, versionCode);

    if (doUpload) {
        try {
            await uploadToSupabase({
                versionName,
                versionCode,
                nxsPath: result.outputPath,
                nxsFilename: result.outputFilename,
                notes,
                bucket,
                folder,
                promote: doPromote,
            });
        } catch (err) {
            console.error('❌ Upload failed:', err.message);
            console.log(`\n💡 The .nxs file is still available at: ${result.outputPath}`);
            console.log('   You can upload it manually to Supabase Storage.');
        }
    } else {
        console.log(`\n💡 To auto-upload to Supabase, add --upload flag:`);
        console.log(`   node scripts/build-update.js --version ${versionName} --code ${versionCode} --all --upload`);
    }
})();
