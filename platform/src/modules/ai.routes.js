// مسارات المساعد. الحراسة كلها داخل الخدمات (نطاق ومنح ومعاينة ومزلاج) — وهذه الطبقة تنقل
// الطلب وتصعد الخطأ كما هو، فلا رسالة تُستبدل ولا فحص يُعاد هنا.
//
// العقد مع الواجهة:
//   GET  /api/ai/status         ⟵ { mode, modeLabel, configured, suggestions[] }
//   POST /api/ai/chat           ⟵ { reply, intent, choices?, choice_field?, form? }  ← **لا رمز تأكيد أبداً**
//   GET  /api/ai/options/:kind  ⟵ { kind, options[] }          ← كل معرّف يظهر للواجهة يصدر من هنا
//   POST /api/ai/preview        ⟵ { reply, preview, applyToken, previewId, expires_at }  ← المدخل الوحيد لأي تغيير
//   POST /api/ai/apply          ⟵ { reply, applied, resource, resourceId }
//   GET  /api/ai/activity       ⟵ { scope, rows[] }            ← بمنح قراءة التدقيق وحدها
//   GET  /api/ai/tools          ⟵ { tools: [{ name, label_ar, kind, description_ar, input, output_ar }] }
//                                  ← العقد الآلي لأدوات «الفريق والموارد» مُرشَّحاً بمنح صاحب الجلسة
//   POST /api/ai/tools/:name    ⟵ نتيجة الأداة (أداة الكتابة تقبل رمز المعاينة وحده — لا حمولة خام)
//
// وثلاثة أشياء يقولها الخادم بنفسه فلا تخمّنها اللوحة:
//   • `expires_at` — لحظة انتهاء المعاينة كما حُفظت، فتُعرض «صالحة للتأكيد حتى …» ويُعطَّل
//     زرّ التأكيد عند انقضائها بدل إرسال تأكيدٍ يعرف الخادم سلفاً أنه مرفوض.
//   • شروط الحقول في `form` (`when` للظهور و`required_when` للطلب) — قواعد الخدمة نفسها،
//     تُطلب قبل التأكيد لا بعده. و`won` على صفوف قائمة الفرص لأن حال الصفّ لا يُستنتج باسمه.
//   • `intent` في كل ردّ و`choice_field` مع خيارات الالتباس — فيعود اختيار المستخدم بمفتاحه
//     المسمّى إلى نيّته نفسها، ولا يُعاد تصنيفه نصّاً فيضيع.
import { Router } from 'express';
import { requireAuth } from '../core/http/context.js';
import { ask, aiStatus, optionsFor, proposePreview, registerIntents } from '../core/ai/assistant.js';
import { listActivity } from '../core/ai/store.js';
import { applyChange } from './ai/apply.js';
import { listTools, runTool } from './ai/team-tools.js';
import { TEAM_INTENTS } from './ai/team-intents.js';

// نوايا وحدة «الفريق والموارد» تُسجَّل هنا مرةً واحدة: `core/ai` لا يستورد `modules`، والوحدة
// تأتي إليه عند التركيب — فتظهر في بطاقات الاقتراح بمنحها وتُصنَّف قبل الأنماط العامة.
registerIntents(TEAM_INTENTS);

export const aiRouter = Router();
aiRouter.use(requireAuth());

const h = (fn) => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (e) { next(e); }
};

aiRouter.get('/status', h(async (req) => aiStatus(req.ctx.user)));

aiRouter.post('/chat', h((req) => ask(req.ctx, req.body?.message, req.body?.opts || {})));

aiRouter.get('/options/:kind', h((req) => optionsFor(req.ctx.user, String(req.params.kind || ''))));

// معاينة تغيير: حمولة مبنيّة { type, fields } معرّفاتُها صادرة من «الخيارات» — لا نص حر.
aiRouter.post('/preview', h((req) => proposePreview(req.ctx, req.body || {})));

// التأكيد: المزلاج والكتابة في معاملة واحدة داخل applyChange، والصلاحية تُفحص في الخدمة.
aiRouter.post('/apply', h((req) => applyChange(req.ctx, req.body?.applyToken || req.body?.previewId)));

aiRouter.get('/activity', h((req) => listActivity(req.ctx.user, { limit: req.query?.limit })));

// ── أدوات «الفريق والموارد» (الموجّه §13): سطحٌ محدود ومُخوَّل، لا استعلام حرّ ولا أمر عام ──
// القائمة مُرشَّحة بمنح صاحب الجلسة، والتشغيل يفحص البوابة ثانيةً ثم يمرّ بالخدمة ويُسجَّل بنتيجته.
// الكتابة برمز معاينةٍ صادرٍ من أداة المعاينة وحده — نفس انضباط /preview ⟵ /apply أعلاه.
aiRouter.get('/tools', h((req) => ({ tools: listTools(req.ctx.user) })));
aiRouter.post('/tools/:name', h((req) => runTool(req.ctx, String(req.params.name || ''), req.body || {})));
