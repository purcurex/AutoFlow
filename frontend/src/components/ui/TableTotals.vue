<template>
  <tfoot class="app-table-totals"><tr><slot /></tr></tfoot>
</template>

<style>
/* Shared across financial and order-count lists, including horizontally scrolling tables. */
table .app-table-totals > tr > :is(th, td) {
  position: sticky;
  top: auto;
  bottom: 0;
  z-index: 3;
  background: var(--color-total-surface);
  color: var(--color-summary-text);
  border-top: 1px solid var(--color-total-border);
  box-shadow: 0 -1px 0 var(--color-total-border);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
table .app-table-totals > tr > th:first-child { text-align: left; left: 0; z-index: 4; }
table .app-table-totals small { font-weight: 400; }
</style>
