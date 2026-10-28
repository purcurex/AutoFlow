# Workbench identifiers and consumer date sorting

> **For agentic workers:** Use superpowers:executing-plans to implement this plan.

**Goal:** Every displayed workbench order/document number and each SKU is copyable; consumer checkout time supports sorting while the default remains oldest receipt first.

**Architecture:** Reuse the shared workbench list and clipboard fallback. Add consumerPaidAt to the existing server-side sort contract for unpaid/review/exceptions/dispatch, with nulls last and paidAt/id tie-breakers. Apply sorting after authorization/filtering and before paging, including both Excel modes.

**Tech Stack:** Vue, TypeScript, NestJS, Vitest/Jest, OpenAPI.

**Spec:** Current user request and agent.md business rules. The request is sufficiently explicit for direct implementation.

## Global Constraints

- Preserve existing checkout changes and queue/permission predicates. Do not change FOP production code.
- Default paidAt ascending; missing timestamps last. Never substitute createdAt for consumerPaidAt.
- Copy raw values only, preserving leading zeros, without SKU labels, quantity or tracking prefixes. No horizontal page overflow.
- No Git commit requested this turn; retain changes locally.

## Review Focus

Raw copy values in multi-product/multi-dispatch rows; missing values and denied clipboard; narrow layout sort access; invalid or missing consumer dates; sorting across pages and exports without expanding scope.

## Task 1: Consistent copy and sorting

- [x] Add UI tests exercising identifier/SKU copying and date sort toggles, plus HTTP cross-page and export order tests. Confirm failures.
- [x] Extend existing shared copy helper, consumer date header/compact controls, FE/BE sort field validation and comparator.
- [x] Update requirements, OpenAPI and handoff docs; regenerate standard MD/HTML.
- [x] Run FE/BE tests, FOP HTTP tests, lint/build and browser checks. Independent final review of this task's diff, fix material issues with regression coverage.
