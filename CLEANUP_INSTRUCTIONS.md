# 🧹 Cleanup Instructions - Remove Vendor UI from Orange Pi

## Quick Summary

**Goal**: Remove vendor dashboard UI from Orange Pi, keep only edge/hardware logic.

---

## ❌ Files to DELETE from Orange Pi

Run these commands:

```bash
# Delete vendor components
rm -rf components/Vendor/

# Delete vendor Supabase utilities
rm lib/supabase-vendor.ts

# Delete vendor documentation
rm VENDOR_DASHBOARD_SETUP.md
```

Or manually delete:
- `components/Vendor/VendorApp.tsx`
- `components/Vendor/VendorDashboard.tsx`
- `components/Vendor/VendorLogin.tsx`
- `lib/supabase-vendor.ts`
- `VENDOR_DASHBOARD_SETUP.md`

---

## ✏️ Files to EDIT

### 1. `App.tsx` - Remove vendor routes

**Remove these imports:**
```typescript
import VendorApp from './components/Vendor/VendorApp';
```

**Remove this function:**
```typescript
const isVendorPath = () => {
  const path = window.location.pathname.toLowerCase();
  return path.startsWith('/vendor');
};
```

**Remove this routing logic:**
```typescript
// If vendor path, render vendor app
if (isVendorPath()) {
  return <VendorApp />;
}
```

Keep everything else in `App.tsx` - it's needed for local admin and portal.

---

### 2. `.env` - Add machine identity

Add these variables (you'll set values after machine registration):

```env
# Existing (keep these)
SUPABASE_URL=https://fuiabtdflbodglfexvln.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# NEW - Machine identity (set after activation)
MACHINE_ID=
VENDOR_ID=
```

---

### 3. `server.js` - Import and use edge sync

**Add import at top:**
```javascript
const { syncSaleToCloud } = require('./lib/edge-sync.ts');
```

**Find where coins are inserted** (likely in a GPIO handler or session creation), add:

```javascript
// After creating local session/transaction
await syncSaleToCloud({
  amount: pesos,           // e.g., 5.00
  session_duration: seconds, // e.g., 300
  customer_mac: macAddress, // optional
  transaction_type: 'coin_insert'
});
```

**Example location** (look for similar code):
```javascript
// When coin detected
io.emit('coin-inserted', { amount: 5, duration: 300 });

// Add sync here:
await syncSaleToCloud({
  amount: 5.00,
  session_duration: 300,
  transaction_type: 'coin_insert'
});
```

---

## ✅ Files to KEEP (Edge Logic)

These stay on Orange Pi:

### Hardware Control
- `lib/gpio.js` - Coin slot GPIO
- `lib/network.js` - Network management
- `lib/hardware.ts` - Hardware ID extraction
- `lib/opi_pinout.js` - Pin mappings

### Licensing
- `lib/license.ts` - License validation
- `lib/trial.js` - Trial management
- `lib/auth.js` - Local admin auth
- `lib/db.js` - SQLite database

### Edge Sync (NEW)
- `lib/edge-sync.ts` - ✅ Already created

### Local UI (Customer + Admin)
- `components/Portal/*` - Customer captive portal
- `components/Admin/*` - Local hardware config
- `App.tsx` - Local app router (after edits)
- `index.tsx` - Entry point

### Server
- `server.js` - Express server (after edits)
- `install.sh` - Setup script
- `package.json` - Dependencies

---

## 🔧 Updated `.env` Example

```env
# Supabase (for syncing sales/status to cloud)
SUPABASE_URL=https://fuiabtdflbodglfexvln.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Machine Identity (set after activation)
MACHINE_ID=550e8400-e29b-41d4-a716-446655440000
VENDOR_ID=7b7e2b26-d7a2-4c52-9f8e-8e8f8a8b8c8d

# Server
PORT=80
NODE_ENV=production
```

---

## 🌐 Create Separate Cloud Dashboard

Create a **NEW Git repository** for the vendor dashboard:

```bash
# In a separate directory
mkdir rjd-vendor-dashboard
cd rjd-vendor-dashboard

# Initialize React + TypeScript
npm create vite@latest . -- --template react-ts

# Install dependencies
npm install
npm install @supabase/supabase-js

# Copy vendor files from old project
mkdir -p src/components
cp -r ../RJD-PISOWIFI-Management-System/components/Vendor/* src/components/

mkdir -p src/lib
cp ../RJD-PISOWIFI-Management-System/lib/supabase-vendor.ts src/lib/

mkdir -p src/types
cp ../RJD-PISOWIFI-Management-System/types.ts src/types/

# Create .env.local
cat > .env.local << EOF
VITE_SUPABASE_URL=https://fuiabtdflbodglfexvln.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
EOF
```

Update `src/lib/supabase-vendor.ts` to use Vite env vars:

```typescript
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
```

Create simple `src/App.tsx`:

```typescript
import VendorApp from './components/VendorApp';

function App() {
  return <VendorApp />;
}

export default App;
```

Run it:
```bash
npm run dev
# Opens at http://localhost:5173
```

Deploy:
```bash
npm run build
# Upload dist/ folder to Vercel/Netlify
```

---

## 🧪 Testing Checklist

### Orange Pi (Edge Service)
- [ ] Vendor routes removed from App.tsx
- [ ] `npm start` works without errors
- [ ] Captive portal still accessible
- [ ] Admin panel still works (local hardware config)
- [ ] Coin insertion triggers sync (check console logs)
- [ ] Check Supabase: `SELECT * FROM sales_logs ORDER BY created_at DESC`

### Cloud Dashboard
- [ ] New repository created
- [ ] `npm run dev` works
- [ ] Login page shows up
- [ ] Can sign in with email/password
- [ ] Dashboard shows machines (if any registered)
- [ ] Real-time updates work (insert coin on Orange Pi)

---

## 🎯 Architecture After Cleanup

```
┌─────────────────────────┐
│  Orange Pi              │
│  (Edge Service)         │
│                         │
│  ✅ Hardware control    │
│  ✅ Coin detection      │
│  ✅ Network management  │
│  ✅ Captive portal      │
│  ✅ License check       │
│  ✅ Local admin UI      │
│  ✅ Edge sync           │
│                         │
│  ❌ Vendor dashboard    │
│  ❌ Multi-tenant UI     │
└─────────────────────────┘
         ↓ HTTP/HTTPS
         ↓ Syncs data
┌─────────────────────────┐
│  Supabase Cloud         │
│  - vendors table        │
│  - sales_logs table     │
│  - licenses table       │
└─────────────────────────┘
         ↑ HTTP/HTTPS
         ↑ Reads data
┌─────────────────────────┐
│  Cloud Web App          │
│  (Vendor Dashboard)     │
│                         │
│  ✅ Vendor login        │
│  ✅ Fleet management    │
│  ✅ Revenue analytics   │
│  ✅ Real-time updates   │
│  ✅ Multi-tenant        │
└─────────────────────────┘
```

---

## 📞 Need Help?

If you encounter issues:
1. Check console logs on Orange Pi
2. Verify Supabase credentials in `.env`
3. Confirm MACHINE_ID and VENDOR_ID are set
4. Check Supabase SQL Editor: `SELECT * FROM vendors WHERE id = 'your-machine-id'`

All vendor management now happens in the cloud dashboard!
