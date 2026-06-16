# Multi-Role Dashboard System - Complete Guide

## 🎯 System Overview

Your RJD PisoWiFi system now supports **3 separate cloud dashboards** with role-based access:

```
┌─────────────────────────────────────────────────────────────┐
│                      SUPABASE CLOUD                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   licenses   │  │   vendors    │  │  sales_logs  │      │
│  │   clients    │  │  user_roles  │  │     ...      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
         ▲                  ▲                  ▲
         │                  │                  │
    ┌────┴────┐        ┌────┴────┐       ┌────┴────┐
    │ SUPER   │        │ VENDOR  │       │ CLIENT  │
    │ ADMIN   │        │ DASH    │       │ DASH    │
    │ (YOU)   │        │ (Owners)│       │(Customers)│
    └─────────┘        └─────────┘       └─────────┘
```

---

## 👤 Role Descriptions

### 1. **SUPERADMIN** (You)
- **Purpose**: System owner, manages entire platform
- **Capabilities**:
  - Generate and manage ALL licenses
  - View ALL vendors and their machines
  - See global revenue across all machines
  - Assign licenses to specific vendors
  - Monitor system-wide statistics
- **Access**: Full database access via superadmin dashboard

### 2. **VENDOR** (Machine Owners)
- **Purpose**: Business owners who operate PisoWiFi machines
- **Capabilities**:
  - View only THEIR machines
  - Monitor their machine status (online/offline)
  - Track their revenue and transactions
  - See active client sessions on their machines
  - Activate licenses for their machines
- **Access**: Isolated to their own data via RLS

### 3. **CLIENT** (Customers/End Users)
- **Purpose**: People who pay for internet access
- **Capabilities**:
  - View their current session time remaining
  - See how much they've paid
  - Check when their session expires
  - No login required (token-based)
- **Access**: Only see their own session data

---

## 📊 Database Schema (Already Created)

Run the complete SQL schema:
```bash
# File: supabase_vendor_schema.sql
```

Key tables created:
- `user_roles` - Tracks who is superadmin/vendor/client
- `licenses` - License keys you generate and manage
- `vendors` - PisoWiFi machines (owned by vendors)
- `sales_logs` - Every coin insertion/transaction
- `clients` - Active customer sessions

---

## 🚀 Setup Instructions

### Step 1: Make Yourself Superadmin

1. **Sign up** via Supabase Dashboard:
   ```
   Authentication > Users > Add User
   Email: your-email@example.com
   Password: (your choice)
   ```

2. **Get your User ID**:
   ```sql
   SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';
   ```

3. **Grant yourself superadmin role**:
   ```sql
   INSERT INTO user_roles (user_id, role)
   VALUES ('<your-user-id-here>', 'superadmin');
   ```

4. **Verify**:
   ```sql
   SELECT * FROM user_roles WHERE user_id = '<your-user-id>';
   -- Should show: role = 'superadmin'
   ```

---

### Step 2: Generate Your First Licenses

As superadmin, generate license keys:

```sql
-- Generate 10 licenses (no expiration)
SELECT * FROM generate_license_keys(10);

-- Generate 5 licenses with 12-month expiration
SELECT * FROM generate_license_keys(5, NULL, 12);

-- Generate 3 licenses assigned to specific vendor
SELECT * FROM generate_license_keys(3, '<vendor-user-id>', NULL);
```

**Output example**:
```
license_key              | expires_at
-------------------------+----------------------
RJD-a1b2c3d4-e5f6g7h8   | NULL
RJD-i9j0k1l2-m3n4o5p6   | NULL
...
```

---

### Step 3: Create Vendor Accounts

1. **Vendor signs up** (via your vendor dashboard):
   ```
   Email: vendor@example.com
   Password: (they choose)
   ```

2. **Make them a vendor** (you do this as superadmin):
   ```sql
   -- Get their user ID
   SELECT id, email FROM auth.users WHERE email = 'vendor@example.com';
   
   -- Assign vendor role
   INSERT INTO user_roles (user_id, role)
   VALUES ('<vendor-user-id>', 'vendor');
   ```

3. **Assign licenses to vendor** (optional):
   ```sql
   UPDATE licenses 
   SET vendor_id = '<vendor-user-id>'
   WHERE license_key IN ('RJD-xxx-xxx', 'RJD-yyy-yyy');
   ```

---

### Step 4: Enable Realtime

In Supabase Dashboard:
1. Go to **Database** > **Replication**
2. Click **supabase_realtime**
3. Enable for tables:
   - ✅ `vendors`
   - ✅ `sales_logs`
   - ✅ `clients`
   - ✅ `licenses`

---

## 🌐 Dashboard Implementations

### 1. Superadmin Dashboard

**Purpose**: YOUR central management portal

**Features to build**:
- License generator UI
- View all vendors list
- Global revenue statistics
- License assignment to vendors
- System-wide analytics

**Key API Calls**:
```typescript
// Get global stats
const { data } = await supabase.rpc('get_global_stats');

// View all licenses
const { data } = await supabase
  .from('licenses')
  .select('*, vendor:vendor_id(email)')
  .order('created_at', { ascending: false });

// Generate licenses
const { data } = await supabase.rpc('generate_license_keys', {
  batch_size: 10,
  assigned_vendor_id: null,
  expiration_months: null
});

// View all vendors performance
const { data } = await supabase
  .from('superadmin_global_dashboard')
  .select('*')
  .order('total_revenue', { ascending: false });
```

---

### 2. Vendor Dashboard (Already Created)

**Purpose**: Machine owners manage their fleet

**Features** (already implemented):
- View their machines only
- Real-time machine status
- Revenue analytics (24h, 7d, 30d)
- Transaction history
- Active client sessions

**Access Control**: Automatic via RLS
```typescript
// Vendors automatically only see THEIR data
const { data } = await supabase
  .from('vendors')
  .select('*'); // RLS filters to auth.uid() = vendor_id
```

---

### 3. Client Dashboard

**Purpose**: Customers check their session

**Features to build**:
- Show remaining time
- Display amount paid
- Session expiration countdown
- No login required (uses session token)

**Access Method**:
```typescript
// Client accesses via session token (no auth required)
const sessionToken = localStorage.getItem('rjd_session_token');

const { data } = await supabase
  .from('clients')
  .select('*')
  .eq('session_token', sessionToken)
  .eq('is_active', true)
  .single();

// Display:
// - data.remaining_seconds (countdown timer)
// - data.total_paid
// - data.connected_at
// - data.expires_at
```

---

## 🔐 Security Model

### RLS (Row Level Security) Enforced

**Superadmin**:
```sql
-- Can see EVERYTHING
USING (is_superadmin())
```

**Vendors**:
```sql
-- Can only see THEIR data
USING (auth.uid() = vendor_id)
```

**Clients**:
```sql
-- Token-based access (no user account)
USING (session_token = '<token>')
```

**Orange Pi** (Edge Device):
```sql
-- Can insert/update client sessions and sales
-- Uses SUPABASE_ANON_KEY (not service_role)
```

---

## 📱 Dashboard URLs Structure

```
https://superadmin.rjd-pisowifi.com   ← YOUR dashboard
https://vendor.rjd-pisowifi.com       ← Vendor dashboard
https://client.rjd-pisowifi.com       ← Client check session
```

Or use path-based routing:
```
https://dashboard.rjd-pisowifi.com/superadmin
https://dashboard.rjd-pisowifi.com/vendor
https://dashboard.rjd-pisowifi.com/client
```

---

## 🔧 Common Superadmin Tasks

### Generate Licenses
```sql
SELECT * FROM generate_license_keys(50); -- Batch of 50
```

### View All Licenses
```sql
SELECT 
  l.license_key,
  l.hardware_id,
  l.is_active,
  u.email as vendor_email,
  l.activated_at
FROM licenses l
LEFT JOIN auth.users u ON u.id = l.vendor_id
ORDER BY l.created_at DESC;
```

### View Unassigned Licenses
```sql
SELECT license_key, created_at 
FROM licenses 
WHERE hardware_id IS NULL 
ORDER BY created_at DESC;
```

### Unbind a License
```sql
UPDATE licenses 
SET hardware_id = NULL, is_active = false, activated_at = NULL
WHERE license_key = 'RJD-xxxxx-xxxxx';
```

### View Global Statistics
```sql
SELECT * FROM get_global_stats();
```

### Assign License to Vendor
```sql
UPDATE licenses 
SET vendor_id = '<vendor-user-id>'
WHERE license_key = 'RJD-xxxxx-xxxxx';
```

---

## 🎨 Dashboard Tech Stack

All 3 dashboards can use:
- **React** + TypeScript
- **Vite** (fast build)
- **@supabase/supabase-js** (database client)
- **TailwindCSS** (styling)
- Deploy to:
  - Vercel (recommended)
  - Netlify
  - Your own server

---

## 📊 Example Superadmin Dashboard Queries

### Get Total System Revenue
```typescript
const { data, error } = await supabase.rpc('get_global_stats');

console.log(data.total_revenue); // All-time
console.log(data.revenue_today); // Today
console.log(data.revenue_this_month); // This month
```

### Get All Vendors Performance
```typescript
const { data } = await supabase
  .from('superadmin_global_dashboard')
  .select('*')
  .order('total_revenue', { ascending: false });

// Shows each vendor's:
// - machines count
// - online machines
// - total revenue
// - transactions
// - licenses
```

### Generate 10 New Licenses
```typescript
const { data, error } = await supabase.rpc('generate_license_keys', {
  batch_size: 10,
  assigned_vendor_id: null, // Not assigned yet
  expiration_months: null   // No expiration
});

// Returns array of new license keys
```

---

## 🚨 Important Notes

1. **Never expose service_role key** - Only use ANON_KEY in dashboards
2. **RLS is your security** - All filtering happens at database level
3. **Superadmin is powerful** - Only YOU should have this role
4. **Vendors are isolated** - They can't see each other's data
5. **Clients don't need accounts** - Token-based access is simpler

---

## ✅ Deployment Checklist

### For You (Superadmin):
- [ ] Run complete SQL schema in Supabase
- [ ] Make yourself superadmin
- [ ] Generate initial license batch
- [ ] Enable Realtime replication
- [ ] Build & deploy superadmin dashboard
- [ ] Test license generation

### For Vendors:
- [ ] Build & deploy vendor dashboard
- [ ] They sign up via email/password
- [ ] You assign them 'vendor' role
- [ ] They activate licenses on their machines

### For Clients:
- [ ] Build & deploy client dashboard
- [ ] No signup required
- [ ] Access via session token from Orange Pi
- [ ] Shows remaining time/balance

---

## 🎉 You're Ready!

You now have a complete multi-role system:
- **YOU** control all licenses and see global revenue
- **VENDORS** manage their machines independently
- **CLIENTS** check their session status easily

All secured with Supabase RLS and Realtime updates! 🚀
