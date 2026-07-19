import { insert, all, run } from '../../core/db/index.js';
import { id, nowIso } from '../../core/util/ids.js';

export async function notify(userId, { kind, title, body, ref_resource, ref_id }) {
  await insert('notification', {
    id: id('ntf'), user_id: userId, kind: kind || 'info', title: title || '', body: body || '',
    ref_resource: ref_resource || null, ref_id: ref_id || null, created_at: nowIso(),
  });
}
export async function myNotifications(user, unreadOnly = false) {
  return await all(`SELECT * FROM notification WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
    ORDER BY created_at DESC LIMIT 100`, [user.id]);
}
export async function markRead(user, notifId) {
  await run('UPDATE notification SET read_at = ? WHERE id = ? AND user_id = ?', [nowIso(), notifId, user.id]);
}
