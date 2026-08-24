// Shared module-scope helpers used across the SSR page files (moved verbatim from pages.js).
import { fmtSar } from '../../core/util/ids.js';
import { nowDot } from '../../core/i18n/time.js';
import { icon } from '../icons.js';
import { G } from '../i18n/glossary.js';

export const sarShort = (halalas) => {
  const v = (halalas || 0) / 100;
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (Math.abs(v) >= 1e3) return Math.round(v / 1e3) + 'K';
  return String(Math.round(v));
};

export const pct = (n) => `${Math.round(n || 0)}%`;
// HTML-escape user-controlled strings before interpolating into SSR markup (defense against stored XSS
// now that intake/manual entry accept free-text names, clients, notes).
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const bar = (p, color = 'var(--brand)') => `<div class="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
  <div style="width:${Math.min(100, Math.max(0, p))}%;background:${color}" class="h-full rounded-full"></div></div>`;

// ── Shared drill-down modal helpers (CEO dashboard + sector command center) ──
// Popups are pre-rendered inert <template>s opened by Sanad.openDD — server-computed under the
// SAME RBAC scope as the page, so nothing redacted can leak client-side.
export const ddWrap = (id, title, sub, inner) => `<template id="dd-${id}">
  <div class="modal-head"><div><div style="font-weight:800;font-size:15px">${title}</div><div style="font-size:11.5px;color:var(--muted)">${sub}</div></div>
    <button class="btn btn-ghost btn-sm" onclick="Sanad.closeModal()" aria-label="إغلاق">✕</button></div>
  <div class="modal-body">${inner}</div></template>`;
export const attain = (v, tgt, color) => tgt ? `
  <div><div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-bottom:.3rem"><span>الهدف ${fmtSar(tgt)}</span><span class="tnum" style="font-weight:800">${Math.round((v / tgt) * 100)}%</span></div>
  <div class="bar" style="height:8px"><span style="width:${Math.min(100, Math.round((v / tgt) * 100))}%;background:${color}"></span></div></div>` : '';
export const ddRows = (rows) => rows.length ? rows.join('') : '<div style="color:var(--faint);font-size:12px">لا بيانات ضمن هذا النطاق</div>';

// small stat chip used on PMO toolbars
export function statMini(label, value, sub, tone) {
  const c = tone === 'good' ? 'var(--green)' : tone === 'bad' ? 'var(--red)' : tone === 'warn' ? 'var(--amber)' : tone === 'brand' ? 'var(--brand2)' : 'var(--ink2)';
  return `<div class="card" style="padding:.6rem .9rem;min-width:130px">
    <div style="font-size:11px;color:var(--muted);font-weight:700">${label}</div>
    <div class="tnum" style="font-size:1.15rem;font-weight:800;color:${c};letter-spacing:-.02em">${value}</div>
    <div style="font-size:10.5px;color:var(--faint)">${sub || ''}</div></div>`;
}


// ── شريط عدسات مركز العمل اليومي ─────────────────────────────────────────────
// «مهامي» · «مهام فريقي» · «ملاحظاتي» · «صفحتي». مصدرٌ واحد لأن الشريط يعلو **شاشتين**
// (المهام والملاحظات): نسخةٌ ثانية منه تعني أن تُضاف عدسةٌ يوماً فتظهر في إحداهما وتغيب عن
// الأخرى — فيدخل المستخدم الملاحظات ولا يجد طريق العودة إلا زرَّ المتصفّح، وهي بعينها
// الشكوى التي عولجت على صفحة الفرصة من قبل.
// والأنماط ترافق البناء هنا لا في إحدى الشاشتين، وإلا انتقلت العدسة ولم ينتقل شكلها.
export const WORK_LENS_CSS = `
  .wc-lens{display:flex;gap:.4rem;border-bottom:1px solid var(--line);margin-bottom:.75rem;flex-wrap:wrap}
  /* «صفحتي» في الطرف المقابل: مدخلٌ واحد بلا شريطٍ جديد — الشاشة مزدحمة أصلاً بشهادة المالك.
     وهي لكل مستخدم مهما كان دوره: ملفُ المرء لا يحتاج منحاً إدارياً. */
  .wc-lens-sp{flex:1 1 auto}
  .wc-tab-me{color:var(--brand);font-weight:800}
  .wc-tab-me:hover{color:var(--brand2)}
  .wc-tab{display:inline-flex;align-items:center;gap:.4rem;padding:.5rem .85rem;font-size:13px;font-weight:700;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px}
  .wc-tab:hover{color:var(--ink2)}
  .wc-tab.on{color:var(--brand);border-bottom-color:var(--brand)}
  .wc-tab svg{width:15px;height:15px}`;

// `who` إحدى: me · team · notes. و`openCount` رقمُ عدسةٍ مفتوحة يُعرض على التبويب الحالي وحده
// (لا نَعِد برقمٍ عن شاشةٍ لم تُقرأ بعد). و`href` يُبنى من دالةٍ يمرّرها النداء كي تحافظ كل
// شاشة على بقية معاملات رابطها.
export function workLens({ userId, who, canTeam, openCount = null, href }) {
  const link = (key) => (href ? href(key) : `/app/tasks${key ? `?who=${key}` : ''}`);
  const tab = (key, label, ic, on) => `<a class="wc-tab${on ? ' on' : ''}" href="${link(key)}"${on ? ' aria-current="page"' : ''}>${icon(ic)} ${label}${on && openCount != null ? ` <span class="tnum">${openCount}</span>` : ''}</a>`;
  return `<nav class="wc-lens" aria-label="عدسة العرض">
    ${tab(null, G.myWork, 'tasks', who === 'me')}
    ${canTeam ? tab('team', G.teamWork, 'team', who === 'team') : ''}
    ${tab('notes', G.myNotes, 'edit', who === 'notes')}
    <span class="wc-lens-sp"></span>
    <a class="wc-tab wc-tab-me" href="/app/person/${encodeURIComponent(userId)}">${icon('users')} صفحتي</a>
  </nav>`;
}

export function noticeCard(title, msg, backHref = '/', backLabel = 'العودة') {
  return `<div style="max-width:440px;margin:64px auto;text-align:center;background:#fff;border:1px solid var(--line);border-radius:16px;padding:40px 32px;box-shadow:0 4px 24px rgba(15,23,42,.05)">
    <div style="font-size:16px;font-weight:700;color:#0f172a">${title}</div>
    <div style="font-size:13px;color:var(--muted);margin-top:8px;line-height:1.7">${msg}</div>
    <a href="${backHref}" style="display:inline-block;margin-top:20px;background:linear-gradient(120deg,var(--brand),var(--brand2));color:#fff;text-decoration:none;padding:9px 22px;border-radius:10px;font-size:13px;font-weight:600">${backLabel}</a>
  </div>`;
}

// ── منتقٍ بالبحث: حقلٌ يُكتب فيه وقائمةٌ تُصفّى، وخلفه قائمةُ اختيارٍ حقيقية تحمل القيمة ──
// القائمة الطويلة بلا بحث ليست قائمة: من عنده ثمانون مشروعاً يتصفّح ثمانين سطراً ليجد واحداً
// يعرف اسمه. والبحث يقبل الاسم **والرمز** معاً، فمن يحفظ رمز مشروعه لا يُجبَر على تهجّي اسمه.
//
// القيمة تبقى في `<select>` مخفيّة كما كانت: كل ما يقرأ المنتقي اليوم — الحفظ في «مهامي»
// وصفحة الشخص، وترميم «الجهة خارج نطاقك» في لوح التحرير — يقرأ `.value` نفسه ولا يتغيّر
// تحته شيء. والخياراتُ هي مصدر البحث نفسه، فلا تُبعَث نسخةٌ ثانيةٌ من القائمة إلى الصفحة
// تفترق عن الأولى يوماً.
export const PICKER_CSS = `
  .sp{position:relative;min-width:0}
  .sp-q{width:100%}
  .sp-q[aria-expanded="true"]{border-color:var(--brand);box-shadow:0 0 0 3px rgba(36,74,153,.14)}
  .sp-list{position:absolute;inset-inline:0;top:calc(100% + 4px);z-index:75;background:var(--surface);
    border:1px solid var(--line);border-radius:12px;box-shadow:0 16px 40px rgba(15,23,42,.18);
    max-height:264px;overflow:auto;padding:.35rem}
  .sp-row{display:block;width:100%;text-align:start;border:0;background:none;font:inherit;cursor:pointer;
    padding:.42rem .55rem;border-radius:8px;font-size:12.5px;color:var(--ink2);line-height:1.6}
  .sp-row:hover,.sp-row.active{background:#eef3fc;color:var(--brand)}
  .sp-row b{color:var(--brand);font-weight:800}
  .sp-code{color:var(--faint);font-size:var(--fs-micro);margin-inline-start:.3rem}
  .sp-grp{font-size:var(--fs-micro);font-weight:800;color:var(--faint);padding:.35rem .55rem .15rem}
  .sp-empty{padding:.55rem;font-size:12px;color:var(--muted);line-height:1.7}`;

// `groups` = [{ label, items: [{ value, name, code }] }] — كل عنصر يحمل قيمته المرمّزة كما هي.
// و`lead` خياراتٌ تتصدّر القائمة بلا مجموعة (العمل الداخلي والشخصي).
export function searchPicker({ idAttr, label, groups = [], lead = [], dataF = '', placeholder = '', emptyNote = '' }) {
  const opt = (o) => `<option value="${esc(o.value)}"${o.code ? ` data-code="${esc(o.code)}"` : ''}>${esc(o.code ? `${o.code} — ${o.name}` : o.name)}</option>`;
  const any = groups.some((g) => g.items.length);
  return `<div class="sp" data-picker="${esc(idAttr)}">
    <select id="${esc(idAttr)}" name="${esc(idAttr)}" autocomplete="off" hidden${dataF ? ` data-f="${esc(dataF)}"` : ''} aria-hidden="true" tabindex="-1">
      ${lead.map(opt).join('')}
      ${groups.map((g) => (g.items.length ? `<optgroup label="${esc(g.label)}">${g.items.map(opt).join('')}</optgroup>` : '')).join('')}
      ${!any && !emptyNote ? '' : (!any ? `<option value="" disabled>${esc(emptyNote)}</option>` : '')}
    </select>
    <input class="input sp-q" id="${esc(idAttr)}-q" name="${esc(idAttr)}-q" autocomplete="off" type="text"
      role="combobox" aria-expanded="false" aria-controls="${esc(idAttr)}-list" aria-autocomplete="list"
      aria-label="${esc(label)}" placeholder="${esc(placeholder || label)}">
    <div class="sp-list" id="${esc(idAttr)}-list" role="listbox" aria-label="${esc(label)}" hidden></div>
  </div>`;
}
