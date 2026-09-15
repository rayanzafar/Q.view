// مصادقة ربط المساعد الخارجي — تفويض بحساب الموظف نفسه (OAuth 2.1 + PKCE).
//
// المبدأ الذي تقوم عليه الوحدة كلها: **الرمز نائبٌ عن موظف واحد، لا مفتاح خدمة**. كل رمز يحمل
// `user_id`، وحلّه يعيد بناء المستخدم بنطاقه من مصدره الوحيد (`resolveUserFromSession`) فيقرأ
// المساعد ما يقرأه صاحبه على الشاشة — لا حرفاً أكثر. ولذلك لا يوجد في المنصة رمزٌ «للمساعد»
// ولا حساب خدمة: من لا يملك الصلاحية في سند لا يملكها عبر المساعد.
//
// وثلاثة أشياء لا يحفظها هذا الملف عمداً:
//   • الرمز نفسه — تُحفظ بصمته (sha256) فقط، فنسخة القاعدة لا تفتح باباً.
//   • سرّ العميل — لا سرّ أصلاً: العملاء عامّون (public clients) وحمايتهم PKCE بمفتاح لكل جلسة.
//   • كلمة مرور الموظف — التفويض يمرّ بجلسة سند القائمة، فلا تُطلب كلمة مرور في مسار الربط.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { all, get, insert, run, tx } from '../../core/db/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { audit } from '../../core/audit/index.js';
import { config } from '../../core/config.js';
import { resolveUserFromSession } from '../../core/http/context.js';
import { badRequest, notFound } from '../../core/http/errors.js';
import { logError } from '../../core/obs/log.js';

// ── الأعمار: قصيرةٌ حيث يكون السرّ في الطريق، وأطول حيث يكون في خزانة العميل ──────────────
export const CODE_TTL_MS = 5 * 60 * 1000;              // رمز التفويض: دقائق يقطعها إعادة التوجيه
export const ACCESS_TTL_MS = 8 * 60 * 60 * 1000;       // رمز الوصول: يوم عمل واحد
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // رمز التجديد: شهر، ويُدوَّر مع كل استعمال
const LAST_USED_THROTTLE_MS = 60 * 1000;

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const secret = (prefix) => `${prefix}${randomBytes(32).toString('base64url')}`;
const plus = (ms) => new Date(Date.now() + ms).toISOString();
const expired = (iso) => !iso || new Date(iso).getTime() <= Date.now();

/** عنوان هذا الخادم كما يعلنه للعميل — مصدر الوثائق والجمهور المقبول للرموز. */
export const issuer = () => String(config.platformUrl || '').replace(/\/+$/, '');
export const resourceUrl = () => `${issuer()}/mcp`;

// ── العميل: تسجيل ديناميكي (يسجّل العميل نفسه عند أول ربط) ────────────────────────────────
// عنوان العودة يُطابَق حرفياً وقت التفويض. المقبول: https، أو http على جهاز المستخدم وحده
// (عملاء سطح المكتب يفتحون منفذاً محلياً). ولا شارات عامة ولا جزء بعد #: عنوانٌ فضفاض هنا
// يعني تسليم رمز التفويض لموقع آخر.
export function redirectAllowed(uri) {
  let u;
  try { u = new URL(String(uri)); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]');
}

export async function registerClient({ name, redirectUris, ip = null }) {
  const uris = Array.isArray(redirectUris) ? redirectUris.map((u) => String(u || '').trim()).filter(Boolean) : [];
  if (!uris.length) throw badRequest('عنوان العودة مطلوب لتسجيل المساعد');
  if (uris.length > 8) throw badRequest('عناوين العودة أكثر من المسموح');
  for (const u of uris) {
    // الطول قبل الشكل: التسجيل مفتوح بلا حساب، وعنوانٌ بلا سقف طول يجعل صفَّ العميل الواحد
    // ميغابايتاً يكتبه أي أحد. خمسمئة وإثنا عشر محرفاً أوسع من أي عنوان عودة حقيقي.
    if (u.length > 512) throw badRequest('عنوان العودة أطول من المسموح');
    if (!redirectAllowed(u)) throw badRequest('عنوان العودة غير مقبول — يلزم عنوان مؤمَّن أو عنوان على جهازك');
  }
  const clientId = id('mcpc');
  const row = {
    id: clientId,
    name_ar: String(name || 'مساعد ذكي').slice(0, 120),
    redirect_uris: JSON.stringify(uris),
    created_at: nowIso(),
    created_ip: ip,
    disabled_at: null,
  };
  await insert('mcp_client', row);
  return { id: clientId, name_ar: row.name_ar, redirect_uris: uris, created_at: row.created_at };
}

export async function getClient(clientId) {
  if (!clientId) return null;
  const c = await get('SELECT * FROM mcp_client WHERE id = ? AND disabled_at IS NULL', [String(clientId)]);
  if (!c) return null;
  let uris = [];
  try { uris = JSON.parse(c.redirect_uris || '[]'); } catch { uris = []; }
  return { ...c, redirect_uris: uris };
}

/** الجمهور: رمزٌ طُلب لخادمٍ آخر لا يُقبل هنا ولا يُمرَّر إلى أحد. */
export function audienceOk(resource) {
  if (!resource) return true;                       // عميل لا يعلن الجمهور — يُقبل ويُقيَّد بهذا الخادم أصلاً
  const want = String(resource).replace(/\/+$/, '');
  const mine = resourceUrl().replace(/\/+$/, '');
  return want === mine || want === issuer();
}

// ── رمز التفويض: يُصدر بعد إذنٍ صريح من الموظف في شاشة سند ────────────────────────────────
export async function issueAuthCode(ctx, { clientId, redirectUri, codeChallenge, codeChallengeMethod, resource }) {
  const user = ctx?.user;
  if (!user) throw badRequest('يلزم تسجيل الدخول قبل الإذن بالربط');
  const client = await getClient(clientId);
  if (!client) throw notFound('المساعد الطالب غير مسجَّل');
  if (!client.redirect_uris.includes(String(redirectUri))) throw badRequest('عنوان العودة لا يطابق المسجَّل لهذا المساعد');
  if (String(codeChallengeMethod || '') !== 'S256') throw badRequest('طريقة التحقق المطلوبة غير مقبولة');
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(String(codeChallenge || ''))) throw badRequest('بصمة التحقق غير صالحة');
  if (!audienceOk(resource)) throw badRequest('الإذن مطلوب لخادم آخر — لا يُمنح من هنا');
  const code = secret('sanad_c_');
  await insert('mcp_auth_code', {
    id: sha256(code),
    client_id: client.id,
    user_id: user.id,
    redirect_uri: String(redirectUri),
    code_challenge: String(codeChallenge),
    code_challenge_method: 'S256',
    resource: resource ? String(resource).slice(0, 300) : null,
    created_at: nowIso(),
    expires_at: plus(CODE_TTL_MS),
    used_at: null,
  });
  await audit(ctx, { action: 'grant', resource: 'mcp_client', resourceId: client.id, sectorId: user.sector_id || null,
    detail: { client_name: client.name_ar, redirect_uri: String(redirectUri) } });
  return code;
}

async function issuePair(clientId, userId, ip, reason = 'authorize') {
  const access = secret('sanad_a_');
  const refresh = secret('sanad_r_');
  const now = nowIso();
  for (const [kind, value, ttl] of [['access', access, ACCESS_TTL_MS], ['refresh', refresh, REFRESH_TTL_MS]]) {
    await insert('mcp_token', {
      id: id('mcpt'), token_hash: sha256(value), kind, client_id: clientId, user_id: userId,
      created_at: now, expires_at: plus(ttl), last_used_at: null, revoked_at: null, revoked_by: null,
    });
  }
  // الأثر على الإصدار نفسه لا على الإذن وحده: بين الإذن والإصدار خطوةٌ يملكها العميل، ومن بدّل
  // رمز إذنٍ مسروق لا يترك بغير هذا السطر شيئاً باسم أحد. الفاعل هو صاحب الرمز (لا جلسة هنا).
  await audit({ user: { id: userId }, ip }, { action: 'issue', resource: 'mcp_token', resourceId: clientId,
    detail: { reason, kinds: ['access', 'refresh'] } });
  return { access_token: access, refresh_token: refresh, expires_in: Math.floor(ACCESS_TTL_MS / 1000) };
}

/** إبطال كل ما هو حيّ لهذا الموظف مع هذا المساعد — يُستدعى عند قطع الربط وعند كشف إعادة استعمال. */
async function revokeLive(clientId, userId, by) {
  await run('UPDATE mcp_token SET revoked_at = ?, revoked_by = ? WHERE client_id = ? AND user_id = ? AND revoked_at IS NULL',
    [nowIso(), by || null, clientId, userId]);
}

const pkceOk = (verifier, challenge) => {
  const v = String(verifier || '');
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(v)) return false;
  const computed = Buffer.from(createHash('sha256').update(v).digest('base64url'));
  const stored = Buffer.from(String(challenge || ''));
  return computed.length === stored.length && timingSafeEqual(computed, stored);
};

  const reuseDetected = async (row, kind) => {
    // أوضح إشارةٍ على تسريبٍ في هذا التصميم. كانت تُبطل الربط كله بصمت — بلا سطر أثر ولا سطر
    // سجل — فلا يعلم بها أحد. الآن تُكتب في الاثنين باسم صاحب الرمز.
    await revokeLive(row.client_id, row.user_id, 'reuse');
    logError('mcp_token_reuse', { kind, client_id: row.client_id, user_id: row.user_id });
    await audit({ user: { id: row.user_id }, ip: null }, { action: 'revoke', resource: 'mcp_token',
      resourceId: row.client_id, detail: { reason: 'reuse_detected', kind } });
  };

/** تبديل رمز التفويض برمزَي وصول وتجديد. الرمز لمرة واحدة؛ وإعادة استعماله تُبطل ما صدر عنه. */
export async function exchangeAuthCode({ code, clientId, codeVerifier, redirectUri, ip = null }) {
  const client = await getClient(clientId);
  if (!client) throw badRequest('المساعد الطالب غير مسجَّل');
  const row = await get('SELECT * FROM mcp_auth_code WHERE id = ?', [sha256(String(code || ''))]);
  if (!row || row.client_id !== client.id) throw badRequest('الإذن غير صالح — أعد الربط من جديد');
  if (row.used_at) {                                  // إعادة استعمال: نفترض التسريب ونغلق الباب كله
    await reuseDetected(row, 'auth_code');
    throw badRequest('الإذن استُعمل من قبل — أُلغي الربط، أعد الربط من جديد');
  }
  if (expired(row.expires_at)) throw badRequest('انتهت مهلة الإذن — أعد الربط من جديد');
  if (String(row.redirect_uri) !== String(redirectUri || '')) throw badRequest('عنوان العودة لا يطابق ما مُنح عليه الإذن');
  if (!pkceOk(codeVerifier, row.code_challenge)) throw badRequest('التحقق من الطلب فشل — أعد الربط من جديد');
  return await tx(async () => {
    const claim = await run('UPDATE mcp_auth_code SET used_at = ? WHERE id = ? AND used_at IS NULL', [nowIso(), row.id]);
    if (claim.changes !== 1) throw badRequest('الإذن استُعمل من قبل — أعد الربط من جديد');
    return await issuePair(row.client_id, row.user_id, ip, 'authorize');
  });
}

/**
 * التجديد بتدوير: رمز **التجديد** القديم يُبطل مع كل تجديد، وتقديمه بعد ذلك يُبطل الربط كله.
 *
 * وقرارٌ مقصود يُكتب كي لا يُقرأ سهواً: رمز **الوصول** السابق يبقى صالحاً حتى ينتهي عمره وحده
 * (ثماني ساعات) ولا يُبطله التجديد. هذا سلوك الرموز الحاملة المعتاد، والعميل يجدّد أصلاً حين
 * يقارب رمزه الانتهاء. ومن أراد قطعاً فورياً فطريقه واحد صريح: قطع الربط من صفحة الموظف —
 * وهو يُبطل كل ما هو حيّ في اللحظة نفسها.
 */
export async function refreshTokens({ refreshToken, clientId, ip = null }) {
  const client = await getClient(clientId);
  if (!client) throw badRequest('المساعد الطالب غير مسجَّل');
  const row = await get('SELECT * FROM mcp_token WHERE token_hash = ? AND kind = ?', [sha256(String(refreshToken || '')), 'refresh']);
  if (!row || row.client_id !== client.id) throw badRequest('رمز التجديد غير صالح — أعد الربط من جديد');
  if (row.revoked_at) {
    await reuseDetected(row, 'refresh_token');
    throw badRequest('رمز التجديد مستعمل سابقاً — أُلغي الربط، أعد الربط من جديد');
  }
  if (expired(row.expires_at)) throw badRequest('انتهت صلاحية الربط — أعد الربط من جديد');
  return await tx(async () => {
    const claim = await run('UPDATE mcp_token SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL',
      [nowIso(), 'rotated', row.id]);
    if (claim.changes !== 1) throw badRequest('رمز التجديد مستعمل سابقاً — أعد الربط من جديد');
    return await issuePair(row.client_id, row.user_id, ip, 'refresh');
  });
}

/**
 * حلّ رمز الوصول إلى مستخدم سند بنطاقه الكامل — البوابة الوحيدة لكل نداء من المساعد.
 * يعيد `null` لأي سببٍ كان (لا رمز، منتهٍ، مُبطل، عميل موقوف، صاحبه معطَّل) فلا يفرّق المتصل
 * بين الأسباب، ويعيد المستخدم كما تبنيه الجلسة تماماً فلا يوجد طريق ثانٍ لبناء الصلاحيات.
 */
export async function resolveAccessToken(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const row = await get('SELECT * FROM mcp_token WHERE token_hash = ? AND kind = ?', [sha256(value), 'access']);
  if (!row || row.revoked_at || expired(row.expires_at)) return null;
  const client = await getClient(row.client_id);
  if (!client) return null;
  const user = await resolveUserFromSession({ user_id: row.user_id });
  if (!user) return null;
  const last = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
  if (Date.now() - last > LAST_USED_THROTTLE_MS) {
    await run('UPDATE mcp_token SET last_used_at = ? WHERE id = ?', [nowIso(), row.id]);
  }
  return { user, token: row, client };
}

// ── ما يراه الموظف عن روابطه، وقطعها ─────────────────────────────────────────────────────
export async function listConnections(user) {
  if (!user) return [];
  const rows = await all(
    `SELECT t.client_id, c.name_ar, MIN(t.created_at) AS first_at, MAX(t.created_at) AS last_at,
            MAX(COALESCE(t.last_used_at, '')) AS last_used_at, COUNT(*) AS tokens
       FROM mcp_token t JOIN mcp_client c ON c.id = t.client_id
      WHERE t.user_id = ? AND t.revoked_at IS NULL AND t.expires_at > ?
      GROUP BY t.client_id, c.name_ar
      ORDER BY MAX(t.created_at) DESC`,
    [user.id, nowIso()]
  );
  return rows.map((r) => ({
    client_id: r.client_id,
    name_ar: r.name_ar,
    connected_at: r.first_at,
    renewed_at: r.last_at,
    last_used_at: r.last_used_at || null,
  }));
}

export async function revokeConnection(ctx, clientId) {
  const user = ctx?.user;
  if (!user) throw badRequest('يلزم تسجيل الدخول');
  const live = await get('SELECT COUNT(*) AS n FROM mcp_token WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL',
    [user.id, String(clientId || '')]);
  if (!Number(live?.n)) throw notFound('لا يوجد ربط قائم بهذا الاسم على حسابك');
  await revokeLive(String(clientId), user.id, user.id);
  await audit(ctx, { action: 'revoke', resource: 'mcp_client', resourceId: String(clientId), sectorId: user.sector_id || null,
    detail: { by: 'owner' } });
  return { revoked: true };
}

/** إبطال رمزٍ بعينه بناءً على طلب العميل نفسه (يقطع الربط عند حذف الموصّل من المساعد). */
export async function revokeRawToken(rawToken) {
  const value = String(rawToken || '').trim();
  if (!value) return { revoked: false };
  const row = await get('SELECT * FROM mcp_token WHERE token_hash = ?', [sha256(value)]);
  if (!row) return { revoked: false };
  await revokeLive(row.client_id, row.user_id, 'client');
  await audit({ user: { id: row.user_id }, ip: null }, { action: 'revoke', resource: 'mcp_client',
    resourceId: row.client_id, detail: { by: 'client' } });
  return { revoked: true };
}

/**
 * قطع كل روابط المساعد لحسابٍ واحد — يُستدعى من إجراءات الهوية لا من مسار المساعد.
 *
 * السبب أن هذا الباب موجود أصلاً: «إنهاء الجلسات» إجراءُ الجهاز الضائع والشكِّ في التسريب،
 * وتغييرُ كلمة المرور نظيره بيد صاحبه. وكان كلاهما يقطع الجلسات ويترك رمز المساعد يعمل ثماني
 * ساعات — أي أن الإجراء المخصَّص للسرقة لا يقطع أوسع الأبواب. الرمز نائبٌ عن الحساب، فما يُنهي
 * جلساته يُنهي نيابته.
 */
export async function revokeAllForUser(userId, by = 'session_revoke') {
  if (!userId) return { revoked: 0 };
  const r = await run('UPDATE mcp_token SET revoked_at = ?, revoked_by = ? WHERE user_id = ? AND revoked_at IS NULL',
    [nowIso(), by, userId]);
  return { revoked: Number(r.changes || 0) };
}

/**
 * كنس ما انتهى عمره من جداول الربط — مع كنسة الساعة، لا في مسار طلبٍ.
 *
 * ثلاثة جداول تنمو بلا سقف بغيره: رمز إذنٍ يعيش خمس دقائق ويبقى صفّه أبداً، ورموزٌ منتهية
 * أو مُبطلة لا يقرؤها أحد بعد شهرها، وعميلٌ سجّل نفسه ولم يُكمل الربط قط (التسجيل مفتوح بلا
 * حساب — فهو أول ما يُملأ من الخارج).
 *
 * وما يبقى عمداً: الرموز المُبطلة **حديثاً** (نافذة الاحتفاظ) كي يبقى «مَن قطع ولماذا» مقروءاً
 * بعد الحادثة مباشرةً، وسطور التدقيق نفسها — تلك لا تُكنس أبداً.
 */
export async function purgeExpiredMcp({ keepRevokedDays = 30, keepIdleClientDays = 7 } = {}) {
  const now = Date.now();
  const iso = (ms) => new Date(now - ms).toISOString();
  const day = 24 * 60 * 60 * 1000;
  const codes = await run('DELETE FROM mcp_auth_code WHERE expires_at < ?', [new Date(now).toISOString()]);
  const tokens = await run('DELETE FROM mcp_token WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)',
    [new Date(now).toISOString(), iso(keepRevokedDays * day)]);
  // عميلٌ بلا رمزٍ قط ولا إذنٍ قائم ومضى على تسجيله أسبوع: تسجيلٌ لم يصر ربطاً.
  const clients = await run(
    `DELETE FROM mcp_client WHERE created_at < ?
       AND id NOT IN (SELECT client_id FROM mcp_token)
       AND id NOT IN (SELECT client_id FROM mcp_auth_code)`,
    [iso(keepIdleClientDays * day)]
  );
  return { codes: Number(codes.changes || 0), tokens: Number(tokens.changes || 0), clients: Number(clients.changes || 0) };
}
