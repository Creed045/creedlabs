-- =====================================================================
--  Restaurant Menu & Ordering App — Supabase schema
--  Run this whole file once in: Supabase Dashboard → SQL Editor → New query
--  It is safe to re-run (idempotent).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.menu_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  price       numeric(10,2) not null check (price >= 0),
  category    text not null check (category in ('Starters', 'Mains', 'Drinks', 'Desserts')),
  image_url   text,
  available   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  customer_name     text not null check (char_length(customer_name) between 1 and 120),
  phone             text not null check (char_length(phone) between 5 and 30),
  email             text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address           text not null check (char_length(address) between 1 and 500), -- delivery address OR "Table 7"
  notes             text not null default '' check (char_length(notes) <= 1000),
  items             jsonb not null,                    -- [{ id, name, price, quantity }]
  total             numeric(10,2) not null default 0,  -- always recalculated by trigger
  status            text not null default 'new'
                      check (status in ('new', 'preparing', 'ready', 'delivered')),
  payment_method    text not null check (payment_method in ('squad', 'cash')),
  payment_status    text not null default 'pending'
                      check (payment_status in ('pending', 'paid', 'failed')),
  payment_reference text unique,
  created_at        timestamptz not null default now()
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('admin', 'kitchen')),
  created_at timestamptz not null default now()
);

create index if not exists menu_items_category_idx on public.menu_items (category);
create index if not exists orders_created_at_idx   on public.orders (created_at desc);
create index if not exists orders_status_idx       on public.orders (status);

-- ---------------------------------------------------------------------
-- 2. ORDER INTEGRITY TRIGGER
--    The browser cannot be trusted with prices or totals. Before every
--    insert we rebuild the items list from menu_items, reject sold-out
--    items and compute the total in the database. We also force a new
--    order to start as status=new / payment_status=pending.
-- ---------------------------------------------------------------------

create or replace function public.prepare_new_order()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  line      jsonb;
  qty       integer;
  dish      record;
  clean     jsonb   := '[]'::jsonb;
  running   numeric := 0;
begin
  if new.items is null
     or jsonb_typeof(new.items) <> 'array'
     or jsonb_array_length(new.items) = 0 then
    raise exception 'An order must contain at least one item';
  end if;

  if jsonb_array_length(new.items) > 50 then
    raise exception 'Too many different items in one order';
  end if;

  for line in select value from jsonb_array_elements(new.items) loop
    qty := (line ->> 'quantity')::integer;
    if qty is null or qty < 1 or qty > 50 then
      raise exception 'Invalid quantity';
    end if;

    select m.id, m.name, m.price, m.available
      into dish
      from public.menu_items m
     where m.id = (line ->> 'id')::uuid;

    if not found then
      raise exception 'A menu item in your cart no longer exists';
    end if;
    if not dish.available then
      raise exception '% is sold out', dish.name;
    end if;

    clean   := clean || jsonb_build_array(jsonb_build_object(
                 'id', dish.id, 'name', dish.name, 'price', dish.price, 'quantity', qty));
    running := running + dish.price * qty;
  end loop;

  new.items             := clean;
  new.total             := running;
  new.status            := 'new';
  new.payment_status    := 'pending';
  new.payment_reference := null;
  new.created_at        := now();
  return new;
end;
$$;

drop trigger if exists orders_prepare_new on public.orders;
create trigger orders_prepare_new
  before insert on public.orders
  for each row execute function public.prepare_new_order();

-- Trigger functions should not be callable through the API.
revoke execute on function public.prepare_new_order() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. TABLE PRIVILEGES (which columns each API role may touch at all)
--    RLS (section 4) then decides which ROWS they may touch.
-- ---------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

-- menu_items: everyone reads; signed-in users may write (RLS limits to admins)
revoke all on public.menu_items from anon, authenticated;
grant select on public.menu_items to anon, authenticated;
grant insert, update, delete on public.menu_items to authenticated;

-- profiles: signed-in users may read (RLS limits to their own row). No writes.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- orders:
--  * customers may INSERT only these columns (status, total, payment_status,
--    payment_reference are NOT insertable — the trigger sets them)
--  * staff may SELECT and UPDATE only the "status" column.
--  * payment_status / payment_reference can only be changed by the
--    service_role, i.e. the squad-verify / squad-webhook Edge Function.
revoke all on public.orders from anon, authenticated;
grant insert (id, customer_name, phone, email, address, notes, items, payment_method, payment_reference)
  on public.orders to anon, authenticated;
grant select on public.orders to authenticated;
grant update (status) on public.orders to authenticated;

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.menu_items enable row level security;
alter table public.orders     enable row level security;
alter table public.profiles   enable row level security;

-- profiles ------------------------------------------------------------
drop policy if exists "Staff can read own profile" on public.profiles;
create policy "Staff can read own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

-- menu_items ----------------------------------------------------------
drop policy if exists "Anyone can read menu"       on public.menu_items;
drop policy if exists "Admins can insert menu"     on public.menu_items;
drop policy if exists "Admins can update menu"     on public.menu_items;
drop policy if exists "Admins can delete menu"     on public.menu_items;

create policy "Anyone can read menu"
  on public.menu_items for select
  to anon, authenticated
  using (true);

create policy "Admins can insert menu"
  on public.menu_items for insert
  to authenticated
  with check (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role = 'admin'));

create policy "Admins can update menu"
  on public.menu_items for update
  to authenticated
  using      (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role = 'admin'));

create policy "Admins can delete menu"
  on public.menu_items for delete
  to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.role = 'admin'));

-- orders --------------------------------------------------------------
drop policy if exists "Anyone can place an order"   on public.orders;
drop policy if exists "Staff can read orders"       on public.orders;
drop policy if exists "Staff can update orders"     on public.orders;

create policy "Anyone can place an order"
  on public.orders for insert
  to anon, authenticated
  with check (status = 'new' and payment_status = 'pending');

create policy "Staff can read orders"
  on public.orders for select
  to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.role in ('admin', 'kitchen')));

create policy "Staff can update orders"
  on public.orders for update
  to authenticated
  using      (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role in ('admin', 'kitchen')))
  with check (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role in ('admin', 'kitchen')));

-- ---------------------------------------------------------------------
-- 5. REALTIME — stream order inserts/updates to the admin & kitchen panels
--    (Realtime respects the RLS policies above.)
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. STORAGE — public bucket for menu photos, only admins can write
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins can read menu images"   on storage.objects;
drop policy if exists "Admins can upload menu images" on storage.objects;
drop policy if exists "Admins can update menu images" on storage.objects;
drop policy if exists "Admins can delete menu images" on storage.objects;

create policy "Admins can read menu images"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'menu-images' and exists (select 1 from public.profiles p
         where p.id = (select auth.uid()) and p.role = 'admin'));

create policy "Admins can upload menu images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'menu-images' and exists (select 1 from public.profiles p
              where p.id = (select auth.uid()) and p.role = 'admin'));

create policy "Admins can update menu images"
  on storage.objects for update
  to authenticated
  using      (bucket_id = 'menu-images' and exists (select 1 from public.profiles p
              where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (bucket_id = 'menu-images' and exists (select 1 from public.profiles p
              where p.id = (select auth.uid()) and p.role = 'admin'));

create policy "Admins can delete menu images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'menu-images' and exists (select 1 from public.profiles p
         where p.id = (select auth.uid()) and p.role = 'admin'));

-- ---------------------------------------------------------------------
-- 7. SEED DATA — 12 dishes (only inserted when the menu is empty)
--    Images live in /public/images of the web app. Admin uploads go to
--    the "menu-images" storage bucket instead.
-- ---------------------------------------------------------------------

insert into public.menu_items (name, description, price, category, image_url, available)
select * from (values
  ('Beef Suya Skewers',
   'Flame-grilled beef dusted with spicy yaji, served with onions, tomatoes and cabbage.',
   3500.00, 'Starters', '/images/suya.jpg', true),
  ('Goat Meat Pepper Soup',
   'Tender goat in a fiery, aromatic broth with uziza and scent leaves.',
   4500.00, 'Starters', '/images/pepper-soup.jpg', true),
  ('Crispy Spring Rolls',
   'Golden vegetable rolls with a sweet chilli dipping sauce.',
   3000.00, 'Starters', '/images/spring-rolls.jpg', true),
  ('Smoky Party Jollof & Chicken',
   'Firewood-style jollof rice, grilled chicken leg and sweet fried plantain.',
   6500.00, 'Mains', '/images/jollof.jpg', true),
  ('Egusi Soup & Pounded Yam',
   'Rich melon-seed soup with spinach and assorted meat, served with smooth pounded yam.',
   7500.00, 'Mains', '/images/egusi.jpg', true),
  ('Classic Cheeseburger & Fries',
   'Juicy beef patty, cheddar, lettuce, tomato and house sauce with crispy fries.',
   7000.00, 'Mains', '/images/burger.jpg', true),
  ('Margherita Pizza',
   'Wood-fired crust, San Marzano tomato, fresh mozzarella and basil.',
   8500.00, 'Mains', '/images/pizza.jpg', true),
  ('Chilled Zobo',
   'Hibiscus drink infused with ginger, pineapple and cloves. Served ice cold.',
   1500.00, 'Drinks', '/images/zobo.jpg', true),
  ('Chapman',
   'Nigeria''s favourite fizzy fruit cocktail with cucumber and orange.',
   2500.00, 'Drinks', '/images/chapman.jpg', true),
  ('Mango Smoothie',
   'Thick, creamy blend of ripe mangoes and yoghurt.',
   3000.00, 'Drinks', '/images/mango-smoothie.jpg', true),
  ('Puff-Puff with Honey',
   'Warm, fluffy fried dough balls dusted with sugar and drizzled with honey.',
   2000.00, 'Desserts', '/images/puff-puff.jpg', true),
  ('Chocolate Lava Cake',
   'Molten chocolate centre with a scoop of vanilla ice cream.',
   4500.00, 'Desserts', '/images/lava-cake.jpg', true)
) as seed(name, description, price, category, image_url, available)
where not exists (select 1 from public.menu_items);

-- ---------------------------------------------------------------------
-- 8. DEFAULT STAFF ACCOUNTS (idempotent seed for development)
--    Admin   → admin@mamaput.com   / Admin1234!    (opens /admin)
--    Kitchen → kitchen@mamaput.com / Kitchen1234!  (opens /kitchen)
--    Change passwords or delete these accounts in Authentication → Users
--    before going live.
-- ---------------------------------------------------------------------

do $$
declare
  staff record;
  uid   uuid;
begin
  for staff in
    select * from (values
      ('00000000-0000-0000-0000-0000000000a1'::uuid, 'admin@mamaput.com',   'Admin1234!',   'admin'),
      ('00000000-0000-0000-0000-0000000000b2'::uuid, 'kitchen@mamaput.com', 'Kitchen1234!', 'kitchen')
    ) as t(default_id, email, plain_pw, role)
  loop
    select u.id into uid from auth.users u where u.email = staff.email limit 1;

    if uid is null then
      uid := staff.default_id;
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) values (
        '00000000-0000-0000-0000-000000000000',
        uid,
        'authenticated',
        'authenticated',
        staff.email,
        extensions.crypt(staff.plain_pw, extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now(),
        '', '', '', ''
      );

      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(),
        uid,
        uid::text,
        jsonb_build_object('sub', uid::text, 'email', staff.email, 'email_verified', true),
        'email',
        now(),
        now(),
        now()
      );
    end if;

    insert into public.profiles (id, role)
    values (uid, staff.role)
    on conflict (id) do update set role = excluded.role;
  end loop;
exception
  when others then
    raise notice 'Skipped automatic auth.users seed (%). Create staff users in Dashboard → Authentication → Users and insert their UUIDs into public.profiles.', sqlerrm;
end $$;


-- ---------------------------------------------------------------------
-- 9. RESTAURANT TABLES & NFC / DELIVERY LINK SUPPORT
-- ---------------------------------------------------------------------

alter table public.orders
  alter column phone set default '',
  alter column email set default '';

create table if not exists public.restaurant_tables (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (char_length(code) between 1 and 40),
  label      text not null check (char_length(label) between 1 and 80),
  created_at timestamptz not null default now()
);

grant select on public.restaurant_tables to anon, authenticated;
grant insert, update, delete on public.restaurant_tables to authenticated;

alter table public.restaurant_tables enable row level security;

drop policy if exists "Anyone can read restaurant tables"   on public.restaurant_tables;
drop policy if exists "Admins can insert restaurant tables" on public.restaurant_tables;
drop policy if exists "Admins can update restaurant tables" on public.restaurant_tables;
drop policy if exists "Admins can delete restaurant tables" on public.restaurant_tables;

create policy "Anyone can read restaurant tables"
  on public.restaurant_tables for select
  to anon, authenticated
  using (true);

create policy "Admins can insert restaurant tables"
  on public.restaurant_tables for insert
  to authenticated
  with check (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role = 'admin'));

create policy "Admins can update restaurant tables"
  on public.restaurant_tables for update
  to authenticated
  using      (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role = 'admin'));

create policy "Admins can delete restaurant tables"
  on public.restaurant_tables for delete
  to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.role = 'admin'));

insert into public.restaurant_tables (code, label)
select * from (values
  ('1', 'Table 1'), ('2', 'Table 2'), ('3', 'Table 3'), ('4', 'Table 4'), ('5', 'Table 5'),
  ('6', 'Table 6'), ('7', 'Table 7'), ('8', 'Table 8'), ('9', 'Table 9'), ('10', 'Table 10')
) as seed(code, label)
where not exists (select 1 from public.restaurant_tables);

-- ---------------------------------------------------------------------
-- 10. BEST SELLERS, PROTEINS CATEGORY & KITCHEN AVAILABILITY ACCESS
-- ---------------------------------------------------------------------

alter table public.menu_items
  add column if not exists best_seller boolean not null default false;

alter table public.menu_items drop constraint if exists menu_items_category_check;
alter table public.menu_items add constraint menu_items_category_check
  check (category in ('Starters', 'Mains', 'Proteins', 'Drinks', 'Desserts'));

drop policy if exists "Kitchen can update menu availability" on public.menu_items;
create policy "Kitchen can update menu availability"
  on public.menu_items for update
  to authenticated
  using      (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role in ('admin', 'kitchen')))
  with check (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role in ('admin', 'kitchen')));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'menu_items'
  ) then
    alter publication supabase_realtime add table public.menu_items;
  end if;
end $$;

update public.menu_items
   set best_seller = true
 where name in (
   'Beef Suya Skewers',
   'Smoky Party Jollof & Chicken',
   'Egusi Soup & Pounded Yam',
   'Chapman',
   'Chocolate Lava Cake'
 );

insert into public.menu_items (name, description, price, category, image_url, available, best_seller)
select * from (values
  ('Spicy Peppered Asun (Goat Meat)',
   'Flame-roasted cubed goat meat tossed in fiery habanero pepper sauce and red onions.',
   4500.00, 'Proteins', '/images/asun.jpg', true, true),
  ('Peppered Grilled Turkey Wings',
   'Juicy marinated turkey wings slow-grilled and glazed in smoky peppered sauce.',
   4000.00, 'Proteins', '/images/turkey.jpg', true, true),
  ('Crispy Fried Croaker Fish',
   'Seasoned croaker fish steaks fried golden and topped with saut�ed peppers and onions.',
   5000.00, 'Proteins', '/images/fish.jpg', true, false),
  ('Peppered Giant Snails',
   'Tender giant snails saut�ed in rich ata-rodo pepper sauce with crunchy onion rings.',
   5500.00, 'Proteins', '/images/snail.jpg', true, false),
  ('Creamy Tigernut Drink (Kunu Aya)',
   'Chilled velvety blend of tigernuts, sweet dates, coconut and fresh ginger.',
   2000.00, 'Drinks', '/images/kunu.jpg', true, true),
  ('Fresh Pineapple & Ginger Juice',
   'Cold-pressed sweet pineapple juice with a zesty fresh ginger and mint kick.',
   2200.00, 'Drinks', '/images/pineapple-ginger.jpg', true, false),
  ('Caramelised Plantain & Ice Cream',
   'Warm cinnamon-glazed sweet plantain medallions with a scoop of vanilla ice cream.',
   3500.00, 'Desserts', '/images/plantain-icecream.jpg', true, true),
  ('Coconut Parfait & Chin-Chin Crumble',
   'Creamy yoghurt layered with toasted coconut, honey and crunchy house-baked chin-chin.',
   3000.00, 'Desserts', '/images/parfait.jpg', true, false)
) as seed(name, description, price, category, image_url, available, best_seller)
where not exists (
  select 1 from public.menu_items m where m.name = seed.name
);

-- ---------------------------------------------------------------------
-- 11. LIVE ORDER TRACKING, RESTAURANT SETTINGS & WAITER CALLS
-- ---------------------------------------------------------------------

create table if not exists public.order_tracking (
  id             uuid primary key references public.orders (id) on delete cascade,
  status         text not null,
  payment_status text not null,
  updated_at     timestamptz not null default now()
);

grant select on public.order_tracking to anon, authenticated;
alter table public.order_tracking enable row level security;

drop policy if exists "Anyone can read order tracking by id" on public.order_tracking;
create policy "Anyone can read order tracking by id"
  on public.order_tracking for select
  to anon, authenticated
  using (true);

create or replace function public.sync_order_tracking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.order_tracking (id, status, payment_status, updated_at)
  values (new.id, new.status, new.payment_status, now())
  on conflict (id) do update
    set status = excluded.status,
        payment_status = excluded.payment_status,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_sync_tracking on public.orders;
create trigger orders_sync_tracking
  after insert or update of status, payment_status on public.orders
  for each row execute function public.sync_order_tracking();

create table if not exists public.restaurant_settings (
  id                  integer primary key default 1 check (id = 1),
  call_waiter_enabled boolean not null default true,
  opening_time        text not null default '08:00',
  closing_time        text not null default '23:00',
  hours_enabled       boolean not null default true,
  signature_dish_id   uuid references public.menu_items(id) on delete set null,
  updated_at          timestamptz not null default now()
);

insert into public.restaurant_settings (id, call_waiter_enabled, opening_time, closing_time, hours_enabled)
values (1, true, '08:00', '23:00', true)
on conflict (id) do nothing;

grant select on public.restaurant_settings to anon, authenticated;
grant update on public.restaurant_settings to authenticated;
alter table public.restaurant_settings enable row level security;

drop policy if exists "Anyone can read restaurant settings" on public.restaurant_settings;
create policy "Anyone can read restaurant settings"
  on public.restaurant_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins can update restaurant settings" on public.restaurant_settings;
create policy "Admins can update restaurant settings"
  on public.restaurant_settings for update
  to authenticated
  using      (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role = 'admin'));

create table if not exists public.waiter_calls (
  id            uuid primary key default gen_random_uuid(),
  table_label   text not null check (char_length(table_label) between 1 and 80),
  reason        text not null check (char_length(reason) between 1 and 120),
  customer_name text not null default '' check (char_length(customer_name) <= 120),
  status        text not null default 'pending' check (status in ('pending', 'resolved')),
  created_at    timestamptz not null default now()
);

grant insert (id, table_label, reason, customer_name) on public.waiter_calls to anon, authenticated;
grant select, update, delete on public.waiter_calls to authenticated;
alter table public.waiter_calls enable row level security;

drop policy if exists "Customers can call waiter when enabled" on public.waiter_calls;
create policy "Customers can call waiter when enabled"
  on public.waiter_calls for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and exists (
      select 1 from public.restaurant_settings s
       where s.id = 1 and s.call_waiter_enabled = true
    )
  );

drop policy if exists "Staff can read waiter calls" on public.waiter_calls;
create policy "Staff can read waiter calls"
  on public.waiter_calls for select
  to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.role in ('admin', 'kitchen')));

drop policy if exists "Staff can update waiter calls" on public.waiter_calls;
create policy "Staff can update waiter calls"
  on public.waiter_calls for update
  to authenticated
  using      (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role in ('admin', 'kitchen')))
  with check (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role in ('admin', 'kitchen')));

drop policy if exists "Staff can delete waiter calls" on public.waiter_calls;
create policy "Staff can delete waiter calls"
  on public.waiter_calls for delete
  to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.role in ('admin', 'kitchen')));

-- ---------------------------------------------------------------------
-- 12. ADMIN STAFF MANAGEMENT & PASSWORD RESET RPCS
-- ---------------------------------------------------------------------

create or replace function public.admin_list_staff()
returns table (
  id         uuid,
  email      text,
  role       text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.role = 'admin'
  ) then
    raise exception 'Access denied: only admins can view staff accounts';
  end if;

  return query
    select p.id, coalesce(u.email::text, ''), p.role, p.created_at
      from public.profiles p
      join auth.users u on u.id = p.id
     order by p.created_at asc;
end;
$$;

create or replace function public.admin_create_staff(
  p_email    text,
  p_password text,
  p_role     text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_email text := lower(btrim(p_email));
  new_uid     uuid;
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.role = 'admin'
  ) then
    raise exception 'Access denied: only admins can create staff accounts';
  end if;

  if clean_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address';
  end if;

  if char_length(coalesce(p_password, '')) < 6 then
    raise exception 'Password must be at least 6 characters';
  end if;

  if p_role not in ('admin', 'kitchen') then
    raise exception 'Role must be admin or kitchen';
  end if;

  select u.id into new_uid from auth.users u where lower(u.email) = clean_email limit 1;

  if new_uid is not null then
    raise exception 'An account with email % already exists', clean_email;
  end if;

  new_uid := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000',
    new_uid,
    'authenticated',
    'authenticated',
    clean_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    new_uid,
    new_uid::text,
    jsonb_build_object('sub', new_uid::text, 'email', clean_email, 'email_verified', true),
    'email',
    now(),
    now(),
    now()
  );

  insert into public.profiles (id, role)
  values (new_uid, p_role);

  return new_uid;
end;
$$;

create or replace function public.admin_update_staff(
  p_user_id      uuid,
  p_new_role     text default null,
  p_new_password text default null,
  p_new_email    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.role = 'admin'
  ) then
    raise exception 'Access denied: only admins can update staff accounts';
  end if;

  if p_new_role is not null then
    if p_new_role not in ('admin', 'kitchen') then
      raise exception 'Role must be admin or kitchen';
    end if;
    if p_user_id = (select auth.uid()) and p_new_role <> 'admin' then
      raise exception 'You cannot remove your own admin role';
    end if;
    update public.profiles set role = p_new_role where id = p_user_id;
  end if;

  if p_new_password is not null and btrim(p_new_password) <> '' then
    if char_length(p_new_password) < 6 then
      raise exception 'Password must be at least 6 characters';
    end if;
    update auth.users
       set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
           updated_at = now()
     where id = p_user_id;
  end if;
end;
$$;

grant execute on function public.admin_list_staff() to authenticated;
grant execute on function public.admin_create_staff(text, text, text) to authenticated;
grant execute on function public.admin_update_staff(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 12. EXTENSIONS, INDEXES & RPC PRIVILEGE HARDENING
-- ---------------------------------------------------------------------

create extension if not exists pg_trgm with schema extensions;
create extension if not exists hypopg with schema extensions;
create extension if not exists index_advisor with schema extensions cascade;

create index if not exists restaurant_settings_signature_dish_id_idx
  on public.restaurant_settings (signature_dish_id);

create index if not exists orders_status_created_at_idx
  on public.orders (status, created_at desc);

revoke all on function public.sync_order_tracking() from public, anon, authenticated;
revoke all on function public.admin_list_staff() from public, anon;
revoke all on function public.admin_create_staff(text, text, text) from public, anon;
revoke all on function public.admin_update_staff(uuid, text, text, text) from public, anon;