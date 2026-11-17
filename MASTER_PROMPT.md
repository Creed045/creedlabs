# Master AI Prompt — Build the Complete "CreedLabs" Restaurant Ordering, Kitchen & Admin Platform

Copy and paste everything below into any AI coding assistant to recreate this entire application from scratch with all features, security rules, payment flows, real-time sync, and Apple Liquid Glass animations.

---

## PROMPT START

Build a complete, production-ready, mobile-first restaurant ordering, real-time kitchen Kanban, and admin management web application called **CreedLabs** (*"Nigerian classics, smoky proteins & global favourites"*).

### 1. Tech Stack & Architecture
- **Frontend:** React 19 + TypeScript + Vite + React Router v7 (`react-router-dom`).
- **Styling:** Plain modular CSS using CSS custom properties (`global.css`, `menu.css`, `cart.css`, `checkout.css`, `staff.css`, `animations.css`, `glass.css`). No Tailwind or UI component libraries.
- **Backend:** Supabase (`@supabase/supabase-js` v2) using Postgres Database, Row-Level Security (RLS), Postgres Triggers, RPC Functions, Supabase Auth, Supabase Storage, Supabase Realtime, and Supabase Edge Functions (Deno).
- **Payments:** Squad by GTCO Inline Checkout (`https://checkout.squadco.com/widget/squad.min.js`) with server-side verification (`squad-verify`) and HMAC-SHA512 webhook handling (`squad-webhook`).
- **Currency:** Nigerian Naira (`₦`, code `NGN`, locale `en-NG`, kobo subunits = `Naira * 100`).
- **Encoding & Config:** Always save files as UTF-8 without BOM (`.vscode/settings.json` with `"files.encoding": "utf8"`). Configure `vite.config.ts` with `server: { host: true }` so the dev server works over local Wi-Fi on phones, and include `vercel.json` with SPA rewrites (`{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`).

---

### 2. Project File Structure
Create the following exact structure:
```text
├── index.html
├── package.json
├── vite.config.ts
├── vercel.json
├── supabase/
│   ├── schema.sql
│   └── functions/
│       ├── squad-verify/index.ts
│       └── squad-webhook/index.ts
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── lib/
    │   ├── config.ts          # Brand name, NGN currency formatter, categories, Squad public key
    │   ├── types.ts           # TypeScript interfaces & dish customization helpers
    │   ├── supabase.ts        # Supabase client with safe fallback defaults
    │   ├── auth.ts            # Auth context hook & role home helper
    │   ├── cart.ts            # Cart context hook (localStorage persisted)
    │   ├── useMenu.ts         # Live menu hook with Supabase Realtime subscription
    │   ├── orders.ts          # placeOrder, verifyPayment, updateOrderStatus, useLiveOrders
    │   ├── orderContext.ts    # URL/localStorage table QR (/t/:code, ?table=) & delivery (?mode=delivery) context
    │   ├── squad.ts           # Squad inline modal loader & checkout runner
    │   ├── waiter.ts          # Call Waiter realtime hook & settings toggle
    │   ├── alert.ts           # Web Audio API chime synthesizer & device vibration
    │   ├── theme.ts           # Light/Dark mode context & localStorage persistence
    │   ├── time.ts            # Relative time formatter (timeAgo)
    │   └── ripple.ts          # Apple Liquid Glass pointer-tracking & elastic press/release engine
    ├── components/
    │   ├── AuthProvider.tsx
    │   ├── CartProvider.tsx
    │   ├── ThemeProvider.tsx
    │   ├── ThemePicker.tsx
    │   ├── Navbar.tsx
    │   ├── CategoryTabs.tsx
    │   ├── MenuItemCard.tsx
    │   ├── MenuItemForm.tsx
    │   ├── MenuSkeleton.tsx
    │   ├── FoodImage.tsx
    │   ├── CartBar.tsx
    │   ├── CartDrawer.tsx
    │   ├── CallWaiterButton.tsx
    │   ├── OrderItemsList.tsx
    │   ├── PaymentBadge.tsx
    │   ├── ProtectedRoute.tsx
    │   ├── StaffHeader.tsx
    │   ├── LiveDot.tsx
    │   ├── EmptyState.tsx
    │   └── Icons.tsx
    ├── pages/
    │   ├── MenuPage.tsx
    │   ├── CheckoutPage.tsx
    │   ├── StaffLoginPage.tsx
    │   ├── KitchenPage.tsx
    │   └── AdminPage.tsx
    └── styles/
        ├── global.css
        ├── menu.css
        ├── cart.css
        ├── checkout.css
        ├── staff.css
        ├── animations.css
        └── glass.css
```

---

### 3. Database Schema, Security Triggers & Realtime (`supabase/schema.sql`)
Write an idempotent SQL schema that sets up:

1. **Tables:**
   - `public.menu_items`:
     - `id uuid primary key default gen_random_uuid()`
     - `name text not null`
     - `description text not null default ''`
     - `price numeric(10,2) not null check (price >= 0)`
     - `category text not null check (category in ('Starters', 'Mains', 'Proteins', 'Drinks', 'Desserts'))`
     - `image_url text`
     - `available boolean not null default true`
     - `best_seller boolean not null default false`
     - `created_at timestamptz not null default now()`
   - `public.orders`:
     - `id uuid primary key default gen_random_uuid()`
     - `customer_name text not null`
     - `phone text not null default 'N/A'`
     - `email text not null default 'guest@creedlabs.kitchen'`
     - `address text not null` (holds `"Table 4"` for dine-in or street address for delivery)
     - `notes text not null default ''`
     - `items jsonb not null` (array of `{ id, name, price, quantity, modifier }`)
     - `total numeric(10,2) not null check (total >= 0)`
     - `status text not null default 'new' check (status in ('new', 'preparing', 'ready', 'delivered'))`
     - `payment_method text not null check (payment_method in ('squad', 'cash'))`
     - `payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed'))`
     - `payment_reference text unique`
     - `created_at timestamptz not null default now()`
   - `public.order_tracking`:
     - `id uuid primary key references public.orders(id) on delete cascade`
     - `status text not null`
     - `payment_method text not null`
     - `payment_status text not null`
     - `total numeric(10,2) not null`
     - `updated_at timestamptz not null default now()`
     - Publicly selectable by `anon` and `authenticated` so customers can watch their live order progress on the confirmation screen without exposing customer PII from `public.orders`.
   - `public.profiles`:
     - `id uuid primary key references auth.users(id) on delete cascade`
     - `role text not null check (role in ('admin', 'kitchen'))`
   - `public.restaurant_tables`:
     - `id uuid primary key default gen_random_uuid()`
     - `code text not null unique` (e.g. `'1'`..`'10'`)
     - `label text not null` (e.g. `'Table 1'`..`'Table 10'`)
     - `created_at timestamptz not null default now()`
   - `public.restaurant_settings`:
     - `id integer primary key default 1 check (id = 1)`
     - `call_waiter_enabled boolean not null default true`
     - `updated_at timestamptz not null default now()`
   - `public.waiter_calls`:
     - `id uuid primary key default gen_random_uuid()`
     - `table_label text not null`
     - `reason text not null`
     - `customer_name text not null default ''`
     - `status text not null default 'pending' check (status in ('pending', 'attended'))`
     - `created_at timestamptz not null default now()`
   - `public.app_secrets`:
     - `key text primary key`
     - `value text not null`
     - `updated_at timestamptz not null default now()`
     - Enable RLS and revoke all permissions from `anon` and `authenticated`; grant only to `service_role`. Used as a fallback store for `squad_secret_key`.

2. **Database Triggers (Critical for Security):**
   - `prepare_new_order()` (`BEFORE INSERT ON public.orders`):
     - Loops through `new.items`, looks up each dish in `public.menu_items`, raises an exception if a dish does not exist or has `available = false` (`"% is sold out"`), appends any `modifier` to the item name, calculates the true `new.total` server-side from database prices, forces `new.status := 'new'` and `new.payment_status := 'pending'`, and sets `new.payment_reference` for `'squad'` orders (or `null` for `'cash'`).
   - `protect_order_payment_fields()` (`BEFORE UPDATE ON public.orders`):
     - If `current_user in ('anon', 'authenticated')`, blocks any change to `payment_status`, `payment_reference`, `total`, or `payment_method`. Only `service_role` (Edge Functions) can mark an order `paid` or `failed`.
   - `protect_menu_item_fields()` (`BEFORE UPDATE ON public.menu_items`):
     - Allows `kitchen` role to toggle `available`, but raises an exception if a non-admin tries to change `name`, `description`, `price`, `category`, `image_url`, or `best_seller`.
   - `sync_order_tracking()` (`AFTER INSERT OR UPDATE OF status, payment_status ON public.orders`):
     - Upserts the corresponding row in `public.order_tracking`.

3. **Staff Management RPCs (`SECURITY DEFINER`):**
   - `admin_list_staff()`: Returns `id, email, role, created_at` for all staff accounts (verifies caller is `admin`).
   - `admin_create_staff(p_email, p_password, p_role)`: Creates a user in `auth.users` + `auth.identities` using `crypt(p_password, gen_salt('bf'))` and inserts their role into `public.profiles`.
   - `admin_update_staff(p_user_id, p_new_email, p_new_password)`: Updates email and/or bcrypt password hash for an existing staff member.

4. **Default Seed Data:**
   - Seed 15+ Nigerian and continental dishes across `Starters`, `Mains`, `Proteins`, `Drinks`, and `Desserts` (e.g., Smoky Party Jollof Rice, Egusi Soup & Pounded Yam, Peppered Beef Suya, Catfish Pepper Soup, Plantain & Grilled Turkey, Zobo Hibiscus Cooler, Classic Nigerian Chapman, Puff-Puff).
   - Seed default staff accounts:
     - Admin: `admin@mamaput.com` / `Admin1234!` (`role = 'admin'`)
     - Kitchen: `kitchen@mamaput.com` / `Kitchen1234!` (`role = 'kitchen'`)
   - Seed `restaurant_tables` with Tables 1–10.
   - Create public Storage bucket `menu-images` with public `SELECT` and admin `INSERT/UPDATE/DELETE` policies.
   - Add `orders`, `menu_items`, `order_tracking`, `restaurant_settings`, and `waiter_calls` to publication `supabase_realtime`.

---

### 4. Payment Flow (Squad by GTCO) & Supabase Edge Functions

1. **Browser Helper (`src/lib/squad.ts`):**
   - Dynamically loads `https://checkout.squadco.com/widget/squad.min.js`.
   - Reads `VITE_SQUAD_PUBLIC_KEY`.
   - Generates unique transaction references embedding the 32-hex order UUID: `SQ-${orderId.replace(/-/g, '').toLowerCase()}-${Date.now().toString(36).toUpperCase()}`.
   - Opens `window.squad` with `amount` in kobo (`Math.round(amountNaira * 100)`), `currency_code: 'NGN'`, `transaction_ref`, `customer_name`, and `metadata: { order_id }`.
   - **Important Mobile Behaviour:** On mobile browsers, customers often tap the close (`X`) button on Squad's success receipt, which triggers `onClose()`. In `CheckoutPage.tsx`, when `payWithSquad` returns `outcome === 'cancelled'`, **do not discard `lastReference`** and **immediately call `verifyPayment(order.id, reference)`** before showing the retry screen. If the payment succeeded on Squad's server, transition straight to the `done` confirmation screen!

2. **Edge Function 1: `squad-verify` (`supabase/functions/squad-verify/index.ts`):**
   - Deploy with `verify_jwt = false`.
   - Look up the Squad secret key case-insensitively across `Deno.env` (`SQUAD_SECRET_KEY`, `squad_secret_key`, etc.), and if not found in env vars, query `public.app_secrets` (`where key = 'squad_secret_key'`) using the Supabase `service_role` client.
   - Auto-select Squad API base URL: `https://sandbox-api-d.squadco.com` if key starts with `sandbox_sk_` or `test_sk_`, otherwise `https://api-d.squadco.com`.
   - Call `GET ${baseUrl}/transaction/verify/${encodeURIComponent(reference)}` with `Authorization: Bearer ${squadSecret}`.
   - Verify `transaction_status.toLowerCase() === 'success'`, `currency === 'NGN'`, and `Math.round(Number(tx.transaction_amount)) === Math.round(Number(order.total) * 100)`.
   - If `txStatus` is `'failed'` or `'abandoned'`, update `orders.payment_status = 'failed'`.
   - If valid and successful, update `orders` with `{ payment_status: 'paid', payment_reference: txRef }`.

3. **Edge Function 2: `squad-webhook` (`supabase/functions/squad-webhook/index.ts`):**
   - Deploy with `verify_jwt = false`.
   - Retrieve `squadSecret` (env var or `public.app_secrets` fallback).
   - Verify `req.headers.get('x-squad-encrypted-body')` against HMAC-SHA512 hex digest of the raw request body using `crypto.subtle` and timing-safe hex comparison.
   - Check `Event === 'charge_successful'` and `Body.transaction_status.toLowerCase() === 'success'`.
   - Locate the order by `payment_reference`, or fallback to `Body.meta?.order_id`, `Body.metadata?.order_id`, or the UUID extracted from `SQ-<32hex>-...`.
   - Verify kobo amount matches `Math.round(Number(order.total) * 100)` and update `payment_status = 'paid'`.

---

### 5. Customer Frontend Features

1. **Table NFC/QR & Delivery Context (`src/lib/orderContext.ts`):**
   - Visiting `/t/4` or `/?table=4` saves `{ mode: 'table', table: '4' }` in `localStorage` and shows a pill in the navbar (`🍽️ Table 4`).
   - Visiting `/delivery` or `/?mode=delivery` saves `{ mode: 'delivery' }` and shows `🛵 Delivery`.
   - Keep `/` 100% customer-focused (no staff role picker banner; only a subtle `Staff login` link in the navbar).

2. **Menu Page (`src/pages/MenuPage.tsx`):**
   - Hero section with restaurant name, tagline, and active table/delivery badge.
   - Instant search input + quick filter chips (`All`, `🌶️ Spicy`, `🥬 Veg`).
   - Sticky horizontal category tabs (`🔥 Best Sellers`, `All Menu`, `Starters`, `Mains`, `Proteins`, `Drinks`, `Desserts`) with live item counts.
   - Dish cards (`MenuItemCard.tsx`) with lazy-loaded image (`FoodImage.tsx`), `Best Seller` badge, `Sold out` overlay, dish customization options (e.g., Swallow choice for soups, spice level, ice level for drinks), and `+ Add` / quantity stepper.
   - Floating `CallWaiterButton.tsx` (visible when `call_waiter_enabled` is true) allowing dine-in guests to alert staff with 1 tap (`Need waiter at table`, `Request POS / Bill`, `Extra napkins / cutlery`, `Water / Drinks`).

3. **Cart & Checkout (`src/components/CartDrawer.tsx`, `src/pages/CheckoutPage.tsx`):**
   - Slide-over cart drawer + sticky bottom mobile cart bar (`CartBar.tsx`) with dish count and total.
   - **Order Type:** Dine-in (table dropdown from `restaurant_tables`, or locked badge if scanned via table QR/NFC link) vs Delivery (street address input).
   - **Kitchen Preferences:** Spice level selector (`Mild`, `Medium`, `🌶️ Hot`, `🔥 Extra Spicy`) and allergy/dietary safe chips (`No Peanuts`, `No Dairy`, `No Shellfish`, `Gluten-Free`, `Halal`).
   - **Bill Splitting:**
     - `Pay in full`: Single payer.
     - `Split equally`: Divide total evenly across 2–20 people (editable names).
     - `Split by dish`: Assign each individual dish unit to specific people; automatically calculates each person's exact Naira share.
     - On the confirmation screen, each person can tap `Pay ₦...` next to their name to pay their individual share online via Squad!
   - **Payment Methods:**
     - `Pay now with Squad` (online card / bank transfer / USSD).
     - `Pay later` (`Pay at the table` for dine-in or `Pay on delivery` for delivery).
   - **Live Order Tracker:**
     - Subscribes to `public.order_tracking` via Supabase Realtime (`postgres_changes`) and displays a 4-step live progress tracker (`Order Received` -> `Preparing in Kitchen` -> `Ready to Serve` -> `Served / Delivered`) + live payment badge.

---

### 6. Kitchen Board (`src/pages/KitchenPage.tsx`)
1. **3-Column Live Kanban Board:**
   - Columns: `New` (`Start preparing →`), `Preparing` (`Mark ready →` / `←`), `Ready` (`Served / Delivered ✓` / `←`).
   - Plays a synthesized Web Audio chime and vibrates on every new order or waiter call (`Enable sound` button unlocks browser audio).
   - Displays incoming waiter calls at the top with a `✓ Attended` button.
2. **Payment Failed & Awaiting Payment Warning System (Mandatory):**
   - **Failed Payment (`payment_status === 'failed'`):**
     - Ticket card gets a solid red border (`.ticket--failed-payment`) and a pulsing red alert banner: `⚠️ PAYMENT FAILED — Confirm before preparing!`.
     - Action button turns red: `⚠️ Start preparing (Payment Failed) →`.
     - Clicking the button opens a `⚠️ Payment Failed Warning` modal showing the order ID, customer name, and total amount, warning staff not to prepare food unless alternate payment is confirmed, with `Cancel (Don't prepare)` and `Start preparing anyway →` buttons.
   - **Awaiting Payment (`payment_method === 'squad' && payment_status === 'pending'`):**
     - Ticket card gets a dashed amber border (`.ticket--pending-payment`) and a pulsing amber alert banner: `⏳ AWAITING PAYMENT — Customer has not paid online yet!`.
     - Action button turns amber: `⏳ Start preparing (Awaiting Payment) →`.
     - Clicking the button opens an `⏳ Awaiting Payment Warning` modal with `Cancel (Don't prepare)` and `Start preparing anyway →` buttons.
3. **Food Availability Tab:**
   - Second tab (`🍲 Food Availability`) listing all dishes by category so kitchen staff can tap any dish to toggle `✓ Available` / `✕ Sold Out` in real time.

---

### 7. Admin Dashboard (`src/pages/AdminPage.tsx`)
Four main tabs:
1. **Live Orders & Analytics:**
   - KPI summary cards: Today's orders count, Today's total revenue, Online paid revenue, Active orders, and Top selling dishes today.
   - Toggle switch to turn the customer `"Call Waiter"` button ON or OFF across the restaurant in real time.
   - Live waiter call alert banner with `✓ Mark attended`.
   - Filterable order cards (`All`, `New`, `Preparing`, `Ready`, `Delivered`) with status dropdowns and payment badges.
2. **Menu Items:**
   - Add, edit, and delete dishes (`MenuItemForm.tsx`).
   - Upload dish images directly to the `menu-images` Supabase Storage bucket (with instant local preview) or paste an external image URL.
   - 1-click toggles for `Available` / `Sold Out` and `🔥 Best Seller`.
3. **Tables & Links:**
   - Manage restaurant tables (add/delete tables).
   - Copy customer NFC/QR links (`/t/1`..`/t/10`) and Delivery link (`/delivery`).
   - Generate and preview scannable QR codes for any table or delivery link with a `Download PNG` / `Print` modal.
4. **Staff & Password:**
   - Lists all staff accounts via `admin_list_staff()`.
   - Create new `admin` or `kitchen` staff accounts via `admin_create_staff()`.
   - Change email or password for any staff account via `admin_update_staff()`.

---

### 8. Theme & Apple "Liquid Glass" Motion Layer
1. **Light & Dark Mode (`src/styles/global.css`, `src/components/ThemePicker.tsx`):**
   - Warm ivory palette in Light mode (`#faf7f2` background, `#e4572e` brand orange) and rich charcoal palette in Dark mode (`#121110` background, `#1c1917` surface).
   - Smooth 0.3s colour transitions when switching themes.
2. **Apple Liquid Glass Controls (`src/styles/glass.css` + `src/lib/ripple.ts`):**
   - All interactive controls (`.btn`, `.icon-btn`, `.navbar__cart`, `.tabs__tab`, `.chip`, `.pay-option`, `.cart-bar`, `.kitchen-nav__btn`, `.spice-btn`, `.allergy-chip`) use translucent frosted blur (`backdrop-filter: blur(18px) saturate(180%)`), inner top specular highlight (`inset 0 1px 0`), inner bottom shade, glossy top lens reflection (`::after`), and a pointer-tracked radial specular glow (`::before` positioned at `--mx` / `--my`).
   - Delegated pointer listener in `src/lib/ripple.ts` tracks cursor/finger position via `requestAnimationFrame`, applies `.is-liquid-press` on `pointerdown` (`transform: scale(0.94)` + bright light bloom under the finger), and triggers `.is-liquid-release` on `pointerup` with a multi-stage elastic jelly keyframe (`scale(0.94)` → `scale(1.06, 0.95)` → `scale(0.98, 1.03)` → `scale(1.01, 0.99)` → `scale(1)`).
3. **Smooth Page & List Animations (`src/styles/animations.css`):**
   - Opacity page transitions (avoid `transform` on page wrappers so `position: fixed` children like the cart bar and modals stay anchored to the viewport).
   - Staggered entrance animations for menu dish cards, cart lines, order cards, and kitchen tickets, plus scroll-driven reveal (`animation-timeline: view()`) where supported.
   - Respect `@media (prefers-reduced-motion: reduce)` across all animations.

---

### 9. Environment Variables & Verification
- **Frontend (`.env` / Vercel):**
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_SQUAD_PUBLIC_KEY`
- **Supabase Edge Function Secrets:**
  - `SQUAD_SECRET_KEY` (or `squad_secret_key` — checked case-insensitively).
- **Quality Gate:**
  - Ensure `npm run check` (`oxlint && tsc -b && vite build`) passes with **0 warnings and 0 errors**.

## PROMPT END
