# Page Design Spec — MikroTik Management (Desktop-first)

## Layout
- Primary layout: Existing Admin layout (left sidebar + top bar + scrollable main content).
- Main content grid (desktop): 12-column CSS Grid.
  - Left (8 cols): Subscribers table + actions.
  - Right (4 cols): Router status/snapshot + quick filters + recent transactions.
- Spacing: 16–24px section gaps; cards use 16px padding; tables use compact 8–12px cell padding.
- Responsive behavior:
  - ≥1024px: 2-column layout (8/4).
  - 768–1023px: 2-column but stacked cards when needed.
  - <768px: single column; right-side panels become collapsible accordions.

## Meta Information
- Title: “MikroTik Management | Admin”
- Description: “Pamamahala ng MikroTik routers at billing operations gamit ang RouterOS API.”
- Open Graph:
  - og:title = “MikroTik Management”
  - og:description = same as description

## Global Styles
(Aligned sa existing Admin UI tokens)
- Background: slate-100 / slate-50
- Card: white background, subtle border (slate-100), shadow-sm, rounded-2xl
- Typography:
  - Page title: 18–20px, font-black, uppercase tracking-tight
  - Section label: 10px, font-bold, uppercase tracking-widest, slate-500
  - Body: 12–14px, slate-700
- Buttons:
  - Primary: blue-600 background, white text, hover darken, active scale-95
  - Secondary: slate/neutral background, hover light
  - Danger: red-600 background, confirm dialog required
- Links: underline on hover; use blue-600 for actions
- Status chips:
  - Connected: green
  - Disconnected: slate
  - Error: red

## Page Structure
1) Page Header
2) Router Connections & Snapshot (right panel)
3) Subscribers (main table)
4) Subscriber Details (drawer/modal)
5) Billing Action Form (inside details drawer)
6) Transactions Log (right panel + full list modal)

## Sections & Components

### 1) Page Header (Top of content area)
- Left:
  - Title: “MikroTik Management”
  - Subtitle: “Hiwalay sa PPPoE; RouterOS API-based operations”
- Right:
  - Primary button: “Add Router”
  - Secondary button: “Refresh All”
  - Small text status: “Last sync: …”

### 2) Router Connections & Snapshot (Right Panel Card)
- Router selector (dropdown): router name + status chip.
- Inline actions:
  - “Test Connection” button
  - “Edit” icon button
  - “Remove” icon button (requires confirm)
- Snapshot list (read-only):
  - Identity/Name
  - Uptime
  - Resource summary (CPU/Memory) kung available
- Error state:
  - Red callout box with error message + “Retry”

### 3) Subscribers Table (Main Left Card)
- Filters row:
  - Search input (username)
  - Profile filter (dropdown)
  - Status filter (Active/Disabled)
- Table columns (compact): Username | Profile | Status | Last Seen | Actions
- Row actions:
  - “View” (opens details drawer)
- Empty state:
  - “Walang subscriber na nahanap.”

### 4) Subscriber Details Drawer (Right-side drawer, desktop)
- Header: Username + status chip
- Key fields:
  - Profile
  - Disabled flag
  - Last-seen/active-session summary kung available
- Quick actions bar:
  - Activate
  - Extend
  - Suspend
  - (Buttons disabled kapag walang router connection)

### 5) Billing Action Form (Inside drawer)
- Action selector: Activate / Extend / Suspend
- Required fields:
  - Amount (number)
- Optional fields:
  - Plan name
  - Period (days)
  - Notes
- Validation:
  - Disable submit kapag amount <= 0
  - Confirmation dialog bago mag-apply
- Result display:
  - Success toast + transaction id
  - Failure toast + error reason

### 6) Transactions Log (Right Panel Card + Fullscreen List)
- Right panel: last 10 transactions list
  - Line item: timestamp, subscriber, action, amount, result chip
- “View all” opens fullscreen modal with:
  - Date range filter
  - Subscriber search
  - Result filter (success/failed)
  - Row click: show details (error_message/notes)
