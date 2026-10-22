/* Deterministic design-only data. No live API, identity or business data is read. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrderVolumeDemo = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const asOf = '2026-10-21';
  const departments = ['业务一部', '业务二部', '业务三部', '业务四部'].map((name, i) => ({ id: 'sales' + (i + 1), name }));
  const roster = [
    ['曹可滢（Ruth）', 0], ['陈会娟（Coco）', 0], ['董梦强（Alex）', 0], ['李文静（Betty）', 0], ['杨美婷（Heidi）', 0],
    ['马政莹（Maya）', 1], ['辛安冉（Stella）', 1], ['曾婷婷（Mia）', 1], ['张映婷（Zoe）', 1],
    ['陈宣竹（Joy）', 2], ['林世龙（Jaylen）', 2], ['刘朵朵（Iris）', 2], ['杨莹（Kiki）', 2], ['叶力铭（Jennie）', 2], ['梁东澜（Liora）', 3],
  ].map(([name, d], i) => ({ id: 'employee-' + i, name, departmentId: departments[d].id }));
  const carriers = [
    ['YT', '云途 YT'], ['4PX', '4PX'], ['WB', '万邦 WB'], ['YW', '燕文 YW'], ['JS', '极速 JS'], ['OTHER', '其他服务商'], ['UNASSIGNED', '未分配服务商'],
  ].map(([id, name]) => ({ id, name }));
  const warehouses = [{ id: 'HZ', name: '杭州仓' }, { id: 'SZ', name: '深圳仓' }];
  const customers = Array.from({ length: 24 }, (_, i) => ({ id: 'customer-' + i, code: 'C' + String(i + 1).padStart(3, '0'), name: ['Northstar', 'Blue Harbor', 'Maple & Co', 'Velvet Home', 'Orion Studio', 'Olive Lane'][i % 6], departmentId: departments[i % 4].id }));
  const iso = d => d.toISOString().slice(0, 10);
  const addDays = (day, count) => iso(new Date(Date.parse(day + 'T00:00:00Z') + count * 86400000));
  const sum = values => values.reduce((a, b) => a + (b ?? 0), 0);
  let seed = 81;
  const random = max => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; };
  const orders = [];
  for (let day = '2026-01-01'; day <= asOf; day = addDays(day, 1)) {
    const quantity = 18 + random(47) + Number(day.slice(5, 7)) * 2;
    for (let j = 0; j < quantity; j++) {
      const customer = customers[random(customers.length)];
      const team = roster.filter(person => person.departmentId === customer.departmentId);
      const owner = team[random(team.length)];
      orders.push({ id: 'DEMO-' + (orders.length + 1), date: day, customerId: customer.id, ownerId: owner.id, departmentId: customer.departmentId, carrierId: carriers[random(100) < 3 ? 6 : random(6)].id, warehouseId: random(100) < 65 ? 'HZ' : 'SZ' });
    }
  }
  function buckets(grain, month = '2026-10', anchor = asOf) {
    if (grain === 'month') return Array.from({ length: Number(anchor.slice(5, 7)) }, (_, i) => {
      const key = anchor.slice(0, 4) + '-' + String(i + 1).padStart(2, '0');
      const end = iso(new Date(Date.UTC(Number(key.slice(0, 4)), i + 1, 0)));
      return { key, label: key, start: key + '-01', end, status: end > anchor ? 'partial' : 'complete' };
    });
    if (grain === 'week') {
      const weekday = new Date(anchor + 'T00:00:00Z').getUTCDay();
      const monday = addDays(anchor, -(weekday === 0 ? 6 : weekday - 1));
      return Array.from({ length: 4 }, (_, i) => {
        const start = addDays(monday, (i - 3) * 7), end = addDays(start, 6);
        return { key: start, label: start.slice(5) + '—' + end.slice(5), start, end, status: end > anchor ? 'partial' : 'complete' };
      });
    }
    const n = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => {
      const key = month + '-' + String(i + 1).padStart(2, '0');
      return { key, label: key.slice(5), start: key, end: key, status: key > anchor ? 'future' : key === anchor ? 'partial' : 'complete' };
    });
  }
  function objects(category, departmentId) {
    if (category === 'carrier') return carriers;
    if (category === 'organization') return departmentId === 'marketing' ? departments : roster.filter(x => x.departmentId === departmentId);
    return (category === 'customer' ? customers : roster).filter(x => departmentId === 'marketing' || x.departmentId === departmentId);
  }
  const objectId = (row, query) => query.category === 'carrier' ? row.carrierId : query.category === 'customer' ? row.customerId : query.category === 'organization' && query.departmentId === 'marketing' ? row.departmentId : row.ownerId;
  function query(input) {
    const q = { category: 'organization', departmentId: 'marketing', grain: 'month', month: '2026-10', warehouseId: 'all', selectedIds: [], ...input };
    if (q.category === 'customer' && (q.selectedIds.length !== 1 || !customers.some(customer => customer.id === q.selectedIds[0] && (q.departmentId === 'marketing' || customer.departmentId === q.departmentId)))) {
      throw new Error('Select one matching customer before querying order volume');
    }
    const periods = buckets(q.grain, q.month);
    const base = orders.filter(row => (q.departmentId === 'marketing' || row.departmentId === q.departmentId) && (q.warehouseId === 'all' || row.warehouseId === q.warehouseId) && row.date >= periods[0].start && row.date <= periods.at(-1).end);
    const available = objects(q.category, q.departmentId);
    const allowed = new Set(available.map(x => x.id));
    const ids = q.selectedIds.filter(id => allowed.has(id));
    const filtered = base.filter(row => !ids.length || ids.includes(objectId(row, q)));
    const rows = available.filter(item => !ids.length || ids.includes(item.id)).map(item => {
      const matched = filtered.filter(row => objectId(row, q) === item.id);
      const values = periods.map(p => p.status === 'future' ? null : matched.filter(row => row.date >= p.start && row.date <= p.end).length);
      return { ...item, values, total: sum(values), hz: matched.filter(row => row.warehouseId === 'HZ').length, sz: matched.filter(row => row.warehouseId === 'SZ').length };
    });
    const total = filtered.length;
    const aggregate = { id: 'aggregate', name: ids.length ? '所选对象合计' : q.category === 'carrier' ? '服务商订单合计' : (q.departmentId === 'marketing' ? '营销中心' : departments.find(x => x.id === q.departmentId).name) + '合计', values: periods.map(p => p.status === 'future' ? null : filtered.filter(row => row.date >= p.start && row.date <= p.end).length), total, hz: filtered.filter(row => row.warehouseId === 'HZ').length, sz: filtered.filter(row => row.warehouseId === 'SZ').length };
    const ranked = [...rows].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
    // Fix the Top N across the selected period, so a color always represents one object.
    const topLimited = q.category === 'customer' || q.category === 'salesperson' || (q.category === 'organization' && q.departmentId !== 'marketing');
    const visible = topLimited ? ranked.slice(0, 5) : rows;
    const rest = topLimited ? ranked.slice(5) : [];
    if (rest.length) visible.push({ id: 'remaining', name: '其余对象（' + rest.length + '）', total: sum(rest.map(x => x.total)), values: periods.map((p, i) => p.status === 'future' ? null : sum(rest.map(x => x.values[i]))) });
    const latest = Math.max(0, periods.findLastIndex(p => p.status !== 'future'));
    return { query: q, periods, aggregate, rows, ranked, series: [aggregate, ...visible], zoom: { startValue: Math.max(0, latest - (q.grain === 'day' ? 13 : q.grain === 'month' ? 5 : 3)), endValue: latest }, total, activeObjects: rows.filter(x => x.total > 0).length };
  }
  function searchCustomers(keyword, page = 1, pageSize = 10) {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return { items: [], total: 0, page, pageSize };
    const matches = customers.filter(customer => customer.name.toLowerCase().includes(needle) || customer.code.toLowerCase().includes(needle));
    matches.sort((a, b) => Number(b.code.toLowerCase() === needle) - Number(a.code.toLowerCase() === needle) || a.code.localeCompare(b.code));
    return { items: matches.slice((page - 1) * pageSize, page * pageSize), total: matches.length, page, pageSize };
  }
  function customerRanking(input = {}) {
    const rows = customers.map(customer => query({ ...input, category: 'customer', selectedIds: [customer.id] }).rows[0]).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
    const top = rows.slice(0, 10), rest = rows.slice(10);
    if (rest.length) top.push({ id: 'other', name: '其他客户', total: sum(rest.map(r => r.total)), hz: sum(rest.map(r => r.hz)), sz: sum(rest.map(r => r.sz)) });
    return { rows: top, total: sum(rows.map(r => r.total)) };
  }
  return { asOf, departments, roster, carriers, warehouses, customers, orders, buckets, objects, query, searchCustomers, customerRanking };
});
