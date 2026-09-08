// «مركز التطوير» — المعجم الوحيد لهذه الميزة.
//
// كل قيمةٍ مخزَّنة في جداول الترحيلة ٠٤٥ لها هنا اسمٌ عربيٌّ واحد، وكلُّ طبقةٍ تعرض نصاً
// للمستخدم تستورده من هنا: الشاشات، والبريد، وردود المساعد، والتقارير المطبوعة. القاعدة
// المكتوبة في هذا الملف لا في العادة: **لا تصل قيمةٌ خام إلى عينِ مستخدم** — لا «RESOLVED»
// ولا «bug» ولا «critical». وحين تُضاف حالةٌ جديدة تُضاف هنا أولاً، فيُكشف كلُّ موضعٍ نسي
// ترجمتها في اللحظة نفسها بدل أن يتسرّب الرمز إلى شاشة.
//
// والخرائط مجمَّدة (`Object.freeze`) عمداً: مصدرٌ واحد لا يُعدَّل في زمن التشغيل من أي وحدة.

// ── حالات البند ──────────────────────────────────────────────────────────────
export const ITEM_STATUS = Object.freeze({
  NEW: 'جديد',
  TRIAGED: 'قيد الدراسة',
  AWAITING_APPROVAL: 'بانتظار الاعتماد',
  APPROVED: 'معتمد',
  DECLINED: 'مرفوض',
  IN_PROGRESS: 'قيد التنفيذ',
  RESOLVED: 'تم الحل',
  NEEDS_INFO: 'بحاجة لتوضيح',
  DUPLICATE: 'مكرر',
});
export const ITEM_STATUSES = Object.freeze(Object.keys(ITEM_STATUS));
export const itemStatusLabel = (v) => ITEM_STATUS[v] || 'غير محدد';

// حالاتٌ انتهى عندها البند فلا يُنتظر منه شيء — تُستعمل في العدّادات والتقارير.
export const CLOSED_STATUSES = Object.freeze(['RESOLVED', 'DECLINED', 'DUPLICATE']);
export const isClosedStatus = (v) => CLOSED_STATUSES.includes(v);

// ── نوع البند ────────────────────────────────────────────────────────────────
export const ITEM_TYPE = Object.freeze({ bug: 'عُطل', suggestion: 'اقتراح' });
export const ITEM_TYPES = Object.freeze(Object.keys(ITEM_TYPE));
export const itemTypeLabel = (v) => ITEM_TYPE[v] || 'غير محدد';

// ── الإلحاح بلسان صاحب البلاغ لا بلسان المطوِّر ──────────────────────────────
// «عاجل / متوسط / منخفض» تعني للناس أشياء مختلفة، وأثرُ العطل على عمل صاحبه معنىً واحد.
export const ITEM_URGENCY = Object.freeze({
  blocks: 'يعطّل عملي',
  delays: 'يؤخّر عملي',
  improve: 'تحسين لا يعطّل',
});
export const ITEM_URGENCIES = Object.freeze(Object.keys(ITEM_URGENCY));
export const itemUrgencyLabel = (v) => ITEM_URGENCY[v] || 'غير محدد';

// ── تقدير المطوِّر: الحجم والأولوية ──────────────────────────────────────────
export const ITEM_SIZE = Object.freeze({ S: 'صغير', M: 'متوسط', L: 'كبير' });
export const ITEM_SIZES = Object.freeze(Object.keys(ITEM_SIZE));
export const itemSizeLabel = (v) => ITEM_SIZE[v] || 'غير محدد';

export const ITEM_PRIORITY = Object.freeze({
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  critical: 'حرجة',
});
export const ITEM_PRIORITIES = Object.freeze(Object.keys(ITEM_PRIORITY));
export const itemPriorityLabel = (v) => ITEM_PRIORITY[v] || 'غير محدد';

// ── من أين وصل البند ─────────────────────────────────────────────────────────
export const ITEM_SOURCE = Object.freeze({
  sanad: 'من داخل المنصة',
  link: 'من رابط الاستقبال',
  manual: 'أُضيف بالنيابة',
  agent: 'عبر المساعد',
});
export const ITEM_SOURCES = Object.freeze(Object.keys(ITEM_SOURCE));
export const itemSourceLabel = (v) => ITEM_SOURCE[v] || 'غير محدد';

// ── العضوية في فريق المنتج ───────────────────────────────────────────────────
export const MEMBER_ROLE = Object.freeze({ developer: 'مطوِّر', manager: 'مدير المنتج' });
export const MEMBER_ROLES = Object.freeze(Object.keys(MEMBER_ROLE));
export const memberRoleLabel = (v) => MEMBER_ROLE[v] || 'غير محدد';

// ── نوع المنتج ───────────────────────────────────────────────────────────────
export const PRODUCT_KIND = Object.freeze({ internal: 'منتج داخلي', external: 'منتج للعملاء' });
export const PRODUCT_KINDS = Object.freeze(Object.keys(PRODUCT_KIND));
export const productKindLabel = (v) => PRODUCT_KIND[v] || 'غير محدد';

// ── هوية من يفتح رابط الاستقبال ──────────────────────────────────────────────
export const IDENTITY_MODE = Object.freeze({
  anonymous_only: 'بلا تعريف بالنفس',
  optional: 'التعريف بالنفس اختياري',
  required: 'الاسم والبريد مطلوبان',
});
export const IDENTITY_MODES = Object.freeze(Object.keys(IDENTITY_MODE));
export const identityModeLabel = (v) => IDENTITY_MODE[v] || 'غير محدد';

// ── لغة الرابط ───────────────────────────────────────────────────────────────
export const LINK_LANGS = Object.freeze(['ar', 'en']);

// ── ظهور التعليق ─────────────────────────────────────────────────────────────
export const COMMENT_VISIBILITY = Object.freeze({
  internal: 'بين الفريق',
  reporter: 'يقرؤها من أبلغ',
});
export const COMMENT_VISIBILITIES = Object.freeze(Object.keys(COMMENT_VISIBILITY));

// ── نوع الصورة ───────────────────────────────────────────────────────────────
export const IMAGE_KIND = Object.freeze({
  report: 'صورة البلاغ',
  before: 'قبل',
  after: 'بعد',
  logo: 'شعار المنتج',
});
export const IMAGE_KINDS = Object.freeze(Object.keys(IMAGE_KIND));
export const imageKindLabel = (v) => IMAGE_KIND[v] || 'غير محدد';
