// Inline SVG line icons (24px, stroke-based) — no external requests. Consistent 1.75 stroke.
const P = {
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
};
export function icon(name, cls = '') {
  const body = P[name] || P.tasks;
  return `<svg class="${cls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
