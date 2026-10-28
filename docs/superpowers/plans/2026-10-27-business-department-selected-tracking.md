# Business department filters and selected Shopify tracking

Spec: latest user request. Limit business filters to Sales I–IV, direct children of Marketing Center; narrow product cells, keep a 16-character tracking number on one line with TC/WC/QC prefixes; display the number selected for Shopify by FOP, mapping deferred to IT; replace heading info glyph with subtle question mark.

Use the current checkout and preserve prior edits. No Git commit or production FOP edits requested. Execute inline with existing executing-plans/TDD workflow; one fresh final review.

## Tasks
1. Restrict authorized department options to the four normalized sales departments. Demo validates Marketing Center parent; organization editing remains full-directory. Test nonbusiness/subteam exclusions without changing visible order permissions/counts.
2. Add explicit per-group shopifyTracking selection contract, normalize only verified selection; keep legacy candidates separate and do not guess selection. Demo selected values cover TC/WC/QC. UI and Excel display only selected number, compact nowrap layout; question-mark tip retains existing interactions. Regression tests before code.
3. Document source semantics and manual mapping acceptance, regenerate standard MD/HTML/OpenAPI, run meaningful suites/build/lint and browser geometry checks. Fresh final review, fix material findings once.

## Review focus
- Filters do not leak departments or remove authorized tasks; only Marketing Center direct sales departments become selectable.
- Raw logistics order number is not always full-route; no guessed selected number, type or prefix.
- UI/export agree on selected tracking; sample JSEJX2881622244YQ fits one line without page overflow.
- Shared tooltip remains accessible and subtle; no behavior regression.
