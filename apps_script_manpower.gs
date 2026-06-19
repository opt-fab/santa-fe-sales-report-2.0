/**
 * ════════════════════════════════════════════════════════
 * Google Apps Script — Manpower handler
 * เพิ่มโค้ดด้านล่างนี้ไปใน Apps Script Web App ตัวเดียวกับที่
 * SHEETS_WEBAPP_URL ของแอปชี้อยู่ (อันที่ handle "submit_sales" /
 * "save_plan" อยู่แล้ว) — แล้ว Deploy → "Manage deployments" →
 * แก้ deployment เดิม → New version → Deploy
 *
 * จะสร้าง 2 sheet อัตโนมัติเมื่อเรียกครั้งแรก:
 *   • "Manpower"        — 1 row ต่อ (branch+year+month) — upsert
 *   • "Manpower_Log"    — append-only log (เก็บประวัติทุกครั้งที่บันทึก)
 * ════════════════════════════════════════════════════════
 */

// ─── ปรับชื่อ tab ได้ตามต้องการ ───
const MP_SHEET     = "Manpower";
const MP_LOG_SHEET = "Manpower_Log";

// header order — ต้องตรงกับ payload จากฝั่งแอป
const MP_HEADERS = [
  "branch_code","branch_name","district_manager","year","month",
  "rgm","sam","am","ss",
  "k_basic_pt","k_basic_ft","k_silver_pt","k_silver_ft","k_gold_pt","k_gold_ft",
  "s_basic_pt","s_basic_ft","s_silver_pt","s_silver_ft","s_gold_pt","s_gold_ft",
  "pt_8h","pt_dual40","pt_45h","dual_ft","dual_pt",
  "saved_by","updated_at"
];

/**
 * เพิ่ม case นี้ใน switch ของ doPost(e) / doGet(e) เดิม
 * (สมมุติว่า code เดิมอ่าน action จาก e.parameter.action)
 *
 * Example wiring:
 *
 *   function doPost(e) {
 *     const action = e.parameter.action;
 *     switch (action) {
 *       case "submit_sales": return handleSubmitSales_(e);
 *       case "save_plan":    return handleSavePlan_(e);
 *       case "save_manpower":   return handleSaveManpower_(e);   // ← เพิ่ม
 *       case "delete_manpower": return handleDeleteManpower_(e); // ← เพิ่ม
 *       default: return _jsonOk_({ skipped: true });
 *     }
 *   }
 */

// ────────────────────────────────────────────────────────
// SAVE manpower (upsert by branch_code + year + month)
// ────────────────────────────────────────────────────────
function handleSaveManpower_(e) {
  const p = e.parameter || {};
  if (!p.branch_code || !p.year || !p.month) {
    return _jsonOk_({ ok: false, error: "missing branch_code/year/month" });
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = _ensureMpSheet_(ss);

  const data = sh.getDataRange().getValues();   // includes header
  const keyCol = MP_HEADERS.indexOf("branch_code");
  const yCol   = MP_HEADERS.indexOf("year");
  const mCol   = MP_HEADERS.indexOf("month");

  // find existing row (skip header at row 0)
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyCol]) === String(p.branch_code)
        && Number(data[i][yCol]) === Number(p.year)
        && Number(data[i][mCol]) === Number(p.month)) {
      foundRow = i + 1;  // 1-based
      break;
    }
  }

  const now = new Date();
  const row = MP_HEADERS.map(h => {
    if (h === "updated_at") return now;
    const v = p[h];
    if (v == null || v === "") {
      // numeric fields default to 0
      if (h !== "branch_code" && h !== "branch_name" && h !== "district_manager" && h !== "saved_by") return 0;
      return "";
    }
    return v;
  });

  if (foundRow > 0) {
    sh.getRange(foundRow, 1, 1, MP_HEADERS.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }

  // append to log (every save = 1 log row)
  _appendMpLog_(ss, "save", p, now);

  return _jsonOk_({ ok: true, upserted: true, row: foundRow > 0 ? foundRow : sh.getLastRow() });
}

// ────────────────────────────────────────────────────────
// DELETE manpower (by branch_code + year + month)
// ────────────────────────────────────────────────────────
function handleDeleteManpower_(e) {
  const p = e.parameter || {};
  if (!p.branch_code || !p.year || !p.month) {
    return _jsonOk_({ ok: false, error: "missing branch_code/year/month" });
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = _ensureMpSheet_(ss);

  const data = sh.getDataRange().getValues();
  const keyCol = MP_HEADERS.indexOf("branch_code");
  const yCol   = MP_HEADERS.indexOf("year");
  const mCol   = MP_HEADERS.indexOf("month");

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][keyCol]) === String(p.branch_code)
        && Number(data[i][yCol]) === Number(p.year)
        && Number(data[i][mCol]) === Number(p.month)) {
      sh.deleteRow(i + 1);
    }
  }

  _appendMpLog_(ss, "delete", p, new Date());
  return _jsonOk_({ ok: true, deleted: true });
}

// ────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────
function _ensureMpSheet_(ss) {
  let sh = ss.getSheetByName(MP_SHEET);
  if (!sh) {
    sh = ss.insertSheet(MP_SHEET);
    sh.appendRow(MP_HEADERS);
    sh.setFrozenRows(1);
  } else {
    // ถ้า header ยังไม่มี/ไม่ตรง → reset (ครั้งแรกเท่านั้น)
    const firstRow = sh.getRange(1, 1, 1, Math.max(MP_HEADERS.length, sh.getLastColumn())).getValues()[0];
    if (firstRow[0] !== "branch_code") {
      sh.clear();
      sh.appendRow(MP_HEADERS);
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function _appendMpLog_(ss, action, p, when) {
  let sh = ss.getSheetByName(MP_LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(MP_LOG_SHEET);
    sh.appendRow(["ts","action","branch_code","branch_name","year","month","by","payload"]);
    sh.setFrozenRows(1);
  }
  sh.appendRow([
    when, action,
    p.branch_code || "",
    p.branch_name || "",
    p.year || "",
    p.month || "",
    p.saved_by || p.deleted_by || "",
    JSON.stringify(p)
  ]);
}

function _jsonOk_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
