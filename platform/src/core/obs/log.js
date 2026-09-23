// سطرُ سجلٍّ واحد، بصيغةٍ تُبحَث.
//
// لماذا هذا الشكل بالذات: مُستضيفُ المنصة يقرأ **سطراً واحداً** من نوع كائنٍ نصّي ويحوّل كل
// مفتاحٍ فيه إلى حقلٍ قابلٍ للبحث. فالسطر المنظَّم يشتري بحثاً بالمسار والمستخدم ورمز العطب
// بلا أي حزمةٍ جديدة — وقاعدة البيت أن الحِزم لا تُضاف إلا عند انعدام البديل.
//
// وثلاث قواعد بنيوية تجعله آمناً في أسوأ لحظة:
//  ① **لا يستورد شيئاً من التطبيق** — لا إعداد ولا قاعدة بيانات. فما يُبلِّغ عن العطب لا
//    يجوز أن يُعطِّله العطبُ نفسه؛ ولو قرأ الإعداد لصار خطأٌ في الإعداد صمتاً كاملاً.
//  ② **لا سجلَّ وصولٍ إطلاقاً** — صفر سطر لكل طلبٍ ناجح. فالمسار الساخن لا يدفع شيئاً،
//    ولا شيء هنا يحتاج ضبطاً لاحقاً.
//  ③ **دلوٌ يحدّ الاندفاع** — للمستضيف سقفٌ لعدد الأسطر في الثانية يُسقِط ما فوقه **بصمت**.
//    فالحدُّ هنا يجعل البتر معلَناً («log_suppressed» ومعه العدد) بدل أن يختفي بلا أثر.
import { writeSync } from 'node:fs';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

// المستوى يُلتقط مرةً عند التحميل. وقيمةٌ غير مفهومة تعود إلى «info» ولا ترمي: أداةُ التشخيص
// لا يجوز أن تُسقط الإقلاع، ولا أن تُسكِت نفسها لأن أحداً أخطأ في كتابة كلمة.
const threshold = LEVELS[String(process.env.SANAD_LOG_LEVEL || '').trim().toLowerCase()] ?? LEVELS.info;

// دلوٌ عالميٌّ واحد بنفس شكل حادّ الطلبات في core/http/security.js.
const CAP = 100, REFILL_PER_SEC = 30;
let tokens = CAP, lastRefill = Date.now(), suppressed = 0;

function allow() {
  const now = Date.now();
  const gained = ((now - lastRefill) / 1000) * REFILL_PER_SEC;
  if (gained >= 1) { tokens = Math.min(CAP, tokens + Math.floor(gained)); lastRefill = now; }
  if (tokens >= 1) { tokens -= 1; return true; }
  suppressed += 1;
  return false;
}

// نقيّ ومُصدَّر كي يُختبَر وحده: سطرٌ واحد، صالحٌ للقراءة، ولا يرمي مهما كان المُدخَل.
export function formatLine(level, event, fields = {}) {
  const base = { level, event, ts: new Date().toISOString() };
  try {
    // JSON.stringify يهرّب أسطر أثر الاستدعاء إلى \n نصّية — ولهذا يُمرَّر الأثر عبره
    // ولا يُلصَق بالنص أبداً: سطرٌ واحد شرطُ قراءته عند المستضيف.
    return JSON.stringify({ ...base, ...fields }) + '\n';
  } catch {
    // دائري، أو رقمٌ ضخم، أو خاصيّةٌ ترمي عند القراءة — يبقى السطر صالحاً ويقول إنه منقوص.
    return JSON.stringify({ ...base, degraded: 1 }) + '\n';
  }
}

export function log(level, event, fields) {
  if ((LEVELS[level] ?? LEVELS.info) < threshold) return;
  if (!allow()) return;
  if (suppressed) {
    const n = suppressed; suppressed = 0;
    try { writeSync(2, formatLine('warn', 'log_suppressed', { dropped: n })); } catch { /* لا شيء بعده */ }
  }
  const line = formatLine(level, event, fields);
  // خطأٌ إلى المجرى الثاني (يُلوَّن عند المستضيف حمراً)، وما دونه إلى الأول.
  try { writeSync(level === 'error' ? 2 : 1, line); } catch { /* مجرى مغلق — لا شيء يُفعل */ }
}

export const logDebug = (event, fields) => log('debug', event, fields);
export const logInfo = (event, fields) => log('info', event, fields);
export const logWarn = (event, fields) => log('warn', event, fields);
export const logError = (event, fields) => log('error', event, fields);

// للحظة الموت وحدها. `console.error` يكتب إلى أنبوبٍ **لا تزامنياً** على لينكس، و`process.exit`
// بعده مباشرةً يقطع ما لم يُنفَذ — أي أن أهمّ سطرٍ في المنصة (الذي يُطبع وهي تسقط) قد يضيع.
// `writeSync` نداءُ نظامٍ متزامن مهما كان نوع المجرى، فيصل قبل الخروج.
export function writeFatalSync(event, fields) {
  try { writeSync(2, formatLine('error', event, fields)); } catch { /* لا شيء بعد هذا */ }
}

// أثرُ الاستدعاء يُقلَّم ويُجرَّد من مسار الجذر: نفس العطب في التطوير وفي الحاوية يجب أن
// يُقرأ سطراً واحداً لا سطرين مختلفين.
export function trimStack(err, frames = 12) {
  const raw = String(err?.stack || err?.message || err || '');
  return raw.split('\n').slice(0, frames + 1).join('\n')
    .replaceAll(process.cwd() + '/', '').replaceAll('/app/', '')
    .slice(0, 4000);
}
