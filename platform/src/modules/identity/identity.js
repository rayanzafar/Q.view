// إدارة الهوية — المكان الواحد الذي يُفتح فيه الوصول ويُقطع.
//
// قبل هذا الملف لم يكن في المنتج طريقةٌ لإنشاء مستخدم إطلاقاً: الحسابات تُخلق من سكربتات البذر
// وحدها، وشاشة «المستخدمون» جدولُ قراءةٍ بلا زر — بينما يقول دليل التشغيل للمشغّل «أنشئ الحسابات
// من شاشة إدارة المستخدمين». فكان على من يريد إضافة موظف أن يفتح سكربتاً ويشغّله على الخادم.
//
// وثلاثة حُرّاس هنا ليست تفصيلاً:
//  · لا تعطّل نفسك ولا تخفض دورك — وإلا خرج آخرُ مديرِ نظامٍ من بابه وأغلقه خلفه.
//  · لا يبقى النظام بلا مدير نظام واحد نشط على الأقل.
//  · التعطيل يُبطل الجلسات القائمة فوراً — تعطيلٌ يترك الجلسة حيّةً حتى انتهائها ليس تعطيلاً.
import { all, get, run, insert, tx } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { id, nowIso } from '../../core/util/ids.js';
import { requestCode, PURPOSE, normalizeEmail } from '../../core/auth/otp.js';
import { ROLE_LABELS } from '../../core/rbac/matrix.js';

// صلاحية إدارة الهوية = صلاحية مدير النظام. تُفحص في الخدمة لا في الصفحة وحدها: الصفحة
// محروسة بـPAGE_ACCESS، لكن المسارات تُنادى مباشرةً أيضاً.
function requireIdentityAdmin(user, what) {
  if (!user) throw forbidden();
  if (user.role_id !== 'admin' && !can(user, 'admin', '*')) {
    throw forbidden(`${what} من صلاحية مدير النظام وحده`);
  }
}

const VALID_ROLES = new Set(Object.keys(ROLE_LABELS));
const VALID_SCOPES = new Set(['own', 'team', 'department', 'sector', 'company']);

async function loadUser(userId) {
  const u = await get('SELECT * FROM app_user WHERE id = ? AND deleted_at IS NULL', [userId]);
  if (!u) throw notFound('هذا الحساب غير موجود أو محذوف');
  return u;
}

// آخر مدير نظام نشط: قبل أي تعطيل أو خفض دور. بلا هذا الفحص تصير المنصة بلا من يديرها،
// ولا سبيل لاستعادة ذلك من داخل المنتج — يلزم فتح قاعدة البيانات يدوياً.
async function assertNotLastAdmin(targetUser, { changingRole = false, deactivating = false } = {}) {
  if (targetUser.role_id !== 'admin') return;
  if (!changingRole && !deactivating) return;
  const others = await get(
    `SELECT COUNT(*) n FROM app_user
      WHERE role_id = 'admin' AND active = 1 AND deleted_at IS NULL AND id <> ?`, [targetUser.id]);
  if (Number(others.n) === 0) {
    throw badRequest('هذا آخر مدير نظام نشط — عيّن مديراً آخر أولاً، وإلا بقيت المنصة بلا من يديرها');
  }
}

// ─────────────────────────────── قراءة ───────────────────────────────

export async function listUsers(user, { query = '', role = '', status = '' } = {}) {
  requireIdentityAdmin(user, 'عرض حسابات الدخول');
  const rows = await all(`SELECT u.*, r.name_ar role_name, s.name_ar sector_name, e.name_ar employee_name
      FROM app_user u
      LEFT JOIN role r ON r.id = u.role_id
      LEFT JOIN sector s ON s.id = u.sector_id
      LEFT JOIN employee e ON e.id = u.employee_id
      WHERE u.deleted_at IS NULL ORDER BY u.active DESC, u.name_ar LIMIT 500`);
  const q = String(query || '').trim().toLowerCase();
  return rows.filter((u2) => {
    if (role && u2.role_id !== role) return false;
    if (status === 'active' && !u2.active) return false;
    if (status === 'disabled' && u2.active) return false;
    if (status === 'never' && u2.last_login_at) return false;
    if (!q) return true;
    return [u2.name_ar, u2.username, u2.email, u2.employee_name]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });
}

// سجل دخول حسابٍ بعينه. الجدول `login_history` يُكتب منذ أول يوم في المنصة ولم يقرأه أحد قط —
// وهو الشيء الوحيد الذي يجيب «هل دخل هذا الحساب فعلاً، ومن أين؟».
export async function userLoginHistory(user, userId, { limit = 25 } = {}) {
  requireIdentityAdmin(user, 'عرض سجل الدخول');
  const rows = await all(
    'SELECT at, ip, user_agent, ok FROM login_history WHERE user_id = ? ORDER BY at DESC LIMIT ?',
    [userId, Math.min(Number(limit) || 25, 100)]);
  // العنوان حقلٌ حسّاس في مصفوفة الحجب (app_user.ip) — يُحجب عمّن لا يملك رؤيته حتى هنا.
  const maySeeIp = can(user, 'admin', '*') || user.role_id === 'admin';
  return rows.map((r) => ({ ...r, ip: maySeeIp ? r.ip : null }));
}

// ─────────────────────────────── دعوة ───────────────────────────────

// تُنشئ حساباً معطّلاً بلا كلمة مرور، وترسل رمز تفعيل. أول دخول بالرمز يفعّله — فلا تمرّ
// كلمةُ مرورٍ مؤقتة في أي قناة، ولا يوجد سرٌّ دائم يُشارَك في محادثة.
export async function inviteUser(ctx, data = {}) {
  const actor = ctx.user;
  requireIdentityAdmin(actor, 'دعوة مستخدم جديد');

  const email = normalizeEmail(data.email);
  const nameAr = String(data.name_ar || data.nameAr || '').trim();
  const roleId = String(data.role_id || data.roleId || '').trim();
  const sectorId = data.sector_id || data.sectorId || null;
  const scope = String(data.scope || 'own').trim();
  const employeeId = data.employee_id || data.employeeId || null;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('اكتب بريد عمل صحيحاً — إليه يصل رمز الدخول');
  if (!nameAr) throw badRequest('اكتب اسم الموظف بالعربية كما يظهر في المنصة');
  if (!VALID_ROLES.has(roleId)) throw badRequest('اختر دوراً من القائمة — الدور يحدّد ما يراه هذا الشخص');
  if (!VALID_SCOPES.has(scope)) throw badRequest('اختر نطاق البيانات من القائمة');

  const clash = await get('SELECT id, name_ar, active FROM app_user WHERE lower(trim(email)) = ? AND deleted_at IS NULL', [email]);
  if (clash) throw badRequest(`هذا البريد مرتبط بحساب ${clash.name_ar || ''} — عدّل الحساب القائم بدل إنشاء حساب ثانٍ`);

  if (employeeId) {
    const taken = await get('SELECT name_ar FROM app_user WHERE employee_id = ? AND deleted_at IS NULL LIMIT 1', [employeeId]);
    if (taken) throw badRequest(`هذا الموظف مربوط بحساب ${taken.name_ar || ''} — فُكّ الربط أولاً`);
  }

  const uid = id('usr');
  await tx(async () => {
    await insert('app_user', {
      id: uid,
      username: email.split('@')[0].slice(0, 60),
      email,
      name_ar: nameAr,
      role_id: roleId,
      sector_id: sectorId,
      employee_id: employeeId,
      scope,
      password_hash: null,          // بلا كلمة مرور — الدخول بالرمز وحده
      active: 0,                    // يُفعَّل بأول دخول برمز الدعوة
      must_change_pw: 0,
      failed_attempts: 0,
      created_at: nowIso(),
      created_by: actor.id,
    });
    await audit(ctx, {
      action: 'create', resource: 'app_user', resourceId: uid, sectorId,
      detail: `دعوة ${nameAr} بدور ${(ROLE_LABELS[roleId] || {}).ar || roleId}`,
    });
  });

  // الدعوة تُرسَل بعد نجاح المعاملة لا داخلها: رسالةٌ تخرج ثم تفشل المعاملة تعني رمزاً في يد
  // شخصٍ لا حساب له. والفشل في الإرسال لا يُلغي الحساب — يُعاد إرسال الدعوة من الشاشة.
  const inviterName = actor.name_ar || actor.username || null;
  const sent = await requestCode({ email, ip: ctx.ip, purpose: PURPOSE.INVITE, inviterName });
  return { ok: true, id: uid, email, delivered: !!sent.delivered };
}

// إعادة إرسال الدعوة — للحساب الذي لم يُفعَّل بعد.
export async function resendInvite(ctx, userId) {
  requireIdentityAdmin(ctx.user, 'إعادة إرسال الدعوة');
  const u = await loadUser(userId);
  if (!u.email) throw badRequest('هذا الحساب بلا بريد — أضِف بريده أولاً كي يصله الرمز');
  const purpose = u.active ? PURPOSE.SIGNIN : PURPOSE.INVITE;
  const r = await requestCode({ email: u.email, ip: ctx.ip, purpose, inviterName: ctx.user.name_ar || null });
  await audit(ctx, { action: 'update', resource: 'app_user', resourceId: u.id, detail: 'إعادة إرسال رمز الدخول' });
  return { ok: true, delivered: !!r.delivered };
}

// ─────────────────────────── تفعيل وتعطيل ───────────────────────────

export async function setUserActive(ctx, userId, active) {
  const actor = ctx.user;
  requireIdentityAdmin(actor, 'تعطيل الحسابات أو تفعيلها');
  const u = await loadUser(userId);
  const want = active ? 1 : 0;

  if (!want && u.id === actor.id) throw badRequest('لا يمكنك تعطيل حسابك أنت — اطلب من مدير نظام آخر فعل ذلك');
  if (!want) await assertNotLastAdmin(u, { deactivating: true });
  if (Number(u.active) === want) return { ok: true, unchanged: true };

  let revoked = 0;
  await tx(async () => {
    await run('UPDATE app_user SET active = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      [want, nowIso(), actor.id, u.id]);
    if (!want) {
      // الجلسات القائمة تُبطل فوراً. بلا هذا يبقى الحساب المعطَّل داخلاً حتى تنتهي جلسته
      // من تلقائها — أي إلى اثنتي عشرة ساعة بعد قرار المنع.
      const r = await run('UPDATE session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), u.id]);
      revoked = Number(r.changes || 0);
      // ورموز الدخول المعلَّقة تُحرق كذلك — رمزٌ في بريده يفتح ما مُنع منه.
      await run('UPDATE login_code SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL', [nowIso(), u.id]);
    }
    await audit(ctx, {
      action: 'update', resource: 'app_user', resourceId: u.id, sectorId: u.sector_id,
      detail: want ? `تفعيل حساب ${u.name_ar || u.username}` : `تعطيل حساب ${u.name_ar || u.username} وإنهاء جلساته`,
    });
  });
  return { ok: true, active: !!want, sessionsRevoked: revoked };
}

// ─────────────────────────── تعديل الحساب ───────────────────────────

export async function updateUser(ctx, userId, data = {}) {
  const actor = ctx.user;
  requireIdentityAdmin(actor, 'تعديل حسابات الدخول');
  const u = await loadUser(userId);

  const patch = {}, notes = [];
  if (data.name_ar !== undefined) {
    const v = String(data.name_ar).trim();
    if (!v) throw badRequest('الاسم لا يمكن أن يكون فارغاً');
    patch.name_ar = v; notes.push('الاسم');
  }
  if (data.role_id !== undefined && data.role_id !== u.role_id) {
    const v = String(data.role_id);
    if (!VALID_ROLES.has(v)) throw badRequest('اختر دوراً من القائمة');
    if (u.id === actor.id) throw badRequest('لا يمكنك تغيير دورك بنفسك — اطلب من مدير نظام آخر فعل ذلك');
    await assertNotLastAdmin(u, { changingRole: true });
    patch.role_id = v; notes.push(`الدور إلى ${(ROLE_LABELS[v] || {}).ar || v}`);
  }
  if (data.scope !== undefined && data.scope !== u.scope) {
    const v = String(data.scope);
    if (!VALID_SCOPES.has(v)) throw badRequest('اختر نطاق البيانات من القائمة');
    if (u.id === actor.id) throw badRequest('لا يمكنك تغيير نطاقك بنفسك — اطلب من مدير نظام آخر فعل ذلك');
    patch.scope = v; notes.push('نطاق البيانات');
  }
  if (data.sector_id !== undefined) { patch.sector_id = data.sector_id || null; notes.push('القطاع'); }
  if (data.email !== undefined) {
    const v = normalizeEmail(data.email);
    if (!v || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw badRequest('اكتب بريد عمل صحيحاً');
    const clash = await get('SELECT id FROM app_user WHERE lower(trim(email)) = ? AND id <> ? AND deleted_at IS NULL', [v, u.id]);
    if (clash) throw badRequest('هذا البريد مستعمل في حساب آخر');
    patch.email = v; notes.push('البريد');
  }
  if (!Object.keys(patch).length) return { ok: true, unchanged: true };

  patch.updated_at = nowIso();
  patch.updated_by = actor.id;
  const cols = Object.keys(patch);
  await tx(async () => {
    await run(`UPDATE app_user SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => patch[c]), u.id]);
    await audit(ctx, {
      action: 'update', resource: 'app_user', resourceId: u.id, sectorId: patch.sector_id ?? u.sector_id,
      detail: `تعديل ${u.name_ar || u.username}: ${notes.join('، ')}`,
    });
  });
  return { ok: true, changed: notes };
}

// إنهاء كل جلسات حسابٍ بلا تعطيله — لجهازٍ ضائع أو شكٍّ في تسريب.
export async function revokeSessions(ctx, userId) {
  requireIdentityAdmin(ctx.user, 'إنهاء جلسات الحسابات');
  const u = await loadUser(userId);
  const r = await run('UPDATE session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), u.id]);
  await run('UPDATE login_code SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL', [nowIso(), u.id]);
  await audit(ctx, {
    action: 'update', resource: 'app_user', resourceId: u.id,
    detail: `إنهاء جلسات ${u.name_ar || u.username} (${Number(r.changes || 0)})`,
  });
  return { ok: true, sessionsRevoked: Number(r.changes || 0) };
}
