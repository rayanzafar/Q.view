// مركز البيانات — تصدير واستيراد سجلات العمل (الفرص، المشاريع، العملاء، الموظفون، التسكين، الإيراد).
// الصفحة SSR بالكامل؛ معالج الاستيراد (رفع → مطابقة الأعمدة → معاينة → تأكيد) تقوده
// /static/pages/imports.js عبر تفويض data-action — بلا أي onclick مضمّن.
import { layout, pill } from '../layout.js';
import { icon } from '../icons.js';
import { G } from '../i18n/glossary.js';
import { esc } from './_shared.js';
import { listTypes, listRuns } from '../../modules/io/engine.js';

const STATUS_AR = {
  uploaded: 'بانتظار الإكمال', previewed: 'تمت المعاينة', applied: 'منفَّذة',
  undone: 'تم التراجع', failed: 'فشلت', discarded: 'أُلغيت',
};
const STATUS_TONE = { applied: 'green', undone: 'slate', failed: 'red', previewed: 'blue', uploaded: 'amber', discarded: 'slate' };
const MODE_AR = { add: G.importAdd, upsert: G.importUpsert, replace: G.importReplace };
const TYPE_ICON = { clients: 'client', employees: 'team', opportunities: 'opportunity', projects: 'projects', staffing: 'users', revenues: 'money' };

const fmtAt = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '—');

function countsLine(c) {
  if (!c) return '—';
  const parts = [];
  if (c.create) parts.push(`أُضيف <b class="tnum">${c.create}</b>`);
  if (c.update) parts.push(`حُدّث <b class="tnum">${c.update}</b>`);
  if (c.skip) parts.push(`تُجوهل <b class="tnum">${c.skip}</b>`);
  if (c.error) parts.push(`<span style="color:var(--red)">أخطاء <b class="tnum">${c.error}</b></span>`);
  return parts.length ? parts.join(' · ') : `<span class="tnum">${c.total ?? 0}</span> صف`;
}

export async function importsPage(user, opts = {}) {
  const types = listTypes(user);
  const runs = await listRuns(user, {});

  // ── (1) بطاقات الأنواع ──
  const typeCards = types.map((t) => `
    <div class="card" style="padding:1rem 1.1rem;display:flex;flex-direction:column;gap:.7rem">
      <div style="display:flex;align-items:center;gap:.6rem">
        <div style="width:36px;height:36px;border-radius:10px;background:var(--brand-grad);color:#fff;display:flex;align-items:center;justify-content:center;flex:none">${icon(TYPE_ICON[t.type] || 'upload')}</div>
        <div style="min-width:0">
          <div style="font-weight:800;font-size:14px">${esc(t.labelAr)}</div>
          <div style="font-size:11px;color:var(--muted)"><span class="tnum">${t.columns.length}</span> عمود${t.canImport ? '' : ' · قراءة فقط'}</div>
        </div>
      </div>
      <div style="display:flex;gap:.45rem;flex-wrap:wrap;margin-top:auto">
        ${t.canExport ? `<a class="btn btn-sm" href="/api/io/export/${esc(t.type)}?format=xlsx">${icon('download')} ${G.exportData}</a>` : ''}
        ${t.canImport ? `<a class="btn btn-sm" href="/api/io/export/${esc(t.type)}?format=xlsx&template=1">${G.downloadTemplate}</a>` : ''}
        ${t.canImport ? `<button class="btn btn-sm btn-primary" data-action="io-start" data-type="${esc(t.type)}">${icon('upload')} ${G.importData}</button>` : ''}
      </div>
    </div>`).join('');

  // ── (2) معالج الاستيراد (يُظهره ويقوده /static/pages/imports.js) ──
  const steps = ['رفع الملف', G.mapping, G.preview, G.confirmImport];
  const wizard = `
  <style>
    .io-steps{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;padding:.8rem 1.1rem;border-bottom:1px solid var(--line)}
    .io-step{display:flex;align-items:center;gap:.45rem;font-size:12px;font-weight:700;color:var(--faint)}
    .io-step .n{width:22px;height:22px;border-radius:50%;background:#eef1f7;color:var(--muted);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex:none}
    .io-step.on{color:var(--brand)}.io-step.on .n{background:var(--brand);color:#fff}
    .io-step.done{color:var(--green)}.io-step.done .n{background:#dcfce7;color:var(--green)}
    .io-sep{width:26px;height:2px;background:var(--line);border-radius:2px}
    .io-map-table td{padding:.45rem .6rem;border-bottom:1px dashed var(--line);font-size:12.5px;vertical-align:top}
    .io-map-table th{padding:.45rem .6rem;font-size:11px;color:var(--muted);text-align:right}
    .io-drop{border:2px dashed var(--line);border-radius:14px;padding:2rem 1rem;text-align:center;color:var(--muted);cursor:pointer;transition:all .15s}
    .io-drop:hover,.io-drop.drag{border-color:var(--brand);background:#f4f7ff;color:var(--brand)}
    .io-stat{flex:1;min-width:110px;border:1px solid var(--line);border-radius:12px;padding:.6rem .8rem;text-align:center}
    .io-stat .v{font-size:1.4rem;font-weight:800;letter-spacing:-.02em}
    .io-stat .l{font-size:11px;color:var(--muted);font-weight:700}
  </style>
  <div id="io-wizard" class="card" style="display:none;margin-bottom:1.1rem;overflow:hidden">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.1rem;border-bottom:1px solid var(--line)">
      <div style="font-weight:800;font-size:14.5px">${G.importData} — <span id="io-wz-type"></span></div>
      <button class="btn btn-ghost btn-sm" data-action="io-close" aria-label="${G.cancel}">✕</button>
    </div>
    <div class="io-steps">
      ${steps.map((s, i) => `${i ? '<span class="io-sep"></span>' : ''}<span class="io-step" data-step="${i + 1}"><span class="n">${i + 1}</span>${esc(s)}</span>`).join('')}
    </div>
    <div id="io-wz-body" style="padding:1.1rem"></div>
  </div>`;

  // ── (3) سجل العمليات ──
  const runRows = runs.map((r) => `
    <tr style="border-bottom:1px solid var(--line)">
      <td style="padding:.6rem .75rem;font-size:13px;font-weight:700">${esc(r.typeLabel)}
        ${r.fileName ? `<div style="font-size:10.5px;color:var(--faint);font-weight:400;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.fileName)}</div>` : ''}</td>
      <td style="padding:.6rem .75rem;font-size:12px">${esc(MODE_AR[r.mode] || r.mode)}</td>
      <td style="padding:.6rem .75rem">${pill(esc(STATUS_AR[r.status] || r.status), STATUS_TONE[r.status] || 'slate')}
        ${r.status === 'failed' && r.error ? `<div style="font-size:10.5px;color:var(--red);max-width:240px">${esc(r.error)}</div>` : ''}</td>
      <td style="padding:.6rem .75rem;font-size:12px">${countsLine(r.counts)}</td>
      <td style="padding:.6rem .75rem;font-size:12px;color:var(--muted)">${esc(r.by || '—')}</td>
      <td style="padding:.6rem .75rem;font-size:12px;color:var(--muted)" class="tnum">${fmtAt(r.appliedAt || r.createdAt)}</td>
      <td style="padding:.6rem .75rem">${r.canUndo ? `<button class="btn btn-sm" data-action="io-undo" data-run="${esc(r.id)}">${G.undoImport}</button>` : ''}</td>
    </tr>`).join('');

  const runsTable = runs.length ? `
    <div class="tblwrap"><table style="width:100%;border-collapse:collapse">
      <thead><tr style="font-size:11px;color:var(--muted);text-align:right">
        <th style="padding:.5rem .75rem;font-weight:700">النوع</th>
        <th style="padding:.5rem .75rem;font-weight:700">الوضع</th>
        <th style="padding:.5rem .75rem;font-weight:700">الحالة</th>
        <th style="padding:.5rem .75rem;font-weight:700">الأعداد</th>
        <th style="padding:.5rem .75rem;font-weight:700">بواسطة</th>
        <th style="padding:.5rem .75rem;font-weight:700">متى</th>
        <th style="padding:.5rem .75rem;font-weight:700"></th>
      </tr></thead><tbody>${runRows}</tbody></table></div>` : `
    <div class="empty-state">${icon('history')}
      <div class="t">${G.emptyList}</div>
      <div class="s">ابدأ بتصدير ملف Excel لأي نوع أعلاه، أو حمّل القالب الفارغ واستورد بياناتك الأولى.</div>
    </div>`;

  const importables = types.filter((t) => t.canImport);
  const body = `
    ${importables.length ? '' : `<div class="alert info" style="margin-bottom:1rem">${icon('check')} صلاحيتك الحالية تتيح التصدير فقط — الاستيراد يتطلب صلاحية إضافة أو تعديل على النوع.</div>`}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:.8rem;margin-bottom:1.2rem">
      ${typeCards || `<div class="empty-state">${icon('upload')}<div class="t">لا أنواع متاحة</div><div class="s">لا تملك صلاحية تصدير أو استيراد أي نوع من البيانات بعد.</div></div>`}
    </div>
    ${wizard}
    <div class="card" style="overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.85rem 1.1rem;border-bottom:1px solid var(--line)">
        <div style="font-weight:800;font-size:14px">${G.importLog}</div>
        <div style="font-size:11px;color:var(--muted)">${G.undoImport} متاح خلال 7 أيام من التنفيذ</div>
      </div>
      ${runsTable}
    </div>
    <script>window.__SANAD = Object.assign(window.__SANAD || {}, { io: ${JSON.stringify({
      types, isAdmin: user.role_id === 'admin',
    }).replace(/</g, '\\u003c')} });</script>`;

  return layout({
    user, active: 'imports', title: G.dataCenter,
    subtitle: 'تصدير واستيراد سجلات العمل — بمعاينة قبل التنفيذ وإمكانية التراجع',
    body, year: opts.year, scripts: ['/static/pages/imports.js'],
  });
}
