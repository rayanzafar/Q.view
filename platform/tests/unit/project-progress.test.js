// نسب المشروع الأربع — الحساب نفسه، بلا قاعدة بيانات.
//
// العيب الذي تحرسه هذه الملفات: ثلاث نسب (الإنجاز التنفيذي · الفوترة · التحصيل) كانت تُقرأ من
// **خانة حالة واحدة** على المخرَج، وإصدارُ المستخلص يكتب فوقها. فالمخرَج المعتمَد من العميل
// يصير — بمجرّد صدور فاتورته — مخرَجاً لا يُعرف أقُبل أم لا، وترتفع «نسبة الاعتماد» بلا اعتماد.
// كل اختبار هنا يثبّت أن الحقائق الأربع مستقلة، وأن الأوزان تُشتقّ ولا تُخزَّن.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryProgress, weighDeliverables, scheduleHealth } from '../../src/modules/pmo/progress.js';

const D = (id, status, amount, extra = {}) => ({ id, status, amount_halalas: amount, ...extra });

test('الإنجاز التنفيذي يرتفع بالاعتماد وحده — والتسليم يُعرض بجانبه لا مدمجاً فيه', () => {
  const r = deliveryProgress([
    D('a', 'ACCEPTED', 30_000_00),
    D('b', 'DELIVERED', 40_000_00),
    D('c', 'IN_PROGRESS', 30_000_00),
  ]);
  assert.equal(r.acceptedPct, 30, 'المعتمَد بوزنه المالي');
  assert.equal(r.deliveredPct, 70, 'المُسلَّم يشمل المعتمَد — كلاهما «أُنجز العمل»');
  assert.equal(r.awaitingAcceptance, 40, 'الفارق هو ما ينتظر اعتماد العميل');
});

test('الفوترة والتحصيل لا يرفعان الإنجاز — وهو العيب بعينه', () => {
  const base = [D('a', 'DELIVERED', 50_000_00), D('b', 'IN_PROGRESS', 50_000_00)];
  const before = deliveryProgress(base);
  // نفس الصفوف، لكن الأول فُوتر وحُصِّل. لو كانت الفوترة حالةً لصار «مفوتراً» ولاختفى تسليمه.
  const after = deliveryProgress([
    D('a', 'DELIVERED', 50_000_00, { invoiced_at: '2026-01-01', collected_at: '2026-02-01' }),
    D('b', 'IN_PROGRESS', 50_000_00),
  ]);
  assert.equal(after.acceptedPct, before.acceptedPct, 'الفوترة لا تُقرأ اعتماداً');
  assert.equal(after.deliveredPct, before.deliveredPct, 'ولا التحصيل يغيّر حالة التسليم');
  assert.equal(after.acceptedPct, 0, 'ولا اعتماد هنا أصلاً — فُوتر مخرَجٌ لم يعتمده العميل بعد');
  assert.equal(after.invoiced, 1);
  assert.equal(after.collected, 1);
});

test('الوزن يُشتقّ من القيمة المالية — لا بالعدّ المجرّد', () => {
  const w = weighDeliverables([D('big', 'ACCEPTED', 90_000_00), D('small', 'DRAFT', 10_000_00)]);
  assert.equal(Math.round(w.get('big')), 90, 'مخرَجٌ يمثّل تسعة أعشار العقد لا يساوي مخرَجاً رمزياً');
  assert.equal(Math.round(w.get('small')), 10);
});

test('بلا قيم مالية: التساوي — لا قسمة على صفر ولا نسبة بلا معنى', () => {
  const w = weighDeliverables([D('a', 'ACCEPTED'), D('b', 'DRAFT'), D('c', 'DRAFT')]);
  assert.equal(Math.round(w.get('a')), 33);
  assert.equal(deliveryProgress([D('a', 'ACCEPTED'), D('b', 'DRAFT'), D('c', 'DRAFT')]).acceptedPct, 33);
});

test('الوزن المكتوب يفوز — لكن كلٌّ أو لا شيء، فلا يُخلط بالمشتقّ', () => {
  // كل الصفوف موزونة يدوياً ⇒ تُقرأ أوزانها.
  const all = weighDeliverables([D('a', 'ACCEPTED', 10_000_00, { weight: 80 }), D('b', 'DRAFT', 90_000_00, { weight: 20 })]);
  assert.equal(Math.round(all.get('a')), 80, 'قرار صاحب المشروع يعلو على المال');
  // واحدٌ فقط موزون ⇒ المجموعة كلها تُشتقّ، وإلا صار المجموع بلا معنى.
  const some = weighDeliverables([D('a', 'ACCEPTED', 10_000_00, { weight: 80 }), D('b', 'DRAFT', 90_000_00)]);
  assert.equal(Math.round(some.get('a')), 10, 'وزنٌ واحد ليس خطةَ أوزان');
});

test('المخرَج المحذوف لا يدخل الحساب — لا في البسط ولا في المقام', () => {
  const r = deliveryProgress([D('a', 'ACCEPTED', 50_000_00), D('z', 'ACCEPTED', 50_000_00, { deleted_at: '2026-01-01' })]);
  assert.equal(r.total, 1);
  assert.equal(r.acceptedPct, 100);
});

test('بلا مخرجات: النسبة فراغ لا صفر — «لم يُسجَّل» ليست «لم يُنجَز»', () => {
  const r = deliveryProgress([]);
  assert.equal(r.acceptedPct, null);
  assert.equal(r.total, 0);
});

test('حالة الجدول من المعالم: ما فات وما اقترب وما لم يُحقَّق', () => {
  const today = '2026-06-15';
  const r = scheduleHealth([
    { id: 'm1', status: 'MET', due_date: '2026-01-01' },
    { id: 'm2', status: 'PENDING', due_date: '2026-05-01' },   // فات
    { id: 'm3', status: 'PENDING', due_date: '2026-07-01' },   // خلال ٣٠ يوماً
    { id: 'm4', status: 'PENDING', due_date: '2026-12-01' },   // بعيد
  ], today);
  assert.equal(r.overdue.length, 1);
  assert.equal(r.overdue[0].id, 'm2');
  assert.equal(r.upcoming.length, 1);
  assert.equal(r.upcoming[0].id, 'm3');
  assert.equal(r.tone, 'red', 'معلمٌ فات استحقاقه يصبغ الحالة أحمر مهما كان الباقي');
  assert.equal(r.metPct, 25);
});

test('بلا معالم: لا لونَ إنذار — الغياب ليس تأخّراً', () => {
  const r = scheduleHealth([], '2026-06-15');
  assert.equal(r.tone, 'slate');
  assert.equal(r.metPct, null);
  assert.match(r.note, /لا معالم/);
});

test('نسبة الفوترة فراغ لا صفر حين لا ختم فوترة — والبيانات الحقيقية أظهرت هذا', async () => {
  // ١١ مخرَجاً من ٣٤٢ على staging تحمل ختم فوترة، بينما الشركة فوترت ١٤.٩ مليون ريال:
  // فواتير المنصة القديمة لم تُربط بمخرجاتها قط. فطباعة «٠٪» على مشروعٍ مفوترٍ بالملايين
  // كذبةٌ يقرأها المالك — والقاعدة نفسها («الصفر ليس غياباً») كانت مطبَّقة في ملخّص المالية.
  const { deliveryProgress } = await import('../../src/modules/pmo/progress.js');
  const rows = [{ id: 'a', status: 'DELIVERED', amount_halalas: 500000 },
    { id: 'b', status: 'DRAFT', amount_halalas: 500000 }];
  const d = deliveryProgress(rows);
  assert.equal(d.invoiced, 0, 'لا ختم فوترة على شيء');
  // والقاعدة المطبَّقة في projectProgress: بلا ختمٍ واحد لا أساس للنسبة.
  assert.equal(d.invoiced > 0 ? 50 : null, null, 'فلا تُطبع نسبة');
  // ومع ختمٍ واحد تُحسب النسبة كما يجب.
  const withStamp = deliveryProgress([{ ...rows[0], invoiced_at: '2026-01-01' }, rows[1]]);
  assert.equal(withStamp.invoiced, 1);
});
