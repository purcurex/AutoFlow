"""Generate the current local-query field reference; no FOP or DB calls."""
from pathlib import Path
from html import escape as E
import hashlib, importlib.util, json
R=Path(__file__).resolve().parents[2]
D=R/'.runtime/fop-local-field-matrix'; D.mkdir(parents=True,exist_ok=True)
BASE=Path(__file__).parent

def build():
    definitions=json.loads((BASE/'collected-mapping.json').read_text())
    lists=json.loads((BASE/'lists.json').read_text())
    paths={BASE/'collected-mapping.json', BASE/'lists.json', Path(__file__), R/'scripts/build-standalone-field-matrix.py'}
    body='''<style>p{text-indent:2em}h1,h2,h3{text-indent:0}table{font-size:12px;table-layout:fixed}td{overflow-wrap:anywhere;vertical-align:top}code{font-size:11px;overflow-wrap:anywhere}.matrix-wrap{overflow:auto}table{min-width:1050px}.search{padding:12px;width:100%;max-width:520px;margin-bottom:16px}section{scroll-margin-top:20px}th:first-child{width:12%}.evidence{font-size:11px} @media print{.search{display:none}table{min-width:0;font-size:9px}}</style>
<section id="scope"><h2>01 · 阅读口径</h2><p>依据2026-11-25当前代码整理23个待办清单，并补充国内包裹视图、履约进度查询、分析与自动同步字段。表内区分前端返回值、本地保存路径、FOP来源和处理规则；JSON路径也是实际存储字段，不将预留的正式副本列冒充当前读取路径。</p><p>清单和分析读取本地库；审核及即时库存查询使用独立实时API。来源字段存在不表示每笔记录都有值。缺失、不完整、未关联的数据保留待补，真实接通情况以最新版需求说明书及验证证据为准。此轮仅核对代码与文档，未重新采集业务数据。</p><p><a href="HyperZone智能办公平台项目开发需求说明书.html">最新版需求说明书</a>为唯一需求契约，本表为实现对照。履约税费当前代码读取hzkj_fixed_tax_fee；备货原生商品名称仍有hzkj_public_title回退，不能将历史“统一中文配货名”目标写成所有分支都已一致。</p><input class="search" id="search" aria-label="搜索字段" placeholder="搜索清单、字段、FOP字段或本地表名"></section>'''
    matrix=[]
    for i, section in enumerate(lists,2):
        rows=[]
        for label in section['fields']:
            f=dict(definitions[label])
            if section['id'] in ('sales-stock','proc-stock'):
                if label=='订单金额':f.update(local='hz_fop_collected_entities[stock_orders].display.amount/currency；hz_fop_collected_analytics_facts[stock]',source='hzkj_stock_order_new.hzkj_order_amount / hzkj_settlecurrency_number',rule='备货订单自身金额；币种缺失默认USD。',evidence=['backend/src/modules/fop-data/collected-stock-native.ts'])
                if label=='商品图片 / 商品信息':f.update(source='hzkj_orders_billentry：hzkj_local_sku_number、hzkj_local_sku_hzkj_public_title、hzkj_qty、hzkj_local_sku_hzkj_sku_value、hzkj_local_sku_hzkj_picturefield',local='hz_fop_collected_entities[stock_orders].display.items',rule='当前原生备货适配取public_title并可回退已采名称；商品档案补充存在时再按本地读取器处理，名称一致性仍需逐分支核验。',evidence=['backend/src/modules/fop-data/collected-stock-native.ts'])
            if section['id'] in ('sales-stock','proc-stock') and label in ('客户名称','业务员','收货仓库','客户付款时间','创建时间','采购状态'):
                stock_fields={
                    '客户名称':('customerName','facts.customer.name → display.customerName','备货订单客户引用'),
                    '业务员':('owner / department','owner_employee_id / facts.sourceOwner → display.owner；本地账号部门','备货订单业务员稳定ID及本地归属'),
                    '收货仓库':('warehouse / warehouseCode','facts.warehouse → display.warehouse','备货订单仓库引用'),
                    '客户付款时间':('paidAt','paid_at → display.paidAt','备货订单采集事实付款时间'),
                    '创建时间':('createdAt','created_at → display.createdAt','备货订单采集事实创建时间'),
                    '采购状态':('purchaseStatus / purchaseStatusLabel','raw.hzkj_purchase_status → display.purchaseStatus','备货订单 hzkj_purchase_status / hzkj_purchase_status_title')}
                display,local,source=stock_fields[label]
                f.update(display=display,local='hz_fop_collected_analytics_facts[stock].'+local+'；投影至 hz_fop_collected_entities[stock_orders]',source=source,rule='取备货订单自身事实及本地映射，不使用履约订单同名字段替代。缺失留空。',evidence=['backend/src/modules/fop-data/collected-stock-native.ts'])
            if section['id']=='sales-rma' and label=='订单金额':f.update(local='hz_fop_collected_entities[rma].raw.case → display.amount',source='hzkj_after_sale_orders.hzkj_order_amount / hzkj_tocurr_number',display='amount / currency',rule='当前RMA单订单金额；无需明细金额，缺币种默认USD。',evidence=['backend/src/modules/fop-data/collected-rma.ts'])
            if section['id']=='warehouse-inbound' and label=='物流信息':f.update(local='hz_fop_collected_entities[receipt_notice].raw / display → logistics[]',source='hzkj_logistics_company / hzkj_waybill_number / hzkj_shipping_time',display='logistics[].carrier / trackingNumber / shippedAt',rule='国内物流公司、快递号上下两行；与供应商发货时间按同条通知匹配。',evidence=['backend/src/modules/fop-data/collected-receipt-notice.ts','backend/src/modules/workbench-replica/receipt-logistics.ts'])
            paths.update(R/p for p in f['evidence'])
            cells=[label,f['display'],f['local'],f['source'],f['rule']]
            rows.append({'label':label,**f})
        matrix.append({**section,'rows':rows})
        body+=f'<section class="queue" id="{E(section["id"])}"><h2>{i:02d} · {E(section["title"])}</h2><p>工作台：{E(section["group"])}。字段值按当前本地权限范围返回，分页、统计、导出共用查询条件。</p><div class="matrix-wrap"><table class="matrix"><thead><tr>'+''.join('<th>'+x+'</th>' for x in ['前端字段','返回属性','本地保存 / 读取','FOP来源','实现规则 / 边界'])+'</tr></thead><tbody>'
        for row in rows:
            body+='<tr class="field-row">'+''.join('<td>'+E(row[k])+'</td>' for k in ['label','display','local','source','rule'])+'</tr>'
        body+='</tbody></table></div><details><summary>实现依据</summary><ul class="evidence">'+''.join('<li>'+E(p)+'</li>' for p in sorted({p for row in rows for p in row['evidence']}))+'</ul></details></section>'
    extra=(BASE/'current-additional.body.html').read_text();paths.add(BASE/'current-additional.body.html');body+=extra
    # Include implementations cited by supplemental sections, frontend table definitions and sync worker.
    paths.update(R/p for p in json.loads((BASE/'evidence-files.json').read_text()))
    paths.add(BASE/'evidence-files.json')
    evidence=[]
    for p in sorted(paths):
        assert p.is_file(),p
        evidence.append({'path':str(p.relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    body+='''<script>document.getElementById('search').addEventListener('input',function(){const q=this.value.trim().toLowerCase();document.querySelectorAll('.queue').forEach(s=>{let visible=0;s.querySelectorAll('.field-row').forEach(r=>{r.hidden=!(s.querySelector('h2').textContent+' '+r.textContent).toLowerCase().includes(q);if(!r.hidden)visible++});s.hidden=!visible})});</script>'''
    spec=importlib.util.spec_from_file_location('theme','/Library/VSCode/.hyperzone/html-style/render_html.py');theme=importlib.util.module_from_spec(spec);spec.loader.exec_module(theme)
    document=theme.render('HyperZone 23清单字段对照表','当前代码 · 本地保存 · 来源字段 · 实现边界',body,'字段实现对照','2026-11-25');theme.validate(document)
    (D/'matrix-reference.html').write_text(document)
    (D/'matrix.json').write_text(json.dumps(matrix,ensure_ascii=False,indent=2)+'\n')
    (D/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
    return document,matrix,evidence
if __name__=='__main__':
    _,m,_=build();print(json.dumps({'lists':len(m),'fields':sum(len(s['rows']) for s in m),'upstreamCalled':False}))
