// سياقٌ محيط بالطلب — كي يعرف سطرُ السجل **أين** وقع العطب و**لمن**، من مواضع لا تملك `req`.
//
// المنصة تُمرّر `ctx` صراحةً في كل خدمة، وهذا يكفي حيث يصل. لكن أعمق المواضع لا يصلها شيء:
// خطأ الاتصال الخامل في المجمّع، ومهامّ المجدول، وقناة البريد — وهي بالضبط المواضع التي
// تكتب اليوم رسالةً واحدة بلا أثرٍ ولا هوية. فمخزنٌ محيط يملأ الفراغ بلا تمرير وسيطٍ عبر
// كل توقيع.
//
// والنمط منسوخٌ من مخزن المعاملات في `core/db/index.js` — بما فيه **حارس الانضمام**: من
// وجد مخزناً قائماً ينضمّ إليه ولا يفتح ثانياً، وإلا انقسم معرّف الطلب في منتصفه فصار
// سطران لعطبٍ واحد.
import { AsyncLocalStorage } from 'node:async_hooks';
import { id } from '../util/ids.js';

const store = new AsyncLocalStorage();

export const currentScope = () => store.getStore();

// ينضمّ ولا يفتح ثانياً — نفس حارس `tx()`.
export function runInScope(seed, fn) {
  const existing = store.getStore();
  if (existing) return fn();
  return store.run(seed, fn);
}

// مهامّ المجدول تعمل خارج أي طلب. تسميتُها هنا تجعل سطرَ عطبٍ من عمق قاعدة البيانات يحمل
// اسم المهمّة التي كانت تعمل — وهو الفارق بين «فشل استعلام» و«فشل كنسُ الجلسات».
export const runInJobScope = (job, fn) => runInScope({ id: id('job'), kind: 'job', job, at: Date.now() }, fn);

// المسار يُقنَّع مرةً واحدة هنا لا عند كل التقاط: معرّفات المنصة (`prj_…`) والأرقام تُبدَّل
// بـ`:id` كي لا يصير عطبٌ واحد مئتَي عطبٍ مختلف بعدد الصفوف التي أصابها.
export function maskPath(p) {
  return String(p || '').split('?')[0].split('/').map((seg) => {
    if (!seg) return seg;
    if (/^\d+$/.test(seg)) return ':id';
    if (/^[a-z]{2,4}_[A-Za-z0-9_-]{6,}$/.test(seg)) return ':id';
    return seg;
  }).join('/').slice(0, 200);
}

export function requestScope() {
  return (req, res, next) => {
    // المعرّف يُولَّد دائماً و**لا يُقرأ من ترويسةٍ واردة**: الثقة بما يرسله المتصفّح هنا
    // بابُ حقنٍ في السجل بلا أي مقابل — فلا مصدر خارجي لهذا الرقم.
    const rid = id('req');
    // ولا يُخزَّن نصّ الاستعلام إطلاقاً: `?q=` يحمل أسماء عملاء، ومسار التحقّق من رمز
    // الدخول يحمل الرمز نفسه. المسار المقنَّع وحده هو ما يُحفظ.
    const seed = { id: rid, kind: 'http', method: req.method, path: maskPath(req.originalUrl || req.url), user: null, role: null, at: Date.now() };
    try { res.setHeader('X-Request-Id', rid); } catch { /* الترويسة أُرسلت — لا يضرّ */ }
    runInScope(seed, () => next());
  };
}
