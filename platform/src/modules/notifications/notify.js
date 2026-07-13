import { insert, all, run } from '../../core/db/index.js';
import { id, nowIso } from '../../core/util/ids.js';

export function notify(userId, { kind, title, body, ref_resource, ref_id }) {
  insert('notification', {
    id: id('ntf'), user_id: userId, kind: kind || 'info', title: title || '', body: body || '',
    ref_resource: ref_resource || null, ref_id: ref_id || null, created_at: nowIso(),
  });
}
export function myNotifications(user, unreadOnly = false) {
  return all(`SELECT * FROM notification WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
    ORDER BY created_at DESC LIMIT 100`, [user.id]);
}
export function markRead(user, notifId) {
  run('UPDATE notification SET read_at = ? WHERE id = ? AND user_id = ?', [nowIso(), notifId, user.id]);
}
