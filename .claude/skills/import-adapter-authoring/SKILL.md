---
name: import-adapter-authoring
description: How to write an import/export adapter for the Sanad io engine (columns contract, key fields, validate/diff/apply via services, undo support). Load before adding or changing any adapter in src/modules/io/adapters.
---
# Writing a Sanad import/export adapter

An adapter makes one data type importable/exportable through the shared engine (`src/modules/io/engine.js`). The engine owns parsing, mapping UI, preview, tx, import_run/import_row bookkeeping, and undo — the adapter only describes the type.

## Adapter contract (export default object)
```js
export default {
  type: 'opportunities',                 // URL segment + import_run.type
  labelAr: 'الفرص',
  permission: { resource: 'opportunity' },// engine checks can(user,'read'|resource) for export,
                                          // can(user,'create'/'update', resource) per-row for import
  keyFields: ['code'],                    // duplicate detection & upsert identity (fallbacks allowed:
                                          // e.g. ['code'] then ['title_ar','client'])
  columns: [                              // ORDER = template column order
    { key: 'code',      labelAr: 'الكود', aliases: ['رقم الفرصة','code'], required: false },
    { key: 'title_ar',  labelAr: 'العنوان', required: true },
    { key: 'value_sar', labelAr: 'القيمة (ريال)', parse: 'money', min: 0 },
    { key: 'stage',     labelAr: 'المرحلة', parse: 'lookup', lookup: 'stage' },   // by name_ar or id
    { key: 'sector',    labelAr: 'القطاع', parse: 'lookup', lookup: 'sector' },
    { key: 'owner',     labelAr: 'المسؤول', parse: 'lookup', lookup: 'user' },
    // …
  ],
  async fetchRows(user, filters) { … },   // EXPORT: scope-filtered SELECT → array of plain objects
                                          // (redact sensitive fields the caller may not read!)
  async resolveRow(ctx, mapped) { … },    // return {action:'create'|'update'|'skip', existing?, reason?}
  async applyRow(ctx, mapped, resolved) { // MUST go through the existing services (createOpportunity,
    …                                     // updateOpportunity, moveStage …) — never raw insert/update.
  },                                      // return {resource:'opportunity', resourceId, before, after}
  async undoRow(ctx, row) { … },          // invert one import_row: create→soft delete; update→restore
                                          // before_json via the service update
};
```

## Parse types the engine provides
`money` (SAR → halalas, accepts Arabic-Indic digits + thousands separators), `int`, `pct` (0–100), `date` (accepts DD/MM/YYYY, YYYY-MM-DD; emits ISO date), `text` (trimmed, bidi-safe), `lookup` (resolve by exact id, code, or normalized name_ar; unresolved = row error listing the closest matches).

## Rules
- Errors are Arabic + cell-addressed: `الصف ${n}: ${labelAr} — ${problem} (${how_to_fix})`.
- NEVER bypass services in applyRow: RBAC, audit, stage-history, and derived records must fire exactly as if the user did it in the UI.
- Export must round-trip: `fetchRows` output re-imported with the same adapter yields 100% `skip` (no diff). There is a test helper for this — add your type to `tests/unit/import-engine.test.js` round-trip cases.
- Sensitive columns (salary…) export only when `canSeeSensitive`; otherwise omit the column entirely (not empty values).
- Formula-injection guard is engine-side (cells starting with = + - @ are prefixed on export) — don't disable it.
