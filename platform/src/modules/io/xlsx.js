// غلاف Excel/CSV الوحيد — كل قراءة/كتابة ملفات جداول تمر من هنا.
// SheetJS CE 0.20.3 مورَّد محلياً (vendor/xlsx) لتفادي ثغرات نسخة npm القديمة ولإلغاء
// الاعتماد على الشبكة وقت البناء. CSV بترميز UTF-8 مع BOM كي لا تتشوه العربية في Excel.
import * as XLSX from '../../../vendor/xlsx/xlsx.mjs';

const BOM = '﻿';

// الأرقام الهندية والفواصل العربية → صيغة قياسية قبل أي parse رقمي
export function normalizeDigits(s) {
  if (s == null) return s;
  return String(s)
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/٬/g, ',').replace(/٫/g, '.').replace(/،/g, ',');
}

// حارس حقن المعادلات: خلية تبدأ بـ = + - @ تُسبق بفاصلة عليا عند التصدير
function guardCell(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return `'${v}`;
  return v;
}

/** قراءة ملف مرفوع (xlsx/xls/csv) → { headers: string[], rows: string[][] } — كل القيم نصية خام. */
export function parseWorkbook(buffer, fileName = '') {
  const isCsv = /\.csv$/i.test(fileName) || looksLikeText(buffer);
  const wb = isCsv
    ? XLSX.read(stripBom(buffer.toString('utf8')), { type: 'string', raw: true })
    : XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { headers: [], rows: [] };
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
  if (!aoa.length) return { headers: [], rows: [] };
  // إزالة فاصلة الحماية العليا التي أضافها guardCell عند التصدير (نفس سلوك Excel: الفاصلة
  // البادئة قبل = + - @ علامة تنسيق لا محتوى) — يحفظ تطابق التصدير→الاستيراد حرفياً.
  const unguard = (s) => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);
  const headers = aoa[0].map((h) => String(h ?? '').trim());
  const rows = aoa.slice(1)
    .map((r) => headers.map((_, i) => unguard(String(r[i] ?? '').trim())))
    .filter((r) => r.some((c) => c !== ''));
  return { headers, rows };
}

function looksLikeText(buf) {
  const head = buf.subarray(0, 4);
  // xlsx = zip (PK), xls = D0CF
  if (head[0] === 0x50 && head[1] === 0x4b) return false;
  if (head[0] === 0xd0 && head[1] === 0xcf) return false;
  return true;
}
function stripBom(s) { return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; }

/** بناء ملف تصدير. rows = مصفوفة كائنات، columns = [{key, labelAr}]. */
export function buildExport({ columns, rows, format = 'xlsx', sheetName = 'بيانات', rtl = true }) {
  const headers = columns.map((c) => c.labelAr);
  const data = rows.map((r) => columns.map((c) => guardCell(r[c.key] ?? '')));
  if (format === 'csv') {
    const lines = [headers, ...data].map((row) =>
      row.map((v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','));
    return { buffer: Buffer.from(BOM + lines.join('\r\n'), 'utf8'), mime: 'text/csv; charset=utf-8', ext: 'csv' };
  }
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(14, (c.labelAr || '').length + 6) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  if (rtl) wb.Workbook = { Views: [{ RTL: true }] };
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
  return { buffer, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
}
