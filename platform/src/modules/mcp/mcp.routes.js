// نقل ربط المساعد: وثائق الاكتشاف، ومسار الإذن، وتبديل الرموز، ونقطة البروتوكول نفسها.
//
// يُركَّب على جذر المنصة لا تحت `/api`: العملاء الخارجيون يكتشفون الخادم بوثائق قياسية عناوينُها
// ثابتة تحت `/.well-known/`، ولا تُختار عناوينُها.
//
// حدّان مكتوبان هنا لا في الشرح:
//   ① `/mcp` لا يقبل جلسة متصفح أبداً — الرمز في الترويسة وحده. فلا يستطيع موقعٌ في تبويبٍ آخر
//      أن يقود متصفّح الموظف لينفّذ أدوات باسمه (كعكته لا تصلح هنا).
//   ② كل ردّ رفضٍ على `/mcp` يحمل عنوان وثيقة الموارد، فالعميل يعرف من أين يطلب الإذن بنفسه
//      بدل أن يُعرض على الموظف عطلٌ بلا طريق.
import { Router } from 'express';
import { config } from '../../core/config.js';
import { allowFormActionTo } from '../../core/http/security.js';
import { audit } from '../../core/audit/index.js';
import { esc } from '../../web/views/_shared.js';
import { layout } from '../../web/layout.js';
import { HttpError } from '../../core/http/errors.js';
import { handleRpc } from './server.js';
import {
  issuer, resourceUrl, registerClient, getClient, issueAuthCode, exchangeAuthCode,
  refreshTokens, resolveAccessToken, revokeRawToken, audienceOk, ACCESS_TTL_MS,
} from './oauth.js';

export const mcpRouter = Router();

const AUTHORIZE_PATH = '/oauth/authorize';
const bearerOf = (req) => {
  const h = String(req.get('authorization') || '');
  return /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '').trim() : null;
};
const challenge = (res, description) => {
  res.setHeader('WWW-Authenticate',
    `Bearer realm="sanad", resource_metadata="${issuer()}/.well-known/oauth-protected-resource"${description ? `, error="invalid_token"` : ''}`);
};
// وثائق الاكتشاف عامة بطبيعتها، ونقطة البروتوكول تُنادى من عميلٍ قد يكون في متصفّح. لا كعكة
// تُقبل على أيٍّ منها (الرمز في الترويسة)، فالسماح بالأصل المفتوح هنا لا يمنح أحداً شيئاً.
const openCors = (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
};

// ── ① الاكتشاف ────────────────────────────────────────────────────────────────────────────
const protectedResourceDoc = () => ({
  resource: resourceUrl(),
  authorization_servers: [issuer()],
  bearer_methods_supported: ['header'],
  resource_name: 'سند — نظام تشغيل الأعمال',
  resource_documentation: `${issuer()}/app/assistant-link`,
});
const authServerDoc = () => ({
  issuer: issuer(),
  authorization_endpoint: `${issuer()}${AUTHORIZE_PATH}`,
  token_endpoint: `${issuer()}/oauth/token`,
  registration_endpoint: `${issuer()}/oauth/register`,
  revocation_endpoint: `${issuer()}/oauth/revoke`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['sanad'],
});

for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
  mcpRouter.options(p, openCors);
  mcpRouter.get(p, openCors, (req, res) => res.json(protectedResourceDoc()));
}
for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp']) {
  mcpRouter.options(p, openCors);
  mcpRouter.get(p, openCors, (req, res) => res.json(authServerDoc()));
}

// ── ② تسجيل العميل (ديناميكي) ─────────────────────────────────────────────────────────────
mcpRouter.options('/oauth/register', openCors);
mcpRouter.post('/oauth/register', openCors, async (req, res, next) => {
  try {
    const b = req.body || {};
    const client = await registerClient({
      name: b.client_name || b.client_id || 'مساعد ذكي',
      redirectUris: b.redirect_uris,
      ip: req.ip,
    });
    res.status(201).json({
      client_id: client.id,
      client_name: client.name_ar,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(new Date(client.created_at).getTime() / 1000),
    });
  } catch (e) { next(e); }
});

// ── ③ شاشة الإذن: الموظف يقرأ ما سيصل إليه المساعد ثم يأذن أو يرفض ────────────────────────
const oauthError = (res, redirectUri, state, code, description) => {
  if (redirectUri) {
    const u = new URL(redirectUri);
    u.searchParams.set('error', code);
    if (description) u.searchParams.set('error_description', description);
    if (state) u.searchParams.set('state', state);
    return res.redirect(u.toString());
  }
  return res.status(400).json({ error: code, error_description: description });
};

async function consentPage(req, res, client, q) {
  const user = req.ctx.user;
  // النموذج هنا يُحوِّل بعد الإرسال إلى عنوان عودة المساعد (أصلٌ آخر بطبيعته)، وسياسة المحتوى
  // تحسب وجهة التحويل جزءاً من `form-action`. الأصل مأخوذ من عنوانٍ **مسجَّل ومطابَق** قبل هذا
  // السطر بثلاثة فحوص، لا من نصٍّ في الطلب.
  try { allowFormActionTo(res, new URL(String(q.redirect_uri)).origin); } catch { /* عنوان غير صالح لا يصل هنا */ }
  const hidden = Object.entries({
    client_id: q.client_id, redirect_uri: q.redirect_uri, state: q.state || '',
    code_challenge: q.code_challenge, code_challenge_method: q.code_challenge_method || 'S256',
    resource: q.resource || '', scope: q.scope || '',
  }).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  const body = `<div style="display:grid;gap:1rem;max-width:640px;margin:auto">
    <div class="card" style="padding:1.5rem">
      <h2>الإذن بربط مساعد ذكي بحسابك</h2>
      <p>يطلب «<strong>${esc(client.name_ar)}</strong>» أن يقرأ سنداً <strong>باسمك أنت</strong>.</p>
      <div class="alert info">ما يستطيعه بعد إذنك: يقرأ ما تقرؤه على شاشاتك ولا شيء غيره — بصلاحياتك ونطاقك أنت. ولا يرى الرواتب ولا قيم العقود في قراءات الفريق والموارد. وأي تغيير يبقى بخطوتين: معاينة تعرضها عليك ثم تأكيد منك، والموافقات المؤسسية تبقى كما هي.</div>
      <div class="alert warning">لا تأذن لمساعد لا تعرف مصدره. يمكنك قطع الربط في أي وقت من صفحة «ربط المساعد الذكي»، ويُسجَّل الإذن والقطع باسمك.</div>
      <form method="post" action="${esc(AUTHORIZE_PATH)}" style="display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1rem">
        <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">${hidden}
        <button class="btn btn-primary" type="submit" name="decision" value="allow">أذن بالربط</button>
        <button class="btn" type="submit" name="decision" value="deny">رفض</button>
      </form>
    </div>
    <div class="card" style="padding:1.25rem">
      <h3>الحساب الذي سيعمل به</h3>
      <p>${esc(user.name_ar || user.username)} — يُنفَّذ كل طلبٍ من المساعد بصلاحيات هذا الحساب، ويُسجَّل في سجل نشاط المساعد.</p>
    </div></div>`;
  res.send(await layout({ user, active: 'home', title: 'الإذن بربط مساعد', subtitle: 'اقرأ ما سيصل إليه قبل أن تأذن', body }));
}

mcpRouter.get(AUTHORIZE_PATH, async (req, res, next) => {
  try {
    const q = req.query || {};
    // بلا جلسة: نحفظ وجهة العودة ونرسله إلى الدخول — فيعود إلى الإذن نفسه بعد دخوله.
    if (!req.ctx?.user) {
      res.cookie('sanad_next', req.originalUrl, {
        httpOnly: true, sameSite: 'lax', secure: config.env === 'production', maxAge: 15 * 60000, path: '/',
      });
      return res.redirect('/login');
    }
    const client = await getClient(q.client_id);
    if (!client) return oauthError(res, null, q.state, 'invalid_client', 'المساعد الطالب غير مسجَّل');
    if (!client.redirect_uris.includes(String(q.redirect_uri || ''))) {
      return oauthError(res, null, q.state, 'invalid_request', 'عنوان العودة لا يطابق المسجَّل');
    }
    if (String(q.response_type || '') !== 'code') return oauthError(res, q.redirect_uri, q.state, 'unsupported_response_type');
    if (String(q.code_challenge_method || '') !== 'S256' || !q.code_challenge) {
      return oauthError(res, q.redirect_uri, q.state, 'invalid_request', 'يلزم تحقق مؤمَّن من الطلب');
    }
    if (!audienceOk(q.resource)) return oauthError(res, q.redirect_uri, q.state, 'invalid_target');
    await consentPage(req, res, client, q);
  } catch (e) { next(e); }
});

mcpRouter.post(AUTHORIZE_PATH, async (req, res, next) => {
  try {
    if (!req.ctx?.user) return res.redirect('/login');
    const b = req.body || {};
    const client = await getClient(b.client_id);
    if (!client) return oauthError(res, null, b.state, 'invalid_client');
    if (!client.redirect_uris.includes(String(b.redirect_uri || ''))) {
      return oauthError(res, null, b.state, 'invalid_request', 'عنوان العودة لا يطابق المسجَّل');
    }
    if (b.decision !== 'allow') {
      await audit(req.ctx, { action: 'deny', resource: 'mcp_client', resourceId: client.id,
        sectorId: req.ctx.user.sector_id || null, detail: { client_name: client.name_ar } });
      return oauthError(res, b.redirect_uri, b.state, 'access_denied', 'رُفض الإذن');
    }
    const code = await issueAuthCode(req.ctx, {
      clientId: client.id, redirectUri: b.redirect_uri,
      codeChallenge: b.code_challenge, codeChallengeMethod: b.code_challenge_method || 'S256',
      resource: b.resource || null,
    });
    const u = new URL(String(b.redirect_uri));
    u.searchParams.set('code', code);
    if (b.state) u.searchParams.set('state', b.state);
    res.redirect(u.toString());
  } catch (e) { next(e); }
});

// ── ④ تبديل الرموز ────────────────────────────────────────────────────────────────────────
// أخطاء هذا المسار تُقال بشكل OAuth (رمز الخطأ ووصفه العربي) لا بشكل أخطاء المنصة: العميل
// آلةٌ تقرأ الرمز لتقرر إعادة الربط، والوصف يُعرض للموظف حين يعرضه العميل.
const tokenFail = (res, e) => {
  const status = e instanceof HttpError && e.status === 404 ? 400 : (e?.status || 400);
  res.status(status === 403 ? 400 : status).json({
    error: 'invalid_grant',
    error_description: String(e?.message || 'تعذّر إتمام الربط'),
  });
};

mcpRouter.options('/oauth/token', openCors);
mcpRouter.post('/oauth/token', openCors, async (req, res) => {
  const b = req.body || {};
  try {
    const grant = String(b.grant_type || '');
    if (grant === 'authorization_code') {
      const out = await exchangeAuthCode({
        code: b.code, clientId: b.client_id, codeVerifier: b.code_verifier, redirectUri: b.redirect_uri, ip: req.ip,
      });
      return res.json({ token_type: 'Bearer', ...out, scope: 'sanad' });
    }
    if (grant === 'refresh_token') {
      const out = await refreshTokens({ refreshToken: b.refresh_token, clientId: b.client_id, ip: req.ip });
      return res.json({ token_type: 'Bearer', ...out, scope: 'sanad' });
    }
    return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'نوع الطلب غير مدعوم' });
  } catch (e) { return tokenFail(res, e); }
});

mcpRouter.options('/oauth/revoke', openCors);
mcpRouter.post('/oauth/revoke', openCors, async (req, res, next) => {
  try {
    await revokeRawToken(req.body?.token);
    res.status(200).json({});          // القياس: النجاح واحد سواء وُجد الرمز أم لا
  } catch (e) { next(e); }
});

// ── ⑤ نقطة البروتوكول ─────────────────────────────────────────────────────────────────────
mcpRouter.options('/mcp', openCors);
mcpRouter.get('/mcp', openCors, (req, res) => {
  // لا مجرى أحداثاً من الخادم في هذه النسخة: كل نداء طلبٌ وردّ. نقولها صراحةً بدل تركِ العميل
  // ينتظر مجرىً لا يأتي.
  res.setHeader('Allow', 'POST, DELETE, OPTIONS');
  res.status(405).json({ error: 'method_not_allowed', error_description: 'نقطة الربط تستقبل الطلبات بالإرسال لا بالفتح' });
});
mcpRouter.delete('/mcp', openCors, (req, res) => res.status(204).end());

mcpRouter.post('/mcp', openCors, async (req, res, next) => {
  try {
    const raw = bearerOf(req);
    if (!raw) {
      challenge(res);
      return res.status(401).json({ error: 'unauthorized', error_description: 'يلزم الإذن بالربط من حسابك في سند' });
    }
    const auth = await resolveAccessToken(raw);
    if (!auth) {
      challenge(res, true);
      return res.status(401).json({ error: 'invalid_token', error_description: 'انتهى الربط أو أُلغي — أعد الربط من حسابك في سند' });
    }
    const ctx = { user: auth.user, ip: req.ip };
    const out = await handleRpc(ctx, req.body);
    if (out === null) return res.status(202).end();     // إشعارات فقط: لا ردّ في البروتوكول
    res.json(out);
  } catch (e) { next(e); }
});

export const MCP_ACCESS_TTL_MS = ACCESS_TTL_MS;
