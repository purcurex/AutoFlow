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
  background: #edf1fb;
  color: #6478b3;
  border-top: 1px solid #d7dff2;
  box-shadow: 0 -1px 0 #d7dff2;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
table .app-table-totals > tr > th:first-child { text-align: left; left: 0; z-index: 4; }
table .app-table-totals small { font-weight: 400; }
.dark table .app-table-totals > tr > :is(th, td) {
  background: #252f46;
  color: #b4c2ef;
  border-color: #3b4969;
  box-shadow: 0 -1px 0 #3b4969;
}
</style>
