const assert = require('node:assert/strict');
const model = require('./model.cjs');
for (const category of ['carrier', 'organization', 'salesperson']) {
  for (const grain of ['month', 'week', 'day']) {
    for (const departmentId of ['marketing', 'sales1', 'sales2', 'sales3', 'sales4']) {
      const result = model.query({ category, grain, departmentId });
      assert.equal(result.aggregate.total, result.rows.reduce((sum, row) => sum + row.total, 0));
      assert.equal(result.aggregate.total, result.aggregate.hz + result.aggregate.sz);
      result.periods.forEach((period, index) => {
        assert.equal(result.series[0].values[index], period.status === 'future' ? null : result.series.slice(1).reduce((sum, row) => sum + row.values[index], 0));
      });
      assert.equal(result.periods.length, { month: 10, week: 4, day: 31 }[grain]);
    }
  }
}
assert.equal(model.buckets('day', '2024-02').length, 29);
assert.equal(model.buckets('day', '2026-02').length, 28);
assert.equal(model.buckets('day', '2026-09').length, 30);
assert.deepEqual(model.buckets('week', undefined, '2026-01-01').map(period => period.start), ['2025-12-08', '2025-12-15', '2025-12-22', '2025-12-29']);
assert.deepEqual(model.query({ grain: 'day' }).zoom, { startValue: 7, endValue: 20 });
assert.deepEqual(model.query({ grain: 'month' }).zoom, { startValue: 4, endValue: 9 });
const selected = model.query({ category: 'salesperson', departmentId: 'sales1', selectedIds: ['employee-0'] });
assert.equal(selected.series.length, 2);
assert.equal(selected.aggregate.name, '所选对象合计');
assert.equal(selected.total, selected.rows[0].total);
assert.equal(new Set(model.orders.map(order => order.id)).size, model.orders.length);
assert.deepEqual(model.searchCustomers('  ').items, []);
assert.equal(model.searchCustomers(' c001 ').items[0].id, 'customer-0');
assert.equal(model.searchCustomers('Northstar').total, 4);
assert.equal(model.searchCustomers('does-not-exist').total, 0);
assert.equal(model.searchCustomers('C', 1).items.length, 10);
assert.equal(model.searchCustomers('C', 3).items.length, 4);
assert.throws(() => model.query({ category: 'customer' }));
assert.throws(() => model.query({ category: 'customer', selectedIds: ['missing'] }));
assert.throws(() => model.query({ category: 'customer', selectedIds: ['customer-0', 'customer-1'] }));
for (const customer of model.customers) for (const grain of ['month', 'week', 'day']) {
  const result = model.query({ category: 'customer', selectedIds: [customer.id], grain });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, customer.id);
  assert.equal(result.total, result.rows[0].total);
  assert.equal(result.total, result.aggregate.hz + result.aggregate.sz);
  for (const warehouseId of ['HZ', 'SZ']) {
    const filtered = model.query({ category: 'customer', selectedIds: [customer.id], grain, warehouseId });
    assert.equal(filtered.total, warehouseId === 'HZ' ? result.aggregate.hz : result.aggregate.sz);
  }
}
console.log('PASS: 45 combined queries, 72 single-customer time queries, search/code/name/pagination, required customer identity, warehouse reconciliation and time boundaries.');

for (const grain of ['month', 'week', 'day']) for (const warehouseId of ['all', 'HZ', 'SZ']) {
  const ranked = model.customerRanking({ grain, warehouseId });
  assert.equal(ranked.rows.length, 11);
  assert.equal(ranked.rows.at(-1).id, 'other');
  assert.equal(ranked.rows.reduce((s, r) => s + r.total, 0), ranked.total);
  assert.equal(ranked.rows.reduce((s, r) => s + r.hz + r.sz, 0), ranked.total);
}
console.log('PASS: Top 10 + other rankings reconcile for all nine time/warehouse combinations.');
