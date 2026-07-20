// Shared module-scope helpers used across the SSR page files (moved verbatim from pages.js).
import { fmtSar } from '../../core/util/ids.js';

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
export const bar = (p, color = '#2563eb') => `<div class="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
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

export function noticeCard(title, msg, backHref = '/', backLabel = 'العودة') {
  return `<div style="max-width:440px;margin:64px auto;text-align:center;background:#fff;border:1px solid var(--line);border-radius:16px;padding:40px 32px;box-shadow:0 4px 24px rgba(15,23,42,.05)">
    <div style="font-size:16px;font-weight:700;color:#0f172a">${title}</div>
    <div style="font-size:13px;color:var(--muted);margin-top:8px;line-height:1.7">${msg}</div>
    <a href="${backHref}" style="display:inline-block;margin-top:20px;background:linear-gradient(120deg,#2563eb,#9333ea);color:#fff;text-decoration:none;padding:9px 22px;border-radius:10px;font-size:13px;font-weight:600">${backLabel}</a>
  </div>`;
}
