// ── نوايا الدردشة لوحدة «الفريق والموارد» — تُسجَّل في المساعد عند التركيب (ai.routes.js) ──────
//
// كل نية هنا **تنادي أداةً من السجل نفسه** (team-tools.js) وتصوغ جوابها من نتيجتها — فالسؤال
// نفسه من الدردشة ومن الأداة يعيد الأرقام والوحدات نفسها (T41)، ولا معادلة ثانية في الردّ.
// ولا تكتب نيةٌ حرفاً: المتابعة وطلب التسكين لهما معاينةٌ ورمزٌ في الأدوات، والدردشة تقرأ وتشرح
// وتُرشد. والنص الحرّ يُقرأ لأمرين لا ثالث لهما: الأشهر والنسب، واسمٌ يُحلّ إلى **مجموعة** مطابقات
// من سجل الموارد (بنطاق السائل) ثم يختار المستخدم — لا اختيار صامت.
import { can } from '../../core/rbac/index.js';
import { get, all } from '../../core/db/index.js';
import { forbidden } from '../../core/http/errors.js';
import { riyadhDate } from '../../core/i18n/time.js';
import { monthKey } from '../team/capacity-model.js';
import { listResources } from '../team/resources.js';
import { canReadResources, canReadClose } from '../team/access.js';
import { TOOL_BY_NAME, UNITS, CLOSE_DENY_AR, addMonthsKey, monthLabelAr } from './team-tools.js';

// ── قراءة الأشهر والنسب من النص ──────────────────────────────────────────────────────────
const MONTH_WORDS = [
  ['يناير', 1], ['فبراير', 2], ['مارس', 3], ['أبريل', 4], ['ابريل', 4], ['إبريل', 4], ['مايو', 5], ['يونيو', 6], ['يوليو', 7],
  ['أغسطس', 8], ['اغسطس', 8], ['سبتمبر', 9], ['أكتوبر', 10], ['اكتوبر', 10], ['نوفمبر', 11], ['ديسمبر', 12],
];
const westernDigits = (s) => String(s || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
function monthsIn(text) {
  const found = [];
  for (const [w, m] of MONTH_WORDS) {
    const i = text.indexOf(w);
    if (i >= 0 && !found.some((f) => f.m === m)) found.push({ m, i });
  }
  return found.sort((a, b) => a.i - b.i).map((f) => f.m);
}
const yearIn = (text) => { const m = /\b(20\d{2})\b/.exec(westernDigits(text)); return m ? Number(m[1]) : null; };
const today = () => { const t = riyadhDate(); return { key: t.slice(0, 7), year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)) }; };
// للتوفر والتسكين: الأشهر المذكورة (وإن مضت هذه السنة فالتالية)، وإلا الشهر الحالي وشهران بعده.
export function forwardPeriod(text) {
  const t = today();
  const ms = monthsIn(text); const y = yearIn(text);
  if (!ms.length) return { from: t.key, to: addMonthsKey(t.key, 2), explicit: false };
  const lo = Math.min(...ms); const hi = Math.max(...ms);
  const year = y || (hi < t.month ? t.year + 1 : t.year);
  return { from: monthKey(year, lo), to: monthKey(year, hi), explicit: true };
}
// للإقفال: الشهر المذكور (وشهرٌ لم يبدأ بعد يُقرأ من السنة السابقة)، وإلا الشهر المنقضي.
export function backwardMonth(text) {
  const t = today();
  const ms = monthsIn(text); const y = yearIn(text);
  if (!ms.length) { let m = t.month - 1; let yy = t.year; if (m === 0) { m = 12; yy -= 1; } return { year: yy, month: m }; }
  const m = ms[0];
  return { year: y || (m > t.month ? t.year - 1 : t.year), month: m };
}
export const pctsIn = (text) => [...westernDigits(text).matchAll(/(\d{1,4})\s*(%|٪|بالمئة|بالمائة)/g)].map((m) => Number(m[1]));

// ── حلّ اسمٍ إلى مورد: مجموعة مطابقات بنطاق السائل، لا صف مختار صامتاً ──────────────────
const NOISE = new Set(['لماذا', 'ليش', 'كيف', 'يظهر', 'تظهر', 'مسكن', 'مسكّن', 'مسكناً', 'مسكّناً', 'مسكنا', 'مسكّنا', 'التسكين', 'تسكين', 'طاقة', 'طاقته',
  'عقده', 'وطاقة', 'راجع', 'راجعي', 'المتاح', 'متاح', 'خلال', 'شهر', 'الشهر', 'أشهر', 'احتياج', 'الاحتياج', 'يغطي', 'تغطية', 'لديه', 'عنده', 'طلب',
  'طلبه', 'هل', 'من', 'مين', 'على', 'في', 'إلى', 'الى', 'عن', 'مع', 'بين', 'حالة', 'الإقفال', 'إقفال', 'أقفل', 'اقفل', 'الاستغلال', 'استغلال', 'حِمل',
  'حمل', 'المهام', 'مهامه', 'نسبة', 'النسبة', 'الفوترة', 'للفوترة', 'القابل', 'المؤكد', 'مؤكد', 'المبدئي', 'معلق', 'معلَّق', 'المعلق', 'الطلب', 'طلبات',
  ...MONTH_WORDS.map(([w]) => w)]);
const tokensOf = (text) => String(text || '').replace(/[«»"'.,؛:!?؟()\-—]/g, ' ').split(/\s+/).map((w) => w.trim()).filter(Boolean);
const bare = (w) => w.replace(/^(و|ف|ل|ب|ك)?(ال)?/, '');
export async function resolveResource(user, text) {
  const words = tokensOf(text).filter((w) => w.length >= 3 && !NOISE.has(w) && !/\d/.test(w));
  const own = user?.employee_id ? await get('SELECT id, name_ar FROM employee WHERE id = ? AND deleted_at IS NULL', [user.employee_id]) : null;
  const reads = canReadResources(user);
  for (const raw of words) {
    for (const w of [...new Set([raw, bare(raw)])].filter((x) => x.length >= 3)) {
      if (reads) {
        const r = await listResources(user, { q: w, pageSize: 6 });
        if (r.total === 1) return { one: { id: r.rows[0].id, name_ar: r.rows[0].name_ar }, choices: [], query: w };
        if (r.total > 1 && r.total <= 5) return { one: null, choices: r.rows.map((x) => ({ id: x.id, label_ar: x.name_ar })), query: w };
      } else if (own && String(own.name_ar || '').includes(w)) {
        return { one: { id: own.id, name_ar: own.name_ar }, choices: [], query: w };
      }
    }
  }
  return { one: null, choices: [], query: null };
}
const givenEmployee = (opts) => (typeof opts?.employeeId === 'string' && opts.employeeId.trim() ? opts.employeeId.trim() : null);
const monthWord = (label) => String(label || '').split(' ')[0];
const fte = (units) => (Number(units) / 100).toFixed(2);

// ── ١) من المتاح؟ ─────────────────────────────────────────────────────────────────────────
async function runAvailability(ctx, text) {
  const period = forwardPeriod(text);
  const pcts = pctsIn(text);
  const min = pcts.length ? Math.min(100, pcts[0]) : 0;
  const res = await TOOL_BY_NAME.sanad_get_allocations.run(ctx, { from: period.from, to: period.to, minAvailablePct: min });
  const monthsAr = res.period.months.map((m) => m.label_ar).join(' و');
  const head = `**المتاح ${min ? `${min}% فأكثر ` : ''}خلال ${monthsAr}** — ${res.matched} من ${res.total} مورد (${res.scope_ar}).`;
  const lines = res.rows.map((r) => `• ${r.resource.name}${r.resource.job_title ? ` — ${r.resource.job_title}` : ''}: `
    + r.months.map((m) => (m.state === 'out'
      ? `${monthWord(m.label_ar)} خارج الارتباط`
      : `${monthWord(m.label_ar)} متاح ${m.availablePct}% من طاقته (${fte(m.fte.available)} وحدة دوام كامل)`
        + `${m.pendingPct ? ` · طلب معلَّق ${m.pendingPct}%` : ''}${m.tentativePct ? ` · مبدئي ${m.tentativePct}%` : ''}`)).join(' · '));
  const reply = [
    head,
    ...(lines.length ? lines : ['لا مورد يحقق هذا الشرط ضمن نطاقك في هذه الأشهر.']),
    '',
    `الوحدتان: ${UNITS.pct_ar}؛ ${UNITS.fte_ar}.`,
    res.basis_ar,
    'الطلبات المعلَّقة والمبدئي طبقتان تُعرضان ولا تُخصمان من المتاح؛ الحجز الفعلي يمرّ بطلب تسكين ومعاينة وتأكيد.',
  ].join('\n');
  return {
    reply, refs: res.refs, period: res.period, units: res.units, minAvailablePct: min,
    figures: res.rows.map((r) => ({ employeeId: r.resource.id, name: r.resource.name,
      months: r.months.map((m) => ({ key: m.key, availablePct: m.availablePct, availableFte: m.fte.available, confirmedPct: m.confirmedPct, pendingPct: m.pendingPct, tentativePct: m.tentativePct })) })),
    outcome: res.matched ? 'ok' : 'empty',
  };
}

// ── ٢) لماذا هذا الرقم؟ ───────────────────────────────────────────────────────────────────
function metricFrom(text) {
  if (/متاح|المتاح/.test(text)) return 'available_pct';
  if (/فوتر/.test(text)) return 'billable_pct';
  if (/استغلال|الاستغلال/.test(text)) return 'utilization_pct';
  if (/حِمل|حمل المهام|المهام/.test(text)) return 'task_load';
  if (/تغطية مالية|التغطية المالية/.test(text)) return 'coverage';
  return 'confirmed_pct';
}
async function runExplain(ctx, text, opts) {
  const metric = metricFrom(text);
  let employeeId = givenEmployee(opts);
  if (!employeeId) {
    const r = await resolveResource(ctx.user, text);
    if (r.choices.length) return { reply: `أكثر من مورد يطابق «${r.query}» — اختر المقصود:`, choices: r.choices, choice_field: 'employeeId', outcome: 'empty' };
    employeeId = r.one?.id || null;
  }
  const pcts = pctsIn(text);
  const period = forwardPeriod(text);
  const input = { metric, value: pcts.length ? pcts[0] : null };
  if (employeeId) Object.assign(input, { employeeId, from: period.from, to: period.explicit ? period.to : period.from });
  if (employeeId && !period.explicit && (input.value == null || input.value > 100)) input.to = addMonthsKey(period.from, 2);   // مجموع الأشهر يحتاج مدى
  const res = await TOOL_BY_NAME.sanad_explain_metric.run(ctx, input);
  const d = res.definition;
  const parts = [
    `**${d.label_ar}**`,
    `• البسط: ${d.numerator_ar}`,
    `• المقام: ${d.denominator_ar}`,
    `• الفترة: ${d.period_ar}`,
  ];
  if (res.actual) {
    parts.push('', `**الأرقام الفعلية لـ${res.actual.name}** (${res.period.months.map((m) => m.label_ar).join('، ')}):`, res.verdict_ar);
  } else {
    parts.push('', 'اذكر اسم المورد لأقرأ أرقامه الفعلية من مصفوفة التسكين نفسها.');
  }
  parts.push('', `• الحدود: ${d.limits_ar.join('؛ ')}`, `• المصادر: ${d.sources.map((s) => s.label_ar).join('، ')}`);
  return { reply: parts.join('\n'), refs: res.refs, outcome: res.actual ? 'ok' : 'empty' };
}

// ── ٣) حالة الإقفال ───────────────────────────────────────────────────────────────────────
// الإقفال يُدار لكل قطاع على حدة: القطاع من الاختيار السابق، أو من اسمه في النص، أو قطاع الحساب؛
// وحسابٌ شركيٌّ بلا قطاع (المراجعة المالية) يُسأل أيّ قطاع — لا اختيار صامت.
async function sectorFor(user, text, opts) {
  if (typeof opts?.sector === 'string' && opts.sector.trim()) return { id: opts.sector.trim() };
  const rows = await all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL AND active = 1 ORDER BY name_ar');
  const named = rows.filter((s) => s.name_ar && text.includes(s.name_ar));
  if (named.length === 1) return { id: named[0].id };
  if (user?.sector_id) return { id: null };   // الخدمة تأخذ قطاع الحساب
  if (rows.length === 1) return { id: rows[0].id };
  return { choices: rows.map((s) => ({ id: s.id, label_ar: s.name_ar })) };
}
async function runCloseStatus(ctx, text, opts) {
  // الرفض عامّ وبلا رقم: من لا يقرأ الإقفال لا يُقال له حتى أي شهرٍ مفتوح (T43/§13.5).
  if (!canReadClose(ctx.user, ctx.user?.sector_id || null)) throw forbidden(CLOSE_DENY_AR);
  const { year, month } = backwardMonth(text);
  const sec = await sectorFor(ctx.user, text, opts);
  if (sec.choices) return { reply: 'الإقفال يُدار لكل قطاع على حدة — أيّ قطاع تقصد؟', choices: sec.choices, choice_field: 'sector', outcome: 'empty' };
  const res = await TOOL_BY_NAME.sanad_get_close_status.run(ctx, { year, month, sector: sec.id || undefined });
  const p = res.period; const c = res.counters;
  const wantsLock = /أقفل|اقفل|إقفال|اقفال/.test(text);
  if (!p) {
    // لا مسودة بعد: الأداة قراءةٌ صرفة لا تنشئها — يُقال ذلك ويُشار إلى الشاشة التي تنشئها.
    return {
      reply: [
        `**حالة إقفال ${res.label_ar}${res.sector?.name_ar ? ` — ${res.sector.name_ar}` : ''}**: ${res.note_ar}.`,
        wantsLock ? 'المساعد لا يقفل الشهر: الإقفال من شاشة الإقفال بعد المراجعة المالية وبمن يملك اعتماده — ولا يُنفَّذ بمجرد الطلب.'
          : 'افتح شاشة الإقفال لتُنشأ المسودة ثم اسأل عن حالتها.',
      ].join('\n'),
      refs: res.refs, outcome: 'empty',
    };
  }
  const parts = [
    `**حالة إقفال ${p.label_ar}${p.sector_name ? ` — ${p.sector_name}` : ''}**: ${p.status_ar} (الإصدار ${p.version}).`,
    `الموارد ${c.resources} · مكتمل ${c.complete} · استثناءات ${c.exceptions} · بانتظار التأكيد ${c.pending}${c.excluded ? ` · مستبعد ${c.excluded}` : ''}.`,
    res.blockers_ar.length ? '**الموانع:**\n' + res.blockers_ar.slice(0, 10).map((b) => `• ${b}`).join('\n') : 'لا موانع ظاهرة.',
    `الترحيل المالي: ${p.transfer.status_ar} — لا تكامل مالي خارجي في هذه النسخة.`,
    wantsLock ? 'المساعد لا يقفل الشهر: الإقفال من شاشة الإقفال بعد المراجعة المالية وبمن يملك اعتماده — ولا يُنفَّذ بمجرد الطلب.' : res.note_ar,
  ];
  return { reply: parts.join('\n'), refs: res.refs, outcome: 'ok' };
}

// ── ٤) هل يغطي الاحتياج؟ ─────────────────────────────────────────────────────────────────
async function runNeedCoverage(ctx, text, opts) {
  const user = ctx.user;
  const needsRes = await TOOL_BY_NAME.sanad_get_resource_needs.run(ctx, {});
  const open = needsRes.rows.filter((n) => !['cancelled', 'covered'].includes(n.status));
  const pcts = pctsIn(text);
  let person = null;
  const given = givenEmployee(opts);
  if (given) person = { id: given, name_ar: null };
  else if (canReadResources(user)) {
    const r = await resolveResource(user, text);
    if (r.choices.length) return { reply: `أكثر من مورد يطابق «${r.query}» — اختر المقصود:`, choices: r.choices, choice_field: 'employeeId', outcome: 'empty' };
    person = r.one;
  }
  if (person && canReadResources(user)) {
    const needPct = pcts.length > 1 ? pcts[pcts.length - 1] : (pcts[0] ?? null);
    const targets = (needPct != null && open.some((n) => n.ftePct === needPct) ? open.filter((n) => n.ftePct === needPct) : open).slice(0, 3);
    if (!targets.length) return { reply: 'لا احتياج مفتوح ضمن نطاقك يطابق سؤالك — سجّل الاحتياج أولاً من «الاحتياجات القادمة».', outcome: 'empty' };
    const blocks = []; const refs = [];
    for (const n of targets) {
      const c = await TOOL_BY_NAME.sanad_compare_candidates.run(ctx, { needId: n.id, limit: 100 });
      refs.push(...c.refs);
      const row = c.rows.find((x) => x.employeeId === person.id);
      const head = `**${n.role_ar}** على «${n.source.label}» — ${n.demand_ar} (${n.period.months.map(monthLabelAr).join('، ')})، التغطية الآن: ${n.coverage.status_ar}.`;
      if (!row) { blocks.push(`${head}\n${person.name_ar || 'المورد'} خارج أهلية هذا الاحتياج (قطاع آخر أو لا يُقرأ).`); continue; }
      const months = row.availability.map((a) => (a.state === 'out'
        ? `${a.label_ar}: خارج الارتباط`
        : `${a.label_ar}: مؤكد ${a.confirmedPct}% · طلب معلَّق ${a.pendingPct}% · المتاح قبل الطلب ${a.availablePct}%`
          + `${a.potentialPct > 100 ? ` ⇒ تعارض محتمل ${a.potentialPct}% إن اعتُمد المعلَّق وأُضيف الاحتياج` : ` ⇒ بعد الاحتياج ${a.potentialPct}%`}`)).join('\n');
      const pend = row.pendingRequests.length ? `طلبات معلَّقة: ${row.pendingRequests.map((p) => `${p.label} ${p.pct}%`).join('، ')}.` : 'لا طلبات معلَّقة.';
      blocks.push(`${head}\n**${row.name}:**\n${months}\n${pend}\n${row.fit_ar.map((s) => `– ${s}`).join('\n')}`);
    }
    return { reply: [...blocks, '', 'الطلب المعلَّق يُعرض ولا يُخصم حتى يُعتمد؛ المتاح = 100 − المؤكد من طاقة المورد. الحجز يمرّ بطلب تسكين ومعاينة وتأكيد.'].join('\n'),
      refs: [...new Map(refs.map((r) => [r.href, r])).values()], outcome: 'ok' };
  }
  const s = needsRes.summary || {};
  const lines = open.slice(0, 8).map((n) => `• ${n.role_ar} على «${n.source.label}» — ${n.demand_ar} (${n.period.from} → ${n.period.to}) · ${n.certainty_ar} · التغطية: ${n.coverage.status_ar}${n.coverage.gapPct ? ` (فجوة ${n.coverage.gapPct}%)` : ''}`);
  const fu = (needsRes.followups || []).slice(0, 5).map((f) => `• ${f.role_ar}: ${f.reason_ar}`);
  const reply = [
    `**الاحتياجات المفتوحة ضمن نطاقك: ${open.length}** — مؤكد ${s.confirmed ?? 0} · مبدئي ${s.tentative ?? 0} · غير مغطى ${s.uncovered ?? 0} · بانتظار اعتماد ${s.pending ?? 0}.`,
    ...(lines.length ? lines : ['لا احتياجات مفتوحة.']),
    ...(fu.length ? ['', '**متابعات مستحقة:**', ...fu] : []),
    '', needsRes.basis_ar, 'اذكر اسم المورد لأقارن تسكينه المؤكد وطلباته المعلَّقة بالاحتياج.',
  ].join('\n');
  return { reply, refs: needsRes.refs, outcome: open.length ? 'ok' : 'empty' };
}

// ── السجل ─────────────────────────────────────────────────────────────────────────────────
const notTaskOrOpp = (t) => !/مهمة|مهمّة|المهمة|فرصة|الفرصة/.test(t);
export const TEAM_INTENTS = [
  {
    intent: 'team_availability', label_ar: 'من المتاح؟', kind: 'read',
    allow: (u) => !!u && canReadResources(u),
    match: (t) => /(من|مين|مَن)\s+(هو\s+)?(المتاح|متاح|متوفر|متوفّر|الفاضي|فاضي|لديه\s+(طاقة|سعة)|عنده\s+(طاقة|سعة))|(المتاح|متاح|متوفر)\s*(\d|٪|%|[٠-٩])|(طاقة|سعة)\s+(متاحة|فاضية|حرة|حرّة)/.test(t) && notTaskOrOpp(t),
    run: (ctx, text) => runAvailability(ctx, text),
  },
  {
    intent: 'team_explain_metric', label_ar: 'لماذا هذا الرقم؟', kind: 'read',
    allow: () => true,
    match: (t) => (/(لماذا|ليش|لِمَ|كيف)\s.*(يظهر|تظهر|مسكّن|مسكن|تسكين|التسكين|طاقة|طاقته|عقده|متاح|المتاح|استغلال|الاستغلال|حِمل|حمل)/.test(t)
      || /راجع(ي)?\s+(التسكين|الطاقة|الاستغلال|المتاح)/.test(t)
      || /(تسكين|مسكّن|مسكن|مسكناً|مسكّناً|استغلال)\s*[\d٠-٩]+\s*(%|٪)/.test(t)) && notTaskOrOpp(t),
    run: (ctx, text, opts) => runExplain(ctx, text, opts),
  },
  {
    intent: 'team_close_status', label_ar: 'حالة الإقفال', kind: 'read',
    allow: (u) => !!u && canReadClose(u, u.sector_id || null),
    deny_ar: CLOSE_DENY_AR,
    match: (t) => /(أقفل|اقفل|إقفال|اقفال|الإقفال|الاقفال|إغلاق الشهر|اغلاق الشهر|أغلق الشهر|اغلق الشهر|توزيع التكلفة)/.test(t) && notTaskOrOpp(t),
    run: (ctx, text, opts) => runCloseStatus(ctx, text, opts),
  },
  {
    intent: 'team_need_coverage', label_ar: 'تغطية الاحتياج', kind: 'read',
    allow: (u) => !!u && (u.role_id === 'admin' || can(u, 'read', 'resource_need')),
    match: (t) => /(يغطي|تغطي|تغطية|مغطى|يغطّي|تغطّي)\s*.*(احتياج|الاحتياج)|(احتياج|الاحتياج).*(يغطي|تغطي|تغطية|مغطى|يغطّي)|هل\s+يغطي|(الاحتياجات|الاحتياج)\s+(القادمة|المفتوحة|المسجلة|المسجَّلة)/.test(t) && notTaskOrOpp(t),
    run: (ctx, text, opts) => runNeedCoverage(ctx, text, opts),
  },
];
