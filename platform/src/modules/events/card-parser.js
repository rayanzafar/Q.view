// ══ قارئ بطاقة العمل — محليٌّ صِرف ═══════════════════════════════════════════════════════
//
// نصٌّ مُلصَق من بطاقة (أو مُملى) ⟵ حقولٌ مقترَحة: الاسم، الجهة، المسمّى، الجوال، البريد، الموقع.
// «مقترَحة» بمعناها: الخدمة تُعيدها للشاشة كي يراجعها الملتقِط قبل الحفظ، ولا تحفظ شيئاً بنفسها.
//
// ── لماذا محلي، ولماذا لا يرمي ──────────────────────────────────────────────────────────
// البطاقة تُلتقط في قاعة معرض على شبكة جوال متقطّعة، والزمن بين اللقاءين ثوانٍ. نداءٌ خارجي
// هنا يعني انتظاراً لا يحتمله الموقف، وإرسالَ أسماء وأرقام لجهةٍ ثالثة بلا قرار من أحد —
// وهو ما تمنعه سياسة المحرّك المحلي في core/ai أصلاً. فالقارئ تعابير نمطية وقوائم كلمات،
// لا شبكة ولا قاعدة ولا حالة، ولا يرمي أبداً: أسوأ ما يقع أن يعود بحقولٍ فارغة فيكتبها
// الملتقِط بيده — وهو ما كان سيفعله بلا قارئ أصلاً.
//
// ── ترتيب القراءة ───────────────────────────────────────────────────────────────────────
//   ١) تطبيع: NFC، الأرقام العربية-الهندية والفارسية ⟵ لاتينية، حذف العلامات عديمة العرض.
//   ٢) استخراج ما له شكلٌ قاطع: البريد، ثم الموقع (بلا ما يقع داخل البريد)، ثم الهواتف —
//      وسطرُ الفاكس يُقرأ ويُهمَل رقمه لأنه ليس وسيلة تواصل مع الشخص.
//   ٣) تصنيف ما بقي من الأسطر بقوائم كلمات: جهةٌ (شركة، مؤسسة، Company…)، مسمّى (مدير،
//      Manager…)، واسمٌ هو ما ليس أيّاً منهما وبطول اسمٍ. والبطاقة ثنائية اللغة تُفضَّل فيها
//      العربية لأن المنصة عربية وما يُحفظ يُقرأ بها.
import { normalizeEntityName } from '../../core/org/entity-registry.js';

const MAX = 160;

// ── الأرقام: العربية-الهندية والفارسية ⟵ لاتينية ──────────────────────────────────────
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function foldDigits(s) {
  return String(s == null ? '' : s).replace(/[٠-٩۰-۹]/g, (ch) => {
    const i = AR_DIGITS.indexOf(ch);
    if (i >= 0) return String(i);
    const j = FA_DIGITS.indexOf(ch);
    return j >= 0 ? String(j) : ch;
  });
}
const ZERO_WIDTH = /[\u200B-\u200F\uFEFF\u061C]/g;
const HAS_AR = /[؀-ۿ]/;
const HAS_LETTER = /[A-Za-z؀-ۿ]/;

// ── قوائم الكلمات (تُقارَن بعد طيّ الحروف: الهمزات والتاء المربوطة والتشكيل) ───────────
const fold = (s) => normalizeEntityName(s);
// الشرطة ليست فاصلاً عمداً: «Co-Founder» مسمّى واحد لا «Co» (جهة) و«Founder».
const tokensOf = (s) => fold(s).split(/[\s,،.;:|/\\()"'«»&]+/).filter(Boolean);
const bare = (t) => t.replace(/^ال/, '');
const setOf = (words) => new Set(words.map((w) => fold(w)));

const ORG_AR = ['شركة', 'مؤسسة', 'مجموعة', 'هيئة', 'وزارة', 'جامعة', 'معهد', 'مركز', 'بنك', 'صندوق',
  'جمعية', 'مكتب', 'وكالة', 'مصنع', 'مستشفى', 'كلية', 'أمانة', 'غرفة', 'القابضة', 'المحدودة',
  'التجارية', 'للتجارة', 'للاستشارات', 'للتقنية', 'للمقاولات', 'للخدمات', 'للاستثمار', 'للتطوير',
  'للصناعة', 'شركاء'];
const ORG_EN = ['co', 'company', 'corp', 'corporation', 'inc', 'llc', 'ltd', 'limited', 'group',
  'holding', 'holdings', 'est', 'establishment', 'solutions', 'technologies', 'technology', 'systems',
  'consulting', 'services', 'industries', 'international', 'trading', 'contracting', 'bank',
  'university', 'institute', 'authority', 'ministry', 'center', 'centre', 'foundation', 'partners',
  'agency', 'labs'];
// المسمّيات: الصيغ المعرَّفة مذكورة صراحةً (المدير، الرئيس…) ولا تُنزع «ال» آلياً، كي لا يُقرأ
// لقبُ «المهندس أحمد» مسمّى فيُطرد سطرُ الاسم.
const TITLE_AR = ['مدير', 'مديرة', 'المدير', 'المديرة', 'رئيس', 'الرئيس', 'نائب', 'مساعد', 'مستشار',
  'مستشارة', 'المستشار', 'المستشارة', 'مهندس', 'مهندسة', 'أخصائي', 'أخصائية', 'محلل', 'المحلل',
  'مسؤول', 'المسؤول', 'منسق', 'المنسق', 'شريك', 'الشريك', 'مؤسس', 'المؤسس', 'التنفيذي', 'العام',
  'عضو', 'مندوب', 'ممثل', 'مشرف', 'المشرف'];
const TITLE_EN = ['manager', 'director', 'head', 'chief', 'ceo', 'cto', 'cfo', 'coo', 'cio', 'vp',
  'president', 'officer', 'lead', 'engineer', 'consultant', 'analyst', 'specialist', 'coordinator',
  'partner', 'founder', 'co-founder', 'executive', 'senior', 'associate', 'advisor', 'architect',
  'developer'];
// أسماء أقسامٍ لا أشخاص: «Business Development» سطرٌ من كلمتين بلا رقم — يشبه اسماً وليس اسماً.
const NOT_NAME = ['business', 'development', 'sales', 'marketing', 'department', 'division', 'office',
  'team', 'unit', 'operations', 'finance', 'strategy', 'projects', 'digital', 'قسم', 'إدارة',
  'المبيعات', 'التسويق', 'تطوير', 'الأعمال', 'العمليات', 'المالية', 'وحدة', 'فريق', 'الرقمي', 'الرقمية'];
const ORG_SET = setOf([...ORG_AR, ...ORG_EN]);
const TITLE_SET = setOf([...TITLE_AR, ...TITLE_EN]);
const NOT_NAME_SET = setOf(NOT_NAME);
const BRAND_TOKENS = ['شركة', 'شركه'];
const isOrgTok = (t) => ORG_SET.has(t) || ORG_SET.has(bare(t));

// أسطر العنوان تُطرح قبل التصنيف — إلا إن حملت كلمة جهة، فالجهةُ قد تكون «شركة مدينة الرياض».
const ADDR_RE = /\bP\.?\s?O\.?\s?Box\b|ص\s*\.\s*ب|صندوق بريد|\bZip\b|\bPostal\b|الرمز البريدي|\bKSA\b|Saudi Arabia\b|المملكة العربية السعودية|\bRiyadh\b|الرياض|\bJeddah\b|جدة|\bDammam\b|الدمام|\bKhobar\b|الخبر|\bMakkah\b|مكة المكرمة|المدينة المنورة|\bStreet\b|\bSt\.|\bRoad\b|\bRd\.|شارع|\bBuilding\b|\bBldg\b|مبنى|\bFloor\b|الطابق|\bTower\b|برج|\bDistrict\b|حي /i;

// ── البريد والموقع ───────────────────────────────────────────────────────────────────────
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const TLDS = 'com|sa|net|org|io|co|ai|gov|edu|ae|qa|kw|bh|om|jo|eg';
const SITE_RE = new RegExp(`(?:https?:\\/\\/)?(?:www\\.)?[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.(?:${TLDS})\\b(?:\\/[^\\s]*)?`, 'gi');
const GENERIC_MAIL = new Set(['gmail', 'hotmail', 'outlook', 'yahoo', 'icloud', 'live', 'msn', 'mail', 'protonmail']);
function domainLabelOf(email) {
  if (!email) return null;
  const label = email.split('@')[1]?.split('.')[0]?.toLowerCase() || null;
  return label && label.length >= 3 && !GENERIC_MAIL.has(label) ? label : null;
}

// ── الهواتف ─────────────────────────────────────────────────────────────────────────────
// الحدود `(?<![\d+])` و`(?!\d)` ليست في العقد نصاً لكنها تمنع قراءة جوالٍ من داخل سجلٍّ تجاري
// أو رقم ضريبي طويل — «1010512345678» يحوي «0512345678» ولا هو جوال.
const SEP = '[\\s\\-.()]*';
const RE_SA_MOBILE = new RegExp(`(?<![\\d+])(?:\\+?966|00966|0)${SEP}5(?:${SEP}\\d){8}(?!\\d)`, 'g');
const RE_SA_LAND = new RegExp(`(?<![\\d+])(?:\\+?966|00966|0)${SEP}1[1-7](?:${SEP}\\d){7}(?!\\d)`, 'g');
const RE_INTL = new RegExp(`(?<![\\d+])(?:\\+|00)\\d{1,3}(?:${SEP}\\d){7,12}(?!\\d)`, 'g');
// التسميات التي تسبق الأرقام. الحرف المفرد (ت: ج: ف: T: M: F:) يُقبل بنقطتين بعده فقط،
// وبشرط ألّا يكون ذيلَ كلمة — «الجهات:» ليست «ت:».
const LABEL_RE = /\b(?:fax|telefax)\b\s*[:.]?|فاكس\s*[:.]?|\b(?:tel|telephone|phone|mobile|mob|cell|direct|whatsapp|email|e-mail|web|website)\b\s*[:.]?|(?:جوال|هاتف|تلفون|واتساب|مباشر|بريد|موقع)\s*[:.]?|\b[tmfew]\s*:|(?<![؀-ۿ])[تجفب]\s*:/gi;
const FAX_RE = /^(?:fax|telefax|فاكس|f\s*:|ف\s*:)/i;

const digitsOnly = (s) => String(s).replace(/\D/g, '');
const saudiDisplay = (m) => {
  let d = digitsOnly(m);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) d = '0' + d.slice(3);
  else if (/^[15]/.test(d)) d = '0' + d;
  return d;
};
const intlDisplay = (m) => {
  let d = digitsOnly(m);
  if (d.startsWith('00')) d = d.slice(2);
  return '+' + d;
};

// يقسم السطر عند التسميات؛ ما بعد «فاكس» حتى التسمية التالية يُهمَل رقمه.
function segments(line) {
  const out = [];
  let last = 0; let fax = false; let m;
  LABEL_RE.lastIndex = 0;
  while ((m = LABEL_RE.exec(line))) {
    out.push({ text: line.slice(last, m.index), fax });
    fax = FAX_RE.test(m[0]);
    last = m.index + m[0].length;
  }
  out.push({ text: line.slice(last), fax });
  return out;
}
// الترتيب مقصود: الجوال السعودي أولاً ثم الأرضي ثم الدولي — كل مطابقةٍ تُمحى من النص قبل
// التالية كي لا يُقرأ «+966 5…» مرتين (سعودياً ودولياً).
function extractPhones(text, into) {
  let s = text;
  for (const [re, kind, show] of [[RE_SA_MOBILE, 'mobile', saudiDisplay], [RE_SA_LAND, 'land', saudiDisplay], [RE_INTL, 'intl', intlDisplay]]) {
    re.lastIndex = 0;
    s = s.replace(re, (m) => { into.push({ kind, value: show(m) }); return ' '; });
  }
  return s;
}
const stripPhones = (text) => text.replace(RE_SA_MOBILE, ' ').replace(RE_SA_LAND, ' ').replace(RE_INTL, ' ');

// ── القراءة ─────────────────────────────────────────────────────────────────────────────
const cut = (s) => (s == null ? null : String(s).trim().slice(0, MAX) || null);
const empty = () => ({ person_name: null, org_name: null, job_title: null, phone: null, email: null, website: null, extra_phones: [] });

export function parseCardText(text) {
  const out = empty();
  try {
    let s = String(text == null ? '' : (typeof text === 'object' ? '' : text));
    s = foldDigits(s.normalize('NFC')).replace(ZERO_WIDTH, '');
    const rawLines = s.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);

    let email = null; let website = null;
    const phones = [];
    const items = [];
    for (const line of rawLines) {
      let residual = line;
      const em = line.match(EMAIL_RE);
      if (em) {
        if (!email) email = em[0].toLowerCase();
        residual = residual.replace(em[0], ' ');
      }
      const emStart = em ? em.index : -1; const emEnd = em ? em.index + em[0].length : -1;
      SITE_RE.lastIndex = 0; let sm;
      while ((sm = SITE_RE.exec(line))) {
        const insideEmail = em && sm.index < emEnd && sm.index + sm[0].length > emStart;
        if (insideEmail) continue;
        if (!website) website = sm[0].replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
        residual = residual.replace(sm[0], ' ');
      }
      for (const seg of segments(line)) if (!seg.fax) extractPhones(seg.text, phones);
      residual = stripPhones(residual.replace(LABEL_RE, ' '));

      // ما بقي يُقسَّم على الفواصل المرئية: «أحمد العلي | Ahmed Ali» و«مدير المبيعات - شركة كذا».
      for (const part of residual.split(/\s+[|•·]\s+|\s+[-–—]\s+|\s*[،,;]\s+/)) {
        const t = part.replace(/^[\s|,،:;\-–—•·]+|[\s|,،:;\-–—•·]+$/g, '').replace(/\s+/g, ' ').trim();
        if (!t || !HAS_LETTER.test(t)) continue;
        const toks = tokensOf(t);
        const isOrg = toks.some(isOrgTok);
        const isTitle = toks.some((k) => TITLE_SET.has(k));
        if (!isOrg && ADDR_RE.test(t)) continue;
        items.push({
          text: t, toks, isOrg, isTitle,
          ar: HAS_AR.test(t), hasDigit: /\d/.test(t),
          notName: toks.some((k) => NOT_NAME_SET.has(k) || NOT_NAME_SET.has(bare(k))),
        });
      }
    }

    // الجهة: سطرٌ فيه كلمة جهة وليس فيه كلمة مسمّى («Chief Technology Officer» مسمّى لا جهة)،
    // وتُفضَّل العربية ثم ما يحمل اسمَ نطاق البريد (ahmed@elm.sa ⟵ سطر «علم»/«Elm»).
    const label = domainLabelOf(email);
    const score = (it) => (it.ar ? 2 : 0) + (label && it.text.toLowerCase().includes(label) ? 1 : 0);
    const pick = (arr) => arr.reduce((best, it) => (!best || score(it) > score(best) ? it : best), null);
    let org = pick(items.filter((it) => it.isOrg && !it.isTitle)) || pick(items.filter((it) => it.isOrg));
    if (!org && label) org = items.find((it) => !it.isTitle && !it.hasDigit && it.text.toLowerCase().includes(label)) || null;

    // الاسم: كلمتان إلى خمس، بلا رقم ولا @ ولا /، وليس جهةً ولا مسمّى ولا قسماً.
    const words = (t) => t.split(/\s+/).length;
    const nameCands = items.filter((it) => it !== org && !it.isOrg && !it.isTitle && !it.notName && !it.hasDigit
      && !/[@/]/.test(it.text) && it.text.length >= 3 && it.text.length <= 40 && words(it.text) >= 2 && words(it.text) <= 5
      && !BRAND_TOKENS.includes(it.toks[0]));
    const name = nameCands.find((it) => it.ar) || nameCands[0] || null;

    // المسمّى: أقرب سطر مسمّى بعد الاسم (سطران)، وإلا أول سطر مسمّى في البطاقة ليس هو الجهة.
    const titleOk = (it) => it.isTitle && it !== org && it !== name;
    let title = null;
    if (name) {
      const at = items.indexOf(name);
      const near = items.slice(at + 1, at + 3).filter(titleOk);
      title = near.find((it) => it.ar) || near[0] || null;
    }
    if (!title) {
      const any = items.filter(titleOk);
      title = any.find((it) => it.ar) || any[0] || null;
    }

    // الهاتف الرئيسي: جوال سعودي، وإلا دولي، وإلا أرضي — والبقية «هواتف أخرى» بلا تكرار.
    const first = (k) => phones.find((p) => p.kind === k)?.value || null;
    const phone = first('mobile') || first('intl') || first('land');
    const extra = [];
    for (const p of phones) if (p.value !== phone && !extra.includes(p.value)) extra.push(p.value);

    out.person_name = cut(name?.text);
    out.org_name = cut(org?.text);
    out.job_title = cut(title?.text);
    out.phone = cut(phone);
    out.email = cut(email);
    out.website = cut(website);
    out.extra_phones = extra.map((v) => cut(v)).filter(Boolean);
    return out;
  } catch {
    // لا يرمي أبداً: الشاشة تعرض حقولاً فارغة ويكتبها الملتقِط بيده.
    return empty();
  }
}
