// ── الحذف كقدرة مكتملة في المنتج ──
//
// كان في المنصة حذفُ موظف وحذفُ إدارة وحذفُ تسكين — ولا حذفَ مشروعٍ ولا فرصة. فبيانات مستوردة
// من نظامٍ قديم (أوعية داخلية، مشاريع باسم إدارة، صفوف بلا جهة) تبقى إلى الأبد في المحافظ
// والتقارير، ولا سبيل إلى تنظيفها إلا بفتح القاعدة يدوياً — وهو بابٌ خارج التدقيق وخارج
// الصلاحيات، أي خارج كل ما بُنيت عليه المنصة.
//
// وثلاثة مبادئ تحكم هذا الملف، وهي ما يجعل الحذف آمناً بذاته لا بحُسن نيّة مَن يستعمله:
//
// ١) **المال لا يُحذف.** صفٌّ عليه فاتورة أو تحصيل أو عقد أو مستخلص يُرفض حذفه دائماً — لا
//    خيار ولا تجاوز. المال أثرٌ محاسبي، وحذفه يكسر مطابقةً لا تُستعاد من نسخة احتياطية.
//
// ٢) **لا يُترك يتيم.** حذفُ الأصل يحذف تابعه في نفس المعاملة. رأينا هذا العطل بعينه في
//    الإدارات: صفٌّ يشير إلى إدارةٍ محذوفة لا يظهر في تجميع أي إدارة، ولا يعود إلى صندوق
//    «بلا إدارة» لأن حقله ليس فارغاً — فيختفي من الشاشتين معاً بصمت.
//
// ٣) **الرفض يُشرح.** «لا يمكن الحذف» رسالةٌ عاجزة. الرسالة تقول **ما يمنع بالعدد والاسم**،
//    فيعرف صاحبها ما يفعله بدل أن يعيد المحاولة.
//
// والحذف ناعم دائماً (deleted_at) — لا محو صفوف: الأثر يبقى للتدقيق، والرجوع نقرةٌ لا استعادةُ
// نسخة. والمحو النهائي إن لزم يوماً فقرارٌ آخر بأداةٍ أخرى.
import { get, all, run, tx } from '../db/index.js';
import { can } from '../rbac/index.js';
import { audit } from '../audit/index.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { nowIso } from '../util/ids.js';

// جمعٌ عربي صحيح للعدّ في رسائل المنع: «فاتورة واحدة» لا «١ فاتورة».
function countAr(n, one, two, many) {
  const x = Number(n) || 0;
  if (x === 1) return one;
  if (x === 2) return two;
  return `${x} ${many}`;
}

// ── والحساب نوعٌ رابع في نفس الحراسة ──
//
// لم يكن في المنتج حذفُ حساب إطلاقاً: حسابٌ أُنشئ بالخطأ يبقى إلى الأبد في كل قائمة، ويزاحم
// بريدُه أي حسابٍ جديد بنفس العنوان. وعلى البيانات الحيّة ستة أشخاص لكلٍّ منهم حسابان بفارق
// حرفٍ في البريد. فوُسِّع هذا الملف بدل كتابة مسارٍ موازٍ — وحدةُ الحراسة في مكانٍ واحد هي
// أصل تصميمه، ومسارٌ ثانٍ للحذف يعني قاعدتين للأمان تنحرفان بأول تعديل.
//
// وزاد الحسابُ على الثلاثة مبادئ حاجتين لا تُشبعهما جداول العدّ وحدها:
//  · **حارسٌ يسبق العدّ** (`guards`): «آخر مدير نظام» و«حذف الذات» ليسا صفوفاً تُعدّ في جدول،
//    بل حالتان تُحسبان من الحساب نفسه ومن هوية الفاعل.
//  · **ختمٌ يُكمل الحذف** (`finalize`): الحساب المحذوف يجب أن تُقطع جلساته وتُحرق رموزه
//    ويُفرَج عن بريده — وإلا بقي داخلاً باثنتي عشرة ساعة بعد حذفه، وبقي عنوانه محجوزاً.
// حرّاس الحساب: يُحسبان قبل أي عدّ، ويُقالان في نفس قائمة الموانع كي تُعرض العاقبة قبل الضغط.
async function userGuards(row, ctx) {
  const out = [];
  // ١) لا تحذف حسابك أنت. من يحذف نفسه يقفل الباب وهو داخله: تُقطع جلسته في نفس المعاملة،
  //    فيخرج فوراً ولا يملك حساباً يعود به. والتعطيل الذاتي ممنوع أصلاً في خدمة الهوية —
  //    فالحذف الذاتي أولى بالمنع.
  if (ctx && ctx.user && ctx.user.id === row.id) {
    out.push('هذا حسابك أنت — من يحذف حسابه يقفل الباب وهو داخله');
  }
  // ٢) لا تحذف آخر حسابٍ يحمل «مدير النظام». منصةٌ بلا مدير نظام لا يُصلحها أحد من داخلها:
  //    لا دعوة تُرسَل ولا دور يُرفَع ولا حساب يُفعَّل — يلزم فتح قاعدة البيانات يدوياً.
  //    والعدّ على النشطين غير المحذوفين: مديرٌ معطَّل لا يستطيع الدخول ليفتح شيئاً، فلا يُحسب.
  if (row.role_id === 'admin') {
    const r = await get(
      `SELECT COUNT(*) n FROM app_user
        WHERE role_id = 'admin' AND active = 1 AND deleted_at IS NULL AND id <> ?`, [row.id]);
    const others = Number(r && r.n ? r.n : 0);
    if (!others) out.push('هذا آخر مدير نظام نشط — الباقون بعده: لا أحد');
  }
  return out;
}

// ما يُكمل حذف الحساب داخل نفس المعاملة.
async function userFinalize(ctx, row, stamp) {
  const notes = [];
  // الجلسات تُقطع فوراً: حسابٌ محذوف يبقى داخلاً حتى تنتهي جلسته من تلقائها — أي إلى اثنتي
  // عشرة ساعة بعد قرار الحذف — وهو نفس العطل الذي عولج في التعطيل.
  const s = await run('UPDATE session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [stamp, row.id]);
  const revoked = Number(s.changes || 0);
  if (revoked) notes.push(`قُطعت ${countAr(revoked, 'جلسة واحدة', 'جلستان', 'جلسة')}`);
  // ورمزٌ معلَّق في بريده يفتح ما أُغلق: يُحرق معه.
  await run('UPDATE login_code SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL', [stamp, row.id]);
  // ── تحرير البريد ──
  // تفرّدُ البريد في المخطط لا يستثني المحذوف: قيدٌ على العمود وفهرسٌ فريد على
  // lower(trim(email)) — كلاهما يرى الصفَّ المحذوف. فحذفٌ ناعم يترك العنوان محجوزاً إلى
  // الأبد، وأول دعوةٍ بنفس العنوان تسقط بخطأٍ خام لا برسالة عربية (فحصُ التعارض في الدعوة
  // يمرّ لأنه يستثني المحذوف، ثم يرتطم القيد). فيُفرَج عن العنوان هنا، ويبقى محفوظاً في
  // سطر التدقيق أدناه — الأثر يُحفظ في السجل لا في صفٍّ يحجز عنواناً لا يستعمله أحد.
  if (row.email) notes.push(`أُفرِج عن بريده ${row.email}`);
  // والحساب المحذوف يُطفأ كذلك: استعلاماتٌ قائمة تختار المستهدَفين بـ`active = 1` وحدها
  // (اختيار معتمِدي الاعتمادات مثلاً) فتصل إلى محذوفٍ لو بقي نشطاً.
  await run(
    `UPDATE app_user SET active = 0, deactivated_at = COALESCE(deactivated_at, ?), email = NULL,
       updated_at = ?, updated_by = ? WHERE id = ?`,
    [stamp, stamp, (ctx.user && ctx.user.id) || null, row.id]);
  return notes.join('، ');
}

// وصفُ كل نوع: جدوله، اسمه، ما يمنع حذفه (مالٌ أو تحوُّل)، وما يُحذف معه (تابع).
export const REMOVABLE = {
  project: {
    table: 'project',
    label: 'المشروع',
    nameCol: 'name_ar',
    resource: 'project',
    // المال والالتزام التعاقدي: يمنعان الحذف دائماً
    blockers: [
      { table: 'invoice', col: 'project_id', ar: (n) => countAr(n, 'فاتورة واحدة', 'فاتورتين', 'فاتورة') },
      { table: 'collection', col: 'project_id', ar: (n) => countAr(n, 'تحصيل واحد', 'تحصيلين', 'تحصيلاً') },
      { table: 'contract', col: 'project_id', ar: (n) => countAr(n, 'عقد واحد', 'عقدين', 'عقداً') },
      { table: 'revenue_line', col: 'project_id', ar: (n) => countAr(n, 'سطر إيراد واحد', 'سطري إيراد', 'سطر إيراد') },
    ],
    // التابع يُحذف معه في نفس المعاملة — فلا صفَّ يشير إلى مشروعٍ لا وجود له
    cascade: [
      { table: 'allocation', col: 'project_id', ar: 'تسكين' },
      { table: 'task', col: 'project_id', ar: 'مهمة' },
      { table: 'deliverable', col: 'project_id', ar: 'مخرج' },
      { table: 'milestone', col: 'project_id', ar: 'معلم' },
      { table: 'risk', col: 'project_id', ar: 'خطر' },
      { table: 'issue', col: 'project_id', ar: 'عائق' },
    ],
  },
  opportunity: {
    table: 'opportunity',
    label: 'الفرصة',
    nameCol: 'title_ar',
    resource: 'opportunity',
    // ── من أنشأ الفرصة يسحبها ──
    // «سحب الفرصة» قرارُ صاحبها قبل أن يكون قرارَ مديره: من أدخل فرصةً بالخطأ أو كرّرها لا
    // يحتاج قائد قطاعه ليصحّح إدخاله هو. والموانع تسري عليه كما تسري على الجميع — الملكية
    // تفتح الباب ولا تُعطّل الحراسة.
    ownDelete: (user, row) => !!user?.id && row.created_by === user.id,
    blockers: [
      // فرصةٌ تحوّلت إلى مشروع لم تعد فرصةً تُحذف: حذفها يقطع نسب المشروع إلى مصدره
      { table: 'project', col: 'source_opp_id', ar: (n) => countAr(n, 'مشروعٌ قائم', 'مشروعان قائمان', 'مشروعاً قائماً') },
      // (كان هنا مانعُ عقدٍ على `contract.opportunity_id` — والعمود لا وجود له في المخطط أصلاً:
      //  العقد يُربط بالمشروع لا بالفرصة، فكان العدّ صفراً دائماً. حُذف الصفّ الميت كي لا يوحي
      //  بحراسةٍ لا تقع — والعقد يمنع فعلاً من جهة المشروع الناتج، والمشروع الناتج مانعٌ أعلاه.)
      // ساعات عملٍ سُجِّلت على الفرصة أثرُ كشوفٍ معتمدة — تمنع السحب كما يمنع المال
      { table: 'time_entry', col: 'opportunity_id',
        ar: (n) => countAr(n, 'ساعة عمل مسجَّلة واحدة', 'ساعتا عمل مسجَّلتان', 'ساعة عمل مسجَّلة') },
    ],
    // التابع يُسحب مع فرصته في نفس المعاملة — ولا يُمَسّ `opportunity_stage_history`:
    // أثر التدقيق يبقى (كما تبقى سطور التدقيق وسجل الدخول في حذف الحساب).
    cascade: [
      { table: 'opportunity_sector', col: 'opportunity_id', ar: 'إسناد قطاع', hard: true },
      { table: 'document', col: 'opportunity_id', ar: 'مستند' },
      // العضوية جدولٌ عام (group_kind/group_id) — الشرط يثبّت النوع كي لا تُسحب عضويةُ مشروعٍ
      // صادف أن معرّفه يطابق معرّف الفرصة
      { table: 'membership', col: 'group_id', where: "group_kind='opportunity'", ar: 'عضوية فريق' },
      { table: 'task', col: 'opportunity_id', ar: 'مهمة' },
      { table: 'opportunity_department', col: 'opportunity_id', ar: 'إسناد إدارة مشاركة', hard: true },
      { table: 'crm_activity', col: 'opportunity_id', ar: 'نشاط' },
      { table: 'proposal', col: 'opportunity_id', ar: 'عرض' },
    ],
  },
  user: {
    table: 'app_user',
    label: 'الحساب',
    nameCol: 'name_ar',
    resource: 'app_user',
    denyAr: 'حذف الحسابات من صلاحية مدير النظام وحده',
    guards: userGuards,
    finalize: userFinalize,
    // ── صاحبُ عملٍ حيّ لا يُحذف صمتاً: يُمنع ويُقال عدد ما يمنعه ──
    // القرار منعٌ لا نقلٌ تلقائي. النقل يعني أن تختار المنصة مالكاً جديداً بدل صاحب القرار،
    // فتنسب مشروعاً أو فرصةً إلى من لم يقبلها — والنسبة أثرٌ يُقرأ في المحافظ والتقارير
    // والحوافز. وحذفٌ صامت أسوأ: مهامٌّ مفتوحة تصير بلا مسؤول ولا أحد يعلم أنها فقدته.
    // فالرسالة تسمّي المانع بعدده وتقول البديل: انقل العمل، أو عطّل الحساب إن كان المطلوب
    // قطع الوصول الآن — التعطيل يُغلق الباب ويُبقي العمل باسمه.
    blockers: [
      { table: 'task', col: 'assignee_user_id', where: "status NOT IN ('DONE', 'CANCELLED')",
        ar: (n) => countAr(n, 'مهمة مفتوحة واحدة', 'مهمتان مفتوحتان', 'مهمة مفتوحة') },
      { table: 'project', col: 'owner_user_id', where: "COALESCE(status, '') NOT IN ('COMPLETED', 'CANCELLED')",
        ar: (n) => countAr(n, 'مشروع قائم يملكه', 'مشروعان قائمان يملكهما', 'مشروعاً قائماً يملكها') },
      { table: 'opportunity', col: 'owner_user_id',
        ar: (n) => countAr(n, 'فرصة واحدة باسمه', 'فرصتان باسمه', 'فرصة باسمه') },
      { table: 'approval_request', col: 'requested_by', where: "status = 'PENDING'",
        ar: (n) => countAr(n, 'طلب اعتماد واحد ينتظره', 'طلبا اعتماد ينتظرانه', 'طلب اعتماد تنتظره') },
      { table: 'sector', col: 'lead_user_id',
        ar: (n) => countAr(n, 'قطاع يقوده', 'قطاعان يقودهما', 'قطاعاً يقودها') },
      { table: 'department', col: 'manager_user_id',
        ar: (n) => countAr(n, 'إدارة يديرها', 'إدارتان يديرهما', 'إدارة يديرها') },
    ],
    // العروض المحفوظة تخصّ صاحبها وحده ولا يقرؤها غيره — تُطوى معه. أما ما يحمل أثراً
    // تاريخياً (سجل الدخول، سطور التدقيق، ساعات العمل المسجَّلة) فلا يُمَسّ: الحذف الناعم
    // يحفظ الأثر، وجداولُ الأثر تصل إلى اسم صاحبها بلا شرط «غير محذوف».
    cascade: [
      { table: 'saved_view', col: 'user_id', ar: 'عرض محفوظ' },
    ],
    refuseAr: (name, blockers) => `لا يمكن حذف حساب «${name}» — عليه ${blockers.join('، و')}. `
      + 'انقل عمله إلى زميل أو أغلق ما بقي باسمه ثم احذفه. وإن كان المطلوب منعه من الدخول الآن '
      + 'فعطّل الحساب: التعطيل يُغلق الباب فوراً ويُبقي عمله باسمه، والحذف يُزيل الحساب نفسه.',
  },
};

// ما يحمله الجدول فعلاً في هذه القاعدة — لا ما نفترضه.
//
// **ليس كل جدول عنده حذفٌ ناعم**: الفاتورة وسطر الإيراد والتحصيل بلا عمود `deleted_at`
// (حالتها تُدار بحقل الحالة). وافتراضُ وجوده يرمي «لا يوجد هذا العمود» فيُردّ **كلُّ** حذفٍ
// بخطأٍ غامض — بما فيه الحذف المشروع. وأسوأُ منه لو التُقط الخطأ بصمت: يصير المانع المالي
// غير محسوب، فيُحذف مشروعٌ عليه فاتورة. فيُقرأ المخطط ويُبنى الاستعلام على ما وُجد.
const shapeCache = new Map();
async function shapeOf(table, col) {
  const key = `${table}.${col}`;
  if (shapeCache.has(key)) return shapeCache.get(key);
  let hasCol = false, soft = false;
  try { await get(`SELECT ${col} FROM ${table} WHERE 1 = 0`); hasCol = true; } catch { hasCol = false; }
  if (hasCol) { try { await get(`SELECT deleted_at FROM ${table} WHERE 1 = 0`); soft = true; } catch { soft = false; } }
  const v = { hasCol, soft };
  shapeCache.set(key, v);
  return v;
}

// `extra` شرطٌ ثابت مكتوب في هذا الملف (لا مدخلَ مستخدم فيه بحال): مانعُ الحساب ليس «كل صفٍّ
// يشير إليه» بل الحيّ منه وحده — مهمةٌ منجَزة أو مشروعٌ مغلق تاريخٌ لا عملٌ ينتظر صاحبه.
async function countLive(table, col, id, extra = '') {
  const { hasCol, soft } = await shapeOf(table, col);
  if (!hasCol) return 0;
  let sql = `SELECT COUNT(*) n FROM ${table} WHERE ${col} = ?`;
  if (soft) sql += ' AND deleted_at IS NULL';
  if (extra) sql += ` AND (${extra})`;
  const r = await get(sql, [id]);
  return Number(r?.n || 0);
}

// ما يمنع الحذف — يُحسب كاملاً قبل أي رفض، كي تُقال الأسباب مجتمعةً لا سبباً واحداً في كل محاولة.
// و`ctx` اختياري: بعض الحرّاس تعتمد على هوية الفاعل نفسه (حذفُ الذات)، ومن ناداها بلا سياق
// يحصل على الموانع الموضوعية وحدها — ولا يُفترض السماح من غيابها، فالحذف نفسه يُعيد الحساب بسياقه.
export async function removalBlockers(kind, id, ctx = null) {
  const cfg = REMOVABLE[kind];
  if (!cfg) throw badRequest('نوعٌ غير معروف للحذف');
  const out = [];
  if (cfg.guards) {
    const row = await get(`SELECT * FROM ${cfg.table} WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (row) out.push(...await cfg.guards(row, ctx));
  }
  for (const b of cfg.blockers) {
    const n = await countLive(b.table, b.col, id, b.where || '');
    if (n) out.push(b.ar(n));
  }
  return out;
}

/**
 * العاقبة كاملةً قبل الضغط: الموانع، وهل الحذف ممكن، **وما سيُسحب تبعاً بعدده** — فمن يؤكد
 * السحب يعرف أن معه مستندَين ومهمة، لا أن «شيئاً ما» سيختفي. العدّ يطابق حلقة الحذف نفسها
 * (نفس الشرط ونفس فحص شكل الجدول) كي لا تَعِد المعاينةُ بما لا يفعله الحذف.
 * @returns {{blockers:string[], removable:boolean, cascades:{label:string,count:number}[]}}
 */
export async function removalPreview(kind, id, ctx = null) {
  const cfg = REMOVABLE[kind];
  if (!cfg) throw badRequest('نوعٌ غير معروف للحذف');
  const blockers = await removalBlockers(kind, id, ctx);
  const cascades = [];
  for (const c of cfg.cascade) {
    const shape = await shapeOf(c.table, c.col);
    if (!shape.hasCol) continue;
    if (!shape.soft && !c.hard) continue; // حلقة الحذف تتركه — فلا يُعدّ في المعاينة
    const count = await countLive(c.table, c.col, id, c.where || '');
    cascades.push({ label: c.ar, count });
  }
  return { blockers, removable: !blockers.length, cascades };
}

/**
 * حذفٌ ناعم محروس. يرمي رسالةً عربية تسمّي المانع بعدده، أو يحذف الأصل وتابعه معاً.
 * @returns {{ok:true, id:string, cascaded:Record<string,number>}}
 */
export async function removeRecord(ctx, kind, id, opts = {}) {
  const cfg = REMOVABLE[kind];
  if (!cfg) throw badRequest('نوعٌ غير معروف للحذف');
  const row = await get(`SELECT * FROM ${cfg.table} WHERE id = ? AND deleted_at IS NULL`, [id]);
  if (!row) throw notFound(`${cfg.label} غير موجود أو محذوف سابقاً`);
  // الصلاحية الإدارية **أو** ملكية الإنشاء إن فتحها النوع (`ownDelete`): من أنشأ السجل يصحّح
  // إدخاله بنفسه. والموانع أدناه تسري على الطريقين بلا فرق — الملكية لا تُعطّل الحراسة.
  const allowed = can(ctx.user, 'delete', cfg.resource, row) || (cfg.ownDelete && cfg.ownDelete(ctx.user, row));
  if (!allowed) {
    throw forbidden(cfg.denyAr || `حذف ${cfg.label} يتطلب صلاحية إدارية على قطاعه`);
  }

  const name = row[cfg.nameCol] || row.username || id;
  const blockers = await removalBlockers(kind, id, ctx);
  if (blockers.length) {
    throw badRequest(cfg.refuseAr
      ? cfg.refuseAr(name, blockers)
      : `لا يمكن حذف ${cfg.label} «${name}» — عليه ${blockers.join(' و')}. `
        + 'السجلات المالية والتعاقدية لا تُحذف: انقلها أو أغلقها أولاً، أو غيّر حالة السجل إلى «مُلغى» بدل حذفه.',
    );
  }

  const cascaded = {};
  const stamp = nowIso();
  let extra = '';
  await tx(async () => {
    for (const c of cfg.cascade) {
      const shape = await shapeOf(c.table, c.col);
      if (!shape.hasCol) continue;
      // جدولٌ بلا حذفٍ ناعم لا يُختم — يُترك كما هو ويُذكر أنه لم يُمسّ، فلا ادّعاءَ تنظيفٍ لم يحدث
      if (!shape.soft && !c.hard) continue;
      // `where` شرطٌ ثابت مكتوب في هذا الملف (لا مدخلَ مستخدم فيه بحال) — كما `extra` في العدّ:
      // جدولٌ عام كالعضوية (group_kind/group_id) يحتاج تثبيت النوع كي لا يُسحب صفُّ نوعٍ آخر.
      const cond = c.where ? ` AND (${c.where})` : '';
      if (c.hard) {
        // جداول الربط بلا حذفٍ ناعم: صفُّ ربطٍ إلى أصلٍ محذوف لا معنى له ولا أثر فيه
        const r = await run(`DELETE FROM ${c.table} WHERE ${c.col} = ?${cond}`, [id]);
        if (Number(r.changes || 0)) cascaded[c.ar] = Number(r.changes);
        continue;
      }
      const r = await run(`UPDATE ${c.table} SET deleted_at = ? WHERE ${c.col} = ? AND deleted_at IS NULL${cond}`, [stamp, id]);
      if (Number(r.changes || 0)) cascaded[c.ar] = Number(r.changes);
    }
    // ما يُكمل الحذف لهذا النوع (قطعُ جلسات الحساب وتحريرُ بريده) — داخل المعاملة نفسها:
    // حذفٌ يقع وجلسةٌ تبقى حيّةً ليس حذفاً، ونصفُ حذفٍ أسوأ من لا حذف.
    if (cfg.finalize) extra = await cfg.finalize(ctx, row, stamp);
    await run(`UPDATE ${cfg.table} SET deleted_at = ? WHERE id = ?`, [stamp, id]);
    const tail = Object.entries(cascaded).map(([k, n]) => `${n} ${k}`).join('، ');
    await audit(ctx, {
      action: 'delete', resource: cfg.resource, resourceId: id, sectorId: row.sector_id || null,
      detail: `حذف ${cfg.label} «${name}»${tail ? ` ومعه ${tail}` : ''}${extra ? ` — ${extra}` : ''}`
        + (opts.reason ? ` — السبب: ${String(opts.reason).slice(0, 160)}` : ''),
    });
  });
  return { ok: true, id, name, cascaded, note: extra };
}
