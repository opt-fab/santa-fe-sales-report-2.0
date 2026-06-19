-- ════════════════════════════════════════════════════════
-- Santa Fe Sales Report — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- 1. SALES_DATA — ทุกการส่งยอดขาย (unique ต่อ branch+date+slot)
-- ──────────────────────────────────────────────
create table if not exists public.sales_data (
  id              bigserial primary key,
  -- identification
  branch_code     text not null,
  branch_name     text,
  district_manager text,
  submitter_name  text,
  -- key
  submit_date     date not null,
  submit_time_slot text not null check (submit_time_slot in ('16.00', 'สิ้นวัน')),
  submitted_at    timestamptz not null default now(),
  -- sales
  plan_sale       numeric default 0,
  actual_sale     numeric default 0,
  sale_dine_in    numeric default 0,
  sale_take_away  numeric default 0,
  sale_grab       numeric default 0,
  sale_lineman    numeric default 0,
  sale_shopeefood numeric default 0,
  -- transactions
  total_trans     integer default 0,
  trans_dine_in   integer default 0,
  trans_take_away integer default 0,
  trans_grab      integer default 0,
  trans_lineman   integer default 0,
  trans_shopeefood integer default 0,
  -- customer + labour
  customer        integer default 0,
  labour_hour     numeric default 0,
  labour_baht     numeric default 0,
  -- edit tracking
  edit_count      integer default 0,
  last_edited_at  timestamptz,
  -- 1 record ต่อ branch+date+slot
  constraint uq_sales_branch_date_slot unique (branch_code, submit_date, submit_time_slot)
);

create index if not exists idx_sales_branch_date on public.sales_data(branch_code, submit_date desc);
create index if not exists idx_sales_date_slot   on public.sales_data(submit_date, submit_time_slot);

-- ──────────────────────────────────────────────
-- 2. PLAN_SALE — Plan Sale รายวัน (1 record ต่อ branch+date)
-- ──────────────────────────────────────────────
create table if not exists public.plan_sale (
  id           bigserial primary key,
  branch_code  text not null,
  plan_date    date not null,
  plan_amount  numeric not null default 0,
  updated_at   timestamptz not null default now(),
  constraint uq_plan_branch_date unique (branch_code, plan_date)
);

create index if not exists idx_plan_branch_date on public.plan_sale(branch_code, plan_date);

-- ──────────────────────────────────────────────
-- 3. BRANCHES (master — สำหรับ Telegram service ในอนาคต)
-- ──────────────────────────────────────────────
create table if not exists public.branches (
  branch_code      text primary key,
  branch_name      text not null,
  district_manager text not null
);

-- ──────────────────────────────────────────────
-- 4. APP_SETTINGS — global flags (test_mode, etc.)
-- ──────────────────────────────────────────────
create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz default now()
);

insert into public.app_settings (key, value) values
  ('test_mode', 'false')
on conflict (key) do nothing;

-- ──────────────────────────────────────────────
-- 5. USERS — บัญชีผู้ใช้งานทุกระดับ (admin/vp/coo/bzm/branch/franchise)
--    Code (PIN) เป็น primary key — สำหรับเข้าระบบ
-- ──────────────────────────────────────────────
create table if not exists public.users (
  code         text primary key,                              -- รหัสล็อกอิน (PIN) — 4 หลัก (สาขา) / 6 หลัก (TM)
  name         text not null,                                 -- ชื่อ-นามสกุล
  nick         text,                                          -- ชื่อเล่น
  role         text not null check (role in ('admin','vp','coo','bzm','branch','franchise')),
  brand        text check (brand in ('santafe','jaedaeng')),
  cross_brand  boolean default false,                         -- admin/coo ที่ดูแลทั้ง 2 brand
  dm           text,                                          -- ชื่อ BZM ที่ดูแล (เฉพาะ role=branch — ใช้ map ใน UI)
  branch_code  text,                                          -- รหัสสาขา (เฉพาะ role=branch)
  branch_name  text,                                          -- ชื่อสาขา (เฉพาะ role=branch)
  active       boolean default true,                          -- ปิดบัญชีโดยไม่ลบ
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_users_role on public.users(role) where active = true;
create index if not exists idx_users_brand on public.users(brand) where active = true;

-- Auto-update updated_at เมื่อ row ถูก update
create or replace function set_users_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_users_updated on public.users;
create trigger trg_users_updated
  before update on public.users
  for each row
  when (old.* is distinct from new.*)
  execute function set_users_updated_at();

-- Seed: ย้าย SPECIAL_USERS ที่ hardcoded ใน index.html มาเก็บใน DB
insert into public.users (code, name, nick, role, brand, cross_brand) values
  ('601183', 'ADMIN',                          'ADMIN',  'admin', 'santafe', true),
  ('480808', 'VP. Santa Fe',                   'VP',     'vp',    'santafe', false),
  ('490033', 'นิรุต เจริญศิลป์',                 'พี่รุต',  'bzm',   'santafe', false),
  ('570998', 'นพชัย จันทร์รุ่ง',                  'พี่นพ',  'bzm',   'santafe', false),
  ('500759', 'พัทธดนย์ วัฒนายุทธ',                'พี่ปิ๊ก', 'bzm',   'santafe', false),
  ('510620', 'สีวิกา สังข์ด้วง',                   'พี่เจี๊ยบ','bzm',   'santafe', false),
  ('520532', 'ศุกร์แสง วัฒนาฟุ้งเจริญ',           'พี่หยี',  'bzm',   'santafe', false),
  ('601338', 'อนุรักษ์ สอนภักดี',                  'พี่เอ็ม', 'bzm',   'santafe', false)
on conflict (code) do nothing;

-- ──────────────────────────────────────────────
-- 6. MANPOWER — กำลังคนต่อสาขา ต่อเดือน
--    16 fields: 4 ผู้จัดการ + 6 ครัว + 6 บริการ
-- ──────────────────────────────────────────────
create table if not exists public.manpower (
  id            bigserial primary key,
  branch_code   text not null,
  year          int  not null,
  month         int  not null check (month between 1 and 12),
  -- ทีมผู้จัดการสาขา (รวมยอด = rgm+sam+am+ss)
  rgm           int default 0,
  sam           int default 0,
  am            int default 0,
  ss            int default 0,
  -- พนักงานครัว (รวมยอด = sum 6 ช่อง)
  k_basic_pt    int default 0,
  k_basic_ft    int default 0,
  k_silver_pt   int default 0,
  k_silver_ft   int default 0,
  k_gold_pt     int default 0,
  k_gold_ft     int default 0,
  -- พนักงานบริการ (รวมยอด = sum 6 ช่อง)
  s_basic_pt    int default 0,
  s_basic_ft    int default 0,
  s_silver_pt   int default 0,
  s_silver_ft   int default 0,
  s_gold_pt     int default 0,
  s_gold_ft     int default 0,
  -- รายละเอียด Part-time (รวมจากครัว+บริการ ที่เป็น PT)
  pt_8h         int default 0,    -- PT 8 ชั่วโมง
  pt_dual40     int default 0,    -- PT ทวิภาคี 40 ชั่วโมง
  pt_45h        int default 0,    -- PT 4-5 ชม
  -- รายละเอียด ทวิภาคี (dual_pt ต้องเท่ากับ pt_dual40)
  dual_ft       int default 0,    -- ทวิภาคี FT
  dual_pt       int default 0,    -- ทวิภาคี PT (= pt_dual40)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_manpower_branch_year_month unique (branch_code, year, month)
);

create index if not exists idx_manpower_year_month on public.manpower(year, month);
create index if not exists idx_manpower_branch     on public.manpower(branch_code, year, month);

-- ALTER (สำหรับตารางที่มีอยู่แล้ว ก่อนเพิ่ม PT-detail + ทวิภาคี) — รัน idempotent
alter table public.manpower add column if not exists pt_8h     int default 0;
alter table public.manpower add column if not exists pt_dual40 int default 0;
alter table public.manpower add column if not exists pt_45h    int default 0;
alter table public.manpower add column if not exists dual_ft   int default 0;
alter table public.manpower add column if not exists dual_pt   int default 0;

drop trigger if exists trg_manpower_updated on public.manpower;
create trigger trg_manpower_updated
  before update on public.manpower
  for each row
  when (old.* is distinct from new.*)
  execute function set_users_updated_at();  -- reuse generic updated_at setter

-- ──────────────────────────────────────────────
-- 7. RLS (Row Level Security) — ปิดไว้ก่อน เพื่อ migrate ง่าย
--    ค่อยเปิดและทำ policy ทีหลัง
-- ──────────────────────────────────────────────
alter table public.sales_data   disable row level security;
alter table public.plan_sale    disable row level security;
alter table public.branches     disable row level security;
alter table public.app_settings disable row level security;
alter table public.users        disable row level security;
alter table public.manpower     disable row level security;

-- ──────────────────────────────────────────────
-- 5. Auto-update last_edited_at เมื่อ row ถูก update
-- ──────────────────────────────────────────────
create or replace function set_last_edited_at()
returns trigger as $$
begin
  new.last_edited_at = now();
  new.edit_count = coalesce(old.edit_count, 0) + 1;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sales_edit on public.sales_data;
create trigger trg_sales_edit
  before update on public.sales_data
  for each row
  when (old.* is distinct from new.*)
  execute function set_last_edited_at();

-- ──────────────────────────────────────────────
-- 8. SALES_EDITS — audit log (เก็บ before/after ทุกครั้งที่ sales_data ถูก UPDATE)
-- ──────────────────────────────────────────────
create table if not exists public.sales_edits (
  id               bigserial primary key,
  sales_id         bigint not null,
  branch_code      text,
  submit_date      date,
  submit_time_slot text,
  edited_at        timestamptz not null default now(),
  edited_by        text,           -- จาก new.submitter_name (best guess)
  old_data         jsonb not null,
  new_data         jsonb not null
);

create index if not exists idx_sales_edits_key  on public.sales_edits(branch_code, submit_date, submit_time_slot);
create index if not exists idx_sales_edits_time on public.sales_edits(edited_at desc);

alter table public.sales_edits disable row level security;

create or replace function trg_capture_sales_edit()
returns trigger as $$
begin
  insert into public.sales_edits (sales_id, branch_code, submit_date, submit_time_slot, edited_by, old_data, new_data)
  values (new.id, new.branch_code, new.submit_date, new.submit_time_slot, new.submitter_name, to_jsonb(old), to_jsonb(new));
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sales_audit on public.sales_data;
create trigger trg_sales_audit
  after update on public.sales_data
  for each row
  when (old.* is distinct from new.*)
  execute function trg_capture_sales_edit();

-- ✅ DONE — ตรวจดูได้ที่ Database → Tables
