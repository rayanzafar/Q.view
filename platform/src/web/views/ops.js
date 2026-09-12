// «صحة المنصة» — الأعطال المسجَّلة، لمدير النظام وحده.
//
// وقاعدةُ العرض الحاكمة: **لا نصَّ عطبٍ خام ولا أثرَ استدعاءٍ يبلغ الشاشة.** الحارس الفعلي
// ليس فاحص المعجم (يقرأ الثوابت وحدها فلا يرى قيمةً محقونة) بل مسحُ ما بعد النشر: يقرأ
// النصَّ المعروض بحثاً عن كلماتٍ محظورة، فأولُ رسالةٍ إنجليزية من المُشغّل تُحمّر النشرة.
// فيُترجَم كلُّ عطبٍ من جدولٍ عربي، ويُعرض معه **رمزٌ قصير ست عشري** هو المعرّف الوحيد —
// وأبجديّةُ الست عشرة لا تستطيع تهجئة كلمةٍ محظورة، فالسلامة بالبناء لا بالحظّ. ومن أراد
// الأثر الكامل نسخ الرمز وبحث به في سجل المستضيف.
import { layout, card, pill } from '../layout.js';
import { esc, statMini } from './_shared.js';
import { faultGroups, faultStats } from '../../core/obs/store.js';
import { shortCode } from '../../core/obs/fingerprint.js';
import { faultLabel, faultSurfaceLabel, faultKindLabel } from '../i18n/glossary.js';
import { roleLabelAr } from '../../core/obs/severity.js';
import { countAr } from '../../core/i18n/plural.js';

const rel = (iso) => {
  const s = String(iso || '').slice(0, 19);
  if (!s) return '—';
  const mins = Math.round((Date.now() - Date.parse(s + 'Z')) / 60000);
  if (!Number.isFinite(mins)) return '—';
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${countAr(mins, { one: 'دقيقة', two: 'دقيقتين', few: 'دقائق', many: 'دقيقة' })}`;
  const h = Math.round(mins / 60);
  if (h < 24) return `قبل ${countAr(h, { one: 'ساعة', two: 'ساعتين', few: 'ساعات', many: 'ساعة' })}`;
  const d = Math.round(h / 24);
  return `قبل ${countAr(d, { one: 'يوم', two: 'يومين', few: 'أيام', many: 'يوماً' })}`;
};

export async function opsPage(user, opts = {}) {
  const [stats, groups] = await Promise.all([faultStats(), faultGroups({ limit: 120 })]);

  const band = `<div class="kpi4">
    ${statMini('أعطال ظهرت اليوم', String(stats.today), 'مجموعات ظهرت خلال اليوم الماضي')}
    ${statMini('مجموعات مفتوحة', String(stats.groups), 'كل عطل مميَّز يُعدّ مرة واحدة مهما تكرّر')}
    ${statMini('أصابت قيادة', String(stats.senior), 'أعطال أصابت قائد قطاع أو أعلى — تُقرأ أولاً')}
    ${statMini('آخر عطل', rel(stats.lastAt), stats.lastAt ? 'منذ آخر ظهور' : 'لا أعطال مسجَّلة')}
  </div>`;

  const row = (g) => {
    const muted = !!g.muted_at;
    const who = g.last_role ? (roleLabelAr(g.last_role) || 'غير محدَّد') : '—';
    return `<tr${muted ? ' style="opacity:.55"' : ''}>
      <td style="white-space:nowrap">${esc(rel(g.last_at))}</td>
      <td><div style="font-weight:700">${esc(faultLabel(g))}</div>
        <div style="font-size:var(--fs-micro);color:var(--faint)">${esc(faultKindLabel(g.kind))}</div></td>
      <td style="max-width:22ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(faultSurfaceLabel(g))}">${esc(faultSurfaceLabel(g))}</td>
      <td class="tnum" style="text-align:center;font-weight:700">${Number(g.hits) || 0}</td>
      <td>${g.top_role_rank >= 2 ? pill(esc(who), 'amber') : `<span style="color:var(--muted)">${esc(who)}</span>`}</td>
      <td><code dir="ltr" style="background:var(--surface2,#f1f5f9);border:1px solid var(--line);border-radius:6px;padding:.1rem .35rem;font-size:11px">${esc(shortCode(g.fingerprint))}</code></td>
      <td><button class="btn btn-ghost btn-sm" data-action="fault-mute" data-fp="${esc(g.fingerprint)}" data-muted="${muted ? '1' : '0'}">${muted ? 'إلغاء الإسكات' : 'إسكات'}</button></td>
    </tr>`;
  };

  const table = groups.length ? card(`<div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:var(--fs-body)">
      <thead><tr style="position:sticky;top:0;background:var(--surface);text-align:right">
        <th style="padding:.5rem">آخر ظهور</th><th style="padding:.5rem">ما الذي حدث</th>
        <th style="padding:.5rem">أين</th><th style="padding:.5rem;text-align:center">كم مرة</th>
        <th style="padding:.5rem">من تأثّر</th><th style="padding:.5rem">رمز العطل</th><th></th>
      </tr></thead>
      <tbody>${groups.map(row).join('')}</tbody>
    </table></div>`)
    : card(`<div class="empty-state">
        <div class="t">لا أعطال مسجَّلة</div>
        <div class="s">كل شيء يعمل. يظهر هنا كل عطل تصادفه المنصة، مجموعاً بنوعه لا مكرَّراً بعدد وقوعه.</div>
      </div>`);

  const note = card(`<div style="padding:.8rem 1rem;font-size:var(--fs-meta);color:var(--muted);line-height:1.9">
    يُعرض هنا كل عطل، بما فيها أعطال البريد نفسه — ولا يُخفى شيء.
    ولقراءة التفصيل التقني انسخ «رمز العطل» وابحث به في سجل الخادم.
    والقائمة تُكنَس تلقائياً: تبقى الأعطال ثلاثين يوماً، وتُحفظ أحدث خمسمئة مجموعة.
  </div>`);

  const body = `${band}${note}${table}`;
  return layout({ user, active: 'ops', title: 'صحة المنصة',
    subtitle: stats.groups ? `${countAr(stats.groups, { one: 'عطل مفتوح', two: 'عطلان مفتوحان', few: 'أعطال مفتوحة', many: 'عطلاً مفتوحاً' })}` : 'لا أعطال مسجَّلة',
    body, year: opts.year, scripts: ['/static/pages/ops.js'] });
}
