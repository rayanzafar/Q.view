---
description: Adversarial security review of the current diff (authz/IDOR, injection, XSS, CSRF, sensitive-field leaks, import safety) via the security-reviewer agent.
---
Collect the diff (against last deployed tag, or $ARGUMENTS). Launch the **security-reviewer** agent on it. For each CONFIRMED finding: write the exploit as a failing test first (in tests/security/), fix the root cause, prove the test passes, and keep the test. Independently verify the classics yourself on new endpoints: cross-sector IDOR as demo.sectorlead, sensitive fields as demo.bd (salary/margin/cost must be absent from JSON+HTML+exports), SQL params (`grep -n "\${" src/modules/<changed>` inside query strings), esc() coverage. Report: findings, severity, test file added, fix commit.
