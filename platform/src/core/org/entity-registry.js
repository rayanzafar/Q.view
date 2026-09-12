// مرجع الجهات السعودية — الاسم الرسمي مفتاحاً، والأسماء المختصرة والسابقة أسماءً بديلة.
//
// المشكلة التي يحلّها: الجهة الواحدة تُكتب بأشكال كثيرة — «سدايا» و«الهيئة السعودية للبيانات
// والذكاء الاصطناعي (سدايا)» و«هدف» و«صندوق تنمية الموارد البشرية» — فتُسجَّل مرتين وينقسم
// عملها. مقارنة النصوص وحدها لا تكفي: لا رابط لغوي بين «هدف» واسمها الرسمي. المرجع يعرف
// أنهما واحد، فيمسك ما تعجز عنه المطابقة.
//
// **قاعدة التصنيف معكوسة عمداً: اليقين يحتاج برهاناً، وما دونه يُعرَض ولا يُنفَّذ.** جولة أولى
// بتشابه الكلمات وحده أنتجت: «الأمن العام» ⟵ «الهيئة الوطنية للأمن السيبراني» (وعليها ٢٧٠
// مليون ريال)، و«ميناء جدة الإسلامي» ⟵ «جامعة جدة». ثلاثة عيوب صنعتها: مطابقة على كلمة واحدة
// مشتركة، وتجاهل رأس الاسم المؤسسي (ميناء ≠ جامعة)، ومطابقة على اختصار فارغ «—». الثلاثة
// مسدودة أدناه، ولا تعود «مؤكَّدة» إلا مطابقةٌ نصّية كاملة بعد التطبيع.
import { readFileSync } from 'node:fs';

let _ref = null;
function ref() {
  if (_ref) return _ref;
  const path = new URL('../../../seed/saudi-entities.json', import.meta.url);
  try {
    _ref = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // غياب الملف لا يُسقط المنصة: الميزة تصمت ولا تكذب — لا مطابقة أفضل من مطابقة مخترعة.
    _ref = { entities: [], renames: [] };
  }
  return _ref;
}

export function normalizeEntityName(s) {
  return String(s || '')
    .replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
const key = (s) => normalizeEntityName(s).replace(/[«»"'()\-–—.,]/g, ' ').replace(/\s+/g, ' ').trim();

// رأس الاسم المؤسسي: «ميناء» ليس «جامعة»، و«مركز» ليس «وزارة». اختلافه يمنع المطابقة أصلاً.
const HEADS = ['وزاره', 'هيئه', 'صندوق', 'مؤسسه', 'مركز', 'شركه', 'برنامج', 'مجلس', 'امانه',
  'اماره', 'بنك', 'جامعه', 'رئاسه', 'ديوان', 'مصلحه', 'اتحاد', 'معهد', 'كليه', 'مجموعه',
  'مدينه', 'ميناء', 'مطار', 'اكاديميه', 'جمعيه', 'مكتب', 'وكاله'];
function headOf(s) {
  for (const t of key(s).split(' ').slice(0, 2)) {
    const bare = t.replace(/^ال/, '');
    if (HEADS.includes(bare)) return bare;
  }
  return null;
}
const STOP = new Set(['ال', 'و', 'في', 'من', 'على', 'الوطني', 'الوطنيه', 'السعودي', 'السعوديه',
  'العربيه', 'المملكه', 'العامه', 'العام', 'بمنطقه', 'منطقه']);
const distinctive = (s) => key(s).split(' ')
  .filter((w) => w && !STOP.has(w) && !HEADS.includes(w.replace(/^ال/, '')));

let _idx = null;
function index() {
  if (_idx) return _idx;
  const official = new Map();
  const alias = new Map();
  for (const e of ref().entities) {
    official.set(key(e.official_name), e);
    const put = (n, via) => {
      const k = key(n);
      // المطابقة هنا على **المفتاح كاملاً** لا على جزء منه، فالطول ليس مصدر الخطر: «هدف»
      // ثلاثة أحرف ولا تطابق إلا اسماً هو «هدف» بعينه. الحدّ الأدنى يمنع حرفاً أو حرفين
      // (وهي غالباً رموز لا أسماء)، ولا يحرم علامةً تجارية حقيقية قصيرة من الوصول لجهتها.
      if (k && k.length >= 3 && !official.has(k) && !alias.has(k)) alias.set(k, { ent: e, via });
    };
    if (e.short_name) put(e.short_name, 'الاسم المختصر المتداول');
    for (const a of e.aliases || []) put(a, 'اسم بديل مسجَّل');
  }
  for (const r of ref().renames || []) {
    const cur = official.get(key(r.current));
    const k = key(r.former);
    if (cur && k && !official.has(k)) alias.set(k, { ent: cur, via: `مسمّى سابق — ${r.change || 'تغيير مسمّى'}` });
  }
  _idx = { official, alias };
  return _idx;
}

/**
 * يطابق اسماً مكتوباً على المرجع الرسمي.
 * @returns {null | { entity, confidence: 'مؤكَّد'|'للمراجعة', reason_ar, official_name, abbr, exact }}
 *   `exact` يعني أن المكتوب هو الاسم الرسمي حرفاً بحرف فلا شيء يُقترح.
 */
export function matchEntity(name) {
  const nm = String(name || '').trim();
  if (!nm) return null;
  const { official, alias } = index();
  const k = key(nm);

  const hit = official.get(k);
  if (hit) {
    return { entity: hit, confidence: 'مؤكَّد', official_name: hit.official_name, abbr: hit.abbr,
      exact: hit.official_name === nm,
      reason_ar: hit.official_name === nm ? 'مطابق للاسم الرسمي' : 'نفس الاسم الرسمي بإملاء مختلف' };
  }

  // الاسم الرسمي + علامة تجارية بين قوسين تخصّ الجهة نفسها: «… (سدايا)» ⟵ سدايا اختصارها.
  const paren = nm.match(/^(.+?)\s*[(（]([^)）]+)[)）]\s*$/);
  if (paren) {
    const base = official.get(key(paren[1]));
    const brand = key(paren[2]);
    if (base && (brand === key(base.abbr || '') || brand === key(base.short_name || '')
      || (base.aliases || []).some((a) => key(a) === brand))) {
      return { entity: base, confidence: 'مؤكَّد', official_name: base.official_name, abbr: base.abbr,
        exact: false, reason_ar: `الاسم الرسمي مع علامته التجارية «${paren[2]}»` };
    }
  }

  const al = alias.get(k);
  if (al) {
    return { entity: al.ent, confidence: 'مؤكَّد', official_name: al.ent.official_name, abbr: al.ent.abbr,
      exact: false, reason_ar: al.via };
  }

  // للمراجعة: اتفاق رأس الاسم + احتواء كامل من أحد الطرفين + كلمتان مميّزتان على الأقل.
  const hc = headOf(nm);
  if (!hc) return null;
  const tc = new Set(distinctive(nm));
  if (!tc.size) return null;
  let best = null;
  for (const e of ref().entities) {
    if (headOf(e.official_name) !== hc) continue;
    const te = distinctive(e.official_name);
    if (te.length < 2) continue;
    const shared = te.filter((w) => tc.has(w)).length;
    if (shared < 2) continue;
    if (shared !== te.length && shared !== tc.size) continue;   // احتواء كامل من أحد الطرفين
    const score = shared / Math.max(te.length, tc.size);
    if (!best || score > best.score) best = { e, score, shared };
  }
  if (!best) return null;
  return { entity: best.e, confidence: 'للمراجعة', official_name: best.e.official_name, abbr: best.e.abbr,
    exact: false, reason_ar: `رأس الاسم «${hc}» و${best.shared} كلمات مشتركة — يحتاج تأكيدك` };
}

export function entityCount() { return ref().entities.length; }
