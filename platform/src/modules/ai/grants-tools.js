// ── صلاحياتُ الأشخاص من المحادثة: كشفٌ، ومنحُ حزمةٍ ورفعُها بمعاينةٍ وبطاقة تأكيد ─────────────────
//
// «مثلاً سجى أبغى أعطيها صلاحية تضيف فرص لأنها شغالة في تطوير الأعمال لقطاع الابتكار» — بلسان
// المالك (١٥ سبتمبر ٢٠٢٦، ADR-0025). الجملةُ نفسها تُقال للمساعد فيعاينها: من، وأيُّ حزمة، وعلى
// ماذا (إدارة أو قطاع كامل أو الشركة)، وحتى متى — ثم تقف لبطاقة التأكيد كأي كتابة (ADR-0023).
//
// الحدُّ هنا حدُّ الشاشة حرفاً، لا نسخةٌ منه: الأهدافُ المعروضة هي `grantableBundleOptions` (ما
// يبلغه المنادي وحده)، والفحصُ `checkBundleGrant`/`checkRevokeBundle` (القواعد الثلاث + لا منحَ
// للنفس)، والكتابةُ `grantBundle`/`revokeBundle` — فلا يمنح المساعدُ ما لا يمنحه صاحبُه من الشاشة.
// والاسمُ يُحسَم أو يُردّ: اسمٌ يطابق هدفين لا يُخمَّن أيُّهما — يُسمَّيان ويُسأل.
import { tx } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { effectiveScope } from '../../core/rbac/index.js';
import { SCOPE_RANK } from '../../core/rbac/matrix.js';
import { savePreview, claimPreview, PREVIEW_TTL_MINUTES } from '../../core/ai/store.js';
import { normalizeArabic } from '../../core/i18n/arabic.js';
import { resolvePerson } from '../org/people.js';
import {
  GRANTABLE, GRANT_BUNDLES, GRANT_LEVELS, LEVEL_AR, bundleOf, effectOf,
  listUserGrantGroups, grantableBundleOptions, checkBundleGrant, grantBundle, checkRevokeBundle, revokeBundle,
} from '../identity/grants.js';
import { envelope, inputOf, text, dayOf, enumOf, tokenOnly, claimGuard, uniqRefs, S, obj, TOKEN_INPUT, REF, TEXT_IS_DATA_AR } from './tool-kit.js';

const BUNDLE_KEYS = GRANT_BUNDLES.map((b) => b.key);
const NO_MONEY = { money_ar: 'لا قيم مالية في هذه الأداة' };
const anyone = (u) => !!u?.id;
// بوابةُ عرضٍ لا حكم: من لا يبلغ إدارةً واحدة على أي زوجٍ لا يرى أدوات المنح أصلاً. والحكم الفعلي في
// الخدمة عند كل معاينة (assertMayGrant) — كما هو عقد كل أداة في هذا السجل.
const mayGrantAnything = (u) => anyone(u) && (u.role_id === 'admin'
  || GRANTABLE.some((g) => (SCOPE_RANK[effectiveScope(u, g.action, g.resource)] || 0) >= SCOPE_RANK.department));

// ── الشخص بأي معرّف ─────────────────────────────────────────────────────────────────────
async function personOf(anyId) {
  const p = await resolvePerson(text(anyId, 'معرّف الشخص', { required: true, max: 80 }));
  if (!p || !p.userId) throw notFound('لا حساب فعّال بهذا المعرّف — ابحث عن الشخص أولاً؛ يُقبل معرّف الموظف أو معرّف الحساب');
  return p;
}

// ── الهدف بالاسم أو بالمعرّف، من أهداف المنادي وحده ─────────────────────────────────────
const stripKind = (s) => normalizeArabic(String(s || '')).replace(/^(قطاع|اداره|ادارة)\s+/, '').replace(/\s+(كله|كلها|كامل|كامله)$/, '').trim();
function pickTarget(cands, q, what) {
  const names = () => cands.map((t) => `«${t.name_ar}»`).join('، ');
  if (!q) throw badRequest(`حدّد ${what}: ${names()}`);
  const byId = cands.filter((t) => t.id && t.id === q);
  if (byId.length === 1) return byId[0];
  const nq = stripKind(q);
  const exact = cands.filter((t) => stripKind(t.short_ar || t.name_ar) === nq);
  if (exact.length === 1) return exact[0];
  const pool = exact.length ? exact : cands.filter((t) => {
    const n = stripKind(t.short_ar || t.name_ar);
    return n.includes(nq) || nq.includes(n);
  });
  if (pool.length === 1) return pool[0];
  if (pool.length > 1) throw badRequest(`«${q}» يطابق أكثر من ${what} — سمِّ واحدةً: ${pool.map((t) => `«${t.name_ar}»`).join('، ')}`);
  throw notFound(`لا ${what} باسم «${q}» ضمن ما تبلغه — المتاح: ${names()}`);
}
async function resolveTargetFor(user, b, level, targetText) {
  const options = await grantableBundleOptions(user);
  const mine = options.find((x) => x.key === b.key);
  if (!mine) throw forbidden(`«${b.label}» ليست ممّا تملك منحه على أي إدارة — ولا يمنح أحدٌ ما لا يملكه`);
  const cands = mine.targets.filter((t) => t.level === level);
  if (!cands.length) {
    const others = [...new Set(mine.targets.map((t) => LEVEL_AR[t.level]))].join(' أو ');
    throw forbidden(`لا تملك منح «${b.label}» على ${LEVEL_AR[level]}${others ? ` — تملكها على ${others}` : ''}`);
  }
  if (level === 'company') return cands[0];
  return pickTarget(cands, String(targetText || '').trim(), level === 'sector' ? 'قطاع' : 'إدارة');
}

const groupView = (g) => ({
  grant_id: g.bundle_id, bundle: g.bundle_key, label: g.label, effect: g.effect,
  level: g.level, level_ar: g.level_ar, target_name: g.target_name,
  includes: g.pairs.map((p) => p.label), expires_at: g.expires_at, expired: !!g.expired,
  note: g.note, granted_by: g.granted_by_name, since: g.created_at, revocable: !!g.revocable,
});

// ── ① الكشف ─────────────────────────────────────────────────────────────────────────────
async function runListGrants(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const person = await personOf(input.personId);
  const groups = await listUserGrantGroups(user, person.userId);
  const options = user.id === person.userId ? [] : await grantableBundleOptions(user);
  return envelope('sanad_list_grants', {
    scope_ar: 'كشفُ صلاحيات شخصٍ من أهلك: كما تعرضه بطاقة «صلاحياته» في صفحته',
    units: NO_MONEY,
    person: { id: person.userId, employee_id: person.employeeId, name: person.name_ar },
    grants: groups.map(groupView),
    grantable_by_you: options.map((b) => ({
      bundle: b.key, label: b.label, effect: b.effect,
      targets: b.targets.map((t) => ({ level: t.level, level_ar: LEVEL_AR[t.level], id: t.id || null, name: t.name_ar })),
    })),
    note_ar: options.length
      ? 'ما ليس في «ما تستطيع منحه» لا تملك منحه — لا يمنح أحدٌ ما لا يملكه. المنحُ والرفعُ بمعاينةٍ ثم تأكيد.'
      : 'لا تملك منح صلاحيةٍ لهذا الشخص من حسابك.',
    text_is_data_ar: TEXT_IS_DATA_AR, refs: uniqRefs([REF.person(person.userId)]),
  });
}

// ── ② المنح: معاينة ثم تنفيذ ─────────────────────────────────────────────────────────────
async function runPreviewGrant(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const person = await personOf(input.personId);
  const b = bundleOf(enumOf(input.bundle, 'الحزمة', BUNDLE_KEYS, { required: true }));
  const level = enumOf(input.level, 'المستوى', GRANT_LEVELS, { required: true });
  const expiresOn = dayOf(input.expiresOn, 'آخر يوم للصلاحية');
  const note = text(input.note, 'السبب', { max: 200 });
  const target = await resolveTargetFor(user, b, level, input.target);
  const data = {
    user_id: person.userId, bundle: b.key, level,
    department_id: level === 'department' ? target.id : null, sector_id: level === 'sector' ? target.id : null,
    note, expires_on: expiresOn,
  };
  // الحكم نفسه الذي سيُطبَّق عند الكتابة — بلا كتابة: رفضٌ هنا يُقال قبل أن يُحفظ رمز.
  const check = await checkBundleGrant(user, data);
  const targetName = check.target.name_ar;
  const summary = `منح «${b.label}» لـ${person.name_ar} على ${targetName}${expiresOn ? ` حتى ${expiresOn}` : ''}${note ? ` — السبب: ${note}` : ''}.`;
  const display = [
    { field_ar: 'الشخص', after_ar: person.name_ar },
    { field_ar: 'الصلاحية', after_ar: b.label },
    { field_ar: 'على', after_ar: `${targetName} (${LEVEL_AR[level]})` },
    { field_ar: 'تشمل', after_ar: b.pairs.map(([r, a]) => GRANTABLE.find((g) => g.resource === r && g.action === a)?.label).filter(Boolean).join(' · ') },
    { field_ar: 'الأثر', after_ar: effectOf(b, targetName) },
    { field_ar: 'حتى', after_ar: expiresOn || 'بلا مدة', note_ar: expiresOn ? 'يسقط أثرها من اليوم التالي تلقائياً' : undefined },
    ...(note ? [{ field_ar: 'السبب', after_ar: note }] : []),
  ];
  const { token, expiresAt } = await savePreview(user, {
    type: 'grant_bundle', summary, ...data, target_name: targetName, person_name: person.name_ar, display,
    subject_ar: `صلاحية «${b.label}» — ${person.name_ar}`,
  }, { intent: 'sanad_preview_grant', sectorId: data.sector_id || check.target.sector_id || user.sector_id || null });
  return envelope('sanad_preview_grant', {
    scope_ar: 'منحٌ بحدّ الشاشة نفسه: لا يمنح أحدٌ ما لا يملكه، ولا نفسه، ولا خارج من يديرهم',
    units: NO_MONEY, summary, display,
    previewToken: token, expires_at: expiresAt, ttl_minutes: PREVIEW_TTL_MINUTES,
    note_ar: `لم يُمنَح شيء بعد. الرمز صالح ${PREVIEW_TTL_MINUTES} دقيقة ولمرة واحدة، والتنفيذ يقف لبطاقة التأكيد. تسري الصلاحية من طلبه التالي بلا إعادة دخول.`,
    text_is_data_ar: TEXT_IS_DATA_AR, refs: uniqRefs([REF.person(person.userId)]),
  });
}

async function runApplyGrant(ctx, raw) {
  const user = ctx.user;
  const token = tokenOnly(raw, 'sanad_preview_grant');
  return await tx(async () => {
    const p = claimGuard(await claimPreview(user, token), 'grant_bundle');
    const out = await grantBundle(ctx, {
      user_id: p.user_id, bundle: p.bundle, level: p.level, department_id: p.department_id, sector_id: p.sector_id,
      note: p.note, expires_on: p.expires_on,
    });
    await audit(ctx, {
      action: 'create', resource: 'user_grant', resourceId: out.bundle_id, sectorId: p.sector_id || user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_apply_grant', preview: token, confirmed_by: user.id, user_id: p.user_id, bundle: p.bundle, level: p.level, created: out.created, already: out.already },
    });
    return envelope('sanad_apply_grant', {
      scope_ar: 'منحٌ بحدّ الشاشة نفسه', units: NO_MONEY, applied: true, summary: p.summary,
      grant: { grant_id: out.bundle_id, bundle: out.bundle, label: out.label, target_name: out.target_name, level: out.level, level_ar: LEVEL_AR[out.level], expires_at: out.expires_at, created: out.created, already: out.already },
      note_ar: out.created ? 'تسري من طلبه التالي — بلا إعادة دخول.' : 'كانت ممنوحةً له على الهدف نفسه؛ حُدِّثت مدتها وسببها فقط.',
      refs: uniqRefs([REF.person(p.user_id)]),
    });
  });
}

// ── ③ الرفع: معاينة ثم تنفيذ ─────────────────────────────────────────────────────────────
async function runPreviewRevoke(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const person = await personOf(input.personId);
  const grantId = text(input.grantId, 'معرّف الصلاحية', { max: 80 });
  const bundleKey = enumOf(input.bundle, 'الحزمة', BUNDLE_KEYS);
  const targetText = text(input.target, 'الهدف', { max: 120 });
  const groups = (await listUserGrantGroups(user, person.userId)).filter((g) => !g.expired || grantId);
  let g = null;
  if (grantId) {
    g = groups.find((x) => x.bundle_id === grantId) || null;
    if (!g) throw notFound('لا صلاحية بهذا المعرّف لديه — اعرض كشفه أولاً (صلاحيات شخص)');
  } else {
    if (!bundleKey) throw badRequest('حدّد الصلاحية: معرّفها من كشفه، أو حزمتها (وهدفها إن تعدّدت)');
    let pool = groups.filter((x) => x.bundle_key === bundleKey);
    if (targetText) {
      const nq = stripKind(targetText);
      pool = pool.filter((x) => { const n = stripKind(x.target_name); return n === nq || n.includes(nq) || nq.includes(n); });
    }
    if (!pool.length) throw notFound(`لا صلاحية «${bundleOf(bundleKey).label}»${targetText ? ` على «${targetText}»` : ''} لديه — اعرض كشفه أولاً`);
    if (pool.length > 1) throw badRequest(`لديه «${bundleOf(bundleKey).label}» على أكثر من هدف — سمِّ الهدف أو مرّر معرّف الصلاحية: ${pool.map((x) => `${x.target_name} (${x.bundle_id})`).join('، ')}`);
    g = pool[0];
  }
  // الحكم نفسه الذي سيُطبَّق عند الرفع — بلا كتابة.
  await checkRevokeBundle(user, g.bundle_id);
  const summary = `رفع «${g.label}» عن ${person.name_ar} على ${g.target_name}.`;
  const display = [
    { field_ar: 'الشخص', after_ar: person.name_ar },
    { field_ar: 'الصلاحية', before_ar: `${g.label} — ${g.target_name} (${g.level_ar})`, after_ar: 'مرفوعة' },
    { field_ar: 'تشمل', after_ar: g.pairs.map((p) => p.label).join(' · ') },
    { field_ar: 'ما يحدث', after_ar: 'تسقط من طلبه التالي؛ وما يمنحه دوره وتسكينه لا يتأثر' },
  ];
  const { token, expiresAt } = await savePreview(user, {
    type: 'grant_revoke', summary, bundle_id: g.bundle_id, user_id: person.userId, person_name: person.name_ar,
    label: g.label, target_name: g.target_name, display, subject_ar: `رفع «${g.label}» — ${person.name_ar}`,
  }, { intent: 'sanad_preview_revoke_grant', sectorId: g.sector_id || user.sector_id || null });
  return envelope('sanad_preview_revoke_grant', {
    scope_ar: 'الرفع بحدّ المنح نفسه: من يستطيع أن يمنحها يستطيع أن يرفعها',
    units: NO_MONEY, summary, display,
    previewToken: token, expires_at: expiresAt, ttl_minutes: PREVIEW_TTL_MINUTES,
    note_ar: `لم يُرفَع شيء بعد. الرمز صالح ${PREVIEW_TTL_MINUTES} دقيقة ولمرة واحدة، والتنفيذ يقف لبطاقة التأكيد.`,
    text_is_data_ar: TEXT_IS_DATA_AR, refs: uniqRefs([REF.person(person.userId)]),
  });
}

async function runRevokeGrant(ctx, raw) {
  const user = ctx.user;
  const token = tokenOnly(raw, 'sanad_preview_revoke_grant');
  return await tx(async () => {
    const p = claimGuard(await claimPreview(user, token), 'grant_revoke');
    const out = await revokeBundle(ctx, p.bundle_id);
    await audit(ctx, {
      action: 'delete', resource: 'user_grant', resourceId: p.bundle_id, sectorId: user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_revoke_grant', preview: token, confirmed_by: user.id, user_id: p.user_id, rows: out.revoked },
    });
    return envelope('sanad_revoke_grant', {
      scope_ar: 'الرفع بحدّ المنح نفسه', units: NO_MONEY, applied: true, summary: p.summary,
      revoked: { grant_id: p.bundle_id, label: out.label, target_name: out.target_name, rows: out.revoked },
      note_ar: 'رُفعت — تسقط من طلبه التالي بلا إعادة دخول.',
      refs: uniqRefs([REF.person(p.user_id)]),
    });
  });
}

const PERSON = S.str('معرّف الشخص — معرّف الموظف أو معرّف الحساب كما يعيدهما البحث', { maxLength: 80 });
const BUNDLE_DESC = `الحزمة: ${GRANT_BUNDLES.map((b) => `${b.key} = ${b.label}`).join(' · ')}`;

export const GRANT_TOOLS = Object.freeze([
  {
    name: 'sanad_list_grants', label_ar: 'صلاحيات شخص', kind: 'read',
    description_ar: 'كشفُ الصلاحيات الإضافية الممنوحة لشخصٍ فوق دوره (حِزماً على إدارةٍ أو قطاعٍ أو الشركة، بمدتها ومن منحها وهل تستطيع أنت رفعها)، ومعه ما تستطيع أنت منحه له بأهدافه. لمن يرى ملف الشخص؛ غيرُ ذلك يُردّ بجملة. لا يكتب شيئاً.',
    input: obj({ personId: PERSON }, ['personId']),
    output_ar: 'صلاحياته حزمةً حزمة بمعرّف كلٍّ + ما تستطيع منحه بأهدافه؛ بلا مال',
    allow: anyone, run: runListGrants,
  },
  {
    name: 'sanad_preview_grant', label_ar: 'معاينة منح صلاحية', kind: 'preview',
    description_ar: `يعاين منح حزمة صلاحياتٍ لشخصٍ على هدف: الإدارة أو القطاع بالاسم أو المعرّف (لا يلزم لمستوى الشركة)، وحتى تاريخٍ إن أُريد. ${BUNDLE_DESC}. يُفحص بحدّ الشاشة نفسه (لا يمنح أحدٌ ما لا يملكه، ولا نفسه، ولا خارج من يديرهم) ويُردّ قبل الحفظ؛ الاسم الذي يطابق هدفين لا يُخمَّن. لا يكتب شيئاً.`,
    input: obj({
      personId: PERSON,
      bundle: S.en('الحزمة', BUNDLE_KEYS),
      level: S.en('المستوى: department = إدارة واحدة · sector = قطاع كامل · company = الشركة كلها', GRANT_LEVELS),
      target: S.str('الإدارة أو القطاع — بالاسم أو المعرّف؛ يُترك لمستوى الشركة', { maxLength: 120 }),
      expiresOn: S.day('آخر يوم تسري فيه الصلاحية — اختياري، وفراغه بلا مدة'),
      note: S.str('السبب — اختياري، يُكتب في الأثر', { maxLength: 200 }),
    }, ['personId', 'bundle', 'level']),
    output_ar: 'ما سيُمنَح صفاً صفاً (الشخص · الصلاحية · على · تشمل · الأثر · حتى) + رمز المعاينة',
    allow: mayGrantAnything, run: runPreviewGrant,
  },
  {
    name: 'sanad_apply_grant', label_ar: 'تأكيد منح صلاحية', kind: 'write',
    description_ar: 'يمنح الصلاحية المعاينة برمزها وحده عبر خدمة المنح نفسها (بحدّها وأثرها)، وتسري من طلب الشخص التالي بلا إعادة دخول. يقف لبطاقة التأكيد.',
    input: TOKEN_INPUT, output_ar: 'الصلاحية كما مُنحت بمعرّفها ومدتها',
    allow: mayGrantAnything, run: runApplyGrant,
  },
  {
    name: 'sanad_preview_revoke_grant', label_ar: 'معاينة رفع صلاحية', kind: 'preview',
    description_ar: 'يعاين رفع صلاحيةٍ ممنوحة لشخص: بمعرّفها من كشفه، أو بحزمتها (وهدفها إن كانت له على أكثر من هدف). يُفحص بحدّ المنح نفسه — من يستطيع أن يمنحها يستطيع أن يرفعها — ويُردّ قبل الحفظ. لا يكتب شيئاً.',
    input: obj({
      personId: PERSON,
      grantId: S.str('معرّف الصلاحية كما في كشفه — الأدقّ', { maxLength: 80 }),
      bundle: S.en('الحزمة — بديلاً عن المعرّف', BUNDLE_KEYS),
      target: S.str('الهدف بالاسم — إن كانت الحزمة له على أكثر من هدف', { maxLength: 120 }),
    }, ['personId']),
    output_ar: 'الصلاحية قبل (قائمة) وبعد (مرفوعة) + رمز المعاينة',
    allow: mayGrantAnything, run: runPreviewRevoke,
  },
  {
    name: 'sanad_revoke_grant', label_ar: 'تأكيد رفع صلاحية', kind: 'write',
    description_ar: 'يرفع الصلاحية المعاينة برمزها وحده عبر خدمة الرفع نفسها؛ تسقط من طلب الشخص التالي. يقف لبطاقة التأكيد.',
    input: TOKEN_INPUT, output_ar: 'ما رُفع بمعرّفه',
    allow: mayGrantAnything, run: runRevokeGrant,
  },
]);
