// Shared module-scope helpers used across the SSR page files (moved verbatim from pages.js).
import { fmtSar } from '../../core/util/ids.js';
import { yearElapsedPct, targetToDate, paceDelta, requiredRunRate } from '../../core/reports/metrics.js';
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

// ── بطاقة «الإيقاع مقابل الخطة» (v2.1) — البديل الوحيد لمقارنة محقق/مستهدف/متوقع ──
// المبدأ: مقياس الشريط = المستهدف السنوي فقط (100% = الهدف). المحقق تعبئة، وموضع اليوم
// نقطة ذهبية عند «انقضى N% من السنة». المتوقع نهاية السنة سطر نصي بمعادلة معلنة — لا يُرسم
// على الشريط أبداً كي لا يُصغّر المحقق بصرياً (عيب D3 الذي رصده المالك).
export function paceCard({ label, actual = 0, target = 0, forecast = null, weightedOpen = null, today = new Date(), year, color = 'var(--brand)', dd = null }) {
  const elapsed = yearElapsedPct(today, year);
  const delta = paceDelta(actual, target, today, year);
  const runRate = requiredRunRate(actual, target, today, year);
  const attainPct = target ? Math.round((actual / target) * 100) : null;
  const chip = delta == null ? ''
    : delta >= 3 ? `<span class="pace-chip up">متقدم عن الخطة الزمنية بـ<b class="tnum">${delta}</b> ${delta >= 3 && delta <= 10 ? 'نقاط' : 'نقطة'}</span>`
    : delta <= -3 ? `<span class="pace-chip down">متأخر عن الخطة الزمنية بـ<b class="tnum">${Math.abs(delta)}</b> ${Math.abs(delta) >= 3 && Math.abs(delta) <= 10 ? 'نقاط' : 'نقطة'}</span>`
    : '<span class="pace-chip flat">على الخطة الزمنية</span>';
  // فوق 3 أضعاف الهدف يصبح الرقم إنذار مراجعة لا بشرى — احتمالات الفرص أو الهدف يحتاج تدقيقاً
  const fcRatio = target && forecast ? forecast / target : null;
  const overTgt = fcRatio == null || fcRatio <= 1.05 ? ''
    : fcRatio <= 3 ? `<span class="pace-chip up" data-tip="المتوقع نهاية السنة يتجاوز الهدف">قد يبلغ ${fcRatio.toFixed(1)} ضعف الهدف</span>`
    : `<span class="pace-chip flat" data-tip="المتوقع = المحقق + المرجّح من الفرص المفتوحة — فجوة بهذا الحجم تعني عادة أهدافاً غير محدّثة أو احتمالات فوز مبالغاً فيها">المتوقع يفوق الهدف بأكثر من ٣ أضعاف — راجع الهدف أو احتمالات الفرص</span>`;
  const track = target ? `
    <div class="pace-bar" role="img" aria-label="المحقق ${attainPct}% من الهدف، وانقضى ${elapsed}% من السنة">
      <span class="fill" style="width:${Math.min(100, attainPct)}%;background:${color}"></span>
      <span class="now" style="inset-inline-start:${Math.min(100, elapsed)}%" title="نحن هنا — انقضى ${elapsed}% من السنة">${nowDot('')}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:var(--fs-micro);color:var(--muted);margin-top:.35rem">
      <span>الهدف السنوي <b class="tnum">${fmtSar(target)}</b> · حقّقنا <b class="tnum">${attainPct}%</b></span>${chip}
    </div>`
    : '<div style="font-size:var(--fs-micro);color:var(--faint);margin-top:.2rem">لا هدف مسجّل لهذه السنة — يُسجَّل من إدارة الهيكل</div>';
  const fcLine = forecast != null && target ? `
    <div style="display:flex;justify-content:space-between;gap:.6rem;font-size:var(--fs-micro);color:var(--muted);margin-top:.45rem;padding-top:.45rem;border-top:1px dashed var(--line)">
      <span data-tip="المعادلة: المحقق حتى الآن ${fmtSar(actual)} + المرجّح من الفرص المفتوحة ${fmtSar(weightedOpen || 0)}">المتوقع نهاية السنة <b class="tnum" style="color:var(--ink2)">${fmtSar(forecast)}</b> ⓘ</span>
      ${runRate != null && runRate > 0 ? `<span>المطلوب شهرياً للمتبقي <b class="tnum" style="color:var(--ink2)">${fmtSar(runRate)}</b></span>` : runRate === 0 ? '<span style="color:var(--green);font-weight:700">بلغنا الهدف ✓</span>' : ''}
    </div>` : runRate != null && target ? `
    <div style="font-size:var(--fs-micro);color:var(--muted);margin-top:.45rem;padding-top:.45rem;border-top:1px dashed var(--line)">
      ${runRate > 0 ? `المطلوب شهرياً للمتبقي <b class="tnum" style="color:var(--ink2)">${fmtSar(runRate)}</b>` : '<span style="color:var(--green);font-weight:700">بلغنا الهدف ✓</span>'}
    </div>` : '';
  return `<div ${dd ? `class="cardclick" role="button" tabindex="0" onclick="Sanad.openDD('${dd}')"` : ''} style="padding:.7rem .9rem;border:1px solid var(--line);border-radius:12px;background:#fff">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:.6rem;margin-bottom:.4rem">
      <span style="font-size:var(--fs-body);font-weight:700">${label} ${dd ? '<span style="color:var(--faint)">⊕</span>' : ''}</span>
      <span class="tnum" style="font-weight:800;font-size:var(--fs-num-sm);color:${color}">${fmtSar(actual)}</span>
    </div>
    ${track}${overTgt ? `<div style="margin-top:.3rem">${overTgt}</div>` : ''}${fcLine}
  </div>`;
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
