// بوّابة صادرات وحدة الفريق والموارد (ADR-0016) — تُعاد تصديرها من `src/web/pages.js`.
// المسارات: /app/team (البوابة) · /app/team/:section · /app/team/:section/:id — انظر routes.js.
export { teamGatewayPage } from './gateway.js';             // S01
export { resourcesPage } from './resources.js';             // S02 + S03 (المعاينة الجانبية)
export { resourceProfilePage } from './profile.js';         // S04–S08 + S10 (+ S09 نموذج المورد)
export { teamOrgPage } from './org.js';                     // S11
export { teamWorkPage } from './work.js';                   // S12
export { planningPage } from './planning.js';               // S13 + S14 + S15
export { requestsPage, requestDetailPage } from './requests.js';   // S16
export { analysisPage, analysisCasePage } from './analysis.js';    // S17 + S18
export { needsPage, needCandidatesPage } from './needs.js';        // S19 + S20 + S21
export { closePage, closeResourcePage } from './close.js';         // S22 + S24 + S25 · S23
