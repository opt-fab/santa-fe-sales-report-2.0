/**
 * Santa Fe — Supabase ↔ Google Sheets
 *
 * 2 ทิศทาง:
 *  - PULL  : ทุก 1 นาที sync ข้อมูลล่าสุดจาก Supabase ลง Sheet (safety net)
 *  - PUSH  : รับ POST จาก index.html ทุกครั้งที่ user submit/edit (real-time)
 *
 * วิธีใช้:
 *  1. Sheet ใหม่ → Extensions → Apps Script
 *  2. Paste โค้ดทั้งหมด → Save (ตั้งชื่อ "Santa Fe Sync")
 *  3. รัน setupTriggers() 1 ครั้ง (Authorize)
 *  4. Deploy → New deployment → Web app
 *     - Execute as: Me
 *     - Who has access: Anyone
 *     - Deploy → คัดลอก Web app URL
 *  5. ส่ง URL ให้ผม → ผมใส่ใน index.html ให้
 */

// ════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════
const SUPABASE_URL = "https://zroqklbobvixyohfaimc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpyb3FrbGJvYnZpeHlvaGZhaW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NTUzNjMsImV4cCI6MjA5NDIzMTM2M30.BSwbqeQ1jsyvATpOkJ-wV04TGZacagaNpj6S4fPC-J4";

// Sheet ID ปลายทาง — hardcode เพื่อให้ทำงานได้ทั้ง standalone และ bound script
const SHEET_ID = "1OwmLDyuPOKM2rNq4yaXHpVE6Mvfo6Jntk0kJukPHOU4";

// Header ของแต่ละ sheet (ลำดับคอลัมน์)
const SALES_HEADERS = [
  "id", "branch_code", "branch_name", "district_manager", "submitter_name",
  "submit_date", "submit_time_slot", "submitted_at",
  "plan_sale", "actual_sale",
  "sale_dine_in", "sale_take_away", "sale_grab", "sale_lineman", "sale_shopeefood",
  "total_trans", "trans_dine_in", "trans_take_away", "trans_grab", "trans_lineman", "trans_shopeefood",
  "customer", "labour_hour", "labour_baht",
  "edit_count", "last_edited_at"
];

const PLAN_HEADERS = [
  "id", "branch_code", "plan_date", "plan_amount", "updated_at"
];

const BRANCHES_HEADERS = [
  "branch_code", "branch_name", "district_manager"
];

const MANPOWER_HEADERS = [
  "id", "branch_code", "year", "month",
  // Plan + Actual Team (admin ตั้ง plan_*; user กรอก actual_team)
  "plan_team", "plan_staff", "actual_team",
  // Service (5 ช่อง: FT/PT/Basic/Silver/Gold)
  "s_ft", "s_pt", "s_basic", "s_silver", "s_gold",
  // Kitchen (5 ช่อง)
  "k_ft", "k_pt", "k_basic", "k_silver", "k_gold",
  // รายละเอียด Part-time
  "pt_8h", "pt_dual40", "pt_45h",
  // รายละเอียด ทวิภาคี
  "dual_ft", "dual_pt",
  // Legacy (per-tier PT/FT + ทีมผู้จัดการเก่า — เผื่อข้อมูลเก่า)
  "rgm", "sam", "am", "ss",
  "k_basic_pt", "k_basic_ft", "k_silver_pt", "k_silver_ft", "k_gold_pt", "k_gold_ft",
  "s_basic_pt", "s_basic_ft", "s_silver_pt", "s_silver_ft", "s_gold_pt", "s_gold_ft",
  "created_at", "updated_at"
];

const USERS_HEADERS = [
  "code", "name", "nick", "role", "brand", "cross_brand",
  "dm", "branch_code", "branch_name", "active", "created_at", "updated_at"
];

// ════════════════════════════════════════════
// PUSH — รับ POST จาก index.html → trigger full sync
// (Supabase = source of truth → re-fetch ทั้ง table แม่นยำที่สุด)
// ════════════════════════════════════════════
function doPost(e) {
  try {
    const action = (e.parameter || {}).action;

    if (action === "submit_sales") {
      syncTable("sales_data", "Sales", SALES_HEADERS);
    }
    else if (action === "save_plan") {
      syncTable("plan_sale", "Plan", PLAN_HEADERS);
    }
    else if (action === "save_manpower" || action === "delete_manpower") {
      syncTable("manpower", "Manpower", MANPOWER_HEADERS);
    }
    else if (action === "save_user" || action === "delete_user") {
      syncTable("users", "Users", USERS_HEADERS);
    }
    else {
      return _resp({ ok: false, error: "Unknown action: " + action });
    }

    return _resp({ ok: true });
  } catch (err) {
    Logger.log("doPost error: " + err.message);
    return _resp({ ok: false, error: err.message });
  }
}

// GET handler (สำหรับ ping ทดสอบ)
function doGet() {
  return _resp({ ok: true, msg: "Santa Fe Sheets sync — alive" });
}

function _resp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════
// PULL — sync ทั้ง table ทุก 1 นาที (safety net)
// ════════════════════════════════════════════
function syncAll() {
  syncTable("sales_data", "Sales",    SALES_HEADERS);
  syncTable("plan_sale",  "Plan",     PLAN_HEADERS);
  syncTable("branches",   "Branches", BRANCHES_HEADERS);
  syncTable("manpower",   "Manpower", MANPOWER_HEADERS);
  syncTable("users",      "Users",    USERS_HEADERS);
}

function syncTable(tableName, sheetName, headers) {
  // manpower: เรียงตาม year+month (ใหม่สุด → เก่าสุด) แทน id
  // users: ไม่มี id → เรียงตาม code
  let orderBy = "id.desc";
  if (tableName === "manpower") orderBy = "year.desc,month.desc,branch_code.asc";
  else if (tableName === "users") orderBy = "role.asc,code.asc";

  const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=*&order=${orderBy}&limit=10000`;
  const response = UrlFetchApp.fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log(`[${tableName}] ${response.getContentText()}`);
    return;
  }

  const data = JSON.parse(response.getContentText());
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground("#f26c1c").setFontColor("#fff").setFontWeight("bold");
  sheet.setFrozenRows(1);

  if (data.length) {
    const rows = data.map(r => headers.map(h => {
      const v = r[h];
      return (v === undefined || v === null) ? "" : v;
    }));
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // timestamp
  const tz = "Asia/Bangkok";
  const stamp = Utilities.formatDate(new Date(), tz, "dd/MM/yyyy HH:mm:ss");
  sheet.getRange(1, headers.length + 2).setValue("Last sync:");
  sheet.getRange(1, headers.length + 3).setValue(stamp);

  Logger.log(`[${tableName}] ${data.length} rows`);
}

// ════════════════════════════════════════════
// Triggers (auto-sync ทุก 1 นาที)
// ════════════════════════════════════════════
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncAll").timeBased().everyMinutes(1).create();
  syncAll();
  Logger.log("✅ Auto-sync ทุก 1 นาที + Web App รับ POST จาก app");
}

function stopTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  SpreadsheetApp.getUi().alert("Stopped.");
}

// ════════════════════════════════════════════
// Menu
// ════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🔄 Supabase Sync")
    .addItem("Sync ตอนนี้", "syncAll")
    .addItem("Setup auto (ทุก 1 นาที)", "setupTriggers")
    .addItem("Stop auto-sync", "stopTriggers")
    .addToUi();
}
