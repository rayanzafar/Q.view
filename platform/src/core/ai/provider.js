// محرّك المساعد — **محلي بقرار المالك**، والمزوّد الخارجي بابٌ مغلق يُفتح صراحةً أو لا يُفتح.
//
// القرار: لا تخرج بيانات EVC من المنصة، والإجابات حتمية كي تكون دقتها قابلة للإثبات بالفحص.
// وترجمة القرار إلى كود ليست «لا تضع مفتاحاً»: كان `aiMode()` يعود بمزوّد خارجي بمجرد وجود
// متغيّر بيئة يحمل مفتاحاً — فمتغيّرٌ واحد شارد (منسوخ من بيئة أخرى، أو مضاف لأداة ثالثة على
// المنصة نفسها) يقلب المنتج كله: يصير غير حتمي، ويُرسل معطيات الشركة إلى طرف ثالث، بلا أن
// يقرّر ذلك أحد ولا أن يظهر في أي شاشة. المفتاح **قرينة** لا **قرار**.
//
// لذلك بابان لا باب واحد: `AI_ENGINE=provider` (إعلان نية صريح) **مع** مفتاح صالح. غياب أيٍّ
// منهما ⟵ محلي. وهذا ما يحرسه tests/security/ai-engine-local.test.js حرفياً.
//
// ملاحظة طبقات: الإعدادات العامة (src/core/config.js) ليست من ملفات هذه الموجة، فقراءة المحرّك
// تتم هنا من البيئة مباشرةً — وهذه الوحدة هي **المصدر الوحيد** لمعرفة المفاتيح والمحرّك في
// المنصة كلها، فلا يسأل عنها أحد غيرها.
import { config } from '../config.js';

const DEFAULT_TIMEOUT_MS = 15000;

// «محلي» أو «مزوّد» — نيّة المشغّل وحدها، بلا نظر إلى المفاتيح.
export function aiEngine() {
  return String(process.env.AI_ENGINE || '').trim().toLowerCase() === 'provider' ? 'provider' : 'local';
}

// المصدر الوحيد للمفاتيح في المنصة. يعود بـnull حين لا مفتاح — ولا يقرأه أحد خارج هذا الملف.
function providerKey() {
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (anthropic) return { mode: 'anthropic', key: anthropic, model: process.env.AI_MODEL || 'claude-sonnet-5' };
  const openai = process.env.OPENAI_API_KEY || config.ai?.apiKey;
  if (openai) return { mode: 'openai', key: openai, model: process.env.AI_MODEL || config.ai?.model || 'gpt-4o-mini' };
  return null;
}

// الوضع الفعلي: مزوّد خارجي **فقط** إذا أُعلنت النية وكان المفتاح موجوداً؛ وإلا محلي.
export function aiMode() {
  if (aiEngine() !== 'provider') return 'local';
  return providerKey()?.mode || 'local';
}

// مفتاح موجود بلا إعلان نية — حالةٌ تُذكر في سجل الخادم **مرة واحدة** كي لا تمرّ صامتة:
// المشغّل يظن أنه فعّل المزوّد والمنصة تعمل محلياً، فالصمت هنا يُنتج سوء فهم لا خطأ ظاهر.
export function keyPresentWithoutOptIn() {
  return aiEngine() !== 'provider' && !!providerKey();
}
let _warned = false;
export function warnOnceIfKeyIgnored() {
  if (_warned || !keyPresentWithoutOptIn()) return false;
  _warned = true;
  console.warn('[ai] a provider key is present but AI_ENGINE is not "provider" — the assistant stays LOCAL by design (no data leaves the platform)');
  return true;
}

// إخفاق المزوّد لا يُبتلع: المستخدم يستقبل الإجابة المحلية (المنتج يعمل)، والمشغّل يقرأ السبب
// في سجل الخادم. الابتلاع الصامت السابق كان يجعل «المزوّد مفعَّل ولا يعمل» حالةً غير مرئية.
export function logProviderFallback(err) {
  const reason = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    ? 'timeout' : (err?.message || 'unknown');
  console.warn(`[ai] provider call failed (${aiMode()}): ${reason} — answered with the local engine instead`);
}

// نداء منخفض المستوى. يعيد { text } أو يرمي. لا يُستدعى إلا بمعطيات مُنقّاة (بلا حقول حسّاسة).
export async function complete({ system, user, maxTokens = 800, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const mode = aiMode();
  if (mode === 'local') throw new Error('local_engine'); // المنادي يجيب محلياً
  const cfg = providerKey();
  const signal = AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS) || timeoutMs);
  if (mode === 'anthropic') return anthropic(cfg, system, user, maxTokens, signal);
  return openai(cfg, system, user, maxTokens, signal);
}

async function anthropic(cfg, system, user, maxTokens, signal) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error('anthropic ' + r.status);
  const j = await r.json();
  return { text: (j.content || []).map((c) => c.text).join('') };
}

async function openai(cfg, system, user, maxTokens, signal) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.key },
    body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error('openai ' + r.status);
  const j = await r.json();
  return { text: j.choices?.[0]?.message?.content || '' };
}
