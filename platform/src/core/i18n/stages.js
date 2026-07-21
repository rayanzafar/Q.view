// قاموس مراحل الفرص — المصدر الواحد لمعنى كل مرحلة وشروطها وسلوكها المتوقع.
// يُعرض للمستخدم عند الطلب (زر «؟» برأس عمود الكانبان) بسبعة أسطر ثابتة:
// المعنى / شرط الدخول / شرط الخروج / الاحتمال الافتراضي / العمر المقبول / متى تُعد متوقفة / الإجراء المتوقع.
// العتبات الرقمية تأتي من ROT_THRESHOLDS (modules/crm) — لا نسخة ثانية للأرقام هنا.
import { ROT_THRESHOLDS } from '../../modules/crm/opportunities.js';

export const STAGE_DICT = {
  LEAD: {
    meaning: 'جهة أبدت اهتماماً مبدئياً ولم يُتحقق بعد من جدّيتها',
    entry: 'تواصل موثّق مع جهة لديها حاجة محتملة',
    exit: 'التحقق من الميزانية وصاحب القرار والحاجة الفعلية',
    stalledWhen: 'لا تواصل موثّق خلال أسبوعين',
    expectedNext: 'اجتماع تعريفي أو مكالمة تأهيل',
  },
  QUALIFIED: {
    meaning: 'فرصة جادة: الميزانية وصاحب القرار والحاجة مؤكدة',
    entry: 'اكتمال التأهيل الثلاثي (ميزانية · قرار · حاجة)',
    exit: 'تسليم العرض الفني والمالي للعميل',
    stalledWhen: 'أسبوعان بلا تقدم نحو العرض',
    expectedNext: 'إعداد العرض وتحديد موعد تسليمه',
  },
  PROPOSAL: {
    meaning: 'العرض لدى العميل وبانتظار رده',
    entry: 'تسليم عرض فني ومالي موثّق',
    exit: 'رد العميل: دعوة تفاوض أو ترسية أو اعتذار',
    stalledWhen: 'ثلاثة أسابيع بلا رد رغم المتابعة',
    expectedNext: 'متابعة مجدولة مع صاحب القرار',
  },
  NEGOTIATION: {
    meaning: 'نقاش نهائي على النطاق والسعر قبل الترسية',
    entry: 'دعوة رسمية للتفاوض على العرض',
    exit: 'توقيع الاتفاق أو تعذّر الاتفاق',
    stalledWhen: 'شهر بلا جلسة تفاوض أو مسودة عقد',
    expectedNext: 'جلسة حسم البنود المفتوحة',
  },
  WON: {
    meaning: 'تمت الترسية ووُقِّع الاتفاق — تتحول إلى مشروع',
    entry: 'اتفاق موقّع أو أمر إسناد رسمي',
    exit: '—',
    stalledWhen: '—',
    expectedNext: 'فتح المشروع وتسمية مديره وفريقه',
  },
  LOST: {
    meaning: 'حُسمت لصالح جهة أخرى أو أُلغيت',
    entry: 'اعتذار رسمي أو إلغاء موثّق',
    exit: '—',
    stalledWhen: '—',
    expectedNext: 'توثيق سبب الخسارة للاستفادة القادمة',
  },
  ON_HOLD: {
    meaning: 'متوقفة مؤقتاً بقرار من العميل أو منا',
    entry: 'قرار تأجيل موثّق بسبب واضح',
    exit: 'عودة النشاط أو الإلغاء النهائي',
    stalledWhen: 'ربع كامل بلا مراجعة',
    expectedNext: 'مراجعة دورية لقرار التأجيل',
  },
};

// يدمج صف المرحلة من القاعدة (name_ar, default_win_pct) فوق القاموس + عتبة العمر من ROT_THRESHOLDS
export function stageInfo(stageRow) {
  const d = STAGE_DICT[stageRow.id] || {};
  return {
    ...d,
    id: stageRow.id,
    name_ar: stageRow.name_ar,
    defaultWinPct: stageRow.default_win_pct != null ? Math.round(stageRow.default_win_pct) : null,
    ageLimitDays: ROT_THRESHOLDS[stageRow.id] || null,
  };
}
