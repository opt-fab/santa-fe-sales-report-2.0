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
-- 4. RLS (Row Level Security) — ปิดไว้ก่อน เพื่อ migrate ง่าย
--    ค่อยเปิดและทำ policy ทีหลัง
-- ──────────────────────────────────────────────
alter table public.sales_data disable row level security;
alter table public.plan_sale  disable row level security;
alter table public.branches   disable row level security;

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

-- ✅ DONE — ตรวจดูได้ที่ Database → Tables
