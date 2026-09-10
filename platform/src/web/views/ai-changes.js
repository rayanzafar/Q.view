// صفحة «تغييرات تنتظر تأكيدك» — حيث يقع القرار.
//
// المساعدُ المرتبط بحسابك يقرأ ويقترح، لكنه لا يكتب. فإن طلب تغييراً وقف طلبُه هنا حتى تقرأه
// أنت وتضغط. وثلاثة أشياء تفرضها هذه الصفحة على نفسها لأن الغموض فيها يُوقِّع على ما لم يُقرأ:
//
//   ① **التفصيل قبل الزرّ لا خلفه.** لا «هل توافق» ولا ملخّصٌ في سطر: كل حقلٍ يتغيّر يُعرض
//      بقيمته قبل وقيمته بعد، وما له تبعةٌ يُكتب تحته. تقرأ ما توقّع عليه، لا اسم العملية.
//   ② **من طلبه.** اسم المساعد الذي نادى، ووقتُ الطلب — فطلبٌ لا تعرف من أين جاء يُرفض لا يُؤكَّد.
//   ③ **المهلة معلنة.** لحظةُ انتهاء الصلاحية مكتوبة، فلا تظنّ أن الطلب باقٍ إلى الأبد ولا
//      تُفاجَأ برفضه عند الضغط.
//
// وزرّان لا ثالث لهما: «أؤكّد التنفيذ» و«أرفض». والرفضُ قرارٌ يُسجَّل باسمك مثل التأكيد تماماً —
// كي يقرأ من يعود إلى السجل أن الطلب عُرض وبُتَّ فيه، لا أنه ضاع.
import { layout } from '../layout.js';
import { esc } from './_shared.js';
import { listAwaiting } from '../../modules/ai/confirmations.js';
import { riyadhStamp } from '../../core/i18n/time.js';

const TOOL_AR = Object.freeze({
  sanad_create_opportunity: 'تسجيل فرصة جديدة',
  sanad_update_opportunity: 'تعديل بيانات فرصة',
  sanad_move_opportunity_stage: 'نقل فرصة إلى مرحلة أخرى',
  sanad_create_task: 'إنشاء مهمة',
  sanad_update_task: 'تحديث مهمة',
  sanad_create_allocation_request: 'تغيير تسكين',
  sanad_create_followup: 'فتح متابعة على مورد',
  sanad_decide_approval: 'البتّ في طلب اعتماد',
  sanad_log_contact: 'تسجيل تواصل',
  sanad_dc_apply_triage: 'دراسة بلاغ في مركز التطوير',
  sanad_dc_apply_status: 'تغيير حال بلاغ',
  sanad_dc_apply_approve: 'اعتماد بلاغ',
  sanad_dc_apply_decline: 'رفض بلاغ',
  sanad_dc_apply_create_item: 'تسجيل بلاغ نيابةً عن غيرك',
});

const rowsOf = (preview) => (Array.isArray(preview?.display) ? preview.display : []).filter((r) => r && r.field_ar);

function changeTable(preview) {
  const rows = rowsOf(preview);
  if (!rows.length) {
    // معاينةٌ بلا صفوف عرض: يبقى الملخّص، ويُقال صراحةً أن التفصيل غير متاح — ولا يُختلق.
    return `<div class="alert warning">تفصيلُ هذا الطلب غير متاح للعرض. لا تؤكّده حتى تراجعه مع من طلبه، أو ارفضه واطلب عرضه من جديد.</div>`;
  }
  const hasBefore = rows.some((r) => r.before_ar != null);
  return `<div class="tblwrap"><table class="tbl">
    <thead><tr><th>ما يتغيّر</th>${hasBefore ? '<th>قبل</th>' : ''}<th>${hasBefore ? 'بعد' : 'القيمة'}</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td>${esc(r.field_ar)}${r.note_ar ? `<div class="muted" style="font-size:.85em;margin-top:.25rem">${esc(r.note_ar)}</div>` : ''}</td>
      ${hasBefore ? `<td>${esc(r.before_ar == null ? '—' : String(r.before_ar))}</td>` : ''}
      <td><strong>${esc(r.after_ar == null ? '—' : String(r.after_ar))}</strong></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function card(row) {
  const what = TOOL_AR[row.applyTool] || 'تغيير في سند';
  const subject = row.preview?.subject_ar || null;
  const summary = row.preview?.summary || null;
  return `<section class="card" style="padding:1.5rem" data-token="${esc(row.token)}">
    <h2 style="margin-bottom:.25rem">${esc(what)}</h2>
    ${subject ? `<p class="muted" style="margin-top:0">${esc(subject)}</p>` : ''}
    <p><strong>طلبه:</strong> ${esc(row.askedByClient || 'مساعد مرتبط بحسابك')} · <strong>وقت الطلب:</strong> <span class="tnum">${esc(riyadhStamp(row.at))}</span></p>
    <p class="muted">صالح للتأكيد حتى <span class="tnum">${esc(riyadhStamp(row.expiresAt))}</span> — بعدها يسقط الطلب ولا يُنفَّذ.</p>
    ${summary ? `<div class="alert info" style="margin:1rem 0">${esc(summary)}</div>` : ''}
    <h3>ما الذي ستوافق عليه بالضبط</h3>
    ${changeTable(row.preview)}
    <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.25rem">
      <button class="btn btn-primary" data-action="confirm-change" data-token="${esc(row.token)}">أؤكّد التنفيذ</button>
      <button class="btn" data-action="reject-change" data-token="${esc(row.token)}">أرفض</button>
      <span class="muted" data-role="row-status" role="status" aria-live="polite"></span>
    </div>
  </section>`;
}

export async function aiChangesPage(user) {
  let rows = [];
  let failed = false;
  try { rows = await listAwaiting(user); } catch { failed = true; }

  const list = failed
    ? '<div class="alert warning">تعذّر عرض ما ينتظرك الآن. أعد تحميل الصفحة، وإن تكرّر الأمر فأبلغ مدير النظام.</div>'
    : rows.length
      ? rows.map(card).join('')
      : `<div class="card" style="padding:2rem;text-align:center">
          <h2>لا شيء ينتظر تأكيدك</h2>
          <p class="muted">حين يطلب مساعدك المرتبط تغييراً في سند، يقف الطلب هنا حتى تقرأه وتؤكّده بنفسك. ولا يُكتب شيء قبل ضغطتك.</p>
        </div>`;

  const body = `<div style="display:grid;gap:1rem;max-width:900px;margin:auto">
    <div class="alert info">المساعدُ المرتبط بحسابك <strong>لا يغيّر شيئاً في سند وحده</strong>. كل تغيير يطلبه يقف هنا بتفصيله، فتقرأه ثم تؤكّده أو ترفضه — والقراران يُسجَّلان باسمك.</div>
    ${list}
    <p class="muted">تُدار الروابط من صفحة «ربط المساعد»، ويمكنك قطع أي ربط متى شئت.</p>
  </div>`;

  return layout({
    user, active: 'ai-changes', title: 'تغييرات تنتظر تأكيدك',
    subtitle: 'اقرأ ما سيتغيّر بالتفصيل قبل أن تأذن به', body,
    scripts: ['/static/pages/ai-changes.js'],
  });
}
