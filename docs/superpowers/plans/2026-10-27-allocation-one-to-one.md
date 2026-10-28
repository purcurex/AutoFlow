# One fulfillment order, one allocation document

> Use superpowers:executing-plans. User's explicit correction is the specification; implement in the existing checkout without another design approval or Git commit.

**Goal:** Exactly one allocation document per fulfillment order; the allocation workbench audits that document, never the fulfillment order. Example number: AO261028000404.
**Architecture:** Single nullable allocationDocument { id, number } replaces the unreleased plural reference. Existing shared approval protocol keeps a one-element documents envelope per order. FOP native audit remains authoritative; no production FOP changes.

## Task 1: Implement and verify the one-to-one contract
- [ ] Add failing tests: Demo multi-SKU orders have exactly one target; multiple allocation targets are rejected without writes; two orders sharing an allocation reference are rejected; list/export display a single AO number.
- [ ] Update FE/BE order types, allowlisted serialization, Demo/fixtures, list and Excel. Source missing remains null; array-shaped input fails rather than selecting its first item. Check uniqueness after authorization. Do not restrict real number formats to the example.
- [ ] Validate exactly one allocation audit target and its ID/number against the current order reference, including recheck before write. Batch selection continues to mean multiple independent allocation documents, one per selected order. Preserve permissions, versions, idempotency, dispatch completion and individual results.
- [ ] Update approval copy to name allocation documents explicitly. Convert former multi-allocation tests into cross-order batch tests.
- [ ] Run FE and BE suites, FOP HTTP tests, lint/build. Expected all pass; BE runs serial to avoid existing shared-directory races.

## Task 2: Deliver
- [ ] Correct current requirements, source mapping, handoff, checklist and agent.md; update OpenAPI singular field and one-target cardinality, AO samples; regenerate standard MD/HTML. Retain historical verification as historical and mark superseded assumptions.
- [ ] Verify UI one row/one AO number and one target per selected order. Run one independent final review on task-only diff; fix Important/Critical findings once, with regression evidence.

## Review focus
- Shared or changed target references cannot cause the wrong document to be audited.
- Multi-SKU orders still have one allocation; missing references do not fabricate IDs or hide queues.
- Sales audit still targets hzkj_orders; allocation audit targets hzkj_alloc_bill only.
- One-to-one rules are enforced after data authorization, without widening scopes.
- No production number is derived from order IDs, and no batch partial outcome is lost.
