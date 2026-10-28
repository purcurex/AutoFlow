# Dispatch number and sequential status plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation and a final independent review.

**Goal:** Show dispatch document numbers separately and one current stage: 未创建 → 暂存 → 已提交 → 已审核 → 已同步.
**Architecture:** Reuse dispatchDocuments[].number and normalized fulfillmentProgress.shopifySync. Preserve raw A/B/C document state. Derive synchronized terminal state only after all linked documents are approved and confirmed Shopify sync. Existing pending dashboard predicate stays unchanged; taskStatus=dispatch_synced explicitly queries completed dispatch records within identical user scope.
**Tech Stack:** Vue, NestJS, TypeScript, ExcelJS, OpenAPI.
**Spec:** Latest user request plus requirements9.17 and confirmed FOP sync validation (approved C required; actual platform success before writeback).

## Constraints and decisions
- Default dispatch list remains pending; default status option says 全部待履约. Synced filter clearly labels completed results, does not add to Dashboard backlog.
- Add 发运单编号 immediately before 发运单状态, preserve products as column2, all document numbers visible in the new column. Dispatch status has no extra details/disclosure.
- Multiple documents: earliest known current stage; any missing/unknown fact stays 待确认. This fallback is not a sixth normal business step. Procurement's 待建发运单 label remains unchanged.
- Server filtering, permissions, sorting, totals and both exports stay aligned. No FOP writes or new production adapter.

## Review focus
- Synced must never be inferred from tracking number or document approval alone.
- Completed filter must not enlarge authorization or default dashboard queue.
- Mixed multi-doc/unknown cannot be labeled all complete.
- New number column must match totals colspan and Excel text identifiers.
- Sorting must use same sequence as displayed state.

## Tasks
- [x] Add derived terminal-state, completed dispatch query, sort and export behavior; regression tests.
- [x] Add visible number column and direct current-status badge, filter labels and completed-list context; UI tests.
- [x] Update API/requirements and generated MD/HTML; test, lint/build, browser verification and independent review.

## Completion ledger

- Terminal-state regression initially failed because the old helper had no sync input; implemented normalized sync derivation and covered pending/unknown/multi-document cases.
- Final frontend330/backend544/HTTP146 tests passed. Lint and build passed; independent reviewer found no material issue.
- Browser: default129 pending records preserved; explicit synced filter shows626 demo completed records with separate number and direct status columns.
- OpenAPI427 examples validated; production FOP adapter remains pending IT integration. No Git commit requested for this turn.
