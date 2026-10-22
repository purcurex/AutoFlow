(function () {
  const model = window.OrderVolumeDemo;
  const byId = id => document.getElementById(id);
  const state = { category: 'organization', departmentId: 'marketing', grain: 'month', month: '2026-10', warehouseId: 'all', selectedIds: [] };
  const names = { organization: '组织', carrier: '物流服务商', salesperson: '业务员' };
  const palette = ['#64BDB1', '#E7B96C', '#E49AA5', '#A996D1', '#79B7D2', '#B3BF78'];
  const number = value => value === null ? '—' : Number(value).toLocaleString('zh-CN');
  const charts = [echarts.init(byId('trendA')), null, echarts.init(byId('rankChart'))];
  let current, syncing = false;
  function color(id) {
    if (id === 'aggregate') return '#94A5DD';
    if (id === 'remaining' || id === 'OTHER') return '#A8B5C4';
    if (id === 'UNASSIGNED') return '#C5B5A4';
    const list = state.category === 'carrier' ? model.carriers : state.category === 'organization' && state.departmentId === 'marketing' ? model.departments : model.roster;
    return palette[Math.max(0, list.findIndex(item => item.id === id)) % palette.length];
  }
  function updatePicker() {
    const items = model.objects(state.category, state.departmentId);
    byId('objectList').replaceChildren();
    const search = byId('objectSearch').value.toLowerCase();
    items.filter(item => (item.name + item.id).toLowerCase().includes(search)).forEach(item => {
      const label = document.createElement('label'), input = document.createElement('input'), span = document.createElement('span');
      input.type = 'checkbox'; input.value = item.id; input.checked = state.selectedIds.includes(item.id);
      input.addEventListener('change', () => {
        if (input.checked && state.selectedIds.length >= 5) { input.checked = false; byId('selectionFeedback').textContent = '最多比较 5 个对象，或选择“查看全部对象”。'; return; }
        state.selectedIds = input.checked ? [...state.selectedIds, item.id] : state.selectedIds.filter(id => id !== item.id);
        byId('selectionFeedback').textContent = ''; render();
      });
      span.textContent = item.name; label.append(input, span); byId('objectList').append(label);
    });
    byId('objectSummary').textContent = state.selectedIds.length ? '已选 ' + state.selectedIds.length + ' 个对象' : '全部对象';
    byId('objectCaption').textContent = state.category === 'carrier' ? '② 服务商明细' : state.category === 'organization' ? '明细对象' : names[state.category] + '明细';
  }
  function showDrill(data, series, period, warehouseId) {
    if (period?.status === 'future') return;
    const scope = series?.name || data.aggregate.name;
    const range = period ? period.start + ' 至 ' + (period.end > model.asOf ? model.asOf : period.end) : data.periods[0].start + ' 至 ' + (data.periods.at(-1).end > model.asOf ? model.asOf : data.periods.at(-1).end);
    const wh = warehouseId === 'HZ' ? '杭州仓' : warehouseId === 'SZ' ? '深圳仓' : '全部仓库';
    const element = byId('drillPreview'); element.hidden = false; element.replaceChildren();
    const title = document.createElement('strong'); title.textContent = '工作台下钻预览 · ' + scope;
    const detail = document.createElement('span'); detail.textContent = names[state.category] + ' / ' + range + ' / ' + wh + ' / 按创建日期统计有效订单。正式实现将在有权限的岗位工作台展示同一条件的订单明细；本设计稿不会跳转或请求真实订单。';
    element.append(title, detail); element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function alignWarehouse(data, reference) {
    const series = reference.series.map(item => {
      if (item.id === 'aggregate') return data.aggregate;
      if (item.id !== 'remaining') return data.rows.find(row => row.id === item.id);
      const visible = new Set(reference.series.map(row => row.id));
      const rest = data.rows.filter(row => !visible.has(row.id));
      return { ...item, total: rest.reduce((sum, row) => sum + row.total, 0), values: data.periods.map((p, i) => p.status === 'future' ? null : rest.reduce((sum, row) => sum + row.values[i], 0)) };
    });
    return { ...data, series };
  }
  function trendOption(data, max) {
    const daily = state.grain === 'day';
    return {
      animationDuration: 250, color: data.series.map(item => color(item.id)), aria: { enabled: true },
      textStyle: { fontFamily: 'system-ui', fontSize: 11, color: '#5b6e80' },
      legend: { type: 'scroll', top: 0, left: 0, right: 12, itemWidth: 10, itemHeight: 8, textStyle: { color: '#5b6e80', fontSize: 11 } },
      grid: { top: 65, left: 48, right: 16, bottom: state.grain === 'week' ? 35 : 65 },
      tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, formatter: params => {
        const bucket = data.periods[params[0]?.dataIndex];
        if (!bucket) return '';
        const label = bucket.status === 'future' ? '未到日期' : bucket.status === 'partial' ? '未结束 · 截至 ' + model.asOf : '完整周期';
        return bucket.label + ' · ' + label + '\n' + params.map(item => item.seriesName + '  ' + (item.value === null ? '—' : number(item.value) + ' 单')).join('\n');
      } },
      xAxis: { type: 'category', data: data.periods.map(p => p.label), boundaryGap: !daily, axisTick: { show: false }, axisLine: { lineStyle: { color: '#dbe5ed' } }, axisLabel: { hideOverlap: true, fontSize: 10 } },
      yAxis: { type: 'value', name: '订单 / 单', minInterval: 1, max, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: '#edf0f7' } } },
      dataZoom: state.grain === 'week' ? [] : [{ type: 'slider', ...data.zoom, bottom: 5, height: 20, borderColor: '#dbe5ed', fillerColor: '#94a5dd22', handleStyle: { color: '#94A5DD' } }, { type: 'inside', ...data.zoom }],
      series: data.series.map((item, i) => ({
        id: item.id, name: item.name, type: daily ? 'line' : 'bar', data: item.values,
        itemStyle: { color: color(item.id), borderRadius: daily ? undefined : [3, 3, 0, 0] }, barMaxWidth: 22, barGap: '20%',
        smooth: false, connectNulls: false, showSymbol: false, symbolSize: 5, lineStyle: { width: i === 0 ? 3 : 2 },
        emphasis: { focus: 'series' },
        markArea: daily && i === 0 && data.periods.some(p => p.status === 'future') ? { silent: true, itemStyle: { color: '#f3f6fa' }, label: { color: '#728494', fontSize: 11 }, data: [[{ name: '未到日期', xAxis: data.periods.find(p => p.status === 'future').label }, { xAxis: data.periods.at(-1).label }]] } : undefined,
      })),
    };
  }
  function bindTrend(index, data, warehouseId) {
    const chart = charts[index]; chart.off('click'); chart.on('click', params => {
      if (params.componentType === 'series') showDrill(data, data.series[params.seriesIndex], data.periods[params.dataIndex], warehouseId);
    });
  }
  function cell(row, value, header = false) {
    const item = document.createElement(header ? 'th' : 'td'); item.textContent = value; row.append(item); return item;
  }
  function table(data) {
    byId('summaryRows').replaceChildren();
    [data.aggregate, ...data.ranked].forEach(item => {
      const row = document.createElement('tr'); if (item.id === 'aggregate') row.className = 'aggregate-row';
      cell(row, item.name);
      const td = cell(row, ''), button = document.createElement('button'); button.type = 'button'; button.className = 'table-link'; button.textContent = number(item.total); button.addEventListener('click', () => showDrill(data, item, null, state.warehouseId)); td.append(button);
      cell(row, data.total ? (item.total / data.total * 100).toFixed(1) + '%' : '—'); cell(row, number(item.hz)); cell(row, number(item.sz)); byId('summaryRows').append(row);
    });
    const heading = document.createElement('tr'); cell(heading, '统计对象', true); data.periods.forEach(p => cell(heading, p.label + (p.status === 'future' ? ' · 未到' : p.status === 'partial' ? ' · 截至当前' : ''), true)); byId('periodHead').replaceChildren(heading);
    byId('periodRows').replaceChildren();
    [data.aggregate, ...data.ranked].forEach(item => { const row = document.createElement('tr'); if (item.id === 'aggregate') row.className = 'aggregate-row'; cell(row, item.name); item.values.forEach(value => cell(row, number(value))); byId('periodRows').append(row); });
  }
  function render() {
    byId('departmentField').hidden = state.category === 'carrier';
    byId('departmentCaption').textContent = state.category === 'organization' ? '② 组织范围' : '② 业务部门';
    byId('monthField').hidden = state.grain !== 'day';
    byId('warehouseMode').disabled = state.warehouseId !== 'all';
    if (state.warehouseId !== 'all') byId('warehouseMode').value = 'combined';
    const split = byId('warehouseMode').value === 'split';
    updatePicker();
    current = model.query(state);
    byId('total').textContent = number(current.total); byId('hzTotal').textContent = number(current.aggregate.hz); byId('szTotal').textContent = number(current.aggregate.sz);
    byId('context').textContent = names[state.category] + ' / ' + current.aggregate.name + ' / ' + (state.grain === 'month' ? '2026 年 1—10 月' : state.grain === 'week' ? '本周及前三周' : state.month) + ' / ' + (state.warehouseId === 'all' ? '全部仓库' : state.warehouseId === 'HZ' ? '杭州仓' : '深圳仓') + ' · 授权范围：全部演示订单';
    byId('trendTitle').textContent = names[state.category] + '订单趋势';
    byId('trendNote').textContent = '浅蓝紫为合计，明细与合计不重复累加。' + (state.grain === 'week' ? '完整显示最近 4 周。' : state.grain === 'day' ? '默认最近 14 个已发生日期，未来日期显示为空。' : '默认最近 6 个月，向左拖动查看历史。') + (split ? '两仓共用对象、颜色、Y 轴刻度和缩放范围。' : '');
    byId('trendGrid').classList.toggle('split', split); byId('secondPanel').hidden = !split; byId('firstLabel').hidden = !split;
    if (split && !charts[1]) { charts[1] = echarts.init(byId('trendB')); charts[1].on('datazoom', event => syncZoom(1, 0, event)); }
    if (split) {
      const hz = alignWarehouse(model.query({ ...state, warehouseId: 'HZ' }), current), sz = alignWarehouse(model.query({ ...state, warehouseId: 'SZ' }), current);
      const peak = Math.max(1, ...hz.aggregate.values.filter(x => x !== null), ...sz.aggregate.values.filter(x => x !== null));
      const step = Math.pow(10, Math.max(0, Math.floor(Math.log10(peak)) - 1));
      const max = Math.ceil(peak * 1.1 / step) * step;
      charts[0].setOption(trendOption(hz, max), true); charts[1].setOption(trendOption(sz, max), true); bindTrend(0, hz, 'HZ'); bindTrend(1, sz, 'SZ');
    } else { charts[0].setOption(trendOption(current), true); bindTrend(0, current, state.warehouseId); }
    const ranking = current.ranked.slice(0, 10);
    charts[2].setOption({ animationDuration: 250, aria: { enabled: true }, grid: { left: 145, right: 45, top: 10, bottom: 25 }, tooltip: { trigger: 'axis', renderMode: 'richText', confine: true }, xAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: '#edf0f7' } } }, yAxis: { type: 'category', inverse: true, data: ranking.map(item => item.name), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { width: 130, overflow: 'truncate', fontSize: 11, color: '#5b6e80' } }, series: [{ type: 'bar', name: '订单量', barMaxWidth: 17, label: { show: true, position: 'right', color: '#5b6e80', fontSize: 11 }, data: ranking.map(item => ({ value: item.total, itemStyle: { color: color(item.id), borderRadius: [0, 3, 3, 0] } })) }] }, true);
    charts[2].off('click'); charts[2].on('click', params => showDrill(current, ranking[params.dataIndex], null, state.warehouseId));
    table(current); byId('drillPreview').hidden = true;
    requestAnimationFrame(() => charts.forEach(chart => chart?.resize()));
  }
  function syncZoom(from, to, event) {
    if (syncing || byId('warehouseMode').value !== 'split' || !charts[to]) return;
    syncing = true;
    const values = event.batch?.[0] || event;
    charts[to].dispatchAction({ type: 'dataZoom', start: values.start, end: values.end });
    syncing = false;
  }
  charts[0].on('datazoom', event => syncZoom(0, 1, event));
  byId('category').addEventListener('change', event => { state.category = event.target.value; state.selectedIds = []; state.departmentId = 'marketing'; byId('department').value = 'marketing'; byId('objectSearch').value = ''; render(); });
  byId('department').addEventListener('change', event => { state.departmentId = event.target.value; state.selectedIds = []; byId('objectSearch').value = ''; render(); });
  byId('warehouse').addEventListener('change', event => { state.warehouseId = event.target.value; render(); });
  byId('warehouseMode').addEventListener('change', render);
  byId('month').addEventListener('change', event => { state.month = event.target.value; render(); });
  document.querySelectorAll('[data-grain]').forEach(button => button.addEventListener('click', () => { state.grain = button.dataset.grain; document.querySelectorAll('[data-grain]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); render(); }));
  byId('allObjects').addEventListener('click', () => { state.selectedIds = []; byId('objectSearch').value = ''; byId('objectPicker').open = false; render(); });
  byId('objectSearch').addEventListener('input', updatePicker);
  byId('resetQuery').addEventListener('click', () => {
    Object.assign(state, { category: 'organization', departmentId: 'marketing', grain: 'month', month: '2026-10', warehouseId: 'all', selectedIds: [] });
    byId('category').value = 'organization'; byId('department').value = 'marketing'; byId('month').value = '2026-10'; byId('warehouse').value = 'all'; byId('warehouseMode').value = 'combined';
    byId('objectSearch').value = ''; byId('objectPicker').open = false;
    document.querySelectorAll('[data-grain]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.grain === 'month')));
    render();
  });
  const observer = new ResizeObserver(() => charts.forEach(chart => chart?.resize())); observer.observe(byId('trendGrid'));
  window.addEventListener('resize', () => charts.forEach(chart => chart?.resize()));
  render();
})();
