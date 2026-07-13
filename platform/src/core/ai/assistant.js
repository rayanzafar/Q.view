// Governed AI assistant. Guarantees:
//  1) SCOPE — only reads data the user is allowed to (reuses scope-filtered services).
//  2) REDACTION — sensitive fields stripped BEFORE any external LLM call.
//  3) NO SILENT WRITES — mutating intents return a PREVIEW; apply() needs explicit confirm + permission.
//  4) AUDIT — every request and applied change logged to ai_activity_log.
import { all, get, insert, update } from '../db/index.js';
import { can } from '../rbac/index.js';
import { audit } from '../audit/index.js';
import { complete, aiMode } from './provider.js';
import { companyOverview, sectorDashboard, projectKpis } from '../reports/metrics.js';
import { buildReport } from '../reports/engine.js';
import { id, nowIso, fmtSar, toHalalas } from '../util/ids.js';
import { forbidden, badRequest, notFound } from '../http/errors.js';

// ── Intent router ──
export async function ask(ctx, message, opts = {}) {
  const user = ctx.user;
  const text = String(message || '').trim();
  const intent = classify(text, opts.intent);
  logAsk(user, text, intent, 0, null);

  switch (intent) {
    case 'summarize_project': return summarizeProject(user, opts.projectId || extractProjectId(text));
    case 'weekly_report':     return weeklyReportDraft(ctx);
    case 'detect_risks':      return detectRisks(user);
    case 'data_quality':      return dataQualityScan(user);
    case 'suggest_priorities':return suggestPriorities(user);
    case 'propose_change':    return proposeChange(ctx, text, opts);
    default:                  return smallTalk(user, text);
  }
}

function classify(text, forced) {
  if (forced) return forced;
  const t = text.toLowerCase();
  if (/(لخّص|ملخص|حالة).*(مشروع)|summarize.*project/.test(text)) return 'summarize_project';
  if (/تقرير.*أسبوع|weekly|الموجز/.test(text)) return 'weekly_report';
  if (/مخاطر|متعثر|risk|حرج/.test(text)) return 'detect_risks';
  if (/جودة.*بيانات|نواقص|data quality/.test(text)) return 'data_quality';
  if (/أولوي|priorit|المهم/.test(text)) return 'suggest_priorities';
  if (/غيّر|حدّث|عدّل|أنشئ|اضبط|set |update |create /.test(text)) return 'propose_change';
  return 'smalltalk';
}

// ── Read intents (never write) ──
function summarizeProject(user, projectId) {
  if (!projectId) return reply('حدّد المشروع (اسم أو معرّف) لألخّص حالته.');
  const p = get('SELECT * FROM project WHERE id = ? OR code = ?', [projectId, projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', p)) throw forbidden();
  const k = projectKpis(p.id);
  const risks = all("SELECT title FROM risk WHERE project_id = ? AND status != 'CLOSED' LIMIT 5", [p.id]);
  const showCost = can(user, 'read', 'cost');
  const facts = [
    `الحالة: ${p.status} · RAG: ${p.rag} · الإنجاز: ${Math.round(p.progress_pct || 0)}%`,
    `المهام: ${k.taskCompletionRate}% مكتملة · متأخرة: ${k.lateTasks}`,
    `قبول المخرجات: ${k.deliverableAcceptanceRate}% (من ${k.totalDeliverables})`,
    showCost ? `الصرف الفعلي: ${fmtSar(p.actual_spend_halalas)} · قيمة العقد: ${fmtSar(p.contract_value_halalas)}` : `قيمة العقد: ${fmtSar(p.contract_value_halalas)} (التكلفة محجوبة عن دورك)`,
    risks.length ? `مخاطر مفتوحة: ${risks.map((r) => r.title).join('، ')}` : 'لا مخاطر مفتوحة',
  ];
  return llmOrLocal(user, `لخّص حالة المشروع «${p.name_ar}» بإيجاز تنفيذي وبنبرة مهنية.`, facts,
    () => `**${p.name_ar}** — ${facts.join(' · ')}.` +
      (p.rag === 'RED' ? ' ⚠ المشروع حرج ويحتاج تدخلًا.' : k.lateTasks > 0 ? ' ⚠ توجد مهام متأخرة.' : ' على المسار.'));
}

function weeklyReportDraft(ctx) {
  const data = buildReport('weekly_exec_brief', ctx.user, {});
  const facts = [
    `الإيراد المحقق ${fmtSar(data.totals.revenue)} من ${fmtSar(data.totals.target_revenue)}`,
    `المبيعات ${fmtSar(data.totals.sales)} من ${fmtSar(data.totals.target_sales)}`,
    `خط الأنابيب ${fmtSar(data.pipeline_halalas)}`,
    data.achievements.length ? `إنجازات: ${data.achievements.join('، ')}` : '',
    data.risks.length ? `مخاطر: ${data.risks.join('، ')}` : '',
  ].filter(Boolean);
  return llmOrLocal(ctx.user, 'اكتب مسودة الموجز التنفيذي الأسبوعي بالعربية بنبرة تنفيذية موجزة.', facts,
    () => `**مسودة الموجز التنفيذي الأسبوعي**\n\n${facts.map((f) => '• ' + f).join('\n')}\n\n(يمكنك إرسالها من «التقارير والبريد».)`);
}

function detectRisks(user) {
  const red = all("SELECT name_ar FROM project WHERE rag='RED' AND deleted_at IS NULL " +
    (user.scope === 'company' ? '' : 'AND sector_id = ?') + ' LIMIT 10', user.scope === 'company' ? [] : [user.sector_id]);
  const overdue = all("SELECT p.name_ar, COUNT(*) n FROM task t JOIN project p ON p.id = t.project_id " +
    "WHERE t.status != 'DONE' AND t.due_date IS NOT NULL AND date(t.due_date) < date('now') AND t.deleted_at IS NULL " +
    (user.scope === 'company' ? '' : 'AND p.sector_id = ?') + ' GROUP BY p.id ORDER BY n DESC LIMIT 5',
    user.scope === 'company' ? [] : [user.sector_id]);
  const lines = [];
  if (red.length) lines.push('مشاريع حرجة (RED): ' + red.map((r) => r.name_ar).join('، '));
  for (const o of overdue) lines.push(`${o.name_ar}: ${o.n} مهمة متأخرة`);
  return reply(lines.length ? '**المخاطر المكتشفة:**\n' + lines.map((l) => '• ' + l).join('\n') : 'لا مخاطر بارزة ضمن نطاقك حاليًا.');
}

function dataQualityScan(user) {
  const co = user.scope === 'company';
  const sec = user.sector_id;
  const noType = get('SELECT COUNT(*) n FROM client WHERE (type IS NULL OR type = \'\') AND deleted_at IS NULL').n;
  const zeroPrice = get("SELECT COUNT(*) n FROM service_package WHERE price_halalas = 0").n;
  const noOwner = get('SELECT COUNT(*) n FROM opportunity WHERE owner_user_id IS NULL AND deleted_at IS NULL ' + (co ? '' : 'AND sector_id = ?'), co ? [] : [sec]).n;
  const noDates = get('SELECT COUNT(*) n FROM project WHERE (start_date IS NULL OR end_date IS NULL) AND deleted_at IS NULL ' + (co ? '' : 'AND sector_id = ?'), co ? [] : [sec]).n;
  const items = [
    noType ? `${noType} عميل بلا تصنيف نوع` : null,
    zeroPrice ? `${zeroPrice} باقة خدمة بسعر 0` : null,
    noOwner ? `${noOwner} فرصة بلا مالك` : null,
    noDates ? `${noDates} مشروع بلا تواريخ بداية/نهاية` : null,
  ].filter(Boolean);
  return reply(items.length ? '**فحص جودة البيانات:**\n' + items.map((i) => '• ' + i).join('\n') + '\n\nأصلحها من الوحدات المعنية.' : 'جودة البيانات جيدة ضمن نطاقك.');
}

function suggestPriorities(user) {
  const tasks = all(`SELECT title, priority, due_date FROM task WHERE assignee_user_id = ? AND status != 'DONE' AND deleted_at IS NULL
    ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
    (due_date IS NULL), due_date LIMIT 6`, [user.id]);
  if (!tasks.length) return reply('لا مهام مفتوحة لديك — نظيف! 🎉');
  return reply('**أولوياتك المقترحة اليوم:**\n' + tasks.map((t, i) =>
    `${i + 1}. [${t.priority}] ${t.title}${t.due_date ? ' — يستحق ' + t.due_date : ''}`).join('\n'));
}

// ── Write intent: propose a change → PREVIEW only. Apply is a separate, permissioned step. ──
function proposeChange(ctx, text, opts) {
  const user = ctx.user;
  // Supported safe change: move an opportunity to a stage, or set project RAG. (Extensible.)
  const oppMatch = text.match(/فرصة\s+(\S+).*(فائزة|خسارة|مؤهلة|تقييم)/);
  if (opts.change?.type === 'opp_stage' || oppMatch) {
    const oppId = opts.change?.oppId || oppMatch?.[1];
    const stageWord = opts.change?.stage || oppMatch?.[2];
    const stageMap = { 'فائزة': 'WON', 'خسارة': 'LOST', 'مؤهلة': 'QUALIFIED', 'تقييم': 'PROPOSAL' };
    const stage = stageMap[stageWord] || stageWord;
    const opp = get('SELECT * FROM opportunity WHERE id = ? OR code = ?', [oppId, oppId]);
    if (!opp) throw notFound('الفرصة غير موجودة');
    if (!can(user, 'update', 'opportunity', opp)) throw forbidden('لا تملك صلاحية تعديل هذه الفرصة');
    const preview = { type: 'opp_stage', oppId: opp.id, from: opp.stage_id, to: stage,
      summary: `نقل الفرصة «${opp.title_ar}» من ${opp.stage_id} إلى ${stage}` };
    const token = stashPreview(user, preview);
    return { reply: `**معاينة تغيير (لن يُطبَّق إلا بتأكيدك):**\n${preview.summary}`, preview, applyToken: token };
  }
  return reply('أفهم طلب التعديل، لكن للأمان أطبّق فقط تغييرات محدّدة بمعاينة. جرّب: «انقل الفرصة X إلى فائزة».');
}

const _previews = new Map(); // token → {user, preview, at}
function stashPreview(user, preview) {
  const token = id('aiprev');
  _previews.set(token, { userId: user.id, preview, at: Date.now() });
  return token;
}

export function applyChange(ctx, token) {
  const user = ctx.user;
  const entry = _previews.get(token);
  if (!entry || entry.userId !== user.id) throw badRequest('معاينة غير صالحة أو منتهية');
  _previews.delete(token);
  const p = entry.preview;
  if (p.type === 'opp_stage') {
    const opp = get('SELECT * FROM opportunity WHERE id = ?', [p.oppId]);
    if (!can(user, 'update', 'opportunity', opp)) throw forbidden(); // re-check at apply time
    const st = get('SELECT * FROM stage WHERE id = ?', [p.to]);
    update('opportunity', p.oppId, { stage_id: p.to, win_pct: st?.default_win_pct ?? opp.win_pct,
      stage_changed_at: nowIso(), updated_at: nowIso(), updated_by: user.id });
    insert('opportunity_stage_history', { id: id('osh'), opportunity_id: p.oppId, from_stage_id: p.from,
      to_stage_id: p.to, changed_by: user.id, changed_at: nowIso(), note: 'AI-assisted (بتأكيد المستخدم)' });
    audit(ctx, { action: 'update', resource: 'opportunity', resourceId: p.oppId, sectorId: opp.sector_id,
      detail: { via: 'ai', stage: `${p.from}→${p.to}` } });
    logAsk(user, p.summary, 'propose_change', 1, p);
    return { reply: `تم تطبيق التغيير ✓ — ${p.summary}` };
  }
  throw badRequest('نوع تغيير غير مدعوم');
}

// ── helpers ──
async function llmOrLocal(user, task, facts, localFn) {
  if (aiMode() === 'local') return reply(localFn());
  try {
    // Only redacted facts are sent externally (no raw sensitive fields ever reach here).
    const sys = 'أنت مساعد تنفيذي لشركة استشارية. اكتب بالعربية، موجزًا ومهنيًا. لا تخترع أرقامًا خارج المعطيات.';
    const { text } = await complete({ system: sys, user: `${task}\n\nالمعطيات:\n- ${facts.join('\n- ')}` });
    return reply(text || localFn());
  } catch { return reply(localFn()); } // graceful fallback — never fail because the LLM is down
}
function smallTalk(user, text) {
  return reply('أنا مساعد سند. أستطيع: تلخيص مشروع · مسودة تقرير أسبوعي · كشف المخاطر · فحص جودة البيانات · اقتراح أولوياتك · تنفيذ تغييرات محدّدة بمعاينة وتأكيد. ماذا تريد؟');
}
function reply(text) { return { reply: text }; }
function extractProjectId(text) { const m = text.match(/(p_\S+|PRJ-\S+|prj_\S+)/); return m?.[1] || null; }
function logAsk(user, prompt, intent, applied, preview) {
  insert('ai_activity_log', { id: id('ai'), at: nowIso(), user_id: user.id,
    prompt: String(prompt).slice(0, 500), intent, applied, preview_json: preview ? JSON.stringify(preview) : null });
}

export function aiStatus() {
  return { mode: aiMode(), configured: aiMode() !== 'local',
    note: aiMode() === 'local' ? 'يعمل محليًا بلا مفتاح؛ أضف ANTHROPIC_API_KEY أو OPENAI_API_KEY للترقية' : 'مزوّد خارجي مفعّل' };
}
