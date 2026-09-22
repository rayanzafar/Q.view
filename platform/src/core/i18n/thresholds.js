// المصدر الواحد لعتبات الطاقة ومعاني حالة المشروع (الصحة) — تسمية واحدة ولون واحد لكل نسبة.
// سبب وجوده: نفس نسبة الإشغال كانت تظهر بلونين مختلفين في صفحتين (70% أخضر في صفحة الفريق
// وأصفر في بريد القوى العاملة)، وحالة المشروع كانت تُطبع بحروف لاتينية خام في البريد.
// طبقياً: core لا يستورد من web إطلاقاً — الصفحات والمعجم (web) هي التي تستورد من هنا.
// البريد لا يفهم متغيّرات CSS، لذلك لكل حالة لون هكس (للبريد) ومتغيّر تصميم (للصفحات).

// ── حالة المشروع/القطاع (ما كان يُطبع RED/AMBER/GREEN) ────────────────────────
// المعنى قبل اللون: «على المسار / في خطر / حرج» — اللون يبقى كما هو دلالةً بصرية.
export const HEALTH_ORDER = ['GREEN', 'AMBER', 'RED'];

export const HEALTH = {
  GREEN: { key: 'GREEN', label: 'على المسار', color: '#047857', bg: '#dcfce7', fg: '#047857', cssVar: 'var(--green)' },
  AMBER: { key: 'AMBER', label: 'في خطر', color: '#a16207', bg: '#fef3c7', fg: '#92400e', cssVar: 'var(--amber)' },
  RED: { key: 'RED', label: 'حرج', color: '#dc2626', bg: '#fee2e2', fg: '#b91c1c', cssVar: 'var(--red)' },
};

// حالة غير مسجَّلة (مشروع جديد أو بيانات ناقصة) — لا تُطبع فراغاً ولا رمزاً تقنياً.
export const HEALTH_UNKNOWN = { key: 'UNKNOWN', label: 'غير محدَّدة', color: '#5b6472', bg: '#f1f5f9', fg: '#475569', cssVar: 'var(--muted)' };

export const health = (rag) => HEALTH[String(rag == null ? '' : rag).trim().toUpperCase()] || HEALTH_UNKNOWN;
export const healthLabel = (rag) => health(rag).label;
export const healthColor = (rag) => health(rag).color;
// تسميات جاهزة للعرض في الأماكن التي تحتاج خريطة مباشرة (رؤوس أعمدة، مفاتيح ألوان).
export const HEALTH_LABELS = { GREEN: HEALTH.GREEN.label, AMBER: HEALTH.AMBER.label, RED: HEALTH.RED.label };
// «على المسار/في خطر/حرج» بترتيب ثابت — تُستعمل في شرح مفتاح الألوان.
export const HEALTH_LEGEND = HEALTH_ORDER.map((k) => HEALTH[k].label).join(' · ');

// ── عتبات الطاقة (الإشغال) ────────────────────────────────────────────────────
// قرار المنتج الموثّق في لوحة الامتدادات: فوق 110% تجاوز · 70–110% ضمن الطاقة ·
// 1–69% سعة متاحة · صفر لعضو قطاع = تسكين قطاعي · صفر بلا قطاع = غير مُسكَّن.
// أي سطح جديد (صفحة/بريد/تقرير/تصدير) يأخذ لونه وتسميته من هنا، ولا ينسخ الأرقام.
export const CAPACITY = { over: 110, healthy: 70, idle: 0 };

export const CAPACITY_BANDS = {
  over: { key: 'over', label: 'تجاوز الطاقة', color: '#dc2626', cssVar: 'var(--red)' },
  ok: { key: 'ok', label: 'ضمن الطاقة', color: '#047857', cssVar: 'var(--green)' },
  low: { key: 'low', label: 'سعة متاحة', color: '#a16207', cssVar: 'var(--amber)' },
  park: { key: 'park', label: 'تسكين قطاعي', color: '#834798', cssVar: 'var(--brand2)' },
  off: { key: 'off', label: 'غير مُسكَّن حالياً', color: '#79828f', cssVar: 'var(--faint)' },
};

// pct: نسبة صحيحة (100 = طاقة كاملة). sectorMember: هل العضو مسجَّل على قطاع (يفرّق بين
// «تسكين قطاعي» و«غير مُسكَّن») — نفس منطق لوحة الامتدادات حرفياً.
export const capacityBand = (pct, { sectorMember = false } = {}) => {
  const v = Number(pct) || 0;
  if (v > CAPACITY.over) return 'over';
  if (v >= CAPACITY.healthy) return 'ok';
  if (v > CAPACITY.idle) return 'low';
  return sectorMember ? 'park' : 'off';
};

export const capacityLabel = (pct, opts) => CAPACITY_BANDS[capacityBand(pct, opts)].label;
export const capacityColor = (pct, opts) => CAPACITY_BANDS[capacityBand(pct, opts)].color; // هكس — للبريد
export const capacityVar = (pct, opts) => CAPACITY_BANDS[capacityBand(pct, opts)].cssVar; // متغيّر تصميم — للصفحات

// شرح العتبات بجملة واحدة تُعرض تحت أي مقياس إشغال حتى يعرف القارئ معنى اللون.
export const CAPACITY_LEGEND =
  `تجاوز الطاقة فوق ${CAPACITY.over}% · ضمن الطاقة ${CAPACITY.healthy}–${CAPACITY.over}% · سعة متاحة أقل من ${CAPACITY.healthy}%`;

// ── مطابقة قائمة الدخل مع ما سُجِّل في سند ────────────────────────────────────
// طرفان لتكلفة الإيراد: ما تُقفله المالية شهرياً بسطورها، وما سجّله أهل المشاريع في سند.
// وتطابقٌ حرفيٌّ بالهللة لا يقع أبداً — فرقُ توقيتٍ في اعتماد مصروفٍ يكفي. فالحكم عتبتان معاً،
// وتكفي أوسعهما: نصف بالمئة من رقم المالية، أو خمسة آلاف ريال — أيّهما أكبر. والنسبة وحدها
// تجعل شهراً صغيراً يفشل بفرقِ فاتورةٍ واحدة، والمبلغ وحده يُمرّر فرقاً كبيراً في شهرٍ ضخم.
export const PL_RECON_PCT = 0.5;
export const PL_RECON_MIN_HALALAS = 500_000;   // خمسة آلاف ريال

// الحكم نفسه دالةً: الشاشة والخدمة والورقة تقرأ منها، فلا ثلاث نسخٍ تفترق عند التقريب.
// `finHalalas` رقم المالية و`diffHalalas` فرقُه عن سند. الفراغ يبقى فراغاً.
export const plReconMatch = (finHalalas, diffHalalas) => {
  if (finHalalas == null || diffHalalas == null) return null;
  const tolerance = Math.max((Math.abs(Number(finHalalas)) * PL_RECON_PCT) / 100, PL_RECON_MIN_HALALAS);
  return Math.abs(Number(diffHalalas)) <= tolerance;
};

// شرحُ القاعدة بجملة واحدة تُعرض تحت شارة «مطابق سند».
export const PL_RECON_LEGEND =
  `يُعدّ الشهر مطابقاً إذا كان الفرق أقل من ${PL_RECON_PCT}% من رقم المالية أو أقل من ${PL_RECON_MIN_HALALAS / 100} ريال`;
