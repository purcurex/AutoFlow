# AutoFlow Security Risk Register

## Active Accepted Risk: ExcelJS Transitive UUID Advisory

| Field | Value |
| --- | --- |
| Status | Accepted temporarily with monitoring |
| Severity | Moderate |
| Dependency path | `exceljs@4.4.0 -> uuid@8.3.2` |
| Advisory | `GHSA-w5hq-g745-h8pq` |
| Affected API | UUID v3/v5/v6 when a caller supplies a target buffer |
| AutoFlow observed use | ExcelJS imports and calls only `uuid.v4()` without a supplied buffer in its conditional-formatting serializer |
| Production exposure | Legacy authenticated business-record Excel export only |
| High/Critical audit status | None |

## Decision

`npm audit fix --force` proposes downgrading ExcelJS from 4.4.0 to 3.4.0. That is a breaking dependency change and does not match the affected call path used by AutoFlow. A forced downgrade is therefore not accepted without export compatibility regression testing.

The application does not directly import the vulnerable nested UUID package. Repository inspection confirms ExcelJS uses `uuid.v4()` without the affected buffer argument. The residual practical risk is lower than the generic advisory score, but it remains tracked until ExcelJS publishes a compatible dependency update or the legacy Excel endpoint is replaced.

## Controls And Exit Criteria

- CI fails on high or critical production dependency findings.
- The two moderate findings remain visible in every production audit.
- Do not add direct calls to the nested UUID package.
- Re-evaluate on every ExcelJS release or when replacing the legacy record export.
- Close this risk only after `npm audit --omit=dev` reports no affected ExcelJS UUID path and Excel export regression tests pass.
