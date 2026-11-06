# HyperZone 项目事实与设计入口

- 本前端项目：HyperZone 智能办公平台，工程目录 `/Library/VSCode/AutoFlow/work-app`。
- FOP 后台不是通用第三方 ERP：它是基于金蝶云苍穹平台自研的 **HyperZone** 应用。
- FOP 后台代码库：`/Library/VSCode/dtr5b`。设计接口、统计口径、字段或业务规则前，先读取该库 `AGENTS.md`，核对实体元数据、枚举、校验和 Java 插件实现。
- 后台源码用于核实业务事实；源码存在不等于对应生产 HTTP 接口已经启用。本前端真实 FOP 网络适配器仍须按实际发布接口配置。
- 回款采用方案 2：已支付、已审核的履约订单收款，加已支付、已审核的全款备货收款，按支付当月计入；押金备货不计入。履约使用全款备货库存时不补回产品金额、不重复计算备货收款。
- 时间文案及统计口径统一 `UTC+8`；传输时间戳保留明确时区，日/月归属按 `+08:00` 换算。
- 已审核履约订单的仓库和物流渠道由 FOP 保证完整。全款备货在国内仓库备货，物流渠道不适用，不能归为“其他物流服务商”。
- 物流运费分析当前按已审核发运单的 `hzkj_actual_freight` / `hzkj_actual_freight_time` 统计已确认成本；确认时间不是银行付款日，不能据此承诺最终账单完整性。物流商原币在 `hzkj_textfield1`，必须显式换算 USD；首次正数快照后续调价/退款仍需对接确认。成本采用独立 `allowedFreightIds` 和 `freight` 授权，不能从订单权限推导。
- 已确认后台字段与证据见 `docs/analytics/HYPERZONE_FOP_SOURCE_MAPPING.md`；需求及 OpenAPI 见 `docs/analytics/`、`docs/openapi/`。

未经单独安排，不修改 `/Library/VSCode/dtr5b` 的生产应用实现；本工程内对接层、Mock 与契约同步维护。

## 本地待提交业务补充

- RMA列表原售后类型列改为“RMA单”，内容逐单展示售后类型＋真实售后单号，支持复制；同类型多单不去重折叠，缺号显示—。售后类型筛选及互斥规则保留，Excel主表同步RMA单组合字段，明细保留独立字段。

- RMA售后类型互斥：同一授权履约订单，仅退款refund不能与退货退款return_refund或补发货reshipment并存；同类型部分退款记录及独立取消/拦截标签不受限。BFF在筛选前校验、前端拒绝冲突响应、Excel复核；不自行隐藏冲突类型。Demo每订单只生成一种业务售后类型并可附订单标签。

- 2026-11-05 RMA新增独立退款金额列（refundAmount/refundCurrency，禁止申请或订单金额兜底）、售后类型列/筛选仅refund仅退款、return_refund退货退款、reshipment补发货；售后事项改售后原因纯文本，Shopify列参照待支付。取消/拦截/拦截取消移至订单编号下标签，明确released或interception_release才为拦截取消，不能从关闭流程推定。授权内多事项退款按币种精确合计，缺失金额不显示不完整合计；完整履约商品不变，Excel同步，真实FOP字段映射发布仍待联调。

- 2026-11-05 销售页签顺序：待支付、待审核、备货、RMA售后、异常订单、已完成。RMA按履约整单关联退款/退货，不拆SKU售后；支持独立部分退款申请金额，订单金额保留原值，不推定实退金额或全额退款。RMA首列“订单编号”及Excel表头一致，参考待审核采用居中订单号、选择框及多品统计；Shopify单号独立列，模拟订单复用同一TO日期流水格式。RMA桌面固定比例列宽，首列16px留白，1280容器内卡片布局，850内两列。

- 2026-11-05 销售增加RMA售后清单queue=rma，一履约单一行合并匹配事项：退款/退货退款/订单拦截/订单取消；默认active进行中，可closed/all与类型筛选，最近售后更新时间倒序，不回退订单时间。独立allowedRmaCaseIds∩订单白名单∩当前本地归属，快照后重新读取来源及最新权限；搜索/合计/分页/Excel共用范围，同单金额去重按币种合计。允许未支付/已取消来源，RMA不改变主流程队列。isOpen来自实际售后流程，不由cancelled、采购退款或拦截标签推断；只读FOP办理。Demo与HTTP /rma-cases契约已补，真实流程映射待联调，见docs/FOP_RMA_HANDOFF.md。

- 2026-11-05 仓库按履约单整单出库，无部分出库业务。待出库出库进度筛选仅全部/待出库/outbound_pending、拦截发货/shipment_intercepted、取消拦截/shipment_released；默认全部展示；outbound_pending排除明确intercepted、包含released及无标记的未完成订单，两种拦截只按明确shipmentInterceptStatus匹配，未知不算取消。独立matcher同步BFF/前端校验，列表/合计/分页/Excel同范围。旧partial事实仅兼容为待出库且不推定完成；旧前端outbound_partial书签迁移pending，直接API移除值400，Demo不生成部分出库，旧出库排序同待出库按收款时间。已出库筛选与完成事实不变。

- SKU搜索是订单级匹配：命中单个SKU仍返回、展示、统计及导出整笔授权履约订单全部商品；采购退货关联信息不按搜索词截断，退货状态/仓库等显式筛选仍生效。普通履约待办、RMA和采购退货均遵守此原则，库存查询仍按其独立SKU规则。

- 2026-11-05 采购/仓库共用只读采购退货清单queue=purchase_returns，仅实物退货、排除仅退款；按当前授权履约订单主行展示，订单编号首列，样式沿用待采购清单；一单多退货合并，一退货多履约按来源分摊，退货单号有则展示、不补造。只含履约来源；allowedPurchaseReturnIds∩allowedPurchaseOrderIds∩allowedOrderIds∩本地范围。快照后重读当前归属（保留部门祖先）与最新权限。分页、选择、金额统计及Excel以履约单为单位，导出selected使用orderIds；退货单数只统计已编号单据。默认最早收款优先，支持倒序，未知日期末尾。导出复核当前数据/会话，旧选择409。待出库单号下明确shipmentInterceptStatus intercepted红“拦截发货”、released绿“取消拦截”，未知无标签；同步Excel列，不影响队列。真实退货/拦截字段、网关发布仍待联调，见docs/FOP_PURCHASE_RETURNS_HANDOFF.md，未改FOP源码。

- 2026-11-02 客户报价物流渠道改为直接按服务商/编码/名称搜索实际渠道并多选；分页、搜索不丢已选及毛利率，跨旧分类查询，候选只取API。预留GET logistics/actual-channels与FopLogisticsCatalogPort.searchActualChannels，DTO search≤120/page≥1/pageSize≤100；分类关联仍存入原报价请求，页面已选表/矩阵改显示服务商。原资源权限guard仍拒绝未配置的独立渠道读权，live适配仍待FOP目录同步/授权，不以订单授权放开，也无本地假数据兜底。字段核对实际渠道number/name/hzkj_logistics_providers，hzkj_state为国家分区。详见docs/FOP_QUOTE_LOGISTICS_CHANNELS_API.md。

- 查询摘要值使用独立定宽槽：枚举按当前语言全部可选项的实际最大字宽预留（备货类型四个中文字），切换已选值不改变后方位置；部门/业务员/关键词/单号等自由文本使用固定宽度，溢出省略并保留全文悬停。只影响摘要排版，查询、权限及操作不变。

- 2026-11-05 异常类型文案更新：采购退货、订单取消、配货超时、物流异常、妥投异常；兼容原procurement_exception/dispatch_exception/allocation_exception/logistics_exception/delivery_exception编码。前端筛选、列表、摘要及中英文Excel标签一致；仅改分类名称，不由标签推定订单已取消、存在实物退货或配货实际超时，也不改变主流程及队列规则。

- 2026-10-31 异常订单按独立类型筛选，exception.type独立枚举，exception.reason为FOP原始原因文本/null，列表和Excel单独展示；不再以库存/地址/物流单号作为分类，也不从原因推定类型。异常清单纳入全部未取消且存在异常标记的授权履约单，包含已发货/妥投阶段，不以支付或发货状态排除；标记不改主流程事实及其它队列，允许同时出现在待办/完成和异常清单。演示按原进度叠加分类、原因留空；真实FOP字段和原因字典待后台功能补齐，未更改FOP源码。
