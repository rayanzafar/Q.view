// مركز البريد — عرض صادرات المنصة (وضع sandbox يكتب إلى صندوق معاينة بدل الإرسال الحقيقي)،
// طابور الإرسال وسجلّه، وحالة قناة الإرسال. إتاحته لمدير النظام ومكتب الرئيس فقط (nav.js).
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { layout, card, pill, tr } from '../layout.js';
import { all } from '../../core/db/index.js';
import { config, ROOT } from '../../core/config.js';
import { esc } from './_shared.js';

export async function mailPage(user, opts = {}) {
  const dir = resolve(ROOT, 'data/outbox');
  let files = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.html'))
      .map((f) => ({ f, t: statSync(resolve(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t).slice(0, 30);
  } catch { files = []; }
  const queue = await all(`SELECT id, subject, status, attempts, last_error, created_at, sent_at, to_json
      FROM email_queue ORDER BY created_at DESC LIMIT 30`);
  const logs = await all(`SELECT l.event, l.detail, l.at, q.subject FROM email_log l
      LEFT JOIN email_queue q ON q.id = l.queue_id ORDER BY l.at DESC LIMIT 30`);
  const smtpOn = config.mailTransport === 'smtp';

  const chan = card(`<div style="padding:.85rem 1rem;display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">
    <div style="font-weight:800;font-size:13.5px">قناة الإرسال</div>
    ${smtpOn ? pill('بريد حقيقي مفعّل', 'green') : pill('وضع المعاينة — لا يُرسل بريد حقيقي', 'amber')}
    <span style="font-size:11.5px;color:var(--muted)">${smtpOn
      ? 'الرسائل تُرسل عبر خادم البريد المهيأ.'
      : 'كل رسالة تُحفظ هنا للمعاينة بدل إرسالها. تفعيل الإرسال الحقيقي يحتاج بيانات خادم البريد من مزوّد النطاق (يُطلب من المالك).'}</span>
  </div>`);

  const fileRows = files.map(({ f, t }) => {
    const name = f.replace(/^\d+_/, '').replace(/_/g, ' ').replace(/\.html$/, '');
    return `<div style="display:flex;align-items:center;gap:.6rem;padding:.45rem 0;border-bottom:1px dashed var(--line);font-size:12.5px">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
      <span style="flex:none;font-size:10.5px;color:var(--faint)" class="tnum">${new Date(t).toISOString().slice(0, 16).replace('T', ' ')}</span>
      <button class="btn btn-sm" data-action="preview-mail" data-file="${esc(f)}">معاينة</button>
    </div>`;
  }).join('') || `<div class="empty-state"><div class="t">لا رسائل بعد</div><div class="s">أرسل تقريراً تجريبياً من صفحة التقارير وستظهر رسالته هنا فوراً.</div></div>`;

  const qRows = queue.map((q) => {
    let to = ''; try { to = (JSON.parse(q.to_json || '[]') || []).join('، '); } catch { to = ''; }
    return `<tr style="border-bottom:1px solid var(--line)">
      <td style="padding:.4rem .6rem;font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q.subject || '')}</td>
      <td style="padding:.4rem .6rem;font-size:11px;color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(to)}</td>
      <td style="padding:.4rem .6rem;text-align:center">${pill(tr(q.status), q.status === 'SENT' ? 'green' : q.status === 'FAILED' ? 'red' : 'blue')}</td>
      <td style="padding:.4rem .6rem;text-align:center;font-size:11px;color:var(--muted)" class="tnum">${String(q.created_at || '').slice(0, 16).replace('T', ' ')}</td>
    </tr>${q.last_error ? `<tr><td colspan="4" style="padding:0 .6rem .4rem;font-size:10.5px;color:var(--red)">${esc(q.last_error)}</td></tr>` : ''}`;
  }).join('') || `<tr><td colspan="4"><div class="empty-state" style="padding:1rem"><div class="s">الطابور فارغ</div></div></td></tr>`;

  const logRows = logs.map((l) => `<div style="display:flex;gap:.6rem;padding:.32rem 0;border-bottom:1px dashed var(--line);font-size:11.5px">
      <span style="flex:none;color:var(--muted)" class="tnum">${String(l.at || '').slice(5, 16).replace('T', ' ')}</span>
      <span style="flex:none">${pill(tr(l.event) || esc(l.event || ''), l.event === 'failed' ? 'red' : l.event === 'sent' ? 'green' : 'slate')}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink2)">${esc(l.subject || l.detail || '')}</span>
    </div>`).join('') || `<div style="font-size:11.5px;color:var(--faint);padding:.4rem 0">لا أحداث بعد</div>`;

  const th = (t, a) => `<th style="padding:.4rem .6rem;font-size:10.5px;color:var(--muted);font-weight:700;text-align:${a || 'right'}">${t}</th>`;
  const body = `
    ${chan}
    <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:.9rem;margin-top:.9rem">
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:800;font-size:13.5px">صندوق المعاينة</div>
          <a class="btn btn-sm" href="/app/reports">إرسال تقرير الآن</a></div>
        <div style="padding:.5rem 1rem .8rem">${fileRows}</div>`)}
      <div style="display:flex;flex-direction:column;gap:.9rem">
        ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">طابور الإرسال</div>
          <div class="tblwrap"><table style="width:100%;border-collapse:collapse"><thead><tr>${th('الموضوع')}${th('إلى')}${th('الحالة', 'center')}${th('متى', 'center')}</tr></thead><tbody>${qRows}</tbody></table></div>`)}
        ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">سجل الأحداث</div>
          <div style="padding:.4rem 1rem .7rem">${logRows}</div>`)}
      </div>
    </div>
    <div id="mail-preview" class="modal" data-action="close-mail-modal"><div class="modal-card" style="width:760px;max-width:96vw">
      <div class="modal-head"><div style="font-weight:800;font-size:13.5px">معاينة الرسالة</div><button class="btn btn-ghost btn-sm" data-action="close-mail">✕</button></div>
      <iframe id="mail-frame" style="width:100%;height:70vh;border:none;background:#fff"></iframe>
    </div></div>`;
  return layout({ user, active: 'mail', title: 'مركز البريد', subtitle: 'صادرات المنصة: معاينة، طابور، وسجل', body, year: opts.year, scripts: ['/static/pages/mail.js'] });
}

// نص الرسالة الخام للمعاينة (يُخدم عبر مسار ويب مقيّد بنفس صلاحية الصفحة)
export function outboxFileHtml(fileName) {
  if (!/^[\w؀-ۿ.-]+\.html$/.test(fileName)) return null;
  try { return readFileSync(resolve(ROOT, 'data/outbox', fileName), 'utf8'); } catch { return null; }
}
