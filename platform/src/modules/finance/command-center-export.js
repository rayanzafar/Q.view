// ── مركز القطاع ملفَّ Excel: ستّ أوراقٍ هي فصول الشاشة نفسها ────────────────────────────
//
// الشاشة تقرأ حمولةً واحدةً مُرشَّحةً بالصلاحية (`buildCommandCenterDataset`)، وهذا الملفّ
// يقرأ الحمولة **ذاتها** ثم يكتبها أوراقاً. فما حُجب عن الشاشة محجوبٌ عن الملفّ بالضرورة
// لا بفحصٍ ثانٍ يُنسى: الحجب هنا **بالغياب** لا بقيمةٍ فارغة — سطورُ الكلفة تسقط من الحمولة
// فتسقط من الورقة، وعمودُ الهامش لا يُرسَم أصلاً حين لا يحمله أيُّ مشروع.
//
// وبابٌ واحدٌ يُفحص هنا فوق ما حجبته الحمولة: `export` على `report` — فمن يقرأ الشاشة ليس
// بالضرورة من يُخرج مالَها ملفاً يُرسَل بالبريد.
//
// ── لماذا المُحمِّل يُستدعى كسولاً ─────────────────────────────────────────────────────────
// بانيةُ الحمولة تُستدعى عبر بابِ حقنٍ (`_loaders`) يُغلقه مسارُ التشغيل ويفتحه الاختبار —
// نفسُ عُرف `income-statement.js`. والاستيراد خلفه ديناميٌّ داخل الدالة كي لا يُحمَّل بناءُ
// الحمولة كلُّه في اختبارٍ يمرّر حمولتَه جاهزة. أما حلُّ القطاع فاسمٌ واحدٌ لا يمرّ بذلك الباب،
// فيُستورد ساكناً من الوحدة نفسها.
import { can } from '../../core/rbac/index.js';
import { forbidden } from '../../core/http/errors.js';
import { config } from '../../core/config.js';
import { audit } from '../../core/audit/index.js';
import { targetYear } from '../org/sector-targets.js';
import { MONTHS_AR, riyadhStamp } from '../../core/i18n/time.js';
import { HEALTH_LABELS } from '../../core/i18n/thresholds.js';
import { buildWorkbook } from '../io/xlsx.js';
// القطاع يُحلّ بالقاعدة الواحدة التي تحرس الحمولة والمسار (D6) — لا نسخةَ ثانيةٍ هنا تفترق
// عنها عند أول تعديل. والاستيراد ساكنٌ لأنه اسمٌ واحدٌ لا يمرّ ببابِ الحقن؛ أما بانيةُ الحمولة
// فتبقى كسولةً للسبب المشروح أعلاه.
import { resolveCommandCenterSector } from './command-center.js';
// مصدرُ الإقفال بالعربية من مصدره الواحد (`pl-lines.js`) — الشاشة واللوحة والملفّ تقول الجملة
// نفسها، فلا نسختان تفترقان عند أول تعديلٍ في الصياغة.
import { CLOSED_SOURCE_AR } from './pl-lines.js';
import { G } from '../../web/i18n/glossary.js';

/** بابُ حقنٍ للاختبار وحده — لا يمسّه مسار التشغيل. */
export const _loaders = { buildCommandCenterDataset: null };

async function datasetLoader() {
  if (_loaders.buildCommandCenterDataset) return _loaders.buildCommandCenterDataset;
  const mod = await import('./command-center.js');
  return mod.buildCommandCenterDataset;
}

// ── قراءاتٌ متسامحة ──────────────────────────────────────────────────────────────────────
// الحمولة تحجب بالغياب، فكلُّ قراءةٍ هنا تحتمل غيابَ قسمها كاملاً بلا أن تنكسر.
const arr = (v) => (Array.isArray(v) ? v : []);
const at12 = (a, i) => (Array.isArray(a) ? a[i] : undefined);
const nameOf = (o) => String(o?.name ?? o?.name_ar ?? '').trim();
const idOf = (o) => String(o?.id ?? o?.key ?? '').trim();
const byId = (list) => new Map(arr(list).map((o) => [idOf(o), nameOf(o)]));

// ريالٌ عدداً لا نصّاً ولا هللةً: الغائب خليّةٌ فارغة، والصفرُ المسجَّل يبقى صفراً.
const sar = (halalas) => (halalas == null || halalas === '' ? '' : Math.round(Number(halalas)) / 100);
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? '' : Number(v));
const yesNo = (v) => (v == null ? '' : v ? 'نعم' : 'لا');
const monthName = (m) => (m >= 1 && m <= 12 ? MONTHS_AR[m - 1] : '');
// مجموعُ مصفوفةٍ شهرية: الغياب الكاملُ فراغٌ، وسطرٌ فيه رقمٌ واحدٌ يُجمع ما سُجِّل منه.
const sum12 = (a) => {
  const vals = arr(a).filter((v) => v != null && v !== '');
  return vals.length ? vals.reduce((x, y) => x + Number(y), 0) : null;
};

// ملاحظاتُ الحمولة: مفتاحُها داخليٌّ ونصُّها وحده ما يُقرأ.
const NOTE_AR = Object.freeze({
  costs_hidden: 'سطور الكلفة ونسبة الهامش خارج صلاحيتك، فلا تظهر في هذا الملفّ',
  no_project_plan: 'لا خطة على مستوى المشروع — الخطة تُعتمد للقطاع كله',
  revenue_hidden: 'الإيراد خارج صلاحيتك، فلا يظهر في هذا الملفّ',
  plan_hidden: 'الخطة والمستهدف خارج صلاحيتك، فلا يظهران في هذا الملفّ',
});

// ── الترويسة: من أيِّ قطاعٍ وأيِّ سنةٍ ومتى خرج الملفّ ───────────────────────────────────
// تتكرّر في رأس كل ورقة عمداً: من يقصّ ورقةً ويرسلها وحدها يجب أن تحمل ورقتُه مصدرَها.
const headRows = (sectorName, year, stamp) => ([
  { c0: `مركز القطاع — ${sectorName}` },
  { c0: `السنة: ${year}` },
  { c0: `تاريخ إخراج الملفّ: ${stamp}` },
  { c0: '' },
]);
const withHead = (columns, head, body) => {
  const first = columns[0]?.key;
  return [...head.map((h) => ({ [first]: h.c0 })), ...body];
};

// ── ١) قائمة الدخل: سطرٌ لكل بند، واثنا عشر شهراً فعليةً، ثم الخطة ثم المجموع ─────────────
function plSheet(data, head) {
  const lines = arr(data.lines);
  if (!lines.length) return null;
  const columns = [
    { key: 'line', labelAr: G.lineItem },
    ...MONTHS_AR.map((m, i) => ({ key: `m${i + 1}`, labelAr: m })),
    { key: 'plan', labelAr: 'الخطة' },
    { key: 'total', labelAr: 'المجموع' },
  ];
  const body = lines.map((l) => {
    const row = { line: nameOf(l) || idOf(l) };
    for (let i = 0; i < 12; i++) row[`m${i + 1}`] = sar(at12(l.fin, i));
    row.plan = sar(sum12(l.plan));
    row.total = sar(sum12(l.fin));
    return row;
  });
  return { name: G.incomeStatement, columns, rows: withHead(columns, head, body) };
}

// ── ٢) المشاريع ─────────────────────────────────────────────────────────────────────────
// عمودُ الهامش لا يُرسَم حين لا تحمله الحمولة: الحجب غيابُ عمودٍ لا خليّةٌ فارغة تُسائَل عنها.
function projectsSheet(data, head) {
  const projects = arr(data.projects);
  if (!projects.length) return null;
  const clients = byId(data.clients);
  const depts = byId(data.depts);
  const hasMargin = projects.some((p) => p?.margin_pct != null);
  const columns = [
    { key: 'name', labelAr: G.project },
    { key: 'client', labelAr: G.client },
    { key: 'dept', labelAr: G.departmentWord },
    { key: 'status', labelAr: G.statusWord },
    { key: 'contract', labelAr: `${G.contractValue} (${G.sar})` },
    { key: 'revenue', labelAr: `${G.revenue} في الفترة (${G.sar})` },
    { key: 'remaining', labelAr: `المتبقي (${G.sar})` },
    { key: 'unbilled', labelAr: `مُنجَزٌ بلا فاتورة (${G.sar})` },
    ...(hasMargin ? [{ key: 'margin', labelAr: `${G.margin} %` }] : []),
  ];
  const body = projects.map((p) => ({
    name: nameOf(p),
    client: clients.get(String(p?.client_id ?? '')) || '',
    dept: depts.get(String(p?.dept_id ?? '')) || '',
    status: HEALTH_LABELS[p?.rag] || '',
    contract: sar(p?.contract),
    revenue: sar(sum12(p?.act?.rev)),
    remaining: sar(p?.remaining),
    unbilled: sar(p?.unbilled),
    ...(hasMargin ? { margin: num(p?.margin_pct) } : {}),
  }));
  return { name: G.projects, columns, rows: withHead(columns, head, body) };
}

// ── ٣) الفرص ────────────────────────────────────────────────────────────────────────────
function oppsSheet(data, head) {
  const opps = arr(data.opps);
  if (!opps.length) return null;
  const clients = byId(data.clients);
  const stages = byId(data.stages);
  const columns = [
    { key: 'name', labelAr: 'الفرصة' },
    { key: 'client', labelAr: G.client },
    { key: 'stage', labelAr: G.stage },
    { key: 'value', labelAr: `القيمة (${G.sar})` },
    { key: 'prob', labelAr: `${G.probability} %` },
    { key: 'close', labelAr: `شهر ${G.expectedClose}` },
    { key: 'idle', labelAr: 'أيام بلا حركة' },
    { key: 'stalled', labelAr: G.stalled },
  ];
  const body = opps.map((o) => ({
    name: nameOf(o),
    client: clients.get(String(o?.client_id ?? '')) || '',
    // رمزُ المرحلة لا يُطبع أبداً — بلا اسمٍ عربيٍّ تبقى الخانة فارغة.
    stage: stages.get(String(o?.stage_key ?? '')) || '',
    value: sar(o?.value),
    prob: num(o?.prob),
    close: monthName(Number(o?.close_m)),
    idle: num(o?.idle_days),
    stalled: yesNo(o?.stalled),
  }));
  return { name: G.opportunities, columns, rows: withHead(columns, head, body) };
}

// ── ٤) العملاء ──────────────────────────────────────────────────────────────────────────
// حصةُ الإيراد: تُقرأ من الحمولة إن حملتها، وإلّا تُحسب من إيرادات العملاء أنفسهم. وحين
// يغيب الإيرادُ كلُّه (بابُه مغلق) يسقط العمود لا أن يخرج أصفاراً.
function clientsSheet(data, head) {
  const clients = arr(data.clients);
  if (!clients.length) return null;
  const revenues = clients.map((c) => (c?.revenue ?? c?.revenue_halalas ?? null));
  const shares = clients.map((c) => (c?.share_pct ?? c?.revenue_share_pct ?? null));
  const total = revenues.reduce((a, v) => a + (v == null ? 0 : Number(v)), 0);
  const hasShare = shares.some((s) => s != null) || (revenues.some((v) => v != null) && total > 0);
  const counts = clients.map((c) => (c?.projects ?? c?.projects_count ?? null));
  const hasCount = counts.some((v) => v != null);
  const columns = [
    { key: 'name', labelAr: G.client },
    ...(hasShare ? [{ key: 'share', labelAr: `حصة ${G.revenue} %` }] : []),
    ...(hasCount ? [{ key: 'count', labelAr: `عدد ${G.projects}` }] : []),
  ];
  const body = clients.map((c, i) => ({
    name: nameOf(c),
    ...(hasShare ? {
      share: shares[i] != null ? num(shares[i])
        : (revenues[i] != null && total > 0 ? Math.round((Number(revenues[i]) / total) * 100) : ''),
    } : {}),
    ...(hasCount ? { count: num(counts[i]) } : {}),
  }));
  return { name: G.clients, columns, rows: withHead(columns, head, body) };
}

// ── ٥) الفريق والطاقة ───────────────────────────────────────────────────────────────────
function staffingSheet(data, head) {
  const st = data.staffing;
  if (!st || (!Array.isArray(st.cap) && !Array.isArray(st.alloc))) return null;
  const columns = [
    { key: 'month', labelAr: 'الشهر' },
    { key: 'cap', labelAr: `${G.capacity} (وحدات دوام كامل)` },
    { key: 'alloc', labelAr: 'المُسكَّن (وحدات دوام كامل)' },
  ];
  const body = MONTHS_AR.map((m, i) => ({ month: m, cap: num(at12(st.cap, i)), alloc: num(at12(st.alloc, i)) }));
  return { name: 'الفريق والطاقة', columns, rows: withHead(columns, head, body) };
}

// ── ٦) المصادر والمطابقة ────────────────────────────────────────────────────────────────
// المقارنةُ الشهرية بين ما رفعته المالية وما سجّله سند. وحين تغيب المطابقة (بابُ الكلفة
// مغلق) تبقى الورقةُ بعمودٍ واحدٍ يقول مصدرَ الأرقام — بلا أعمدةِ كلفةٍ فارغة.
function reconSheet(data, head) {
  const meta = data.meta || {};
  const months = arr(Array.isArray(data.recon) ? data.recon : data.recon?.months);
  const tail = [];
  const up = meta.finance_upload;
  if (up?.at || up?.by) {
    tail.push({ c0: `آخر رفعٍ لملفّ المالية: ${riyadhStamp(up.at)}${up.by ? ` — ${up.by}` : ''}` });
  } else {
    tail.push({ c0: 'لم يُرفَع ملفُّ المالية بعد' });
  }
  const closed = Number(meta.closed_through);
  tail.push({ c0: closed >= 1 && closed <= 12 ? `الشهر المقفل: ${monthName(closed)}` : 'لم يُقفَل شهرٌ بعد' });
  const src = CLOSED_SOURCE_AR[String(meta.closed_source || '')];
  if (src) tail.push({ c0: `مصدر الإقفال: ${src}` });
  if (meta.completeness_pct != null) tail.push({ c0: `اكتمال البيانات: ${Math.round(Number(meta.completeness_pct))}%` });
  for (const n of arr(data.notes)) { const t = NOTE_AR[String(n)]; if (t) tail.push({ c0: t }); }

  if (!months.length) {
    const columns = [{ key: 'c0', labelAr: 'من أين تأتي الأرقام؟' }];
    return { name: 'المصادر والمطابقة', columns, rows: withHead(columns, head, tail) };
  }
  const columns = [
    { key: 'month', labelAr: 'الشهر' },
    { key: 'fin', labelAr: `فعلي المالية (${G.sar})` },
    { key: 'sanad', labelAr: `المسجَّل في سند (${G.sar})` },
    { key: 'diff', labelAr: `الفرق (${G.sar})` },
    { key: 'pct', labelAr: 'نسبة الفرق %' },
    { key: 'match', labelAr: 'مطابق سند' },
  ];
  const body = months.map((r, i) => ({
    month: monthName(Number(r?.month ?? i + 1)),
    fin: sar(r?.fin_cor),
    sanad: sar(r?.sanad_cor),
    diff: sar(r?.diff),
    pct: num(r?.pct),
    match: yesNo(r?.match),
  }));
  return {
    name: 'المصادر والمطابقة',
    columns,
    rows: [...withHead(columns, head, body), { month: '' }, ...tail.map((t) => ({ month: t.c0 }))],
  };
}

/**
 * مركز القطاع ملفَّ Excel.
 *
 * @param {{user: object, ip?: string}} ctx
 * @param {{sector?: string, year?: number|string}} query
 * @param {{_dataset?: object}} [opts]  حمولةٌ جاهزةٌ تُمرَّر في الاختبار بدل بنائها — لا في التشغيل.
 * @returns {Promise<{buffer: Buffer, mime: string, filename: string}>}
 */
export async function exportCommandCenter(ctx, query = {}, opts = {}) {
  const user = ctx?.user;
  // بابٌ فوق ما حجبته الحمولة: من يقرأ الشاشة ليس بالضرورة من يُخرجها ملفاً.
  if (!can(user, 'export', 'report')) throw forbidden('تصدير التقارير خارج صلاحياتك');
  const sector = await resolveCommandCenterSector(user, query);
  const year = targetYear(Number(query.year) || config.fiscalYear);

  let data = opts._dataset;
  if (!data) {
    const build = await datasetLoader();
    data = await build(user, sector.id, { year });
  }
  data = data || {};

  const sectorName = nameOf(data.meta?.sector) || (typeof data.meta?.sector === 'string' ? data.meta.sector : '')
    || sector.name_ar || '';
  const shownYear = Number(data.meta?.year) || year;
  const head = headRows(sectorName, shownYear, riyadhStamp(data.meta?.generated_at || new Date().toISOString()));

  const sheets = [
    plSheet(data, head),
    projectsSheet(data, head),
    oppsSheet(data, head),
    clientsSheet(data, head),
    staffingSheet(data, head),
    reconSheet(data, head),
  ].filter(Boolean);

  const out = buildWorkbook({ sheets, rtl: true });
  await audit(ctx, {
    action: 'export',
    resource: 'report',
    resourceId: `command-center:${sector.id}`,
    sectorId: sector.id,
    detail: { year: shownYear, sheets: out.sheetNames },
  });
  return {
    buffer: out.buffer,
    mime: out.mime,
    filename: `مركز القطاع ${sectorName} ${shownYear}.xlsx`.replace(/\s+/g, ' ').trim(),
  };
}
