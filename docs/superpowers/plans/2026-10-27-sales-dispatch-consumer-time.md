# Sales and dispatch consumer order time

> Use superpowers:executing-plans. Execute the user's explicit correction in the current checkout. No new worktree or Git commit requested.

**Goal:** Sales unpaid/review/exceptions and dispatch lists show C端下单时间 from consumerPaidAt, consistently in both Excel modes. Rename procurement labels to 待推1688采购 and 待支付采购款.
**Scope:** Consumer payment completion is distinct from FOP creation and B-end collection. Missing/invalid upstream data remains null/—. Original payment sorting, filters, totals, permissions and all other workbench date columns stay unchanged. Production FOP mapping remains IT integration work; no source edits there.

## Task 1
- [ ] Extend existing FE and Excel tests over all four queues, valid zoned value and absent value; retain another workbench creation time. Extend existing HTTP time/authorization test over four queues. Observe expected failures before implementation.
- [ ] Update FopOrdersView date label/hint/value and fop-order-export column selection; retain existing BFF normalization. Rename shared FE/BE procurement labels, keeping enum values unchanged.
- [ ] Update agent.md, requirements, OpenAPI, handoff/checklist/source mapping and generated MD/HTML. Record FOP processed_at limitation and latest scope explicitly.
- [ ] Verify full FE/BE and FOP HTTP suites, lint/build, docs validation and UI. One read-only final review of task-only diff. Preserve earlier uncommitted work.

## Review focus
- Header and actual cell/export value both use consumerPaidAt; no createdAt or paidAt fallback.
- Sales exception queue and dispatch included; procurement/allocation/warehouse unchanged.
- API enums and query behavior unchanged by display-label correction.
- True first completed consumer payment source remains distinguished from Shopify processed_at and FOP payment.
