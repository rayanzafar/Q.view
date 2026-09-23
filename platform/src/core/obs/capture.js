// التقاطُ العطب وحفظه — والقاعدةُ الحاكمة: **لا يُبطئ استجابةً، ولا يرمي، ولا يستدعي نفسه.**
//
// أداةٌ تعمل لحظة العطب هي أداةٌ تعمل في أسوأ لحظة. فإن انتظرت كتابةً في قاعدةٍ هي نفسها ما
// تعطّل، صارت كلُّ استجابة 500 معلّقةً بمهلة الاتصال — تُستنزف حصص المجمّع، ويعجز مسبار
// الجاهزية عن الرد، فيُعيد المستضيف التشغيل، وبعد ثلاثٍ يتوقف. عطبٌ عابر يصير انقطاعاً
// دائماً. ولذلك:
//  • الالتقاط **لا يُنتظَر**: يُسجَّل السطر فوراً، ويُجمَّع الصفّ ويُكتب على مهل.
//  • ومجمِّعٌ يضمن **بياناً واحداً لكل بصمةٍ في الثانية** مهما بلغ معدّل العطب. عاصفةُ أعطاب
//    لا يجوز أن تصير هي الانقطاع.
//  • وسقفٌ عام فوق ذلك، لأن مسار «تقرير غير معروف: <مفتاح>» يسمح لأي داخلٍ بتوليد بصماتٍ
//    بلا حدّ — فيدور حول أي حدٍّ لكل بصمة.
//  • وفشلُ الالتقاط يُبتلع: الصفُّ فهرسٌ، والحقيقةُ في السطر الذي غادر إلى سجل المستضيف.
import { run, inTransaction } from '../db/index.js';
import { nowIso } from '../util/ids.js';
import { logError, trimStack } from './log.js';
import { currentScope, maskPath } from './reqctx.js';
import { fingerprint } from './fingerprint.js';
import { isDigestable, seniorityRank } from './severity.js';

const FLUSH_MS = 1000;
const MAX_GROUPS_PER_FLUSH = 50;      // سقفٌ عام: انفجارُ بصماتٍ لا يفتح باب الكتابة
let pending = new Map();
let timer = null;
let inCapture = false;                 // مِزلاجٌ يمنع الاستدعاء الذاتي

function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, FLUSH_MS);
  timer.unref?.();                     // لا يُبقي العملية حيّةً عند الإغلاق
}

async function flush() {
  if (!pending.size) return;
  const batch = [...pending.values()].slice(0, MAX_GROUPS_PER_FLUSH);
  pending = new Map();
  // داخل معاملة المُستدعي لا يُكتب شيء: عطبٌ يُرجِع المعاملة يمحو صفَّه معها.
  if (inTransaction()) return;
  for (const r of batch) {
    try {
      await run(
        `INSERT INTO error_event (fingerprint, kind, source, method, status, err_kind, err_code, message, stack,
            hits, first_at, last_at, last_req_id, last_user, last_role, top_role_rank, digestable)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (fingerprint) DO UPDATE SET
           hits = error_event.hits + excluded.hits,
           last_at = excluded.last_at,
           last_req_id = excluded.last_req_id,
           last_user = excluded.last_user,
           last_role = excluded.last_role,
           message = excluded.message,
           stack = excluded.stack,
           top_role_rank = CASE WHEN excluded.top_role_rank > error_event.top_role_rank
                                THEN excluded.top_role_rank ELSE error_event.top_role_rank END`,
        [r.fingerprint, r.kind, r.source, r.method, r.status, r.err_kind, r.err_code, r.message, r.stack,
          r.hits, r.at, r.at, r.req_id, r.user, r.role, r.rank, r.digestable],
      );
    } catch { /* الصفُّ فهرسٌ لا حقيقة — والحقيقةُ غادرت في السطر */ }
  }
}

// كلُّ ملتقِطٍ يمرّ من هنا. لا يرمي أبداً، ولا يعود إلى نفسه.
function record(parts) {
  if (inCapture) return;
  inCapture = true;
  try {
    const fp = fingerprint(parts);
    const prev = pending.get(fp);
    if (prev) { prev.hits += 1; prev.at = nowIso(); return; }
    if (pending.size >= MAX_GROUPS_PER_FLUSH) return;      // السقف العام
    pending.set(fp, {
      fingerprint: fp, kind: parts.kind, source: parts.source || null, method: parts.method || null,
      status: parts.status ?? null, err_kind: parts.errKind || null, err_code: parts.errCode || null,
      message: String(parts.message || '').slice(0, 300), stack: parts.stack || null,
      hits: 1, at: nowIso(), req_id: parts.reqId || null, user: parts.user || null, role: parts.role || null,
      rank: seniorityRank(parts.role), digestable: isDigestable(parts),
    });
    schedule();
  } catch { /* لا شيء بعد هذا — الملتقِط لا يُسقط ما جاء يلتقطه */ } finally { inCapture = false; }
}

// كلُّ مدخلٍ محميٌّ بنفسه: بناءُ كائن الوصف يقرأ خصائص الخطأ، وخاصيّةٌ ترمي عند القراءة
// تُفلت من حماية `record` لأنها تقع **قبل** استدعائه. أمسكها اختبارٌ بخطأٍ مسموم.
const guard = (fn) => { try { fn(); } catch { /* الملتقِط لا يُسقط ما جاء يلتقطه */ } };

export function captureHttpError(err, req, status) {
  guard(() => {
  const s = currentScope();
  record({
    kind: 'http',
    source: s?.path || maskPath(req?.originalUrl || ''),
    method: req?.method || null,
    status,
    errKind: err?.name || null,
    errCode: err?.code || null,
    message: err?.message || String(err),
    stack: trimStack(err),
    reqId: s?.id || null,
    user: s?.user || req?.ctx?.user?.username || null,
    role: s?.role || req?.ctx?.user?.role_id || null,
  });
  });
}

export function captureJobError(job, err) {
  guard(() => record({
    kind: 'job', job, source: job,
    errKind: err?.name || null, errCode: err?.code || null,
    message: err?.message || String(err), stack: trimStack(err),
    reqId: currentScope()?.id || null,
  }));
}

export function captureRejection(err) {
  guard(() => record({
    kind: 'rejection', source: 'unhandledRejection',
    errKind: err?.name || null, errCode: err?.code || null,
    message: err?.message || String(err), stack: trimStack(err),
  }));
}

// للاختبارات: تفريغٌ فوري بلا انتظار المؤقّت.
export async function flushCaptures() { if (timer) { clearTimeout(timer); timer = null; } await flush(); }
