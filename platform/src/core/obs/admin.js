// أفعالُ مدير النظام على سجل الأعطال. الحارس في الخدمة لا في المسار — قاعدة البيت.
import { forbidden } from '../http/errors.js';
import { audit } from '../audit/index.js';
import { muteFault } from './store.js';

export async function muteFaultFor(ctx, fingerprint, muted) {
  if (ctx?.user?.role_id !== 'admin') throw forbidden('إسكات الأعطال من صلاحية مدير النظام وحده');
  const on = muted !== false && muted !== '0' && muted !== 0;
  const res = await muteFault(fingerprint, on);
  await audit(ctx, { action: 'update', resource: 'error_event', resourceId: String(fingerprint || '').slice(0, 16), detail: { action: on ? 'إسكات' : 'إلغاء الإسكات' } });
  return res;
}
