"""Offline checks for the generated matrix; never contacts FOP or a database.
Run generate.py first. Runtime manifests are derived outputs, not source inputs.
"""
from pathlib import Path
from html.parser import HTMLParser
from html import unescape
from collections import Counter
import json,re,hashlib,importlib.util

R=Path(__file__).resolve().parents[2]
D=R/'.runtime/fop-local-field-matrix'
p=R/'docs/integrations/HyperZone待办清单数据字段对照表.html'
html=p.read_text()
spec=importlib.util.spec_from_file_location('hz','/Library/VSCode/.hyperzone/html-style/render_html.py')
hz=importlib.util.module_from_spec(spec);spec.loader.exec_module(hz);hz.validate(html)
m=json.loads((D/'matrix.json').read_text())
assert len(m)==23 and len({s['id'] for s in m})==23
assert html.count('<table class="matrix">')==23
assert html.count('<th>前端展示字段</th><th>本地数据库字段</th><th>FOP 来源</th>')==23

class Audit(HTMLParser):
 def __init__(self):
  super().__init__();self.groups=[];self.current=None;self.cells=[];self.states=[];self.flags=[];self.api_states=[];self.api_groups=[]
 def handle_starttag(self,t,a):
  a=dict(a)
  if t=='tbody' and a.get('class')=='field-group':
   self.current=[];self.flags.append((a.get('data-source'),a.get('data-missing')));self.api_groups.append(set(a.get('data-api','').split()))
  if self.current is not None and t=='tr':self.cells=[]
  if self.current is not None and t=='td':
   self.cells.append(int(a.get('rowspan','1')))
   if 'data-local-state' in a:self.states.append(a['data-local-state'])
   if 'data-api-state' in a:self.api_states.append(a['data-api-state'])
 def handle_endtag(self,t):
  if self.current is not None and t=='tr':self.current.append(self.cells)
  if self.current is not None and t=='tbody':self.groups.append(self.current);self.current=None
x=Audit();x.feed(html)
for group in x.groups:
 assert len(group[0])==3,group
 assert group[0][0]==len(group),group
 assert all(len(r)==2 for r in group[1:]),group
assert len(x.groups)==sum(len(s['rows']) for s in m)
assert len(x.states)==sum(len(r['parts']) for s in m for r in s['rows'])
assert set(x.states)<= {'local-read','schema-only','mapping-pending','mock-only'}
assert {'local-read','schema-only','mapping-pending','mock-only'} <= set(x.states)
assert all(a in ('true','false') and b in ('true','false') for a,b in x.flags)

# Detect stale reports when the application, export, schema or source evidence changes.
evidence=json.loads((D/'evidence.json').read_text())
for e in evidence:
 assert hashlib.sha256((R/e['path']).read_bytes()).hexdigest()==e['sha256'],e['path']
metadata={Path(e['path']).stem:(R/e['path']).read_text() for e in evidence if e['path'].endswith('.dym')}
supply=json.loads((D/'api-supply.json').read_text())
verified_source=set();api_contract_only=set()
for section in m:
 for row in section['rows']:
  for local,source in row['parts']:
   doc=re.search(r'<strong class="source">[^<]* · (hzkj_\w+)</strong>',source)
   code=re.search(r'<code class="fields">(.*?)</code>',source,re.S)
   if not doc or not code:continue
   assert doc[1] in metadata,doc[1]
   for field in re.findall(r'hzkj_\w+',unescape(code[1])):
    assert field in metadata[doc[1]] or field in supply['defined'].get(doc[1],[]),(section['id'],row['label'],doc[1],field)
    if field not in metadata[doc[1]]:api_contract_only.add((doc[1],field))
    verified_source.add((doc[1],field))

# API supply is checked independently from source and local-read flags.
assert set(x.api_states)=={'defined','confirm','missing'}
assert len(x.api_groups)==len(x.groups)
assert all(group <= {'defined','confirm','missing'} for group in x.api_groups)
for label in ['API 已提供定义待联调','API 待确认','API 待提供']:
 assert label in html
assert 'data-api-state=' in html and 'value="api-missing"' in html
assert 'afterOrderId 仅为订单主键续读' in html
assert '拟议接口不是已发布接口' in html
assert '州省现有原始接口缺失' not in html
assert '独立17号接口包已定义州省 hzkj_state' in html
assert '已运输是否等于供应商已发货' in html
assert '不可直接将已运输量当已发量' in html
# Prevent a known absent response field being rendered as already supplied.
for attributes,cell in re.findall(r'<td([^>]*)>(.*?)</td>',html,re.S):
 doc=re.search(r'<strong class="source">[^<]* · (hzkj_\w+)</strong>',cell)
 code=re.search(r'<code class="fields">(.*?)</code>',cell,re.S)
 if not doc or not code:continue
 fields=set(re.findall(r'hzkj_\w+',unescape(code[1])))
 if fields & set(supply['missing'].get(doc[1],[])):
  assert 'data-api-state="missing"' in attributes,(doc[1],fields,attributes)
assert 'hzkj_tocurr' in supply['missing']['hzkj_after_sale_orders']
assert 'hzkj_logistics_channel1' in supply['missing']['hzkj_deliver_bill']
assert 'hzkj_pay_time' in supply['defined']['hzkj_purorderbill']
assert 'hzkj_state' in supply['defined']['hzkj_orders']

# Local column declarations are checked independently of the generated HTML.
src=(R/'backend/src/database/workbench-schema.ts').read_text()
columns={t:json.loads(c) for t,c in re.findall(r'"(hz_fop_\w+)": Object.freeze\((\[[^\n]+?\])\)',src.split('export const WORKBENCH_PRIMARY_KEYS')[0])}
receipt=(R/'backend/src/database/migrations/1794403000000-WorkbenchReceiptNotices.ts').read_text()
for table,field in json.loads((D/'references.json').read_text()):
 if table=='hz_fop_workbench_receipt_notices':assert re.search(r'\b'+field+r'\b',receipt),field
 elif table.startswith('organization_'):continue
 else:assert field in columns[table],(table,field)

by_id={s['id']:s for s in m}
labels=lambda key:[r['label'] for r in by_id[key]['rows']]
for key in ['sales-review','sales-completed']:
 fields=labels(key);assert fields[fields.index('Customer')+1:fields.index('Customer')+3]==['物流信息','发货仓库']
for key in ['dispatch-pending','dispatch-completed','warehouse-outbound','warehouse-completed']:
 assert '物流渠道 / 跟踪号' in labels(key)
for key in ['proc-purchase-procurement','proc-purchase-procurement_shipping','proc-purchase-completed']:
 assert key in by_id
 fields=labels(key);assert fields.index('展开明细 · 业务员 / 部门')==len(fields)-2
assert by_id['sales-completed']['title']=='已审核清单'
assert '审核状态' in labels('allocation-completed')
assert '履约状态' in labels('dispatch-completed')
assert labels('warehouse-inbound')==['收货通知单编号','商品图片 / 商品信息','供应商','收货仓库','供应商发货时间','物流信息','入库进度','通知 / 已入库 / 待入库']
assert '备货元数据没有 hzkj_shop' in html
assert '一张 RMA 售后单一行' in html
assert '旧 API 已入库展示 · 完整同步待接通' in html and '自动增量已暂停' in html
assert 'hz_fop_collected_orders' in html and '已采集模式字段' in html
collected=json.loads((R/'scripts/fop-local-field-matrix/collected-mapping.json').read_text())
assert len(collected)==14 and len({x['label'] for x in collected})==14
assert '不以产品金额或 hzkj_currency 替代' in html
assert '待支付取已知未取消且未付款' in html
assert '不代表真实同步已接通' in html
assert '不是 C 端买家付款时间' in html
# Critical local-read assertions catch accidental claims after regenerating stale mappings.
mapping=(R/'backend/src/modules/workbench-replica/local-workbench-mapping.ts').read_text()
query=(R/'backend/src/modules/workbench-replica/local-workbench.service.ts').read_text()
assert 'consumerPaidAt: paidAt' in mapping
assert 'reviewedAt: time(row.source_audited_at)' in mapping
assert "row.queue_code === 'sales_completed' ? { reviewedAt: time(row.phase_completed_at) }" not in mapping
assert "count(DISTINCT NULLIF(btrim(sales_order_number),''))" in query
assert "count(DISTINCT NULLIF(btrim(sku_code),''))" in query
assert 'total:groupRows[0].detail_order_count' in query
assert 'platformOrderNumber:row.platform_order_number??null' in query
assert '当前代码按关联履约订单 ID 去重' not in html
assert '当前本地查询仅 Mock 模式返回' not in html
assert not re.search(r'<(?:script|img)[^>]+src=["\']https?://',html)
assert not re.search(r'(client_secret|access_token|password)\s*[:=]',html,re.I)
assert not re.search(r'/kapi/|data\.items\[\]',html)
assert re.search(r'text-indent:\s*2em',html)
assert '@media print' in html and 'max-width:760px' in html
assert 'window.print()' in html and 'beforeprint' in html and 'afterprint' in html
assert 'review-filter' in html and 'data-source=' in html and 'data-missing=' in html
print(json.dumps({'ok':True,'lists':len(m),'display_columns':len(x.groups),'mapping_rows':len(x.states),'rowspan_groups':sum(len(g)>1 for g in x.groups),'local_read_states':dict(Counter(x.states)),'verified_source_fields':len(verified_source),'api_contract_only_fields':len(api_contract_only),'api_supply_states':dict(Counter(x.api_states)),'self_contained':True,'evidence_hashes_match':True,'visual_browser_check':'not covered by offline validator'},ensure_ascii=False))
