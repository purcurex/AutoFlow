(function () {
  const model = window.OrderVolumeDemo;
  const byId = id => document.getElementById(id);
  const number = value => value === null ? '—' : Number(value).toLocaleString('zh-CN');
  const state = { customer: null, grain: 'month', month: '2026-10', warehouseId: 'all', keyword: '', page: 1 };
  let chart = null;

  const rankChart = echarts.init(byId('customerRankChart'));
  function renderRanking() {
    const data = model.customerRanking({ grain: state.grain, month: state.month, warehouseId: state.warehouseId });
    byId('customerRankingTotal').textContent = '授权范围合计 ' + number(data.total) + ' 单 · 前十客户＋其他合计，不因单客户搜索而缩小范围';
    rankChart.setOption({ tooltip: { trigger: 'axis', renderMode: 'richText' }, grid: { left: 200, right: 45, top: 10, bottom: 30 },
      xAxis: { type: 'value', minInterval: 1 }, yAxis: { type: 'category', inverse: true, data: data.rows.map(r => r.name + (r.code ? ' · ' + r.code : '')) },
      series: [{ type: 'bar', barMaxWidth: 18, label: { show: true, position: 'right' }, data: data.rows.map(r => ({ value: r.total, itemStyle: { color: r.id === 'other' ? '#B5BFCE' : '#64BDB1', borderRadius: [0, 4, 4, 0] } })) }],
    });
    rankChart.off('click'); rankChart.on('click', p => { const row = data.rows[p.dataIndex]; const customer = model.customers.find(c => c.id === row?.id); if (customer) choose(customer); });
    byId('customerRankRows').replaceChildren();
    for (const row of data.rows) {
      const tr = document.createElement('tr');
      for (const value of [row.name + (row.code ? ' · ' + row.code : ''), number(row.total), data.total ? (row.total / data.total * 100).toFixed(1) + '%' : '0%', number(row.hz), number(row.sz)]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
      byId('customerRankRows').append(tr);
    }
    byId('customerMonthField').hidden = state.grain !== 'day';
  }
  function clearSelection() {
    state.customer = null;
    byId('customerData').hidden = true;
    byId('customerEmpty').hidden = false;
    byId('customerSearchResults').hidden = true;
    byId('customerSearchResults').replaceChildren();
    byId('customerSearchPaging').hidden = true;
    byId('customerPeriodRows').replaceChildren();
    byId('customerDrill').hidden = true;
    for (const id of ['customerName', 'customerMeta', 'customerRange', 'customerTotal', 'customerHz', 'customerSz']) byId(id).textContent = '';
    if (chart) { chart.dispose(); chart = null; }
  }

  function showOrders(period, warehouseId) {
    if (!state.customer || period.status === 'future') return;
    const end = period.end > model.asOf ? model.asOf : period.end;
    const warehouse = warehouseId === 'HZ' ? '杭州仓' : warehouseId === 'SZ' ? '深圳仓' : '全部仓库';
    byId('customerDrill').hidden = false;
    byId('customerDrill').textContent = '工作台下钻预览：' + state.customer.name + '（' + state.customer.code + '） / ' + period.start + ' 至 ' + end + ' / ' + warehouse + '。仅携带已选客户 ID 与日期、仓库条件；正式实现后在授权工作台打开订单。';
  }

  function renderCustomer() {
    if (!state.customer) return;
    const customer = state.customer;
    const query = { category: 'customer', selectedIds: [customer.id], grain: state.grain, month: state.month, warehouseId: state.warehouseId };
    const data = model.query(query);
    const hz = model.query({ ...query, warehouseId: 'HZ' });
    const sz = model.query({ ...query, warehouseId: 'SZ' });
    const valuesFor = (warehouse, index) => state.warehouseId === 'all' || state.warehouseId === warehouse ? (warehouse === 'HZ' ? hz : sz).aggregate.values[index] : data.periods[index].status === 'future' ? null : 0;
    byId('customerEmpty').hidden = true;
    byId('customerData').hidden = false;
    byId('customerMonthField').hidden = state.grain !== 'day';
    byId('customerName').textContent = customer.name;
    byId('customerMeta').textContent = customer.code + ' · ' + model.departments.find(dept => dept.id === customer.departmentId).name;
    byId('customerSearchStatus').textContent = '已确定客户：' + customer.name + '（' + customer.code + '），仅展示该客户数据。';
    byId('customerRange').textContent = (state.grain === 'month' ? '2026 年 1—10 月 · 默认最近 6 月' : state.grain === 'week' ? '本周及前三周 · 共 4 周' : state.month + ' · 默认最近 14 个已发生日期') + ' / ' + (state.warehouseId === 'all' ? '全部仓库' : state.warehouseId === 'HZ' ? '杭州仓' : '深圳仓') + ' / 截至 ' + model.asOf;
    byId('customerTotal').textContent = number(data.total);
    byId('customerHz').textContent = number(data.aggregate.hz);
    byId('customerSz').textContent = number(data.aggregate.sz);
    byId('customerTrendTitle').textContent = customer.name + '（' + customer.code + '）订单趋势';
    byId('customerDrill').hidden = true;
    const series = [{ name: '客户订单合计', values: data.aggregate.values, color: '#94A5DD', warehouseId: state.warehouseId }];
    if (state.warehouseId === 'all') series.push({ name: '杭州仓', values: hz.aggregate.values, color: '#64BDB1', warehouseId: 'HZ' }, { name: '深圳仓', values: sz.aggregate.values, color: '#E7B96C', warehouseId: 'SZ' });
    if (!chart) chart = echarts.init(byId('customerChart'));
    chart.setOption({
      animationDuration: 250, aria: { enabled: true }, textStyle: { fontFamily: 'system-ui', color: '#5b6e80' },
      legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 8, textStyle: { fontSize: 11, color: '#5b6e80' } },
      grid: { top: 60, left: 45, right: 16, bottom: state.grain === 'week' ? 35 : 65 },
      tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, formatter: params => {
        const period = data.periods[params[0]?.dataIndex];
        return period ? period.label + (period.status === 'future' ? ' · 未到日期' : period.status === 'partial' ? ' · 截至 ' + model.asOf : '') + '\n' + params.map(item => item.seriesName + '  ' + number(item.value) + (item.value === null ? '' : ' 单')).join('\n') : '';
      } },
      xAxis: { type: 'category', boundaryGap: state.grain !== 'day', data: data.periods.map(p => p.label), axisTick: { show: false }, axisLine: { lineStyle: { color: '#dbe5ed' } }, axisLabel: { hideOverlap: true, fontSize: 10 } },
      yAxis: { type: 'value', name: '订单 / 单', minInterval: 1, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: '#edf0f7' } } },
      dataZoom: state.grain === 'week' ? [] : [{ type: 'slider', ...data.zoom, height: 20, bottom: 5, fillerColor: '#94a5dd22', borderColor: '#dbe5ed', handleStyle: { color: '#94A5DD' } }, { type: 'inside', ...data.zoom }],
      series: series.map((item, index) => ({ name: item.name, type: state.grain === 'day' ? 'line' : 'bar', data: item.values, barMaxWidth: 25, showSymbol: false, connectNulls: false, smooth: false, lineStyle: { width: index === 0 ? 3 : 2 }, itemStyle: { color: item.color, borderRadius: [3, 3, 0, 0] }, emphasis: { focus: 'series' } })),
    }, true);
    chart.off('click');
    chart.on('click', params => { if (params.componentType === 'series') showOrders(data.periods[params.dataIndex], series[params.seriesIndex].warehouseId); });
    byId('customerPeriodRows').replaceChildren();
    data.periods.forEach((period, index) => {
      const row = document.createElement('tr');
      [period.label, data.aggregate.values[index], valuesFor('HZ', index), valuesFor('SZ', index), period.status === 'future' ? '未到日期' : period.status === 'partial' ? '截至 ' + model.asOf : '完整周期'].forEach((value, col) => {
        const cell = document.createElement('td');
        if (col === 1 && value !== null) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'table-link'; button.textContent = number(value); button.addEventListener('click', () => showOrders(period, state.warehouseId)); cell.append(button);
        } else cell.textContent = col > 0 && col < 4 ? number(value) : value;
        row.append(cell);
      });
      byId('customerPeriodRows').append(row);
    });
    requestAnimationFrame(() => chart?.resize());
  }

  function choose(customer) {
    state.customer = customer;
    byId('customerSearchInput').value = customer.code;
    byId('customerSearchResults').hidden = true;
    byId('customerSearchPaging').hidden = true;
    renderCustomer();
  }
  function search() {
    const result = model.searchCustomers(state.keyword, state.page);
    byId('customerSearchResults').replaceChildren();
    if (!result.total) { byId('customerSearchStatus').textContent = '未找到可查看的匹配客户，请核对名称或编码。'; return; }
    const exact = result.items.find(item => item.code.toLowerCase() === state.keyword.toLowerCase());
    if (exact) { choose(exact); return; }
    byId('customerSearchResults').hidden = false;
    byId('customerSearchStatus').textContent = '找到 ' + result.total + ' 位匹配客户，请根据名称、编码和部门选择一位。';
    result.items.forEach(customer => {
      const button = document.createElement('button'); button.type = 'button';
      const name = document.createElement('span'), meta = document.createElement('small');
      name.textContent = customer.name; meta.textContent = customer.code + ' · ' + model.departments.find(department => department.id === customer.departmentId).name;
      button.append(name, meta); button.addEventListener('click', () => choose(customer)); byId('customerSearchResults').append(button);
    });
    const pages = Math.ceil(result.total / result.pageSize);
    byId('customerSearchPaging').hidden = pages <= 1;
    byId('customerPrev').disabled = state.page === 1;
    byId('customerNext').disabled = state.page === pages;
    byId('customerPageLabel').textContent = state.page + ' / ' + pages + ' 页';
  }
  byId('customerSearchForm').addEventListener('submit', event => {
    event.preventDefault(); clearSelection(); state.keyword = byId('customerSearchInput').value.trim(); state.page = 1;
    if (!state.keyword) { byId('customerSearchStatus').textContent = '请输入客户名称或编码，搜索并确定客户后显示订单数据。'; return; }
    search();
  });
  byId('customerSearchInput').addEventListener('input', () => { clearSelection(); byId('customerSearchStatus').textContent = byId('customerSearchInput').value.trim() ? '点击“搜索客户”查找匹配项，确定客户后显示订单数据。' : '请输入客户名称或编码，搜索并确定客户后显示订单数据。'; });
  byId('clearCustomer').addEventListener('click', () => { byId('customerSearchInput').value = ''; clearSelection(); byId('customerSearchStatus').textContent = '请输入客户名称或编码，搜索并确定客户后显示订单数据。'; byId('customerSearchInput').focus(); });
  byId('customerPrev').addEventListener('click', () => { state.page--; search(); });
  byId('customerNext').addEventListener('click', () => { state.page++; search(); });
  document.querySelectorAll('[data-customer-grain]').forEach(button => button.addEventListener('click', () => {
    state.grain = button.dataset.customerGrain;
    document.querySelectorAll('[data-customer-grain]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    renderRanking(); renderCustomer();
  }));
  byId('customerMonth').addEventListener('change', event => { state.month = event.target.value; renderRanking(); renderCustomer(); });
  byId('customerWarehouse').addEventListener('change', event => { state.warehouseId = event.target.value; renderRanking(); renderCustomer(); });
  renderRanking();
  const rankObserver = new ResizeObserver(() => rankChart.resize()); rankObserver.observe(byId('customerRankChart'));
  const observer = new ResizeObserver(() => chart?.resize()); observer.observe(byId('customerChart'));
})();
