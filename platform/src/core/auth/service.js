// Authentication service: login with lockout, session lifecycle, password change.
import { get, run, insert } from '../db/index.js';
import { config } from '../config.js';
import { id, nowIso } from '../util/ids.js';
import { verifyPassword, hashPassword } from './password.js';
import { audit } from '../audit/index.js';

export function login({ username, password, ip, userAgent }) {
  const u = get('SELECT * FROM app_user WHERE lower(username) = lower(?) AND deleted_at IS NULL', [username]);
  const fail = (reason) => {
    if (u) {
      const attempts = (u.failed_attempts || 0) + 1;
      const locked = attempts >= config.maxFailedAttempts
        ? new Date(Date.now() + config.lockMinutes * 60000).toISOString() : null;
      run('UPDATE app_user SET failed_attempts = ?, locked_until = ? WHERE id = ?', [attempts, locked, u.id]);
      insert('login_history', { id: id('lh'), user_id: u.id, at: nowIso(), ip, user_agent: userAgent, ok: 0 });
    }
    return { ok: false, reason };
  };

  if (!u || !u.password_hash) return fail('invalid');
  if (!u.active) return fail('inactive');
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) return fail('locked');
  if (!verifyPassword(password, u.password_hash)) return fail('invalid');

  // success
  const now = nowIso();
  run('UPDATE app_user SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [now, u.id]);
  insert('login_history', { id: id('lh'), user_id: u.id, at: now, ip, user_agent: userAgent, ok: 1 });
  const sid = id('sess');
  insert('session', {
    id: sid, user_id: u.id, created_at: now,
    expires_at: new Date(Date.now() + config.sessionTtlHours * 3600000).toISOString(),
    ip, user_agent: userAgent,
  });
  audit({ user: u, ip }, { action: 'login', resource: 'session', resourceId: sid });
  return { ok: true, sessionId: sid, user: u, mustChangePassword: !!u.must_change_pw };
}

export function logout(sessionId) {
  if (sessionId) run('UPDATE session SET revoked_at = ? WHERE id = ?', [nowIso(), sessionId]);
}

export function changePassword(userId, newPassword) {
  run('UPDATE app_user SET password_hash = ?, must_change_pw = 0, updated_at = ? WHERE id = ?',
    [hashPassword(newPassword), nowIso(), userId]);
}
