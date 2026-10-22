# ECharts API Audit and Repository Release Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the integration work. Independent frontend and backend contract investigations use superpowers:dispatching-parallel-agents; no shared business-source edits.

**Goal:** Diagnose every current ECharts feature, publish field-level integration requirements in Markdown, self-contained HyperZone HTML and OpenAPI 3.1.1 JSON, update README, and commit/push the current project.

**Architecture:** Trace UI → frontend API → authenticated controller → scoped service → demo/live provider. Keep implementation evidence separate from proposed FOP requirements. Render human-readable field dictionaries from the same OpenAPI schema to reduce contract drift.

**Tech Stack:** Vue 3, ECharts 6, TypeScript, NestJS, PostgreSQL, OpenAPI 3.1.1, HyperZone shared HTML renderer.

**Spec:** User request in the current chat (2026-10-22): comprehensive ECharts diagnosis, field-level API requirements as local MD/HTML, updated README, Git commit/push with local project authoritative.

## Global Constraints

- Preserve current business implementation and existing user changes; report diagnostic findings rather than silently redesigning business behavior.
- Use existing checkout; user explicitly authorized submitting its accumulated changes and resolving remote discrepancies in favor of local files.
- No credentials, databases, runtime logs or dependency/build folders in the commit.
- HTML uses `/Library/VSCode/.hyperzone/html-style/STANDARD.md`, embedded shared CSS and transparent SVG logo.
- Real FOP endpoints/field IDs not supplied by the user must be marked pending mapping, never invented as existing Kingdee operations.

## Review Focus

- Scope consistency between charts, totals, customer search, drill-down and per-user permissions.
- Payment date UTC+8 vs browser/server date boundaries, missing data, previous December and division by zero.
- Customer amount totals, Top 10 plus Other, warehouse split and currency policy.
- Parameter validation, response/error shapes, nullable/optional fields and schema examples.
- Remote divergence and accidental inclusion of local secrets/generated runtime data.

## Tasks

- [x] Inventory all charts and audit implementation with source/test evidence in `docs/analytics/ECHARTS_FRONTEND_AUDIT.md`.
- [x] Audit backend contracts and produce `docs/openapi/hyperzone-analytics.openapi.json` plus `docs/analytics/ECHARTS_BACKEND_CONTRACT_AUDIT.md`.
- [x] Integrate `docs/analytics/HYPERZONE_ECHARTS_API_REQUIREMENTS.md` and matching `.html`; include field dictionary, FOP mapping checklist, issues and acceptance cases.
- [x] Rewrite `README.md` around current platform features, independent permissions, demo/live boundaries and reproducible deployment/verification commands.
- [x] Run lint, unit tests, E2E where available, production compilation, OpenAPI validation and HTML structural review; record actual outcomes. File-URL browser preview was blocked by the tool security policy and is explicitly excluded from completed verification.

Release sequence: review staged scope and commit the local snapshot, merge fetched remote history with the `ours` strategy while verifying the tree is unchanged, then push normally and compare local/remote commit IDs. Remote deployment files already exist locally; this retains history while making local content authoritative. Final Git execution results are recorded in the delivery message and Git history.

## Execution rulings

- User requested direct execution; no additional plan approval gate is necessary.
- This is a diagnosis/documentation/release task, not an authorization to implement every possible production integration gap discovered.
