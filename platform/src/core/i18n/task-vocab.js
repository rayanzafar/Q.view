// مفرداتُ المهمة — مصدرٌ واحد يقرؤه الطرفان.
//
// حالاتُ المهمة وأولوياتُها كانت تعيش في `web/layout.js` وحدها (جدول `LABELS`)، وهو ملفُّ
// عرضٍ لا تستورده الخدمات ولا يجوز أن تستورده. فحين احتاجت خدمةُ المهام أن تكتب في سجل
// التدقيق «الحالة: منجز» لا «DONE»، لم يكن أمامها إلا أن تكرّر الجدول — ونسختان تفترقان.
//
// فالمفردات تنزل إلى `core/i18n` حيث تصل إليها الخدماتُ والشاشاتُ معاً (نفس موضع
// `MONTHS_AR` الذي يستورده `layout.js` أصلاً)، و`LABELS` يفرشها ولا يعيد كتابتها.
//
// ولماذا يهمّ: القيمةُ الخام تُطبع على شاشة سجل التدقيق كما هي، و«DONE» و«TODO» من
// المصطلحات التي يرصدها فاحصُ المعجم ومسحُ ما بعد النشر — فالترجمة هنا ليست تجميلاً.

export const TASK_STATUS_AR = {
  TODO: 'قيد الانتظار', IN_PROGRESS: 'قيد التنفيذ', BLOCKED: 'مُعطَّل',
  IN_REVIEW: 'قيد المراجعة', DONE: 'منجز', CANCELLED: 'ملغى',
};
export const taskStatusLabel = (s) => TASK_STATUS_AR[String(s || '').toUpperCase()] || 'حالة غير محدَّدة';

export const TASK_PRIORITY_AR = { P0: 'حرجة', P1: 'عالية', P2: 'متوسطة', P3: 'منخفضة' };
export const taskPriorityLabel = (p) => TASK_PRIORITY_AR[String(p || '').toUpperCase()] || 'أولوية غير محدَّدة';

// أسماءُ حقول المهمة كما يقرؤها إنسانٌ في سجل التدقيق. المفتاح غير المذكور هنا لا يُكتب في
// الأثر أصلاً — قائمةُ سماحٍ لا قائمةَ حظر، فلا يتسرّب حقلٌ جديد إلى الشاشة بمجرد إضافته.
export const TASK_FIELD_AR = {
  title: 'العنوان', status: 'الحالة', priority: 'الأولوية', due_date: 'تاريخ الاستحقاق',
  start_date: 'تاريخ البدء', assignee_user_id: 'المسؤول', utilization_pct: 'حجم المهمة',
  progress_pct: 'نسبة الإنجاز', project_id: 'المشروع', opportunity_id: 'الفرصة',
  department_id: 'الإدارة', category: 'التصنيف', next_step: 'الخطوة التالية',
  work_kind: 'نوع العمل', blocked_reason: 'سبب التعطيل',
};
export const taskFieldLabel = (f) => TASK_FIELD_AR[String(f || '')] || null;
