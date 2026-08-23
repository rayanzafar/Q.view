// Inline SVG line icons (24px, stroke-based) — no external requests. Consistent 1.75 stroke.
const P = {
  // تلميح معلومة: دائرة i — بديل محرف ⓘ الذي لا تحمله خطوط المنصة (v5.38)
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v4h1.5"/>',
  // «صفحتي»: شروقٌ لا منزل — الصفحة بدايةُ يومٍ لا مسكن، وشكلها يميّزها عن كل أيقونة أخرى.
  home: '<path d="M3 18h18"/><path d="M7.5 18a4.5 4.5 0 019 0"/><path d="M12 4.5v2.5M5.4 7.4l1.8 1.8M18.6 7.4l-1.8 1.8M2.5 13.5h2M19.5 13.5h2"/>',
  ceo: '<path d="M3 3v18h18"/><path d="M7 14l3-3 3 2 5-6"/>',
  portfolio: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  sector: '<path d="M3 9l9-6 9 6"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  opportunity: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  projects: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16"/>',
  tasks: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="20" cy="18" r="2"/>',
  timesheet: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  approvals: '<path d="M20 6L9 17l-5-5"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a5 5 0 015-5h2a5 5 0 015 5v2"/><path d="M17 8a3 3 0 010 6M21 21v-2a5 5 0 00-3-4.5"/>',
  reports: '<path d="M4 4h11l5 5v11a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z"/><path d="M14 4v5h5M8 13h8M8 17h5"/>',
  users: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0114 0"/>',
  audit: '<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/>',
  ai: '<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><circle cx="18" cy="17" r="1.5"/><circle cx="5" cy="16" r="1"/>',
  logout: '<path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4"/><path d="M10 12h9M13 8l-3 4 3 4"/>',
  bell: '<path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 21a2 2 0 004 0"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v5h-5"/>',
  money: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5a2.5 2 0 012.5-1.5c1.4 0 2.5.7 2.5 1.7S15 13 12 13s-2.5 1-2.5 2 1.1 1.7 2.5 1.7a2.5 2 0 002.5-1.5"/>',
  risk: '<path d="M12 3l9 16H3z"/><path d="M12 9v4M12 16v.5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  filter: '<path d="M3 5h18l-7 8v5l-4 2v-7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  kanban: '<rect x="3" y="3" width="5" height="14" rx="1"/><rect x="10" y="3" width="5" height="10" rx="1"/><rect x="17" y="3" width="4" height="17" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  flag: '<path d="M4 21V4h13l-2 4 2 4H4"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01M10 21v-4h4v4"/>',
  userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0112 0"/><path d="M18 8v6M15 11h6"/>',
  upload: '<path d="M12 15V3m0 0L8 7m4-4l4 4"/><path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  history: '<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v4h4"/><path d="M12 8v4l3 2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  client: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5 4h14l3 8v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6z"/>',
  download: '<path d="M12 3v12m0 0l4-4m-4 4l-4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  megaphone: '<path d="M21 11L3 6v12l18-4v-3z"/><path d="M12.4 16.8a3 3 0 105.8-1.6"/>',
};
export function icon(name, cls = '') {
  const body = P[name] || P.tasks;
  return `<svg class="${cls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
