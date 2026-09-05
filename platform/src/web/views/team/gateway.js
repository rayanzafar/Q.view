// ── S01 — بوابة الفريق ومعاينة المسار (وحدة الفريق والموارد، ADR-0016) ─────────────────────
//
// «صفحة البداية بوابة لأربعة مسارات. يختار المستخدم مساراً فتظهر معاينة موجزة، ثم يدخل إلى
//  مساحة العمل. لا تجعل البداية جدولاً ضخماً… الحقائق المختصرة تأتي من النطاق المصرح والفترة
//  المعلنة، وتحمل روابط للفلاتر التي أنتجتها. لا أرقام ثابتة من الصورة» — الموجّه §4.1، §11/S01.
//
// كل رقمٍ هنا من خدمةٍ قائمة تحت نطاق القارئ نفسه (listResources / utilizationTable /
// teamCommitments / listNeeds / listRequests) — وما لا تصله صلاحيته أو لم تصل خدمته بعد
// **يُحذف** الرقم لا يُخترع. المعاينات الأربع تُعرض خادمياً خاملةً (hidden) ويبدّلها العميل
// (public/pages/team-resources.js) بلا جلب؛ و`?path=` يسبق الاختيار فتعمل بلا JavaScript أيضاً.
// ولا تُحمَّل قوائم المهام والملفات هنا — أعدادٌ وروابط فقط.
import { nowIso } from '../../../core/util/ids.js';
import { G } from '../../i18n/glossary.js';
import { canCreateResource, canReadClose } from '../../../modules/team/access.js';
import { utilizationTable } from '../../../modules/team/analysis.js';
import { teamCommitments } from '../../../modules/team/commitments.js';
import { listNeeds } from '../../../modules/team/needs.js';
import { teamLayout, PATHS, SECTION_TABS, emptyState, monthLabel, esc, icon } from './_shell.js';

const N = (v) => Number(v) || 0;
// رقمٌ لا تصله الصلاحية أو لم تصل خدمته ⇒ لا رقم (لا صفرٌ كاذب ولا عطل في البوابة).
async function tryFact(fn) { try { return await fn(); } catch { return null; } }
const tryImport = (p) => import(p).catch(() => null);

// ترتيب الشبكة كما في الصورة المرجعية (من اليمين): التسكين، الفريق، التحليل، العمل.
const ORDER = ['planning', 'people', 'analysis', 'work'];

const GATEWAY_CSS = `
  .tm-gw [hidden]{display:none!important}
  .tm-gw-ask{margin:.2rem 0 1rem}
  .tm-gw-ask .q{font-size:22px;font-weight:800;color:var(--ink2);line-height:1.4}
  .tm-gw-ask .s{font-size:var(--fs-body);color:var(--muted);margin-top:.25rem}
  .tm-gw .tm-path{padding-bottom:3.4rem;text-decoration:none;color:inherit}
  .tm-gw .tm-path:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
  .tm-gw .tm-path .art svg{width:46px;height:46px}
  .tm-gw .tm-path .go{text-decoration:none;font-size:18px}
  .tm-gw .tm-path .go:hover{border-color:var(--brand);color:var(--brand)}
  .tm-gw .tm-path .facts .fact:hover{background:#eef2fb}
  .tm-gw .tm-path .facts .tm-note{align-self:center}
  .tm-gw-pv:focus{outline:none}
  .tm-gw-pv .fact{text-decoration:none;color:inherit}
  .tm-gw-pv .fact:hover{background:#eef2fb}
  .tm-gw-pv .fact svg{width:22px;height:22px;color:var(--brand);flex:none}
  .tm-gw-pv .fact b{font-size:var(--fs-val-sm)}
  .tm-gw-pv .tabs{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center}
  .tm-gw-pv .tabs a{color:var(--brand);text-decoration:none;font-size:var(--fs-body)}
  .tm-gw-pv .tabs a+a::before{content:'|';color:var(--faint);margin-inline-end:.6rem}
  .tm-gw-pv .ph .t svg{width:16px;height:16px;vertical-align:-3px;color:var(--brand2)}
  @media (max-width:640px){.tm-gw .tm-path{flex-direction:column}.tm-gw .tm-path .art{width:100%;height:64px}.tm-gw-ask .q{font-size:18px}}
`;

export async function teamGatewayPage(user, opts = {}) {
  const key = nowIso().slice(0, 7);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const sel = PATHS[String(opts.path || '')] ? String(opts.path) : null;
  const canCreate = canCreateResource(user);
  const showClose = canReadClose(user);

  // خدمتان قد لا تكونان قد وصلتا بعد (المرحلة B قيد الهبوط): غيابهما يُسقط أرقامهما فقط.
  const [resMod, allocMod] = await Promise.all([
    tryImport('../../../modules/team/resources.js'),
    tryImport('../../../modules/team/allocations.js'),
  ]);
  const [res, util, pending, work, needs] = await Promise.all([
    resMod?.listResources ? tryFact(() => resMod.listResources(user, { status: 'active', page: 1, pageSize: 500 })) : null,
    tryFact(() => utilizationTable(user, { year, month })),
    allocMod?.listRequests ? tryFact(() => allocMod.listRequests(user, { filter: 'pending_my_decision' })) : null,
    tryFact(() => teamCommitments(user, { year, month })),
    tryFact(() => listNeeds(user, {})),
  ]);

  // ── الحقائق المختصرة — كلٌّ منها يحمل رابط الشاشة المفلترة التي أنتجته ────────────────
  const F = { people: [], planning: [], work: [], analysis: [] };
  const basis = { people: '', planning: '', work: '', analysis: '' };
  if (res) {
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const total = N(res.total);
    F.people.push({ value: total, plural: { one: 'مورد نشط', two: 'موردان نشطان', few: 'موارد نشطة', many: 'مورداً نشطاً' }, href: '/app/team/resources?status=active' });
    // العدّان التاليان يُقرآن من الصفوف نفسها؛ إن لم تصل كل الصفوف فلا يُعرض عدٌّ ناقص.
    if (rows.length === total) {
      F.people.push({ value: rows.filter((r) => r.availablePct != null && N(r.availablePct) > 0).length, plural: { one: 'مورد بسعة متاحة', two: 'موردان بسعة متاحة', few: 'موارد بسعة متاحة', many: 'مورداً بسعة متاحة' },
        href: '/app/team/resources?status=active', title: 'موارد نشطة لديها طاقة متاحة في الفترة الحالية' });
      F.people.push({ value: new Set(rows.map((r) => r.resourceType || 'internal')).size, plural: { one: 'نوع موارد', two: 'نوعا موارد', few: 'أنواع موارد', many: 'نوعاً من الموارد' }, href: '/app/team/resources' });
    }
    basis.people = String(res.basis_ar || '');
  }
  if (util) {
    const rows = Array.isArray(util.rows) ? util.rows : [];
    F.planning.push({ value: rows.filter((r) => N(r.overPct) > 0).length, plural: { one: 'تجاوز هذا الشهر', two: 'تجاوزان هذا الشهر', few: 'تجاوزات هذا الشهر', many: 'تجاوزاً هذا الشهر' }, href: `/app/team/planning?from=${key}&to=${key}` });
    basis.planning = String(util.basis_ar || '');
  }
  if (pending) {
    const n = Array.isArray(pending) ? pending.length : N(pending.total != null ? pending.total : (pending.rows || []).length);
    F.planning.push({ value: n, plural: { one: 'طلب بانتظار قرارك', two: 'طلبان بانتظار قرارك', few: 'طلبات بانتظار قرارك', many: 'طلباً بانتظار قرارك' }, href: '/app/team/requests?filter=pending_my_decision' });
  }
  F.planning.push({ text: monthLabel(`${year}-12`), label: 'أفق التخطيط', href: `/app/team/planning?from=${key}&to=${year}-12` });
  if (work?.counts) {
    const workHref = `/app/team/work?year=${year}&month=${month}`;
    F.work.push({ value: N(work.counts.tasks), plural: { one: 'مهمة مفتوحة', two: 'مهمتان مفتوحتان', few: 'مهام مفتوحة', many: 'مهمة مفتوحة' }, href: workHref },
      { value: N(work.counts.late), plural: { one: 'مهمة متأخرة', two: 'مهمتان متأخرتان', few: 'مهام متأخرة', many: 'مهمة متأخرة' }, href: workHref },
      { value: N(work.counts.works), plural: { one: 'عمل نشط', two: 'عملان نشطان', few: 'أعمال نشطة', many: 'عملاً نشطاً' }, href: workHref });
    basis.work = String(work.basis_ar || '');
  }
  if (needs) {
    F.analysis.push({ value: N(needs.total), plural: { one: 'احتياج مفتوح', two: 'احتياجان مفتوحان', few: 'احتياجات مفتوحة', many: 'احتياجاً مفتوحاً' }, href: '/app/team/needs' });
    basis.analysis = String(needs.basis_ar || '');
  }
  if (util) {
    F.analysis.push({ value: Math.max(0, N(util.total) - N(util.counts?.bySignal?.none)), plural: { one: 'إشارة للمراجعة', two: 'إشارتان للمراجعة', few: 'إشارات للمراجعة', many: 'إشارة للمراجعة' }, href: `/app/team/analysis?year=${year}&month=${month}` });
  }

  const factVal = (f) => (f.text != null ? esc(f.text) : String(N(f.value)));
  // التسمية تتبع العدد كما في العربية (احتياج مفتوح · احتياجان · احتياجات · احتياجاً): الرقم كبيراً
  // والكلمة بصيغتها الصحيحة تحته — لا «1 احتياجات مفتوحة».
  const factLabel = (f) => {
    if (!f.plural) return f.label;
    const n = N(f.value);
    return n === 1 ? f.plural.one : n === 2 ? f.plural.two : (n >= 3 && n <= 10) || n === 0 ? f.plural.few : f.plural.many;
  };
  const cardFact = (f) => `<a class="fact" href="${esc(f.href)}"${f.title ? ` title="${esc(f.title)}"` : ''}><b class="tnum">${factVal(f)}</b><span>${esc(factLabel(f))}</span></a>`;
  const pvFact = (p, f) => `<a class="fact" href="${esc(f.href)}"${f.title ? ` title="${esc(f.title)}"` : ''}>${icon(p.icon)}<div><b class="tnum">${factVal(f)}</b><span>${esc(factLabel(f))}</span></div></a>`;

  // ── بطاقة المسار: زرٌّ بلوحة المفاتيح، والسهم رابطٌ حقيقي يعمل بلا JavaScript ─────────
  const card = (p) => {
    const on = sel === p.key;
    const facts = F[p.key].slice(0, 3);
    return `<div class="tm-path${on ? ' on' : ''}" role="button" tabindex="0" data-action="path-select" data-path="${p.key}" aria-pressed="${on ? 'true' : 'false'}" aria-controls="tm-gw-pv-${p.key}">
      <div style="flex:1;min-width:0">
        <div class="ttl">${esc(p.label)}</div>
        <div class="blurb">${esc(p.blurb)}</div>
        <div class="facts">${facts.length ? facts.map(cardFact).join('') : `<span class="tm-note">افتح المسار لاستعراض التفاصيل</span>`}</div>
      </div>
      <div class="art" aria-hidden="true">${icon(p.icon)}</div>
      <a class="go" href="${esc(p.href)}" aria-label="فتح ${esc(p.label)}" title="فتح ${esc(p.label)}">←</a>
      <span class="tag"${on ? '' : ' hidden'}>المسار المحدد</span>
    </div>`;
  };

  // ── معاينة المسار: خاملة حتى تُختار؛ الإقفال يُخفى عن غير المخوَّل ولا يُخفى التخطيط ──
  const panel = (p) => {
    const on = sel === p.key;
    const tabs = (SECTION_TABS[p.key] || []).filter((t) => t.key !== 'close' || showClose);
    const facts = F[p.key];
    return `<section class="tm-preview tm-gw-pv" id="tm-gw-pv-${p.key}"${on ? '' : ' hidden'} data-path="${p.key}" aria-labelledby="tm-gw-pv-${p.key}-t" tabindex="-1">
      <div class="ph"><div><div class="t" id="tm-gw-pv-${p.key}-t">${icon(p.icon)} معاينة ${esc(p.label)}</div><div class="s">لمحة سريعة من بيانات فريقك قبل الانتقال إلى صفحة التفاصيل.</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-action="path-close" aria-label="إغلاق المعاينة">✕</button></div>
      ${facts.length ? `<div class="facts">${facts.map((f) => pvFact(p, f)).join('')}</div>` : emptyState('لا أرقام لعرضها هنا', 'افتح المسار لاستعراض التفاصيل ضمن صلاحيتك.')}
      ${basis[p.key] ? `<div class="tm-note" style="margin-bottom:.8rem">${icon('info')}<span>${esc(basis[p.key])}</span></div>` : ''}
      <div class="links"><div class="tabs">${tabs.map((t) => `<a href="${esc(t.href)}">${esc(t.label)}</a>`).join('')}</div>
        <a class="btn btn-primary" href="${esc(p.href)}" aria-label="فتح ${esc(p.label)}">فتح المسار ←</a></div>
    </section>`;
  };

  const paths = ORDER.map((k) => PATHS[k]).filter(Boolean);
  const body = `<style>${GATEWAY_CSS}</style><div class="tm-gw" id="tm-gw">
    <div class="tm-gw-ask"><div class="q">${esc(G.teamAsk)}</div><div class="s">${esc(G.teamAskSub)}</div></div>
    <div class="tm-paths">${paths.map(card).join('')}</div>
    <div class="tm-gw-pvs">${paths.map(panel).join('')}</div>
  </div>`;

  return teamLayout({
    user, path: null, title: G.team, crumbs: [], year: opts.year,
    // «إضافة مورد» يفتح نموذج S09 في سجل الموارد (S02) — قالبٌ واحد لا نسخة ثانية في البوابة.
    actions: canCreate ? `<a class="btn btn-primary" href="/app/team/resources?add=1">${icon('plus')} ${esc(G.addResource)}</a>` : '',
    body, scripts: ['/static/pages/team-resources.js'],
  });
}
