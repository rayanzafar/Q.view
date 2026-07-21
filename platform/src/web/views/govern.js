// Governance pages: approvals queue, users & roles, audit log, reports & mail.
import { layout, card, pill, tr, hbars } from '../layout.js';
import { fmtSar } from '../../core/util/ids.js';
import { all } from '../../core/db/index.js';
import { myApprovalQueue } from '../../modules/workflow/engine.js';
import { esc, statMini } from './_shared.js';

export async function approvalsPage(user) {
  const q = await myApprovalQueue(user);
  const list = q.map((a) => `<tr class="border-b border-line">
    <td class="py-2.5 px-3 text-[13px]">${a.workflow_name}</td>
    <td class="px-3 text-[12px] text-muted">${a.resource} · ${a.resource_id}</td>
    <td class="px-3 text-[13px] tabular-nums">${fmtSar(a.amount_halalas)}</td>
    <td class="px-3">${pill('الخطوة ' + a.current_step, 'amber')}</td>
    <td class="px-3">
      <button onclick="Sanad.approve('${a.id}','approve')" class="text-[12px] text-green-700 font-bold">اعتماد</button>
      <button onclick="Sanad.approve('${a.id}','reject')" class="text-[12px] text-red-600 font-bold mr-2">رفض</button></td></tr>`).join('');
  const totalAmt = q.reduce((a, x) => a + (x.amount_halalas || 0), 0);
  const byRes = {}; for (const x of q) byRes[x.resource] = (byRes[x.resource] || 0) + 1;
  const resBreak = Object.entries(byRes).map(([r, n]) => `${tr(r) || r}: ${n}`).join(' · ') || '—';
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
    ${statMini('بانتظار اعتمادك', q.length, 'طلب')}
    ${statMini('إجمالي المبالغ', fmtSar(totalAmt), 'قيمة قيد الاعتماد', 'brand')}
    ${statMini('حسب النوع', Object.keys(byRes).length, resBreak)}</div>`;
  const body = strip + card(`<div class="p-4 border-b border-line font-bold text-sm">طلبات بانتظار اعتمادك (${q.length})</div>
    <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">المسار</th><th class="px-3 font-medium">المورد</th><th class="px-3 font-medium">المبلغ</th>
      <th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">إجراء</th></tr></thead>
      <tbody>${list || '<tr><td class="p-4 text-muted text-sm" colspan="5">لا طلبات بانتظارك</td></tr>'}</tbody></table>`);
  return layout({ user, active: 'approvals', title: 'الاعتمادات', body });
}

export async function usersPage(user) {
  const rows = await all(`SELECT u.*, r.name_ar role_name FROM app_user u LEFT JOIN role r ON r.id = u.role_id
    WHERE u.deleted_at IS NULL ORDER BY u.role_id, u.name_ar LIMIT 300`);
  const list = rows.map((u) => `<tr class="border-b border-line">
    <td class="py-2 px-3 text-[13px]">${esc(u.name_ar || '')}<div class="text-[11px] text-muted">${esc(u.username || '— بلا دخول')}</div></td>
    <td class="px-3">${pill(u.role_name || u.role_id, 'blue')}</td>
    <td class="px-3 text-[12px]">${u.sector_id || '—'}</td>
    <td class="px-3">${u.active ? pill('نشط', 'green') : pill('معطّل', 'red')}</td>
    <td class="px-3 text-[11px] text-muted">${u.last_login_at ? u.last_login_at.slice(0, 10) : 'لم يدخل'}</td></tr>`).join('');
  const activeN = rows.filter((u) => u.active).length;
  const neverIn = rows.filter((u) => !u.last_login_at).length;
  const byRole = {}; for (const u of rows) { const r = u.role_name || u.role_id || '—'; byRole[r] = (byRole[r] || 0) + 1; }
  const roleItems = Object.entries(byRole).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([r, n], i) => ({ label: esc(r), value: n, color: ['var(--brand)', 'var(--brand2)', '#0891b2', '#059669', '#d97706', '#db2777'][i % 6] }));
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:.9rem">
    ${statMini('إجمالي المستخدمين', rows.length, `${Object.keys(byRole).length} دور`)}
    ${statMini('نشط', activeN, 'حسابات مفعّلة', 'good')}
    ${statMini('معطّل', rows.length - activeN, 'حسابات موقوفة', rows.length - activeN ? 'bad' : '')}
    ${statMini('لم يسجّل دخولًا', neverIn, 'حسابات خاملة', neverIn ? 'warn' : '')}</div>`;
  const body = `${strip}
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:.9rem">
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">المستخدمون والصلاحيات (${rows.length})</div>
      <div style="max-height:520px;overflow-y:auto"><table class="w-full"><thead><tr class="text-[11px] text-muted text-right" style="position:sticky;top:0;background:var(--surface)">
        <th class="py-2 px-3 font-medium">المستخدم</th><th class="px-3 font-medium">الدور</th><th class="px-3 font-medium">القطاع</th>
        <th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">آخر دخول</th></tr></thead><tbody>${list}</tbody></table></div>`)}
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">التوزيع حسب الدور</div><div style="padding:.7rem 1rem">${hbars(roleItems, { fmt: (v) => v + '' })}</div>`)}
    </div>
    <div class="mt-3 text-[11px] text-muted">التفويض يُنفَّذ على الخادم. تعطيل حسابك أو خفض دورك بنفسك ممنوع خادميًا. الرواتب وعناوين IP محجوبة عن غير المصرّح لهم.</div>`;
  return layout({ user, active: 'users', title: 'المستخدمون والصلاحيات', body });
}

export async function auditPage(user) {
  const rows = await all('SELECT * FROM audit_log ORDER BY at DESC LIMIT 200');
  const today = new Date().toISOString().slice(0, 10);
  const todayN = rows.filter((a) => (a.at || '').slice(0, 10) === today).length;
  const distinctUsers = new Set(rows.map((a) => a.username || a.user_id).filter(Boolean)).size;
  const byAction = {}; for (const a of rows) { const k = a.action || '—'; byAction[k] = (byAction[k] || 0) + 1; }
  const actItems = Object.entries(byAction).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n], i) => ({ label: esc(tr(k) || k), value: n, color: ['var(--brand)', 'var(--brand2)', '#059669', '#d97706', '#dc2626', '#0891b2'][i % 6] }));
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:.9rem">
    ${statMini('أحداث (آخر 200)', rows.length, 'مسجّلة')}
    ${statMini('اليوم', todayN, 'حدث اليوم', 'brand')}
    ${statMini('مستخدمون نشطون', distinctUsers, 'في السجل')}
    ${statMini('أنواع الإجراءات', Object.keys(byAction).length, 'مختلفة')}</div>`;
  const list = rows.map((a) => `<tr class="border-b border-line">
    <td class="py-1.5 px-3 text-[11px] text-muted tabular-nums">${a.at.slice(0, 19).replace('T', ' ')}</td>
    <td class="px-3 text-[12px]">${esc(a.username || a.user_id || '—')}</td>
    <td class="px-3">${pill(tr(a.action), a.action === 'delete' ? 'red' : a.action === 'create' ? 'green' : 'slate')}</td>
    <td class="px-3 text-[12px]">${esc(a.resource || '')} ${a.resource_id ? '· ' + esc(a.resource_id) : ''}</td></tr>`).join('');
  const body = `${strip}
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:.9rem">
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">سجل التدقيق (آخر 200)</div>
      <div style="max-height:540px;overflow-y:auto"><table class="w-full"><thead><tr class="text-[11px] text-muted text-right" style="position:sticky;top:0;background:var(--surface)">
        <th class="py-2 px-3 font-medium">الوقت</th><th class="px-3 font-medium">المستخدم</th><th class="px-3 font-medium">الإجراء</th>
        <th class="px-3 font-medium">المورد</th></tr></thead><tbody>${list}</tbody></table></div>`)}
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">التوزيع حسب نوع الإجراء</div><div style="padding:.7rem 1rem">${hbars(actItems, { fmt: (v) => v + '' })}</div>`)}
    </div>`;
  return layout({ user, active: 'audit', title: 'سجل التدقيق', body });
}

export async function reportsPage(user) {
  const defs = await all('SELECT * FROM report_definition WHERE active = 1 ORDER BY id');
  const groups = await all('SELECT * FROM recipient_group ORDER BY name_ar');
  const schedules = await all('SELECT rs.*, rd.name_ar rname, rg.name_ar gname FROM report_schedule rs JOIN report_definition rd ON rd.id = rs.report_id LEFT JOIN recipient_group rg ON rg.id = rs.recipient_group_id ORDER BY rs.created_at DESC LIMIT 50');
  const outbox = await all('SELECT * FROM email_queue ORDER BY created_at DESC LIMIT 15');
  const freqAr = { daily: 'يومي', weekly: 'أسبوعي', biweekly: 'كل أسبوعين', monthly: 'شهري', quarterly: 'ربع سنوي', yearly: 'سنوي' };

  const reportCards = defs.map((d) => card(`<div style="padding:.9rem 1rem">
    <div style="font-weight:700;font-size:var(--fs-ui);margin-bottom:.5rem">${esc(d.name_ar)}</div>
    <div style="display:flex;gap:.4rem">
      <button onclick="Sanad.previewReport('${d.key}')" class="text-white" style="border:none;cursor:pointer;font-size:11px;padding:.35rem .6rem;border-radius:8px;background:var(--brand-grad)">معاينة</button>
      <button onclick="Sanad.testSend('${d.key}')" style="border:1px solid var(--line);cursor:pointer;font-size:11px;padding:.35rem .6rem;border-radius:8px;background:#fff">إرسال تجريبي</button>
    </div></div>`, 'card-h')).join('');

  const schedList = schedules.map((s) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.5rem .75rem;font-size:var(--fs-ui)">${s.rname}</td>
    <td style="padding:.5rem .75rem;font-size:12px">${freqAr[s.frequency] || s.frequency}</td>
    <td style="padding:.5rem .75rem;font-size:12px;color:var(--muted)">${s.gname || '—'}</td>
    <td style="padding:.5rem .75rem">${s.active ? pill('مفعّل', 'green') : pill('موقوف', 'slate')}</td>
    <td style="padding:.5rem .75rem;font-size:11px;color:var(--muted)">${s.next_run_at ? s.next_run_at.slice(0, 10) : '—'}</td></tr>`).join('');
  const outList = outbox.map((q) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.5rem .75rem;font-size:12px">${q.subject || ''}</td>
    <td style="padding:.5rem .75rem">${pill(tr(q.status), q.status === 'SENT' ? 'green' : q.status === 'FAILED' ? 'red' : 'amber')}</td>
    <td style="padding:.5rem .75rem;font-size:11px;color:var(--muted)">${q.created_at.slice(0, 16).replace('T', ' ')}</td></tr>`).join('');

  const body = `
    <div style="font-weight:800;font-size:var(--fs-title);margin-bottom:.5rem">التقارير المتاحة</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1.25rem">${reportCards}</div>
    ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:var(--fs-title);margin-bottom:.6rem">جدولة تقرير جديد</div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
        <select id="sch-report" aria-label="التقرير" style="border:1px solid var(--line);border-radius:8px;padding:.4rem .6rem;font-size:var(--fs-ui)">${defs.map((d) => `<option value="${d.id}">${d.name_ar}</option>`).join('')}</select>
        <select id="sch-freq" aria-label="تكرار الإرسال" style="border:1px solid var(--line);border-radius:8px;padding:.4rem .6rem;font-size:var(--fs-ui)">${Object.entries(freqAr).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select id="sch-group" aria-label="مجموعة المستلمين" style="border:1px solid var(--line);border-radius:8px;padding:.4rem .6rem;font-size:var(--fs-ui)"><option value="">— مجموعة مستلمين —</option>${groups.map((g) => `<option value="${g.id}">${g.name_ar}</option>`).join('')}</select>
        <input id="sch-time" type="time" value="08:00" aria-label="وقت الإرسال" style="border:1px solid var(--line);border-radius:8px;padding:.35rem .5rem;font-size:var(--fs-ui)">
        <button onclick="Sanad.addSchedule()" class="text-white" style="border:none;cursor:pointer;font-size:var(--fs-ui);padding:.45rem 1rem;border-radius:8px;background:var(--brand-grad)">جدولة</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:.5rem">الصلاحيات تُنفَّذ لكل مستلم وقت الإرسال — لا تُرسَل الأرقام الحساسة لمن لا يملك صلاحيتها.</div></div>`)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1.25rem">
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:var(--fs-ui)">التقارير المجدولة</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:11px;color:var(--muted);text-align:right"><th style="padding:.4rem .75rem">التقرير</th><th style="padding:.4rem .75rem">التكرار</th><th style="padding:.4rem .75rem">المستلمون</th><th style="padding:.4rem .75rem">الحالة</th><th style="padding:.4rem .75rem">التالي</th></tr></thead><tbody>${schedList || '<tr><td style="padding:1rem;color:var(--muted);font-size:var(--fs-ui)" colspan="5">لا جداول بعد</td></tr>'}</tbody></table>`)}
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:var(--fs-ui)">سجل الإرسال (Outbox)</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:11px;color:var(--muted);text-align:right"><th style="padding:.4rem .75rem">الموضوع</th><th style="padding:.4rem .75rem">الحالة</th><th style="padding:.4rem .75rem">الوقت</th></tr></thead><tbody>${outList || '<tr><td style="padding:1rem;color:var(--muted);font-size:var(--fs-ui)" colspan="3">لا رسائل بعد</td></tr>'}</tbody></table>`)}
    </div>
    <div id="report-preview" style="margin-top:1rem"></div>`;
  return layout({ user, active: 'reports', title: 'التقارير والبريد', subtitle: 'محرك تقارير تنفيذية + جدولة + بريد', body });
}
