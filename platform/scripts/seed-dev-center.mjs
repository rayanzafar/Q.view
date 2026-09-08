// بذرةُ «مركز التطوير»: منتجُ «سند» نفسه وفريقُه الأول.
//
// يُشغَّل مرةً بعد الترحيلة ٠٤٥ على كل بيئة، ويُعاد بلا ضرر: كلُّ خطوةٍ فيه تسأل عن الحال
// قبل أن تكتب. وهذا شرطٌ لا تحسين — سكربتُ بذرٍ يُشغَّل على القاعدة الحيّة مرةً ثم يُنسى، ثم
// يُشغَّل ثانيةً بعد شهور من مُشغِّلٍ آخر لا يعرف أنه شُغّل.
//
// و«سند» منتجٌ **داخلي**: بلا جهاتٍ ولا روابط استقبال — بلاغاته تأتي من داخل المنصة وحدها.
//
// والأشخاص يُحلّون بالبريد أولاً ثم بالاسم، ومن لم يُوجَد **يُنبَّه عنه ولا يُرمى**: قائمةُ
// أربعةٍ فيها اسمٌ لم يُطابق يجب ألّا تمنع الثلاثة الباقين من أن يُبذَروا، والبيئات تختلف
// (القاعدة الحيّة فيها الأربعة، وقاعدةُ التجربة قد لا يكون فيها أحد).
//
// التشغيل:  node --experimental-sqlite scripts/seed-dev-center.mjs

import { get, all, insert, update, close } from '../src/core/db/index.js';
import { id, nowIso } from '../src/core/util/ids.js';

const PRODUCT = {
  key: 'sanad',
  name_ar: 'سند',
  name_en: 'Sanad',
  description: 'منصة الأعمال الداخلية لرؤية الخبراء الاستشارية — أعطالها واقتراحاتها تُستقبل هنا.',
  kind: 'internal',
  item_prefix: 'SND',
  brand_color: '#244a99',
};

// الفريق الأول — أربعتُهم مديرو منتج (ومديرُ المنتج يملك ما يملكه المطوِّر ويزيد الاعتماد).
const TEAM = [
  { email: 'hussien.aljifri@evc.sa', name: 'حسين الجفري', role: 'manager' },
  { email: null, name: 'ريان ظفر', role: 'manager' },
  { email: null, name: 'جاكوب سيد', role: 'manager' },
  { email: null, name: 'إسحاق سيد', role: 'manager' },
];

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('⚠️ ', ...a);

/** بالبريد أولاً — وهو المطابقة الوحيدة التي لا تلتبس — ثم بالاسم العربي أو الإنجليزي. */
async function resolvePerson({ email, name }) {
  if (email) {
    const byEmail = await get(
      'SELECT id, username, name_ar, email FROM app_user WHERE LOWER(email) = ? AND deleted_at IS NULL',
      [String(email).toLowerCase()]);
    if (byEmail) return { person: byEmail, how: 'بالبريد' };
  }
  if (!name) return { person: null, how: null };
  const rows = await all(
    `SELECT id, username, name_ar, email FROM app_user
      WHERE deleted_at IS NULL AND (name_ar = ? OR name_en = ? OR username = ?)`,
    [name, name, name]);
  if (rows.length === 1) return { person: rows[0], how: 'بالاسم' };
  if (rows.length > 1) return { person: null, how: 'ملتبس', candidates: rows };
  return { person: null, how: null };
}

async function ensureProduct() {
  const existing = await get('SELECT * FROM product WHERE key = ?', [PRODUCT.key]);
  if (existing) {
    log(`• المنتج «${existing.name_ar}» موجودٌ سلفاً — لا يُنشأ ثانيةً.`);
    // الأرشفةُ تُرفع إن كان قد أُرشف: إعادةُ التشغيل تعني «أعِد هذا إلى العمل».
    if (existing.archived_at) {
      await update('product', existing.id, { archived_at: null, updated_at: nowIso() });
      log('  ورُفعت أرشفتُه.');
    }
    return existing;
  }
  const pid = id('prd');
  await insert('product', {
    id: pid, ...PRODUCT, project_id: null, item_seq: 0, brand_blob_id: null, archived_at: null,
    created_at: nowIso(), created_by: null,
  });
  log(`✓ أُنشئ المنتج «${PRODUCT.name_ar}» بمفتاح ${PRODUCT.key} وبادئة ${PRODUCT.item_prefix}.`);
  return await get('SELECT * FROM product WHERE id = ?', [pid]);
}

async function ensureMember(productId, person, role) {
  const existing = await get('SELECT * FROM product_member WHERE product_id = ? AND user_id = ?', [productId, person.id]);
  if (existing) {
    if (existing.role === role && existing.active) {
      log(`  • ${person.name_ar || person.username} عضوٌ سلفاً — بلا تغيير.`);
      return 'unchanged';
    }
    await update('product_member', existing.id, { role, active: 1, updated_at: nowIso() });
    log(`  ✓ حُدِّثت عضوية ${person.name_ar || person.username}.`);
    return 'updated';
  }
  await insert('product_member', {
    id: id('pmb'), product_id: productId, user_id: person.id, role, active: 1,
    created_at: nowIso(), created_by: null,
  });
  log(`  ✓ أُضيف ${person.name_ar || person.username} مديرَ منتج.`);
  return 'created';
}

async function main() {
  const product = await ensureProduct();
  let missing = 0;
  for (const t of TEAM) {
    const { person, how, candidates } = await resolvePerson(t);
    if (!person) {
      missing++;
      if (how === 'ملتبس') {
        warn(`«${t.name}» يطابق أكثر من حساب — لم يُضَف. المرشّحون: ${candidates.map((c) => c.username).join(' · ')}`);
      } else {
        warn(`«${t.name}» لا حساب له في هذه القاعدة — لم يُضَف. أضِفه من شاشة المستخدمين ثم أعِد تشغيل هذا السكربت.`);
      }
      continue;
    }
    log(`- ${t.name} ← ${person.username} (${how})`);
    await ensureMember(product.id, person, t.role);
  }
  const members = await all(
    'SELECT user_id, role, active FROM product_member WHERE product_id = ? AND active = 1', [product.id]);
  log('');
  log(`الخلاصة: منتجٌ واحد «${product.name_ar}» و${members.length} عضواً فعّالاً${missing ? ` · ${missing} لم يُطابَق` : ''}.`);
  if (missing) log('لم يُرمَ خطأ: النواقص تُضاف لاحقاً بإعادة تشغيل السكربت نفسه.');
}

main().then(() => close()).catch(async (e) => {
  console.error('تعذّر بذر مركز التطوير:', e);
  await close();
  process.exit(1);
});
