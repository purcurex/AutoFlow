# -*- coding: utf-8 -*-
"""Generate the offline three-column field matrix from versioned mapping definitions.

Usage: python3 scripts/fop-local-field-matrix/generate.py
       python3 scripts/fop-local-field-matrix/validate.py
Only local code and FOP metadata are read; no network or database access occurs.
Generated audit manifests are written beneath .runtime/fop-local-field-matrix.
"""
from pathlib import Path
from html import escape as E
import json,re,importlib.util,hashlib
R=Path(__file__).resolve().parents[2]; D=R/'.runtime/fop-local-field-matrix'
D.mkdir(parents=True,exist_ok=True)
OUT=R/'docs/integrations/HyperZone待办清单数据字段对照表.html'
# List inventory is versioned here; no previous runtime artifact is required.
old=[{'group': 'sales', 'id': 'sales-unpaid', 'title': '待支付清单', 'main': '平台订单（履约订单）'}, {'group': 'sales', 'id': 'sales-review', 'title': '待审核清单', 'main': '平台订单（履约订单）'}, {'group': 'sales', 'id': 'sales-stock', 'title': '备货清单', 'main': '备货订单'}, {'group': 'sales', 'id': 'sales-rma', 'title': 'RMA售后清单', 'main': '售后单 RMA'}, {'group': 'sales', 'id': 'sales-exceptions', 'title': '异常订单清单', 'main': '平台订单（履约订单）'}, {'group': 'sales', 'id': 'sales-completed', 'title': '已完成清单', 'main': '平台订单（履约订单）'}, {'group': 'dispatch', 'id': 'dispatch-pending', 'title': '待履约清单', 'main': '平台订单（履约订单）'}, {'group': 'dispatch', 'id': 'dispatch-completed', 'title': '已履约订单', 'main': '平台订单（履约订单）'}, {'group': 'procurement', 'id': 'proc-fulfill-procurement', 'title': '待采购清单 · 履约单', 'main': '平台订单（履约订单）'}, {'group': 'procurement', 'id': 'proc-fulfill-procurement_shipping', 'title': '已采购待发货 · 履约单', 'main': '平台订单（履约订单）'}, {'group': 'procurement', 'id': 'proc-fulfill-completed', 'title': '采购完成清单 · 履约单', 'main': '平台订单（履约订单）'}, {'group': 'procurement', 'id': 'proc-purchase-procurement', 'title': '待采购清单 · 采购单', 'main': '采购订单'}, {'group': 'procurement', 'id': 'proc-purchase-procurement_shipping', 'title': '已采购待发货 · 采购单', 'main': '采购订单'}, {'group': 'procurement', 'id': 'proc-purchase-completed', 'title': '采购完成清单 · 采购单', 'main': '采购订单'}, {'group': 'procurement', 'id': 'proc-stock', 'title': '备货待采购清单', 'main': '备货订单'}, {'group': 'procurement', 'id': 'proc-returns', 'title': '采购退货清单', 'main': 'FOP 采购退货单'}, {'group': 'allocation', 'id': 'allocation-allocation', 'title': '未齐套清单', 'main': '配货单'}, {'group': 'allocation', 'id': 'allocation-allocation_review', 'title': '已齐套未审核', 'main': '配货单'}, {'group': 'allocation', 'id': 'allocation-completed', 'title': '配货完成清单', 'main': '配货单'}, {'group': 'warehouse', 'id': 'warehouse-inbound', 'title': '待入库清单', 'main': '收货通知单'}, {'group': 'warehouse', 'id': 'warehouse-outbound', 'title': '待出库清单', 'main': '发货通知单'}, {'group': 'warehouse', 'id': 'warehouse-completed', 'title': '已出库清单', 'main': '销售出库单'}, {'group': 'warehouse', 'id': 'warehouse-returns', 'title': '采购退货清单', 'main': 'FOP 采购退货单'}]
# Validate all published local references against the implemented schema, including later migration.
src=(R/'backend/src/database/workbench-schema.ts').read_text()
columns={m[0]:json.loads(m[1]) for m in re.findall(r'"(hz_fop_\w+)": Object.freeze\((\[[^\n]+?\])\)',src.split('export const WORKBENCH_PRIMARY_KEYS')[0])}
columns['hz_fop_workbench_receipt_notices']=['document_id','source_version','owner_employee_ids','ownership_verified_at','shipment_state','carrier_name','quantity','inbound_quantity','lines','published_at']
columns['organization_employees']=['name','department_id','account_id']
columns['organization_nodes']=['name']
refs=[]
def db(table,*fields):
 for field in fields:
  assert field in columns[table],(table,field)
  refs.append((table,field))
 return '<code class="table-name">'+E(table)+'</code><code class="fields">'+E(' · '.join(fields))+'</code>'
def n(text):return '<small>'+E(text)+'</small>'
def fop(doc,field='',note=''):
 return '<strong class="source">'+E(doc)+'</strong>'+('<code class="fields">'+E(field)+'</code>' if field else '')+(n(note) if note else '')
def wait(doc='',note='具体源字段及写入映射待确认。'):
 return '<!-- source-unconfirmed -->'+(fop(doc,note=note) if doc else '<span class="pending">待补映射</span>'+n(note))
def confirmed(doc,field='',note=''):
 return '<span class="review-tag review-confirmed">来源已确认</span>'+fop(doc,field,note)
def row(label,local,source,note=''):
 return dict(label=label,parts=[(local,source)],note=note)
def multi(label,parts,note=''):return dict(label=label,parts=parts,note=note)
O='hz_fop_workbench_orders'; L='hz_fop_workbench_order_lines'; SD='hz_fop_source_documents'; SL='hz_fop_source_lines'; M='hz_fop_workbench_memberships'; A='hz_fop_workbench_purchase_allocations'; Q='hz_fop_workbench_procurement_demands'
FD='履约订单 · hzkj_orders'; ST='备货订单 · hzkj_stock_order_new'; PD='采购订单 · hzkj_purorderbill'; RD='RMA售后单 · hzkj_after_sale_orders'; AD='配货单 · hzkj_alloc_bill'; DD='发运单 · hzkj_deliver_bill'; WD='发货通知单 · hzkj_deliver_order'; ID='收货通知单 · hzkj_receiptnotice'

def number(stock=False,flags=False):
 parts=[(db(O,'order_number')+n('订单编号；本单商品行计算款数、总件数。'),fop(ST if stock else FD,'billno'))]
 if flags:parts.append((db(O,'intercept_status','cancelled')+n('单号下的订单取消、拦截发货、取消拦截标签。'),wait('订单控制事实','仅按明确取消／拦截事实展示；FOP 标记字段待补。')))
 return multi('备货单号' if stock else '订单编号',parts,'含单号下商品统计'+('、订单标签' if flags else ''))
def products(stock=False,table=L):
 return row('商品图片 / 商品信息',db(table,'image_url','sku_code','product_name','variant','quantity')+n('整组展示；商品款数与总件数从完整明细计算。'),confirmed(ST if stock else FD,'hzkj_orders_billentry','本单商品分录及 SKU 基础资料；商品信息作为一个字段组。'),'图片、SKU、名称、属性、数量')
def amount(stock=False):
 return row('订单金额',db(O,'total_amount','currency_code',*(() if stock else ('product_amount','freight_amount','tax_amount','discount_amount'))),fop(ST if stock else FD,'hzkj_order_amount · hzkj_settlecurrency' if stock else 'hzkj_total_amount · hzkj_settlecurrency\nhzkj_order_amount · hzkj_fre_quo_amount · hzkj_fixed_tax_fee · hzkj_discount_cost','金额来源按现行建表定义与 FOP 元数据核对；领域适配已实现，正式API对应字段待提供；不能沿用旧接口将产品金额当总额。' if not stock else '备货金额与结算币种；按本单事实写入。'),'金额及币种'+('；悬浮明细：产品、运费、税费、优惠' if not stock else ''))
def customer():return row('Customer',db(O,'country_code','recipient_snapshot'),confirmed(FD,'hzkj_country · 本单收件人字段组','收件人对象整体来源已确认；独立17号接口包已定义州省 hzkj_state 及其余收件人字段；当前实际返回与完整数据仍待恢复联调确认，不再按未提供字段处理。'),'国家、收件人信息；含详情弹窗，不逐项展开')
def payment(label='客户付款时间',stock=False):return row(label,db(O,'customer_paid_at'),(confirmed(ST,'hzkj_receipt_date','客户付款时间待 FOP 通过收款单回写，数据未接入。') if stock else fop(FD,'hzkj_receipt_date')),'paidAt 与兼容字段 consumerPaidAt 当前均读取此字段；本列不是 C 端买家付款时间')
def custshop(stock=False,combined=False):
 doc=ST if stock else FD
 if combined:return [row('客户 / 店铺',db(O,'customer_name','store_name'),fop(doc,'hzkj_customer · hzkj_shop'))]
 return [row('客户名称',db(O,'customer_name'),fop(doc,'hzkj_customer')),row('店铺',db(O,'store_name'),wait(ST,'本地展示投影已读取 store_name；备货元数据没有 hzkj_shop，实际业务来源及写入映射待确认，不沿用履约单字段。') if stock else fop(doc,'hzkj_shop'))]
def warehouse(stock=False):return row('收货仓库' if stock else '发货仓库',db(O,'warehouse_id','warehouse_name'),fop(ST if stock else FD,'hzkj_warehouse' if stock else 'hzkj_dst_warehouse'),'列表当前读取订单展示仓；包裹路由仓通过关联事实另行保存')
def salesperson(stock=False):return multi('业务员',[(db(O,'owner_employee_id'),fop(ST if stock else FD,'hzkj_operator')),(db('organization_employees','name','department_id')+db('organization_nodes','name'),'<span class="local-only">本地组织目录</span>'+n('按员工绑定显示当前姓名、部门；不覆盖为 FOP 历史部门。'))],'姓名、业务部门')
def shopify():return row('Shopify 单号',db(O,'shopify_order_number'),fop(FD,'hzkj_source_number'))
def audit(label='订单审核时间'):return row(label,db(SD,'source_audited_at'),fop(FD,'auditdate'))
def logistics(label,tracking=True,dispatch=False,approved=False):
 if label=='自定义物流渠道':
  return row(label,db('hz_fop_fulfillment_orders','custom_channel_id','custom_channel_name'),confirmed(FD,'物流决策 · hzkj_customer_channel','自定义物流渠道；未支付时可能仅有此值，不能作为实际发运渠道。'))
 if dispatch:
  return multi(label,[(db('hz_fop_dispatches','actual_channel_id')+db('hz_fop_reference_items','name'),confirmed(DD,'hzkj_logistics_channel1','发运单物流渠道；与关联履约单渠道不一致时取发运单。')),(db('hz_fop_tracking_numbers','number','tracking_type'),confirmed(DD,'hzkj_logistics_orderno · hzkj_logistics_trackno','前者全程（QC），后者尾程（WC）；类型标签显示在号码后，保留同一发运单内对应关系。'))],'物流渠道名＋物流跟踪号；多张发运单逐组展示')
 parts=[(db('hz_fop_fulfillment_orders','custom_channel_id','custom_channel_name'),confirmed(FD,'物流决策 · hzkj_customer_channel','自定义物流渠道英文名称，直接展示，不加类型前缀。')),(db('hz_fop_order_packages','channel_id')+db('hz_fop_reference_items','name'),confirmed(FD,'包裹信息 · hzkj_channel','实际物流渠道中文名称；客户报价默认渠道可在同步订单时写入，审核时确认后续发货渠道；缺失保留空值。'))]
 if approved:parts.append((db('hz_fop_tracking_numbers','number','tracking_type','shopify_selected')+n('按包裹及当前有效发运关联读取选定跟踪号；无号码显示“尚未获取”。'),fop(DD,'hzkj_logistics_orderno · hzkj_logistics_trackno','发运取号后同步；对应全程、尾程，按 FOP 选定关系展示，实际选择与关联的同步写入待接通。')))
 return multi(label,parts,'英文自定义渠道＋中文实际渠道；'+('有跟踪号显示，无号显示“尚未获取”' if approved else '不加“自定义”“实际”前缀，不展示跟踪号'))

def dispatchnumber():return row('发运单编号',db(SD,'document_number')+n('通过 hz_fop_document_relations 的 dispatch 关联取得，可多单。'),fop(DD,'billno'))
def dispatchstatus(allocation=False):
 if allocation:return row('发运单状态',db(SD,'raw_bill_status')+n('配货清单全部审核为已完成，其余未完成。'),fop(DD,'billstatus'))
 return row('履约状态',db('hz_fop_dispatches','raw_delivery_status')+n('按关联有效发运单的交付状态实时归一化；全部 FULFILLED 才进入已履约。'),confirmed(DD,'hzkj_delivery_status · 交付状态','PENDING 待处理；TRACKING_OBTAINED 已取号未同步；FULFILLED 已发货；UPDATING 更正中；CANCELLED 已取消。多单优先显示更正中、已取消、待处理、已取号未同步；未知不当作完成。'))
def complete(role):
 if role=='sales':return row('订单审核时间',db(SD,'source_audited_at')+n('直接读取履约订单审核时间，不以清单阶段时间覆盖。'),fop(FD,'auditdate'))
 if role=='allocation':return row('配货审核时间',db(SD,'source_audited_at')+n('通过有效 allocation 关联读取配货单审核时间；多张配货单全部已审核时取最近审核时间，任一审核时间缺失则保留空值，不以阶段时间替代。'),confirmed(AD,'auditdate','配货单审核时间来源已确认；本地读取已调整，真实同步写入尚未接通。'))
 if role=='dispatch':return row('发运审核时间',db(SD,'source_audited_at')+n('取关联有效发运单审核时间；多单取最近一次。'),confirmed(DD,'auditdate'))
 titles={'sales':'订单审核时间','dispatch':'发运审核时间','procurement':'采购完成时间','allocation':'配货审核时间','warehouse':'出库完成时间'}
 return row(titles[role],db(M,'phase_completed_at')+n('按 queue_code 区分阶段；本地返回值已读取，来源计算需在同步适配中确认。'),fop(FD,'auditdate') if role=='sales' else wait({'dispatch':DD,'procurement':'采购完成事实','allocation':AD,'warehouse':'出库完成事实'}[role],'当前已履约页面展示发运审核时间；不能标成 Shopify 同步成功时间。' if role=='dispatch' else '具体完成证据及时间写入规则待实现。'))
def progress(q):
 if q in ['procurement','procurement_shipping']:
  parts=[(db('hz_fop_fulfillment_orders','raw_purchase_status'),confirmed(FD,'hzkj_purchase_status','履约订单表头：0 未采购、1 部分采购、2 已采购、3 已入库、4 已发货；已采购不代表采购款已付或1688已下单。')),(db(O,'purchase_application_state','purchase_coverage_state','platform_order_state','supplier_payment_state'),confirmed('采购申请／采购订单／平台下单及付款事实',note='用于具体采购进度筛选及辅助标签，与履约订单原生采购状态分开；业务来源已确认，具体源字段及归一化规则待确认。'))]
  if q=='procurement_shipping':parts.append((db(O,'supplier_shipment_state'),confirmed(PD,'hzkj_shipping_tim · hzkj_status_changed','元数据中的供应商发货时间与物流状态；归档 queryPurchase 及原始事实均未定义这两项。08号收货通知单提供的是该单 hzkj_shipping_time／hzkj_status_changed，须确认明确来源关联后再使用，不能换成同名采购事实。')))
  return multi('采购状态' if q=='procurement' else '供应商发货状态',parts,'原生状态从本地履约订单表读取；未知不默认未采购。待采购 logisticsGate 由有效 dispatch 关联及 hz_fop_tracking_numbers.tracking_type／number／removed_at 计算：无单 pending_dispatch；任一有效全程 QC 号即 satisfied，否则 pending_logistics。发运制备及待1688下单筛选已落地；配货发运完成须非空且全部有效发运单 hz_fop_source_documents.raw_bill_status=C。关联未核验先报不完整。真实同步写入待接通。')
 if q=='shipping':return row('出库状态',db('hz_fop_fulfillment_orders','raw_delivery_status'),confirmed(FD,'hzkj_delivery_status','履约订单表头：0 未出库、1 部分出库、2 已出库；不是分录 hzkj_outbound_status。历史部分出库如实展示，不新增部分出库操作；拦截标签独立。'),'页面、排序、待出库判断与 Excel 统一读取本地原生状态；未知不默认未出库。')
 if q=='exceptions':return row('异常类型',db('hz_fop_exception_marks','type'),wait('异常分类','采购退货、订单取消、配货超时、物流异常、妥投异常；FOP 分类字段待补。'))
 return None

def regular(q,completed=False,role='sales'):
 rows=[number(flags=q=='shipping' and not completed),products(),shopify(),amount(),customer()]
 if q=='review':rows += [logistics('物流信息',approved=completed),warehouse()]
 if q!='unpaid':rows.append(payment('收款日期'))
 if q=='allocation_review':rows.append(row('配货单号',db(SD,'document_number')+n('allocation 关联唯一一张配货单时返回；多包裹配货单展示待完善。'),fop(AD,'billno')))
 if q in ['dispatch','allocation','allocation_review']:rows.append(dispatchnumber())
 if completed and q=='dispatch':rows.append(dispatchstatus())
 elif completed and q=='allocation_review':rows.append(row('审核状态',db(SD,'raw_bill_status')+n('直接依据关联有效配货单审核状态；C 显示已审核，多单全部已审核才进入本清单。撤销审核后不再展示为完成。'),confirmed(AD,'billstatus','配货单审核状态来源已确认；不使用固定“已完成”标签，真实同步写入尚未接通。')))
 elif completed and q=='procurement':rows.append(row('采购状态',db('hz_fop_fulfillment_orders','raw_purchase_status'),confirmed(FD,'hzkj_purchase_status','4 已发货；后续变为 3 已入库仍保留完成记录，排除无需新采购的备货库存订单。')))
 elif completed and q=='shipping':rows.append(progress(q))
 elif completed and q!='review':rows.append(row('完成状态',db(M,'queue_code','classification_state')+db(O,{'dispatch':'shopify_sync_state','procurement':'procurement_stage','allocation':'allocation_review_state','warehouse':'outbound_state'}[role]),wait('阶段完成事实','按本地队列成员关系与明确阶段事实展示；不能仅凭源单存在判为完成。')))
 elif not completed:
  if q in ['dispatch','allocation','allocation_review']:rows.append(dispatchstatus(q.startswith('allocation')))
  elif progress(q):rows.append(progress(q))
 rows+=custshop()
 if q=='exceptions':rows += [row('异常原因',db('hz_fop_exception_marks','reason'),wait('异常原因','保留原始原因文本；具体 FOP 字段待补。')),row('异常时长',db('hz_fop_exception_marks','occurred_at')+n('当前时间减发生时间，本地计算。'),wait('异常发生时间'))]
 if q!='review':rows.append(warehouse())
 if q=='unpaid':rows.append(logistics('自定义物流渠道'))
 if q=='dispatch':rows.append(logistics('物流渠道 / 跟踪号',dispatch=True))
 if q=='shipping':
  shipment=logistics('物流渠道 / 跟踪号',dispatch=True)
  shipment['note']='履约订单视角，一单一行；仅展示有效关联、未删除且 billstatus=C 的已审核发运单；多个发运包裹逐组展示。撤审、删除、解除关联后移除物流，不回退履约包裹信息；页面与 Excel 同口径，真实同步写入待接通。'
  rows.append(shipment)
 rows.append(salesperson())
 if completed or q in ['procurement','procurement_shipping','allocation_review','shipping']:rows.append(payment())
 if completed:rows.append(complete(role))
 elif q=='procurement':rows.append(audit())
 elif q=='procurement_shipping':rows.append(multi('采购付款时间',[(db('hz_fop_purchase_orders','paid_at')+n('经履约—采购明确分摊关联读取；多采购单取最早付款时间，任一付款时间未知则保留空值。'),confirmed(PD,'hzkj_pay_time','queryPurchase 与原始事实已定义支付时间；当前元数据未见同名字段，是否覆盖线下、部分付款及退款后的口径待确认，真实写入尚未接入。')),(db('hz_fop_stock_orders','procurement_paid_at')+db('hz_fop_stock_consumptions','stock_document_id','order_document_id'),confirmed(ST,note='使用全款备货库存时取备货订单采购付款时间；具体源字段待确认，真实写入尚未接入。此类无新采购需求履约单不进入待采购。'))]))
 elif q=='allocation_review':rows.append(row('齐套时间','<span class="pending">本地列表尚未返回</span>'+db('hz_fop_allocations','ready_at')+n('存储位置已建；allocationReadyAt 尚未映射到列表。'),fop(AD,'hzkj_complete_time','已核对存储来源；尚未接入列表返回。')))
 elif q=='shipping':rows.append(row('WMS创建时间','<span class="pending">本地列表尚未返回</span>'+db('hz_fop_delivery_notices','wms_created_at'),fop(WD,'hzkj_bill_create_time','存储位置已建；wmsCreatedAt 尚未映射到列表。')))
 else:rows.append(payment())
 return rows

def stock(proc=False):
 rows=[number(True),products(True),row('备货类型',db(O,'stock_type'),fop(ST,'hzkj_stock_type'))]
 if not proc:rows.append(row('备货订单状态',db(O,'customer_payment_state','order_review_state')+n('由两项本地阶段组合为未支付／已支付／已审核。'),fop(ST,'hzkj_receipt_status · billstatus','原始状态需经归一化，不直接透传为前端标签。')))
 rows += [row('采购状态',db(O,'stock_lifecycle','supplier_shipment_state','procurement_stage','purchase_coverage_state')+n('当前 SQL 按阶段组合生成 purchaseStatus。'),fop(ST,'hzkj_purchase_status','原生备货采购状态已核对；同步时如何形成上述归一化字段仍需实现。')),amount(True),payment(stock=True),row('创建时间',db(O,'business_created_at'),confirmed(ST,'hzkj_bizdate','元数据字段名称：创建时间；用于创建时间筛选与排序。'))]
 rows+=custshop(True) if proc else custshop(True)[:1]
 rows += [warehouse(True),salesperson(True)]
 return rows

def rma():
 return [number(flags=True),products(),shopify(),amount(),row('退款金额',db('hz_fop_rma_orders','refund_amount','refund_currency'),fop(RD,'hzkj_refund_amount · hzkj_tocurr','一张售后单一行，退款金额不跨 RMA 汇总；现有原始响应缺退款结算币种，不以原单币种兜底。')),row('RMA单',db('hz_fop_rma_orders','after_sale_type')+db(SD,'document_number'),fop(RD,'hzkj_sales_type · number / billno','已有 RMA 查询响应使用 number；保留每张售后单，原始标识与单号分别保存。'),'售后类型＋售后单号；同一履约单有多张售后单时分别占一行'),row('售后原因',db('hz_fop_rma_orders','reason'),fop(RD,'hzkj_resason1','旧适配有原因名称回退；同步时保留明确原文。'))]+custshop(combined=True)+[warehouse(),salesperson(),payment()]

def returns():
 pieces=[(db('hz_fop_purchase_returns','raw_physical_status','reason')+db(SD,'document_number'),wait('FOP 采购退货单','业务主体已确认；正式实体编码和 API 待补。当前 raw_physical_status 仅模拟模式用于已知标签，正式归一化待实现。')),(db('hz_fop_return_line_details','requested_quantity','returned_quantity')+db(SL,'sku_code'),wait('FOP 采购退货单分录','申请／已退数量与退货商品；正式来源字段待补。')),(db(SD,'document_number')+db('hz_fop_purchase_returns','purchase_source_id','supplier_id')+db('hz_fop_reference_items','name'),wait(PD,'采购单号、供应商经本地已解析关联读取；正式退货来源关联待补。')),('<span class="pending">退货物流尚未返回</span>'+n('需求为退货物流渠道名＋物流跟踪号；渠道字段待补，跟踪号当前为空。'),wait('退货物流事实'))]
 return [number(),products(),shopify(),amount(),customer(),payment(),multi('采购退货',pieces,'退货单、进度、数量、采购单、供应商、物流渠道名＋物流跟踪号')]+custshop()+[warehouse(),salesperson(),audit()]

def purchase_group(shipping=False,completed=False):
 rows=[multi('采购单信息',[(db(SD,'document_number')+db('hz_fop_purchase_orders','purchase_type','platform_code'),fop(PD,'billno','采购类型及平台分类源字段待确认。')),(db('hz_fop_purchase_orders','supplier_id')+db('hz_fop_reference_items','name'),fop(PD,'hzkj_supplier')),(db('hz_fop_platform_orders','external_order_id'),confirmed(PD,'hzkj_1688_order_n','1688 下单回传号；queryPurchase 与原始事实已定义本字段。本地有效平台订单 external_order_id 已直接返回；真实同步仍未接通。'))],'组头：采购单号、供应商、采购类型、1688 单号'),multi('采购进度',[(db('hz_fop_purchase_orders','raw_trade_status','raw_platform_status'),confirmed(PD,'hzkj_paystatus · hzkj_pay_status · hzkj_purchase_channel','现有 API 已定义供应商付款状态、1688订单状态与采购渠道；与付款／下单标签的枚举归一化、线下无需平台规则仍待确认。正式模式不得按旧 Mock 规则猜测。'))]+([(db('hz_fop_procurement_line_details','ordered_quantity','supplier_shipped_quantity'),confirmed(PD,'hzkj_billentry · hzkj_qty · hzkj_transportqty','queryPurchase 已定义采购数量和已运输数量；已运输是否等于供应商已发货、取消／退货后的数量口径仍待确认。不可直接将已运输量当已发量；整单来源及授权完整性须独立核验。'))] if shipping or completed else [])),row('采购付款时间',db('hz_fop_purchase_orders','paid_at'),confirmed(PD,'hzkj_pay_time','queryPurchase 与原始事实已定义支付时间；当前元数据未见同名字段，是否覆盖线下、部分付款及退款后的口径待确认，真实同步尚未接入。')),multi('履约笔数 / SKU数 / 数量',[( db('hz_fop_procurement_line_details','sales_order_number')+n('按整张采购单有效分录的销售订单编号去除首尾空白、排除空号后去重；NULL 代表尚未映射并阻断不完整结果。展开明细总数另按授权履约订单 ID 去重，不混用组头笔数。'),confirmed(PD,'采购分录 · hzkj_salbillnumber','履约笔数＝本采购单当前权限范围内，关联销售订单（平台订单／履约订单）编号的去重个数；相同销售订单号跨 SKU、跨分录仅计一笔。去除首尾空白、忽略空号，保留完整编号，不按前缀排除平台订单，不按 ID 或分录行数替代。')),(db(SL,'sku_code','removed_at')+n('按采购主单全部未移除的有效分录 SKU 去重；不按履约分摊行数计数，不受搜索命中行或展开分页影响。'),confirmed(PD,note='SKU 数＝采购单全部有效商品分录的 SKU 去重个数；相同 SKU 多行合并，未知 SKU 使整单结果未就绪。业务来源已确认，具体 SKU 原始字段及同步映射待补。')),(db('hz_fop_procurement_line_details','ordered_quantity','supplier_shipped_quantity','cancelled_quantity')+n('按采购主单全部有效分录汇总采购、已发及采购减已发的未发数量；同 SKU 多分录合并等价求和。缺量、负数、超发、取消量非明确零或来源权限不足时阻断，不以分摊或零兜底。'),confirmed(PD,'hzkj_billentry · hzkj_qty · hzkj_transportqty','采购数量 hzkj_qty 已提供定义；已运输数量 hzkj_transportqty 是供应商已发量候选，业务含义及取消／退货影响待确认。按全部有效分录合并 SKU 再汇总，不以运输、收货或入库量直接替代已发量；未知不按零处理。'))],'整单组头：销售订单号去重笔数、SKU 去重种数、商品采购／已发／未发件数；与展开明细分页统计分开'),row('客户付款时间摘要',db(O,'customer_paid_at')+n('按组内授权履约单计算最早／最近客户付款时间。'),fop(FD,'hzkj_receipt_date')),row('待创建采购单组',db(Q,'unassigned_quantity','order_document_id','order_line_id'),'<span class="local-only">本地需求汇总</span>'+n('未分配到采购单的需求统一一组；组内订单编号、查询和信息展示均以履约订单为主体。没有采购单号及供应商发货状态；按履约订单查询并展示相应商品需求。'))]
 rows += [row('展开明细 · 履约订单',db(O,'order_number','shopify_order_number'),fop(FD,'billno · hzkj_source_number'),'履约订单号及 Shopify 单号'),multi('展开明细 · 商品信息',[(db(SL,'image_url','sku_code','product_name','variant'),confirmed(FD,'hzkj_orders_billentry','本单分录商品资料。')),(db(A,'allocated_requirement_quantity','supplier_shipped_quantity')+db(Q,'unassigned_quantity'),wait('采购需求与履约分摊','明细数量按本组需求，不把采购整单数量重复分配给每笔履约。'))]),row('展开明细 · 客户 / 店铺',db(O,'customer_name','store_name'),fop(FD,'hzkj_customer · hzkj_shop')),multi('展开明细 · 发货仓库 / '+('采购完成时间' if completed else '客户付款时间'),[(db(O,'warehouse_name'),fop(FD,'hzkj_dst_warehouse')),(('<span class="pending">本地展开明细尚未返回 completedAt</span>' if completed else db(O,'customer_paid_at')),wait('采购完成事实','已有阶段时间存储，但采购组展开明细尚未返回；不可替换为付款时间。') if completed else fop(FD,'hzkj_receipt_date'))]),salesperson()]
 if completed:
  rows[2]=row('采购完成时间','<span class="pending">本地采购组头尚未返回 completedAt</span>',wait('采购完成事实','当前页面已预留展示，组头汇总时间尚未映射。'))
 # Match the expanded table: salesperson precedes warehouse / event time.
 rows[-2],rows[-1]=rows[-1],rows[-2]
 for r in rows:
  if r['label']=='业务员':r['label']='展开明细 · 业务员 / 部门'
 return rows

def inbound():
 P='hz_fop_workbench_receipt_notices';N='hz_fop_receipt_notices'
 rows=[row('收货通知单编号',db(SD,'document_number'),fop(ID,'billno')),row('商品图片 / 商品信息',db(P,'lines'),confirmed(ID,'本单商品分录','商品资料来源确认；逐行已入库数量仍待确认，不包含在本次商品资料确认范围。'),'图片、SKU、名称、属性、数量及入库进度'),row('通知 / 已入库 / 待入库',db(P,'quantity','inbound_quantity')+n('待入库＝通知数量－已入库数量，逐行与整单核对。'),wait(ID,'逐行已入库及数量汇总写入待接通；未知不记为 0。')),row('供应商',db(N,'supplier_id')+db('hz_fop_reference_items','name'),confirmed(ID,'采购信息 · hzkj_providersupplier','供货供应商；按本单 supplier_id 关联供应商基础资料名称，不取履约单或采购订单上的其他供应商。真实同步写入待接通。')),row('收货仓库',db(N,'warehouse_id')+db('hz_fop_reference_items','name','code'),confirmed(ID,'hzkj_ware_house','通知单表头仓库；不取履约发货仓库，也不混用商品分录 hzkj_warehouse。真实同步写入待接通。')),row('供应商发货时间',db(N,'supplier_shipped_at'),fop(ID,'hzkj_shipping_time')),row('物流信息',db(P,'carrier_name')+db(N,'tracking_number'),confirmed(ID,'物流信息 · hzkj_logistics_company · hzkj_waybill_number','本单国内物流公司名称＋国内运单号，对应供应商发往国内仓库的收货包裹；不取履约／发运渠道、全程或尾程跟踪号，不加 QC/WC 标记。真实同步写入待接通。')),row('入库进度',db(P,'shipment_state','quantity','inbound_quantity')+db(N,'raw_wms_status')+n('已审核、明确已发货且有未入库余额；按本单事实计算未入库／部分入库。'),fop(ID,'billstatus · hzkj_receiptnotice_status','供应商已发货证明仍需明确映射，WMS 状态不能替代。'))]

 order=['收货通知单编号','商品图片 / 商品信息','供应商','收货仓库','供应商发货时间','物流信息','入库进度','通知 / 已入库 / 待入库']
 return sorted(rows,key=lambda r:order.index(r['label']))

sections=[]
for s in old:
 id=s['id'];note='';g=s['group']
 if id=='sales-stock':rows=stock()
 elif id=='proc-stock':rows=stock(True)
 elif id=='sales-rma':rows=rma();note='一张 RMA 售后单一行，以售后单 ID 作为行、勾选及导出标识；同履约单多售后分别展示。订单基础信息来自本地履约投影，售后类型、原因、退款金额来自当前售后单。筛选后按售后单分页计数。'
 elif id.endswith('returns'):rows=returns();note='业务主体为 FOP 采购退货单，列表仍按履约订单聚合。旧表设计绑定 hzkj_purrefundapplybill（采购退款申请）尚未按新口径调整；不能据此认定采购退货 API 已接通。'
 elif id=='warehouse-inbound':rows=inbound();note='一张收货通知单一行；本单数量、商品及入库进度整体展示。真实来源写入新增投影尚待完成。'
 elif id.startswith('proc-purchase'):rows=purchase_group('shipping' in id,'completed' in id);note='按采购单查看：组头单据号为采购订单号，展开明细为关联履约订单号；1688 订单号为平台采购回传号，单独展示。未创建采购单的需求统一成组，组内编号、查询及明细均以履约订单为主体，无采购订单号。整单 SKU、销售订单号及数量已按采购主单有效分录汇总；展开明细仍按关联履约需求分页。缺源字段或整单授权不完整时明确未就绪，真实同步仍待接通。'
 else:
  q={'sales-unpaid':'unpaid','sales-review':'review','sales-exceptions':'exceptions','sales-completed':'review','dispatch-pending':'dispatch','dispatch-completed':'dispatch','proc-fulfill-procurement':'procurement','proc-fulfill-procurement_shipping':'procurement_shipping','proc-fulfill-completed':'procurement','allocation-allocation':'allocation','allocation-allocation_review':'allocation_review','allocation-completed':'allocation_review','warehouse-outbound':'shipping','warehouse-completed':'shipping'}[id]
  role={'sales':'sales','dispatch':'dispatch','procurement':'procurement','allocation':'allocation','warehouse':'warehouse'}[g]
  rows=regular(q,'completed' in id,role)
  if g in ['allocation','warehouse']:note='业务阶段来源为'+s['main']+'；当前列表按履约订单展示，订单基础列读取履约投影，单据编号及阶段信息通过本地关联取得。'
  else:note='一笔履约订单一行；本地查询投影提供基础信息，关联状态另列来源。'
 if id=='proc-fulfill-procurement':
  note='按履约单查看：一笔履约订单一行，订单编号为履约订单号。切换按采购单查看：采购单组头编号为采购订单号，展开明细显示关联履约订单号。两种视图的主单编号分别对应各自主体。'
  rows[0]['note']='履约订单号；含本单商品统计'
 if id=='sales-completed':note='已审核履约订单；后续采购、发运、出库不改变归属。跟踪号取当前有效发运关联，有号显示，无号显示“尚未获取”；不是全部业务流程已完成。'
 sections.append(dict(id=id,title='已审核清单' if id=='sales-completed' else s['title'],group=g,rows=rows,note=note))

# Show both the actual query field and the typed source storage without adding columns.
for section in sections:
 for r in section['rows']:
  revised=[]
  for local,source in r['parts']:
   stock_source=ST in source
   if FD in source or stock_source:
    typed='hz_fop_stock_orders' if stock_source else 'hz_fop_fulfillment_orders'
    targets=[]
    if '<code class="table-name">'+O+'</code>' in local:
     matches=re.findall(r'<code class="table-name">'+O+r'</code><code class="fields">(.*?)</code>',local)
     lookup={'order_number':(SD,'document_number'),'customer_name':(typed,'customer_id'),'store_name':(typed,'store_id'),'warehouse_name':(typed,'warehouse_id'),'currency_code':(typed,'settlement_currency')}
     for match in matches:
      for name in match.split(' · '):
       if name in lookup:targets.append(lookup[name])
       elif name in columns[typed]:targets.append((typed,name))
     if 'recipient_snapshot' in ' '.join(matches):
      # Keep the recipient as a single field group, per document scope.
      local+=n('来源落库：hz_fop_fulfillment_orders 的收件人、国家与地址字段组。')
    if '<code class="table-name">'+L+'</code>' in local:
     targets.extend((SL,name) for name in ['image_url','sku_code','product_name','variant','quantity'])
    by_table={}
    for table,field in targets:
     assert field in columns[table],(table,field)
     refs.append((table,field))
     by_table.setdefault(table,[])
     if field not in by_table[table]:by_table[table].append(field)
    for table,fields in by_table.items():local+=n('来源落库：'+table+' · '+' / '.join(fields))
   revised.append((local,source))
  r['parts']=revised

# API supply is independent of source confirmation and live synchronization.
# Audited against individual archived packages 01-19 on 2026-11-11. The merged
# OpenAPI is older than package 17; it must not silently override its fields.
API_DEFINED={
 'hzkj_orders': set('billno billstatus auditdate hzkj_orders_billentry hzkj_source_number hzkj_receipt_date hzkj_datetimefield hzkj_customer hzkj_shop hzkj_dst_warehouse hzkj_operator hzkj_country hzkj_customer_channel hzkj_delivery_status hzkj_order_amount hzkj_state'.split()),
 'hzkj_stock_order_new': set('billno billstatus hzkj_orders_billentry hzkj_order_amount hzkj_stock_type hzkj_receipt_status hzkj_purchase_status hzkj_bizdate hzkj_receipt_date hzkj_customer hzkj_operator hzkj_warehouse'.split()),
 'hzkj_purorderbill': set('billno hzkj_supplier hzkj_pay_time hzkj_paystatus hzkj_pay_status hzkj_purchase_channel hzkj_1688_order_n hzkj_billentry hzkj_qty hzkj_transportqty hzkj_salbillnumber'.split()),
 'hzkj_after_sale_orders': set('billno number hzkj_sales_type hzkj_resason1 hzkj_refund_amount'.split()),
 'hzkj_alloc_bill': set('billno billstatus auditdate hzkj_complete_time'.split()),
 'hzkj_deliver_bill': set('billno billstatus auditdate hzkj_delivery_status hzkj_logistics_orderno hzkj_logistics_trackno'.split()),
 'hzkj_deliver_order': set('billno hzkj_bill_create_time'.split()),
 'hzkj_receiptnotice': set('billno billstatus hzkj_shipping_time hzkj_status_changed hzkj_receiptnotice_status hzkj_logistics_company hzkj_waybill_number'.split()),
}
API_MISSING={
 'hzkj_orders': set('hzkj_total_amount hzkj_settlecurrency hzkj_fre_quo_amount hzkj_fixed_tax_fee hzkj_discount_cost hzkj_channel'.split()),
 'hzkj_stock_order_new': {'hzkj_settlecurrency'},
 'hzkj_after_sale_orders': {'hzkj_tocurr'},
 'hzkj_deliver_bill': {'hzkj_logistics_channel1'},
 'hzkj_purorderbill': {'hzkj_shipping_tim','hzkj_status_changed'},
 'hzkj_receiptnotice': {'hzkj_ware_house','hzkj_providersupplier'},
}
API_PACKAGES={'hzkj_orders':'01号履约查询／17号原始事实','hzkj_stock_order_new':'14号备货查询','hzkj_purorderbill':'07号采购查询／17号原始事实','hzkj_after_sale_orders':'13号RMA查询','hzkj_alloc_bill':'02号配货查询／17号原始事实','hzkj_deliver_bill':'03号发运查询／17号原始事实','hzkj_deliver_order':'04号发货通知／17号原始事实','hzkj_receiptnotice':'08号收货通知查询'}
API_LABELS={'defined':'API 已提供定义待联调','confirm':'API 待确认','missing':'API 待提供'}
def api_state(local,source):
 if 'local-only' in source:return None,''
 doc=re.search(r'<strong class="source">[^<]* · (hzkj_\w+)</strong>',source)
 field_block=re.search(r'<code class="fields">(.*?)</code>',source,re.S)
 if 'FOP 采购退货单' in source or '退货物流事实' in source:return 'missing','归档19类接口包未提供正式采购实物退货接口。'
 if not doc:return 'confirm','来源能力或正式字段尚待 FOP 确认；不据业务来源确认推定 API 已提供。'
 entity=doc[1];package=API_PACKAGES.get(entity,'现有接口包')
 if field_block:
  fields=set(re.findall(r'hzkj_\w+|\bbillno\b|\bbillstatus\b|\bauditdate\b|\bnumber\b',field_block[1]))
  missing=fields & API_MISSING.get(entity,set())
  if missing:return 'missing',package+'未定义：'+'、'.join(sorted(missing))+'；需 FOP 扩展正式响应。'
  if entity=='hzkj_orders' and 'hzkj_purchase_status' in fields:return 'confirm','01号包已定义采购状态，但枚举仍是旧版0／1／2；17号原始事实未定义该表头，须确认当前0—4枚举与发布响应。'
  if fields and fields <= API_DEFINED.get(entity,set()):return 'defined',package+'已提供字段定义；数据完整性、业务口径及真实返回仍须联调验收。'
 if entity=='hzkj_receiptnotice' and 'inbound_quantity' in local:return 'missing','08号包只定义已收货量，未定义可直接使用的逐行已入库量；需补来源及响应。'
 if entity=='hzkj_receiptnotice' and 'lines' in local:return 'confirm','08号包已有商品分录；SKU基础资料引用与商品属性完整性、真实返回仍待确认。'
 return 'confirm',package+'存在查询能力；本行具体字段、完整关联或归一化口径仍待确认。'

# Local-read coverage and source confirmation are separate from global live sync.
def local_state(local,source):
 text=re.sub('<[^>]*>',' ',local+' '+source)
 if '本地列表尚未返回' in local:return 'schema-only'
 if any(term in local for term in ['本地字段与统计映射待补','字段与列表映射待补','尚未接入整单统计','本地展开明细尚未返回','本地采购组头尚未返回','退货物流尚未返回','多包裹配货单展示待完善']):return 'mapping-pending'
 if any(term in text for term in ['仅 Mock','仅模拟模式','当前仅 Mock']):return 'mock-only'
 return 'local-read'

LOCAL_LABELS={'local-read':'完整模式读取已实现','schema-only':'仅存储预留','mapping-pending':'本地映射待补','mock-only':'仅 Mock 归一化'}
def review_flags(local,source):
 text=re.sub('<[^>]*>',' ',local+' '+source)
 source_unknown='<!-- source-unconfirmed -->' in source or '待确认' in source or '仍需明确映射' in source or any(term in source for term in ['待同步适配确认','源字段待确认','来源待确认','具体源字段及归一化规则待确认','原始接口缺失','原始响应缺退款结算币种','数量仍待确认','原始字段及同步映射待补','数量字段及同步映射待补','具体关联分摊写入契约待补'])
 # A confirmed business object never hides an unresolved physical field or mapping.
 not_connected=local_state(local,source)!='local-read' or any(term in text for term in ['原始接口缺失','原始响应缺退款结算币种','数据未接入','跟踪号当前为空'])
 return source_unknown,not_connected

def review_badges(source_unknown,not_connected):
 return ('<span class="review-tag review-source">来源待确认</span>' if source_unknown else '')+('<span class="review-tag review-missing">数据未接入</span>' if not_connected else '')

styles='''<style>
.api-defined{color:#165a9b;background:#eaf1f7;border-color:#9ab7ce}.api-confirm{color:#8a4708;background:#fff2d7;border-color:#e7b35c}.api-missing{color:#a12424;background:#ffebeb;border-color:#e7a2a2}

.review-local{color:#165a9b;background:#eaf1f7;border-color:#9ab7ce}.review-confirmed{color:#12685e;background:#e6f5f0;border-color:#85c9b7}.review-tag{display:inline-block;padding:2px 8px;margin:0 6px 7px 0;border:1px solid;border-radius:5px;font-size:12px;font-weight:650;line-height:1.7;white-space:nowrap;text-indent:0}.review-source{color:#8a4708;background:#fff2d7;border-color:#e7b35c}.review-missing{color:#a12424;background:#ffebeb;border-color:#e7a2a2}.matrix tbody td.review-source-cell{background:#fffaf0;border-left:3px solid #db9a32}.matrix tbody td.review-missing-cell{background:#fff5f5;border-left:3px solid #cf5252}.review-legend{padding:14px 16px;border:1px solid #dbe5ed;border-radius:8px;margin:20px 0}.review-legend>div{display:flex;gap:8px;align-items:baseline;margin:4px 0}.review-legend .review-tag{flex-shrink:0}.matrix-tools select{font:inherit;border:1px solid #cbd8e3;border-radius:6px;padding:10px;background:#fff;max-width:100%}.matrix-tools{flex-wrap:wrap}.review-note{font-size:12px;color:#5b6e80}@media print{.review-tag,.matrix tbody td.review-source-cell,.matrix tbody td.review-missing-cell{print-color-adjust:exact;-webkit-print-color-adjust:exact}.review-tag{font-size:9px}}

.flow{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap;margin:20px 0}.flow span{background:#eaf3f7;padding:12px 18px;border-radius:7px;font-weight:600;color:#133f69}.flow b{align-self:center;color:#087f8c}.guide{border-left:3px solid #087f8c;padding:4px 16px;background:#f3f8fa}.guide p{margin:8px 0}.matrix{table-layout:fixed;width:100%}.matrix col:first-child{width:22%}.matrix col:nth-child(2){width:43%}.matrix col:last-child{width:35%}.matrix td,.matrix th{vertical-align:top;overflow-wrap:anywhere}.matrix td{padding:13px 15px}.matrix tbody:nth-of-type(even) td{background:#f8fafc}.matrix tbody td[rowspan]{vertical-align:top;border-right:1px solid #e2e9ef}.matrix tbody+tbody tr:first-child td{border-top:1px solid #cbd8e3}.matrix code{background:transparent;padding:0;color:#254c6c;font-size:11.5px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.table-name,.fields{display:block}.table-name{font-weight:600;margin-top:5px}.fields{margin:3px 0 7px}.matrix small{display:block;color:#5b6e80;font-size:12px;line-height:1.75;margin-top:6px}.source{font-size:13px;font-weight:600;display:block}.pending{color:#9b5b13;font-weight:600}.local-only{color:#087f8c;font-weight:600}.section-note{color:#5b6e80}.list-block{scroll-margin-top:18px}.matrix-tools{display:flex;gap:10px;align-items:center;margin:20px 0}.matrix-tools input{font:inherit;border:1px solid #cbd8e3;border-radius:6px;padding:10px 12px;width:min(480px,100%)}.matrix-tools button{font:inherit;border:1px solid #cbd8e3;padding:10px 12px;background:white;border-radius:6px;cursor:pointer}.toc .sub a{font-size:12px;padding-left:18px;line-height:1.5}.evidence code{overflow-wrap:anywhere;font-size:12px}.table-wrap{max-width:100%}[hidden]{display:none!important}@media(max-width:760px){.matrix{min-width:780px}.matrix-tools{flex-wrap:wrap}}@media print{.matrix-tools{display:none}.matrix{min-width:0}.matrix td{padding:7px 9px}.matrix code{font-size:9px}.matrix small{font-size:10px}thead{display:table-header-group}tbody{break-inside:avoid}.list-block{break-before:auto}.table-wrap{overflow:visible} @page{size:A4 landscape;margin:14mm}}
</style>'''
body=styles+'''<section><h2 id="reading">01 · 读取链路</h2>
<div class="flow"><span>FOP 业务单据</span><b>→</b><span>同步落库 · 来源事实表</span><b>→</b><span>本地展示投影与关联查询</span><b>→</b><span>工作台列表</span></div>
<p>本表用于核对列表需求、本地读取字段与上游业务来源。本表只记录数据展示列，不包含勾选、展开、催办等操作列。列表、筛选、排序、分页及合计读取本地数据库；FOP API 服务于服务端同步落库，不作为页面取数接口。</p>
<p>当前进入工作台或切换清单只读取本地，自动增量已暂停；筛选、翻页、排序与“刷新”只重查本地。“同步数据”由后台任务完成，成功后再重查本地。即时库存查询及审核属于独立按需能力，不纳入本表。</p>
<div class="guide"><span class="review-tag review-missing">旧 API 已入库展示 · 完整同步待接通</span><p><strong>核对状态：</strong>本轮新增已采集只读模式：旧 API 完整游标扫描后写入 hz_fop_collected_orders，销售清单直接读取本地已知字段，缺失值留空；下游数据集显示未接入。正式一致快照、变更及授权续验协议仍待 FOP 提供。下方 23 清单矩阵记录完整模式设计；当前实际入库与展示路径以“已采集模式字段”表为准，不能把完整模式映射数量当作本轮已采集字段数量。</p></div>
<h3>配货流程适用版本</h3><p>现阶段履约审核后自动建配货单；使用备货库存且够用的齐套待审单归“已齐套未审核”。不齐套无法通过 FOP 配货审核，预占／锁库门禁已有；本表现行配货查询仍要求有效配货单。若采集显示已审无单或已审却不齐套，应核查异步任务、关联与版本，不认定正常流程缺口。</p><p>未来智能配货改为订单先预占、齐套后建单，需新增订单级待配货视图及五进度、计算结果、预占与变更字段；拦截闭环另待 FOP 补齐。上述未来字段／API 和本地接收适配均待开发，未加入下列现行 348 条映射，不能把本段说明当作已实现。详见<a href="HyperZone智能办公平台项目FOP扩展开发需求.html">扩展需求 V1.4</a>未来智能配货与拦截相关 E13—E15。</p>
<h3>三列阅读规则</h3><ul><li><strong>前端展示字段：</strong>按列表列名记录。商品、收件人等同源对象整体描述，不拆成每个属性。</li><li><strong>本地数据库字段：</strong>先列当前查询实际读取的表和列，并在同格注明来源落库位置。“本地读取已接入”只证明读取路径存在；“仅存储预留”表示列已建但列表尚未返回；“本地映射待补”表示统计或投影不符合确认规则；“仅 Mock 归一化”表示正式模式尚无有效归一化。来源事实写入及展示投影生产仍须接通真实同步。</li><li><strong>FOP 来源：</strong>列业务单据、已核实字段及独立 API 提供状态。API 已提供定义只证明归档契约包含字段；来源确认、真实数据与同步实现分别验收。跨单据已存在本地关联时按来源拆行；未提供的 API 明确标示。</li><li><strong>一列多来源：</strong>合并左侧单元格，右侧逐行说明各来源。同一单据内的多个值合并在同一行。</li></ul>
<p>商品款数、总数量、金额合计及阶段标签由授权范围内的完整本地数据计算，不要求 FOP 提供同名展示字段。搜索命中一个 SKU，仍返回整笔订单；清单与导出沿用同一权限及数据范围。</p>
<div class="review-legend" aria-label="审阅标记说明"><div><span class="review-tag review-source">来源待确认</span><span>业务来源、具体源字段或字段含义尚未确认；按同格说明核实。</span></div><div><span class="review-tag review-missing">数据未接入</span><span>本地字段尚未返回、仅模拟模式提供，或明确缺少该数据；不用于代替全局真实同步状态。</span></div><p class="review-note">绿色“来源已确认”仅代表对照表业务来源通过核对，不代表真实同步已接通；具体字段或数据仍待补时保留对应警示。两类问题可同时存在。蓝色“本地读取已接入”与绿色“来源已确认”均不代表真实 FOP 同步完成；同步整体状态见上方说明。</p></div>
<div class="review-legend" aria-label="API 提供状态说明"><div><span class="review-tag api-defined">API 已提供定义待联调</span><span>归档接口已定义字段或能力，未证明远端当前部署、完整数据或同步写入已就绪。</span></div><div><span class="review-tag api-confirm">API 待确认</span><span>接口存在，但字段语义、枚举、完整关联或授权契约待 FOP 确认。</span></div><div><span class="review-tag api-missing">API 待提供</span><span>当前归档未提供所需字段或能力；须由 FOP 新增或扩展。本地计算及组织目录不标此状态。</span></div><p class="review-note">API 状态独立于绿色来源确认、蓝色本地读取和全局真实同步状态；整行含多项时，仍须阅读同格列出的具体缺项。</p></div><div class="matrix-tools"><input id="field-search" aria-label="搜索清单、字段或表名" placeholder="搜索清单、展示字段、本地表或 FOP 来源"><select id="review-filter" aria-label="按审阅标记筛选"><option value="all">全部字段</option><option value="source">来源待确认</option><option value="missing">数据未接入</option><option value="any">全部警示项</option><option value="api-defined">API 已提供定义待联调</option><option value="api-confirm">API 待确认</option><option value="api-missing">API 待提供</option></select><button id="clear-search" type="button">清除</button><span id="search-status" aria-live="polite"></span></div></section>'''
collected=json.loads((R/'scripts/fop-local-field-matrix/collected-mapping.json').read_text())
body+='<section><h2 id="collected-fields">已采集模式字段</h2><p>实际订单表：hz_fop_collected_orders；原始报文保存在 raw，展示 JSON 保存在 display，索引字段用于权限、筛选和分页。hz_fop_collected_batches 记录租户、公司、工作区、采集时间、完整页数及激活状态；只读取当前工作区与已配置租户／公司的 active 批次。</p><table><thead><tr><th>字段组</th><th>实际本地位置</th><th>FOP 来源 / 前端字段</th><th>当前状态</th></tr></thead><tbody>'
for entry in collected:
 body+='<tr>'+''.join('<td>'+E(value)+'</td>' for value in [entry['label'],entry['local'],entry['source']+' → '+entry['display'],entry['state']])+'</tr>'
body+='</tbody></table><p>待支付取已知未取消且未付款；待审核取已付款且 billstatus=B；已审核仅取 billstatus=C，取消及付款差异不抹除审核记录。异常待核查兜底未整体出库的已付款、取消或状态未知订单；它不是确认发生业务异常，也不替代 FOP 正常配货清单。下游关联齐备后重新归类。来源外未授权、未返回、删除及历史变更仍须 FOP 对账。</p></section>'
groups=[('sales','02 · 销售工作台'),('dispatch','03 · 发运工作台'),('procurement','04 · 采购工作台'),('allocation','05 · 配货工作台'),('warehouse','06 · 仓库工作台')]
for group,title in groups:
 body+=f'<section class="workbench-section" id="wb-{group}"><h2 id="{group}">{title}</h2>'
 for s in sections:
  if s['group']!=group:continue
  body+=f'<article class="list-block" id="{s["id"]}"><h3>{E(s["title"])}</h3><p class="section-note">{E(s["note"])}</p><table class="matrix"><colgroup><col><col><col></colgroup><thead><tr><th>前端展示字段</th><th>本地数据库字段</th><th>FOP 来源</th></tr></thead>'
  for r in s['rows']:
   flags=[review_flags(local,source) for local,source in r['parts']]
   apis=[api_state(local,source) for local,source in r['parts']]
   api_flags=' '.join(sorted({state for state,_ in apis if state}))
   body+=f'<tbody class="field-group" data-api="{api_flags}" data-source="{str(any(x[0] for x in flags)).lower()}" data-missing="{str(any(x[1] for x in flags)).lower()}">'
   for i,(local,source) in enumerate(r['parts']):
    body+='<tr>'
    if i==0:body+=f'<td rowspan="{len(r["parts"])}"><strong>{E(r["label"])}</strong>{n(r["note"]) if r["note"] else ""}</td>'
    source_unknown,not_connected=flags[i]
    # Place source uncertainty beside FOP origin, and missing-data warnings beside current local mapping.
    state=local_state(local,source)
    local_warning=f'<span class="review-tag {"review-local" if state=="local-read" else "review-missing"}">{LOCAL_LABELS[state]}</span>'+review_badges(False,not_connected)
    api_status,api_note=apis[i]
    source_warning=review_badges(source_unknown,False)+(f'<span class="review-tag api-{api_status}">{API_LABELS[api_status]}</span>'+n(api_note) if api_status else '')
    local_class=f' class="review-missing-cell" data-local-state="{state}"' if not_connected else f' data-local-state="{state}"'
    source_class=(' class="review-source-cell"' if source_unknown else '')+(f' data-api-state="{api_status}"' if api_status else '')
    body+=f'<td{local_class}>{local_warning}{local}</td><td{source_class}>{source_warning}{source}</td></tr>'
   body+='</tbody>'
  body+='</table></article>'
 body+='</section>'
body+='''<section><h2 id="gaps">07 · 映射边界</h2>
<h3>来源表与展示表</h3><p><code>hz_fop_source_documents</code> 统一保存源单号、实体、ID、版本与审核时间；履约、备货、采购、配货等类型表保存各自业务事实。<code>hz_fop_workbench_orders</code> 与商品、清单成员表承载前端展示；RMA、采购退货、发运等多单资料通过本地已解析关联读取。字段名称相似不等于同步映射已经实现。</p>
<h3>待采购视图与单据号</h3><table><thead><tr><th>查看视图</th><th>主单编号</th><th>关联明细</th></tr></thead><tbody><tr><td>按履约单查看</td><td>履约订单号</td><td>本笔履约订单的商品与采购进度</td></tr><tr><td>按采购单查看</td><td>采购订单号</td><td>展开显示关联履约订单号及商品；1688 订单号另列</td></tr></tbody></table><p>待创建采购单仅为未建采购需求的汇总分组，不是采购业务单据。组内订单编号为履约订单号，查询条件、信息展示及明细均以履约订单为主体；SKU 命中时保留对应履约订单完整商品，不按采购单查询。</p>
<h3>采购单关联笔数</h3><p>按采购单查看时，“履约笔数”按采购分录销售订单编号 <code>hzkj_salbillnumber</code> 去重，涵盖平台订单、履约订单；同号多条分录合并计一笔，空号不计。例如 A、A、B 共计 2 笔。仅统计当前权限范围内的关联销售订单，不以分录行数、SKU 数或履约订单 ID 数替代；展开明细的分页总数单独统计。本地新增 <code>hz_fop_procurement_line_details.sales_order_number</code> 并接入查询；NULL 表示未同步且阻断结果，已确认的空号不计。展开明细分页总数独立按授权履约 ID 计算，页面及导出读取同一组头结果。真实字段同步写入仍未接通。</p>
<h3>采购单 SKU 与数量</h3><p>按采购单查看时，SKU 数为整张采购单全部有效分录的 SKU 去重种数；数量、已发、未发分别为所有 SKU 的采购、已发货、未发货件数合计。相同 SKU 的多条分录先合并，再汇总整单。例如 SKU A 采购 10 件、已发 6 件，SKU B 采购 5 件、已发 5 件，则显示 2 SKU、采购 15、已发 11、未发 4。</p><p>组头统计不随展开分页或某笔关联履约单变化，也不能先排除已发完的 SKU 再统计；保留现有数据权限校验。待创建采购单组尚无采购主单，仍按待采购需求汇总，不显示已发、未发。本地组头已改为采购主单全部未移除分录汇总：SKU 取 <code>hz_fop_source_lines.sku_code</code>，数量取 <code>hz_fop_procurement_line_details.ordered_quantity</code> 与 <code>supplier_shipped_quantity</code>；未发为两者之差。完整来源关系及整单授权必须通过校验，未知、异常数量及取消量不明时阻断。该实现只证明本地读取与计算路径，真实同步尚未接通。</p>
<h3>物流信息</h3><p>未支付展示履约单物流决策的自定义物流渠道。待审核按英文自定义物流渠道名称、中文实际物流渠道名称直接分行展示，不加“自定义”“实际”前缀；Customer 后依次为物流信息、发货仓库。客户运费报价设置默认实际渠道后，同步订单时即可带入，履约审核时确认后续发货渠道，此时尚未获取跟踪号。已审核清单沿用相同列顺序，展示已完成审核操作的履约订单；物流信息追加有效跟踪号，无号显示“尚未获取”。页面与导出采用相同口径。</p>
<p>制作发运单时获取并回写跟踪号；删除发运单清空对应号码，重建后以新号码更新。同步变更须同时撤销旧发运关联与号码事实、清空包裹号码镜像并重算受影响订单；空值必须覆盖旧值。读取时仅接受当前有效关联且未删除的发运单号码，不回退旧包裹镜像。发运工作台以发运单渠道及号码为准，全程 QC、尾程 WC 标记置于号码后；收货通知使用本单国内物流公司名称及运单号，不沿用履约发货渠道与 QC/WC 标记；退货物流尚缺的渠道映射继续保留待补。</p>
<h3>金额与时间</h3><p>履约总额对应 <code>hzkj_total_amount</code>，产品金额对应 <code>hzkj_order_amount</code>；须按现行落库定义写入，避免沿用旧直接查询适配的金额口径。结算币种以 <code>hzkj_settlecurrency</code> 为准，RMA 退款币种以 <code>hzkj_tocurr</code> 为准。</p>
<p>客户向 FOP 付款时间为 <code>hzkj_receipt_date</code>；C 端买家付款时间为 <code>hzkj_datetimefield</code>。本地已分别预留 <code>customer_paid_at</code>、<code>consumer_paid_at</code>，当前列表兼容返回的 <code>consumerPaidAt</code> 仍读取前者，不可依据接口名称认定已展示 C 端时间。备货创建时间为 <code>hzkj_bizdate</code>（创建时间）；客户付款时间待 FOP 通过收款单回写。</p>
<h3>采购筛选规则</h3><p><span class="review-tag review-confirmed">采购完成口径已确认</span>采购阶段完成＝供应商全部已发货。按履约单查看，要求本单采购需求全部发出；按采购单查看，要求整张采购单全部有效 SKU 已发出、未发数量为 0。部分发货不算完成，无需等待仓库收货或入库；未取得完整发货事实时不推定完成。其余筛选细则仍待逐项核对。</p><p>客户已支付且未取消、存在新采购需求的履约单进入采购队列。使用全款备货库存且无需新采购的履约单不进入待采购；供应商全部已发货的订单进入采购完成，不再进入待采购或已采购待发货。</p><ul><li><strong>待创建采购单：</strong>未创建采购单，或仍有未覆盖采购需求。</li><li><strong>待推 1688 采购：</strong>已有采购单，平台下单尚未推送或未全部推送。</li><li><strong>待支付采购款：</strong>已有采购单且不存在待推送动作，采购款未付；旧数据的部分付款仍归此项。</li><li><strong>采购退款待跟进：</strong>采购付款状态为已退款，且未进入供应商全部已发货阶段；标签优先于推单、付款状态。</li><li><strong>供应商待发货／部分发货：</strong>采购单已创建、采购款已付、平台下单成功或无需平台下单；供应商未发货／未全部发货。</li><li><strong>采购完成：</strong>关联采购已覆盖本单需求，供应商全部已发货；不能仅以已下单、已付款判定完成。</li></ul><p>履约订单视角的主状态直接取本地原生字段；具体付款、下单、供应商发货标签及进度筛选保留独立事实。待采购与已采购待发货限原生采购状态 0／1／2；采购完成为 4（已发货），后续到 3（已入库）仍保留完成记录。无新采购需求的备货库存订单排除，未知原生状态提示数据未就绪。按采购单查看已采用采购主单有效分录汇总：整单未发数量为 0 且采购量大于 0 才完成；未知或不完整数据明确报错，不因某笔关联履约需求发完而判整单完成。未创建采购单统一成组。来源同步及其余归一化规则后续与 FOP 逐项核对。</p><h3>RMA 行粒度</h3><p>同一履约单关联多张售后单时分别占行，各行仅展示当前售后单的退款金额、原因及类型。分页、搜索、勾选与导出均以售后单为单位；原订单金额与商品总量按履约单去重，退款金额不跨售后单汇总。</p><h3>采购退货与关联</h3><p>采购退货业务主体按 FOP 采购退货单确认，正式实体与 API 待补。现有 <code>hz_fop_purchase_returns</code> 的旧实体约束仍引用采购退款申请 <code>hzkj_purrefundapplybill</code>，须在正式接入前校正。关联主键、分录及分摊量需要源端明确提供；不能用单号模糊匹配或同 SKU 推定关系。</p>
<h3>2026-11-12 单轮联调</h3><p>李铭嵩与华智组织100000已核验，449页采集44,855条不重复履约订单；全部facts为空，且上述订单均缺总金额、结算币种、运费报价、固定税费、优惠额及来源版本。此前仅保存采集文件；本轮在用户追加授权后执行新扫描并写入独立采集订单表，完整批次校验后激活供工作台读取。该模式不伪造完整副本水位或授权租约；Mock已关闭，自动增量及后台调用保持暂停。六项同步服务没有地址，按用户确认列为FOP后端开发待办，均标记API待提供。</p><h3>同步接口供应边界</h3><p>现有接口包提供单据查询、原始事实主键续读、目录、库存及审核能力；没有通用可靠变更流、版本一致初始化快照、初始化水位或全实体批量版本快照定义。这些能力均为 API 待提供，拟议接口不是已发布接口。afterOrderId 仅为订单主键续读，不追踪旧单修改、删除和归属变化，也不能当作增量提交水位。</p><p>17号独立包较合并 OpenAPI 更完整，提供州省、采购支付时间、付款状态、1688状态与订单号等定义；应以独立包逐项复核。采购已运输量不自动等于供应商已发量，收货通知已收货量不自动等于已入库量。人员及统计权限接口存在，但服务集成身份、各资源独立授权、有效期及撤权契约仍待确认。本项目新提议的 service-feed 领域契约属于拟议未部署能力；本地白名单归一化器支持接收明确业务字段，不表示现有分页 API 已提供这些字段。关键金额、币种、数量、归属及来源关系缺失时保持未知或拒绝发布，不能由适配器自动补造。</p><h3>待接通项</h3><p>已有订单不等待六项服务即可入库展示；完整模式仍须补齐真实变更源、单据快照及初始化屏障后验收。采购付款、平台下单、复杂退货分摊、待入库逐行数量，以及未映射到列表的齐套／WMS 时间，按对应行逐项验收。未取得的金额、币种、状态和时间保留未知，不用其他业务事件替代。</p>
</section><section class="evidence"><h2 id="evidence">08 · 核对依据</h2><p>本表以当前本地读取代码和迁移为实现依据，以 FOP 元数据为业务来源依据，以归档独立接口包为 API 提供状态依据；2026-11-12另按用户授权执行一次真实采集，记录见本轮联调证据。旧直接查询适配仅用于追溯已知字段，不作为本地同步已接通的证明。</p><ul>'''
evidence=[('已采集模式字段定义','scripts/fop-local-field-matrix/collected-mapping.json'),('已采集模式归一化','backend/src/modules/fop-data/collected-order-normalizer.ts'),('已采集模式本地读取','backend/src/modules/workbench-replica/collected-workbench.service.ts'),('已采集模式分类','backend/src/modules/workbench-replica/collected-workbench-query.ts'),('本轮真实联调证据','docs/integrations/fop-one-shot-20261112.json'),('采购销售编号迁移','backend/src/database/migrations/1794408000000-WorkbenchPurchaseSalesNumber.ts'),('可重现生成器','scripts/fop-local-field-matrix/generate.py'),('校验器','scripts/fop-local-field-matrix/validate.py'),('履约清单导出','backend/src/modules/fop-data/fop-order-export.ts'),('采购分组导出','backend/src/modules/fop-data/procurement-groups-export.ts'),('备货导出','backend/src/modules/fop-data/fop-stock-export.ts'),('RMA导出','backend/src/modules/fop-data/rma-orders-export.ts'),('采购退货导出','backend/src/modules/fop-data/purchase-returns-export.ts'),('列表列定义','frontend/src/views/autoflow/FopOrdersView.vue'),('备货列定义','frontend/src/views/autoflow/StockOrdersView.vue'),('采购组头与展开','frontend/src/views/autoflow/PurchaseGroupsView.vue'),('RMA 列定义','frontend/src/components/autoflow/RmaOrdersTable.vue'),('采购退货列定义','frontend/src/components/autoflow/PurchaseReturnOrdersTable.vue'),('待入库列定义','frontend/src/views/autoflow/ReceiptNoticesView.vue'),('本地读取与关联','backend/src/modules/workbench-replica/local-workbench.service.ts'),('本地返回字段','backend/src/modules/workbench-replica/local-workbench-mapping.ts'),('本地分类与筛选','backend/src/modules/workbench-replica/local-workbench-query.ts'),('本地物流取数','backend/src/modules/workbench-replica/local-workbench-logistics.ts'),('物流渠道展示','frontend/src/components/autoflow/OrderLogisticsChannels.vue'),('包裹号码语义修订','backend/src/database/migrations/1794407000000-WorkbenchTrackingLifecycle.ts'),('本轮字段迁移','backend/src/database/migrations/1794405000000-WorkbenchConfirmedSources.ts'),('字段与主键','backend/src/database/workbench-schema.ts'),('待入库新增表','backend/src/database/migrations/1794403000000-WorkbenchReceiptNotices.ts'),('收货通知单 FOP 元数据','/Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_einkauf/metadata/hzkj_receiptnotice.dym'),('落库与投影发布','backend/src/modules/workbench-replica/replica-publisher.ts'),('真实同步源状态','backend/src/modules/workbench-replica/replica-change-contract.ts'),('来源表设计（以迁移修订为准）','docs/designs/workbench-database/schema-design.json'),('项目最新约定','agent.md')]
evidence.extend((Path(path).stem+' FOP 元数据',path) for path in ['/Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_einkauf/metadata/hzkj_purorderbill.dym', '/Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_logistics/metadata/hzkj_deliver_bill.dym', '/Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_after_sale_orders.dym', '/Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_alloc_bill.dym', '/Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_deliver_order.dym', '/Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym', '/Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new.dym'])
for label,path in [('业务领域归一化实现','backend/src/modules/workbench-replica/replica-domain-normalizer.ts'),('拟议同步API能力契约','backend/src/modules/workbench-replica/replica-source-api.ts'),('受控HTTP源适配','backend/src/modules/workbench-replica/replica-http-source.ts'),('初始化编排','backend/src/modules/workbench-replica/replica-bootstrap.service.ts'),('跨页快照暂存','backend/src/modules/workbench-replica/replica-snapshot-staging.ts'),('独立授权与归属续验','backend/src/modules/workbench-replica/replica-authorization.service.ts'),('专用实时适配','backend/src/modules/fop-data/fop-kingdee.realtime.ts'),('完整导出分页','backend/src/modules/workbench-replica/collect-replica-pages.ts'),('拟议同步服务交接契约','docs/openapi/fop-replica-service-contract.json'),('拟议领域JSON契约','docs/openapi/fop-replica-domain.schema.json')]:
 if (R/path).is_file():evidence.append((label,path))
# Archive files are optional audit evidence; versioned API_DEFINED/API_MISSING
# retain the reviewed result if this ignored historical directory is unavailable.
api_archive=R/'.runtime/fop-round3/api-docs/金蝶测试环境完整接口'
if api_archive.is_dir():
 for prefix in ['01-','03-','07-','08-','13-','14-','17-','18-','19-']:
  paths=sorted(path for path in api_archive.rglob('接口说明.md') if path.relative_to(api_archive).parts[0].startswith(prefix))
  if paths:evidence.append(('API定义归档 · '+paths[0].relative_to(api_archive).parts[0],str(paths[0])))
manifest=[]
for label,path in evidence:
 data=(R/path).read_bytes();manifest.append(dict(label=label,path=path,sha256=hashlib.sha256(data).hexdigest()))
 body+=f'<li><strong>{label}</strong> · <code>{E(path)}</code></li>'
body+='</ul><p>FOP 源码核对：<code>/Library/VSCode/dtr5b</code> 内履约订单、备货订单、RMA、采购订单、配货与发运单元数据。源字段存在与同步 API 可用分别验收。</p></section>'
body+='''<script>
(()=>{const input=document.getElementById('field-search'),status=document.getElementById('search-status'),review=document.getElementById('review-filter');
function filter(){const term=input.value.trim().toLocaleLowerCase();let count=0;document.querySelectorAll('.list-block').forEach(section=>{const title=section.querySelector('h3').textContent.toLocaleLowerCase();let visible=0;section.querySelectorAll('.field-group').forEach(group=>{const flagged=review.value==='all'||review.value==='source'&&group.dataset.source==='true'||review.value==='missing'&&group.dataset.missing==='true'||review.value==='any'&&(group.dataset.source==='true'||group.dataset.missing==='true'||group.dataset.api.includes('missing')||group.dataset.api.includes('confirm'))||review.value.startsWith('api-')&&group.dataset.api.split(' ').includes(review.value.slice(4));group.hidden=!flagged||!!term&&!title.includes(term)&&!group.textContent.toLocaleLowerCase().includes(term);if(!group.hidden){visible++;count++;}});section.hidden=!visible;});document.querySelectorAll('.workbench-section').forEach(s=>s.hidden=![...s.querySelectorAll('.list-block')].some(x=>!x.hidden));status.textContent=term||review.value!=='all'?'匹配 '+count+' 个展示字段':'';}
input.addEventListener('input',filter);review.addEventListener('change',filter);document.getElementById('clear-search').addEventListener('click',()=>{input.value='';review.value='all';filter();input.focus();});document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',()=>{input.value='';review.value='all';filter();}));let saved='',savedReview='all';window.addEventListener('beforeprint',()=>{saved=input.value;savedReview=review.value;input.value='';review.value='all';filter();});window.addEventListener('afterprint',()=>{input.value=saved;review.value=savedReview;filter();});})();
</script>'''
spec=importlib.util.spec_from_file_location('hz','/Library/VSCode/.hyperzone/html-style/render_html.py');hz=importlib.util.module_from_spec(spec);spec.loader.exec_module(hz)
html=hz.render('待办清单数据字段对照表','前端展示字段 · 本地数据库字段 · FOP 来源',body,version='本地副本查询版',document_date='2026-11-12')
# Extend the standard directory with each individual list.
for group,title in groups:
 marker=f'<li><a href="#{group}">{title}</a></li>'
 entries=''.join(f'<li class="sub"><a href="#{s["id"]}">{E(s["title"])}</a></li>' for s in sections if s['group']==group)
 assert marker in html
 html=html.replace(marker,marker+entries)
hz.validate(html)
OUT.write_text(html)
(D/'api-supply.json').write_text(json.dumps({'defined':{entity:sorted(fields) for entity,fields in API_DEFINED.items()},'missing':{entity:sorted(fields) for entity,fields in API_MISSING.items()}},ensure_ascii=False,indent=2))
(D/'matrix.json').write_text(json.dumps(sections,ensure_ascii=False,indent=2));(D/'references.json').write_text(json.dumps(sorted(set(refs)),ensure_ascii=False,indent=2));(D/'evidence.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps(dict(path=str(OUT),lists=len(sections),display_columns=sum(len(s['rows']) for s in sections),mapping_rows=sum(len(r['parts']) for s in sections for r in s['rows']),verified_local_columns=len(set(refs)),bytes=OUT.stat().st_size),ensure_ascii=False))
