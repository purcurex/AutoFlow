# 采购退货与出库拦截接入

## 展示约定

采购、仓库工作台共用只读“采购退货清单”，只包含需要实物退回供应商的单据，排除仅退款。按履约订单展示，一笔履约订单一行，订单编号首列；商品、金额、客户、店铺、收款日期、发货仓库、业务员及审核时间沿用当前授权履约订单。关联区域显示退货单号、进度、采购单、供应商、退货商品及物流。支持搜索、业务部门、退货出库仓库和退货进度筛选，默认全部状态、最新C端付款优先、每页50条，可切换最早C端付款优先，缺失C端付款时间始终排后，不回退收款或创建时间。单号/SKU/物流单号支持复制，导出默认全部筛选结果，也可导出所选履约订单。

SKU搜索用于匹配履约订单，命中其中一个SKU后仍展示该订单全部商品及当前筛选范围内的关联退货信息；不按搜索词裁剪商品或退货明细，合计及Excel沿用整单结果。

同一履约订单的多笔退货合并展示；一笔退货关联多个履约订单时，各行只保留对应来源商品分摊。退货单号可空，有真实单号才展示，不补造单号；仅有采购退款状态不推定退货任务。本清单只包含履约来源，备货来源不进入本清单。订单数及订单金额按履约订单去重；“退货单数”只统计有实际单号的独立退货资源；退货数量按筛选后关联明细汇总。

归一化进度：pending_outbound待退货出库、in_transit退货在途、received供应商已收货、completed退货完成、cancelled已取消、unknown待确认。进度必须来自真实退货业务事实，不能根据采购退款/客户付款状态推定。数量为当前授权来源分摊；returnedQuantity表示已实际退货出库数量，不表示供应商已收货或退款到账。

## BFF API

- GET /api/autoflow/integrations/fop/purchase-returns
- POST /api/autoflow/integrations/fop/purchase-returns/export

必须传 workbenchRole=procurement|warehouse；服务端检查当前岗位入口。列表可选search（200字符内）、departmentId、ownerId、warehouseCode=HZ|SZ、status、paidAtOrder=asc|desc（默认asc）；page默认1，pageSize=20|50|100默认50。导出共用筛选，mode=filtered|selected，selected必须传1–100个唯一orderIds，filtered不接受orderIds；旧returnIds参数拒绝。一次最多10000笔履约订单/50000行原商品及退货明细。返回source、refreshedAt、items、total、page/pageSize、departments及全筛选范围totals；items为履约订单，附purchaseReturns关联数组、returnQuantity、returnedQuantity，total按履约订单计。

Excel包含“采购退货清单”（首列订单编号，每订单一行）、“退货明细”（订单×退货来源商品分摊）、“商品明细”和“导出说明”。主表金额为完整履约订单金额，并非退款金额；各币种分别合计。列表发货仓库属于履约订单，筛选出库仓库及明细退货仓库属于退货出库。

## 员工网关契约（待发布联调）

以下为目标契约，并非当前 KingdeeFopDataProvider 已接通的采购退货能力。旧通用员工 HTTP 网关适配器及配置入口已移除；真实接入须先发布并验证独立退货授权、采购单及履约来源分摊关联，再实现 Kingdee 适配。拟议路径 POST /purchase-returns 不是已发布的金蝶 URL；subject={tenantId,userId}须由服务端当前认证上下文产生，不接收浏览器传递员工身份。显式 Demo 只用于本地契约验收，原始退货单可查询不等于当前清单所需关联和权限已接通。

返回 PurchaseReturnSnapshot：subject必须与当前租户/员工一致；returns为独立采购退货单数组。具体结构见 backend/src/modules/fop-data/purchase-returns.ts。

每单包含id、tenantId、kind=physical_return|refund_only、number（可空，仅真实退货单号）、status、purchaseOrder{id,number}、supplier{id,name}、warehouseCode/warehouse、createdAt（含时区）、logistics{carrier,trackingNumber}、lines。

每行是精确的“退货商品 × 来源订单”分摊，包含唯一id、sku/name/variant/imageUrl、quantity、returnedQuantity，以及sourceOrder{id,number,kind=fulfillment|stock,customerName,owner,department,departmentPathIds}。同一SKU关联多个来源时必须分别提供真实分摊；不能复制整单数量。物流号、单据号始终为字符串，保留前导零和长数字。

权限 /permissions 增加独立 allowedPurchaseReturnIds。返回行必须同时满足：当前退货单白名单、关联采购单allowedPurchaseOrderIds、履约来源allowedOrderIds，以及本地本人/部门/公司范围。缺失/空资源白名单不授权。

上游契约仍可描述fulfillment或stock来源，但当前BFF页面仅纳入fulfillment。BFF读取退货快照后，重读当前履约来源，再按最新资源授权和来源归属过滤；来源员工、客户、部门与订单号使用当前来源记录。筛选后重算数量，详情、合计与导出不得使用未经授权的整单数量。导出完成前重新查询并比较当前结果与权限，失效选择返回409。

## 出库拦截字段

待出库“出库进度”筛选统一为：全部状态、待出库、拦截发货、取消拦截。默认全部状态展示全部符合队列条件的订单；选择待出库排除明确intercepted（拦截发货），包含released（取消拦截）和无拦截标记的未完成订单；两项拦截筛选只匹配明确的shipmentInterceptStatus，不把缺失标记视为取消拦截。列表、统计、分页及Excel共用筛选。已出库清单不开放这些筛选。移除outbound_partial选项及文案；履约订单整单出库，旧上游partial按未完成兼容为待出库，不能推断已整单完成。旧前端书签转outbound_pending，直接API传outbound_partial返回400；Demo不生成部分出库状态。

履约模型新增 shipmentInterceptStatus=intercepted|released|null。仅待出库单号下显示：intercepted为红色“拦截发货”，released为绿色“取消拦截”。缺失、未知和非法值归null，不默认取消拦截；不改变待出库或其它业务队列。待出库Excel增加“订单拦截状态”列；已出库等其它清单不增加标签。

## FOP 核对与边界

已核对 dtr5b 中 hzkj_purrefundapplybill 采购退货申请元数据，以及 PurchaseRefundPolicy 的退货退款/仅退款与实物场景规则。现有原始采购退款、退货类型和平台退款状态不直接等同于上述统一进度；正式上线仍需后台确认有效实物退货来源、真实物流/出库事实、单位换算与分摊关联。履约订单拦截的正式字段/事件映射也待后台确认，未猜测以未知boolean代表取消拦截。

本次实现本地演示及员工网关适配契约，不修改FOP源码、应用授权或凭据，不代表真实接口已发布。Demo在原有开发模式下提供24张覆盖多阶段的退货单及红/绿/空拦截示例；真实网关不可用时明确失败，不回退演示数据。


## 采购退货供应商旺旺入口（2026-11-11）

采购与仓库工作台在每张退货单的供应商名称旁提供“旺旺联系”。沿用供应商联系弹窗、账号复制和安全的 `aliim:sendmsg` 唤起；退货联系不受“已采购待发货”阶段限制，也不自动发送消息。切换筛选、刷新或会话失效时关闭弹窗。

- `GET /api/autoflow/integrations/fop/purchase-returns/:returnId/supplier-follow-up`
- `GET /api/autoflow/integrations/fop/purchase-returns/:returnId/supplier-follow-up/launch`
- 两个接口均要求 `orderId`、`workbenchRole=procurement|warehouse`；launch 另需 64 位十六进制 `contactVersion`。

旧 BFF 模式复用采购退货已有的岗位、退货、采购单、来源履约单及当前人员范围检查，按退货 ID 与履约单 ID 精确绑定供应商；打开会话前重新读取并核验版本。新增归一化可选字段为 `supplier.wangwangAccount` 和 `supplierChatUrl`，只从该退货快照提供的供应商资料取值，不额外查询供应商或采购单，不用供应商名称推造账号。URL 须匹配账号并通过既有旺旺协议白名单；缺账号或链接无效时显示不可用。Demo 不唤起外部聊天。

当前 FOP 访问仍暂停。真实联系人字段尚未完成映射验证；本地副本模式与既有采购催办一致，联系人独立核验服务未接通时明确提示待接通，不回退查询 FOP。上述字段是本项目归一化契约，不代表当前 FOP 原生接口已经返回它们。
