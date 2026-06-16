package com.rjdpisowifi.phonerental.util

import android.app.Activity
import android.app.AlertDialog
import android.app.ProgressDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.core.content.FileProvider
import com.rjdpisowifi.phonerental.BuildConfig
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Handles OTA app updates from the PisoWiFi server.
 * Checks if a newer APK is available and installs it in-place
 * (no uninstall required — same package name + same signing key).
 */
class AppUpdater(
    private val context: Context,
    private val serverUrl: String
) {

    companion object {
        private const val TAG = "AppUpdater"
        private const val PREF_SKIPPED_CODE = "ota_skipped_version_code"
        private const val PREF_PENDING_INSTALL = "ota_pending_install_version"
        private const val PREF_INSTALL_TIMESTAMP = "ota_install_timestamp"
        const val REQUEST_INSTALL_PERMISSION = 9901
    }

    private val gson = Gson()
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS) // APK download can be slow
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private val prefs by lazy {
        context.getSharedPreferences("phone_rental_prefs", Context.MODE_PRIVATE)
    }

    data class UpdateMeta(
        val version_code: Int,
        val version_name: String,
        val filename: String,
        val release_notes: String,
        val apk_url: String?
    )

    /**
     * Silent background check — auto-downloads if newer version found.
     * Respects user's "skip this version" preference.
     * Call this on app startup or heartbeat.
     *
     * @param onUpdateAvailable called on main thread when update starts downloading
     * @param onError called if any step fails (non-fatal — app continues running)
     */
    suspend fun checkAndUpdate(
        onUpdateAvailable: ((versionName: String) -> Unit)? = null,
        onError: ((String) -> Unit)? = null
    ) {
        try {
            val meta = fetchUpdateMeta() ?: return
            Log.d(TAG, "Server version: ${meta.version_code}, App version: ${BuildConfig.VERSION_CODE}")

            // Check if we just installed this version (prevent update loop)
            val pendingVersion = prefs.getInt(PREF_PENDING_INSTALL, -1)
            val installTime = prefs.getLong(PREF_INSTALL_TIMESTAMP, 0)
            val now = System.currentTimeMillis()
            
            if (pendingVersion == meta.version_code && (now - installTime) < 300000) { // 5 minutes cooldown
                Log.i(TAG, "Just installed version ${meta.version_code}, skipping update check")
                prefs.edit().remove(PREF_PENDING_INSTALL).apply()
                return
            }

            if (meta.version_code <= BuildConfig.VERSION_CODE) {
                Log.d(TAG, "App is up to date.")
                return
            }

            // Check if user previously skipped this version
            val skipped = prefs.getInt(PREF_SKIPPED_CODE, -1)
            if (skipped == meta.version_code) {
                Log.d(TAG, "Version ${meta.version_code} was skipped by user.")
                return
            }

            Log.i(TAG, "Update available: v${meta.version_name} (code ${meta.version_code})")
            withContext(Dispatchers.Main) {
                onUpdateAvailable?.invoke(meta.version_name)
            }

            downloadAndInstall(meta)
        } catch (e: Exception) {
            Log.e(TAG, "OTA check failed: ${e.message}", e)
            withContext(Dispatchers.Main) {
                onError?.invoke(e.message ?: "Update check failed")
            }
        }
    }

    /**
     * Interactive / optional update check — shows a dialog before downloading.
     * Use this when triggered manually from the admin "Check for Updates" button.
     *
     * Flow:
     *   1. Check server for update metadata
     *   2a. If up to date → show "App is up to date" toast
     *   2b. If update available → show confirmation dialog with version info
     *       → "Update Now" → progress dialog while downloading → system installer
     *       → "Skip"       → store skip preference for this version
     *
     * Must be called from a coroutine on the main thread.
     *
     * @param activity  required to show dialogs and launch installer intent
     * @param onStatusMessage callback for short status messages (e.g. "Checking…")
     */
    suspend fun checkAndPrompt(
        activity: Activity,
        onStatusMessage: ((String) -> Unit)? = null
    ) {
        onStatusMessage?.invoke("Checking for updates…")

        val meta = withContext(Dispatchers.IO) { fetchUpdateMeta() }

        if (meta == null) {
            withContext(Dispatchers.Main) {
                onStatusMessage?.invoke("No update info from server.")
                Toast.makeText(activity, "Could not reach update server.", Toast.LENGTH_SHORT).show()
            }
            return
        }

        Log.d(TAG, "checkAndPrompt: server=${meta.version_code}, app=${BuildConfig.VERSION_CODE}")

        if (meta.version_code <= BuildConfig.VERSION_CODE) {
            withContext(Dispatchers.Main) {
                onStatusMessage?.invoke("✅ Already on latest version (${BuildConfig.VERSION_NAME})")
                Toast.makeText(activity, "App is up to date!", Toast.LENGTH_SHORT).show()
            }
            return
        }

        // Update available — prompt
        withContext(Dispatchers.Main) {
            val notes = meta.release_notes.ifBlank { "No release notes provided." }
            AlertDialog.Builder(activity)
                .setTitle("Update Available — v${meta.version_name}")
                .setMessage(
                    "A new version is available!\n\n" +
                    "Current:  v${BuildConfig.VERSION_NAME} (code ${BuildConfig.VERSION_CODE})\n" +
                    "New:      v${meta.version_name} (code ${meta.version_code})\n\n" +
                    "What's new:\n$notes\n\n" +
                    "Update now? The app will restart after install."
                )
                .setPositiveButton("Update Now") { _, _ ->
                    // Use new progress dialog with auto-restart
                    CoroutineScope(Dispatchers.Main).launch {
                        downloadAndInstallWithProgress(
                            activity = activity,
                            meta = meta,
                            onProgress = { percent ->
                                onStatusMessage?.invoke("Downloading: $percent%")
                            },
                            onComplete = {
                                onStatusMessage?.invoke("✅ Update installed - app restarting")
                            },
                            onError = { error ->
                                onStatusMessage?.invoke("❌ Update failed: $error")
                            }
                        )
                    }
                }
                .setNegativeButton("Skip This Version") { _, _ ->
                    prefs.edit().putInt(PREF_SKIPPED_CODE, meta.version_code).apply()
                    onStatusMessage?.invoke("Skipped v${meta.version_name}")
                    Toast.makeText(activity, "Update skipped.", Toast.LENGTH_SHORT).show()
                }
                .setNeutralButton("Later", null)
                .show()
        }
    }

    /**
     * Fetch update metadata from server.
     * Returns null if no update info is available.
     */
    private suspend fun fetchUpdateMeta(): UpdateMeta? = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("$serverUrl/api/phone-rental/app-update")
                .get()
                .build()
            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return@withContext null
            if (!response.isSuccessful) return@withContext null

            val meta = gson.fromJson(body, UpdateMeta::class.java)
            if (meta.version_code <= 0 || meta.apk_url.isNullOrBlank()) null else meta
        } catch (e: Exception) {
            Log.w(TAG, "Could not fetch update meta: ${e.message}")
            null
        }
    }

    /**
     * Download APK to cache dir. Returns the file, or null on failure.
     */
    private suspend fun downloadApk(meta: UpdateMeta): File? = withContext(Dispatchers.IO) {
        val apkUrl = meta.apk_url ?: return@withContext null
        val destFile = File(context.cacheDir, "phonerental_update.apk")

        Log.i(TAG, "Downloading APK from $apkUrl")
        try {
            val request = Request.Builder().url(apkUrl).get().build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                Log.e(TAG, "APK download failed: HTTP ${response.code}")
                return@withContext null
            }
            response.body?.byteStream()?.use { input ->
                destFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
            Log.i(TAG, "APK downloaded: ${destFile.absolutePath} (${destFile.length()} bytes)")
            destFile
        } catch (e: Exception) {
            Log.e(TAG, "APK download error: ${e.message}", e)
            null
        }
    }

    /**
     * Download APK to cache dir, then launch system installer.
     * Used by the silent background checkAndUpdate() flow.
     */
    private suspend fun downloadAndInstall(meta: UpdateMeta) = withContext(Dispatchers.IO) {
        val apkFile = downloadApk(meta) ?: return@withContext
        withContext(Dispatchers.Main) {
            triggerInstall(apkFile)
        }
    }

    /**
     * Download and install with progress dialog - shows download progress, installs, and auto-restarts app
     * This is the recommended method for user-initiated updates
     */
    suspend fun downloadAndInstallWithProgress(
        activity: Activity,
        meta: UpdateMeta,
        onProgress: ((percent: Int) -> Unit)? = null,
        onComplete: (() -> Unit)? = null,
        onError: ((String) -> Unit)? = null
    ) = withContext(Dispatchers.Main) {
        val progressDialog = android.app.ProgressDialog(activity).apply {
            setMessage("Downloading update v${meta.version_name}...\n0%")
            setProgressStyle(android.app.ProgressDialog.STYLE_HORIZONTAL)
            max = 100
            isIndeterminate = false
            setCancelable(false)
            show()
        }

        withContext(Dispatchers.IO) {
            try {
                // Download APK with progress tracking
                val apkUrl = meta.apk_url ?: "${serverUrl}/updates/${meta.filename}"
                val destFile = File(activity.cacheDir, meta.filename)
                destFile.parentFile?.mkdirs()

                val request = Request.Builder().url(apkUrl).get().build()
                val response = client.newCall(request).execute()
                
                if (!response.isSuccessful) {
                    throw Exception("Download failed: HTTP ${response.code}")
                }

                val contentLength = response.body?.contentLength() ?: 0
                var downloadedBytes = 0L

                response.body?.byteStream()?.use { input ->
                    destFile.outputStream().use { output ->
                        val buffer = ByteArray(8192)
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            output.write(buffer, 0, bytesRead)
                            downloadedBytes += bytesRead

                            if (contentLength > 0) {
                                val progress = ((downloadedBytes * 100) / contentLength).toInt()
                                withContext(Dispatchers.Main) {
                                    progressDialog.setMessage("Downloading update v${meta.version_name}...\n$progress%")
                                    progressDialog.progress = progress
                                    onProgress?.invoke(progress)
                                }
                            }
                        }
                    }
                }

                Log.i(TAG, "APK downloaded: ${destFile.absolutePath}")

                // Mark as pending to prevent loop
                prefs.edit()
                    .putInt(PREF_PENDING_INSTALL, meta.version_code)
                    .putLong(PREF_INSTALL_TIMESTAMP, System.currentTimeMillis())
                    .apply()

                withContext(Dispatchers.Main) {
                    progressDialog.setMessage("Installing update... Please wait")
                    progressDialog.isIndeterminate = true
                }

                // Install the APK
                val installed = installApkSilently(destFile)

                withContext(Dispatchers.Main) {
                    progressDialog.dismiss()

                    if (installed) {
                        progressDialog.setMessage("Installation complete! Restarting app...")
                        
                        // Show completion toast
                        android.widget.Toast.makeText(
                            activity,
                            "Update installed successfully!",
                            android.widget.Toast.LENGTH_LONG
                        ).show()

                        // Auto-restart app after 1 second
                        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                            val packageManager = activity.packageManager
                            val launchIntent = packageManager.getLaunchIntentForPackage(activity.packageName)
                            launchIntent?.apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                                activity.startActivity(this)
                            }
                            onComplete?.invoke()
                        }, 1000)
                    } else {
                        onError?.invoke("Installation failed. Please try manual installation.")
                        android.widget.Toast.makeText(
                            activity,
                            "Installation failed",
                            android.widget.Toast.LENGTH_LONG
                        ).show()
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Update error: ${e.message}", e)
                withContext(Dispatchers.Main) {
                    progressDialog.dismiss()
                    onError?.invoke(e.message ?: "Update failed")
                    android.widget.Toast.makeText(
                        activity,
                        "Update failed: ${e.message}",
                        android.widget.Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    /**
     * Install APK silently using PackageInstaller API (works in Device Owner mode)
     * Returns true if installation was initiated successfully
     */
    private fun installApkSilently(apkFile: File): Boolean {
        return try {
            val packageInstaller = context.packageManager.packageInstaller
            val params = android.content.pm.PackageInstaller.SessionParams(
                android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL
            )

            val sessionId = packageInstaller.createSession(params)
            val session = packageInstaller.openSession(sessionId)

            session.openWrite("package_write", 0, -1).use { output ->
                apkFile.inputStream().use { input ->
                    input.copyTo(output)
                }
                session.fsync(output)
            }

            // Use PendingIntent for installation result (but we don't wait for it)
            val intent = Intent(context, javaClass).apply {
                action = "com.rjdpisowifi.phonerental.INSTALL_COMPLETE"
            }
            val pendingIntent = android.app.PendingIntent.getActivity(
                context,
                0,
                intent,
                android.app.PendingIntent.FLAG_MUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
            )

            session.commit(pendingIntent.intentSender)
            session.close()

            Log.i(TAG, "Silent installation initiated for ${apkFile.name}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Silent install failed: ${e.message}", e)
            // Fallback to normal install
            triggerNormalInstall(apkFile)
            false
        }
    }

    /**
     * Launch the system package installer with the downloaded APK.
     * On Android 8+, requires REQUEST_INSTALL_PACKAGES permission.
     * If Device Owner mode is active, use silent installation via PackageInstaller.
     */
    private fun triggerInstall(apkFile: File) {
        try {
            // Check if we're in Device Owner mode
            val devicePolicyManager = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
            val isAdminActive = devicePolicyManager.isAdminActive(
                android.content.ComponentName(context, com.rjdpisowifi.phonerental.admin.KioskDeviceAdmin::class.java)
            )
            val isDeviceOwner = devicePolicyManager.isDeviceOwnerApp(context.packageName)

            if (isDeviceOwner) {
                // Device Owner mode: Use silent installation via PackageInstaller
                Log.i(TAG, "Device Owner detected - using silent package installation")
                silentInstallAsDeviceOwner(apkFile, devicePolicyManager)
            } else {
                // Standard mode: Use regular installer
                triggerNormalInstall(apkFile)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch installer: ${e.message}", e)
            // Fallback to normal install
            triggerNormalInstall(apkFile)
        }
    }

    /**
     * Silent installation using PackageInstaller API (requires Device Owner)
     */
    private fun silentInstallAsDeviceOwner(apkFile: File, dpm: android.app.admin.DevicePolicyManager) {
        try {
            // Mark this version as pending installation to prevent loop
            val versionFromFilename = apkFile.name.substringAfter("v").substringBefore("-").toIntOrNull() ?: 0
            prefs.edit()
                .putInt(PREF_PENDING_INSTALL, versionFromFilename)
                .putLong(PREF_INSTALL_TIMESTAMP, System.currentTimeMillis())
                .apply()
            
            val packageInstaller = context.packageManager.packageInstaller
            val params = android.content.pm.PackageInstaller.SessionParams(
                android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL
            )

            val sessionId = packageInstaller.createSession(params)
            val session = packageInstaller.openSession(sessionId)

            session.openWrite("package_write", 0, -1).use { output ->
                apkFile.inputStream().use { input ->
                    input.copyTo(output)
                }
                session.fsync(output)
            }

            // Create intent for installation completion
            val intent = Intent(context, javaClass).apply {
                action = "com.rjdpisowifi.phonerental.INSTALL_COMPLETE"
            }
            val pendingIntent = android.app.PendingIntent.getActivity(
                context,
                0,
                intent,
                android.app.PendingIntent.FLAG_MUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
            )

            session.commit(pendingIntent.intentSender)
            session.close()

            Log.i(TAG, "Silent installation initiated for ${apkFile.name}")
            Toast.makeText(context, "Installing update silently...", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Log.e(TAG, "Silent install failed: ${e.message}", e)
            Toast.makeText(context, "Silent install failed, trying manual install", Toast.LENGTH_LONG).show()
            triggerNormalInstall(apkFile)
        }
    }

    /**
     * Normal installation via system installer (non-Device Owner mode)
     */
    private fun triggerNormalInstall(apkFile: File) {
        try {
            // Mark this version as pending installation to prevent loop
            val versionFromFilename = apkFile.name.substringAfter("v").substringBefore("-").toIntOrNull() ?: 0
            prefs.edit()
                .putInt(PREF_PENDING_INSTALL, versionFromFilename)
                .putLong(PREF_INSTALL_TIMESTAMP, System.currentTimeMillis())
                .apply()
            
            // Android 8+: check if install from unknown sources is allowed for this app
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!context.packageManager.canRequestPackageInstalls()) {
                    Log.w(TAG, "Install from unknown sources not enabled — opening settings")
                    val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                        data = Uri.parse("package:${context.packageName}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(intent)
                    return
                }
            }

            val apkUri: Uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                apkFile
            )

            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            Log.i(TAG, "Launching installer for ${apkFile.name}")
            context.startActivity(installIntent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch normal installer: ${e.message}", e)
        }
    }
}
