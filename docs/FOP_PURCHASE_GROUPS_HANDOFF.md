# 采购分组接口交接（2026-10-30）

## 已实现范围

采购工作台履约“待采购 / 已采购待发货”按当前账号岗位/主部门设置默认维度：业务员、部门经理及营销中心员工按履约单；采购岗位或采购部门员工按采购单；系统管理员及未识别账号按履约单。服务端`WorkbenchAccess.defaultProcurementView`提供默认值，显式`view=fulfillment|purchase`优先，不依据五个工作台入口权限推断岗位。`view=purchase`可切换采购分组视图（选项置于履约选项后）。采购组初始全部收起，支持本页全部展开/收起；刷新保留当前展开状态，切换筛选或页码恢复收起。备货、其他工作台、Dashboard的既有整单统计不变；分组队列按单张采购义务判定，所以同一履约订单可能出现在两个分组页签中。

组头的数量、SKU数、履约数只包括当前筛选和当前权限可见的来源。它们不是整张采购单总量；没有整单金额汇总。采购款状态是获独立采购权限后的单头事实。无采购号的来源保留独立行；关联数据缺失属于接口异常，返回503；不显示采购来源/关联待确认业务任务，不冒充未建采购单。

## 平台接口（JWT / 会话 Cookie）

- GET `/api/autoflow/integrations/fop/purchase-groups`
- GET `/api/autoflow/integrations/fop/purchase-groups/{groupId}`
- POST `/api/autoflow/integrations/fop/purchase-groups/export`

列表/明细共用：必填 `queue=procurement|procurement_shipping`；可选search（200字符）、departmentId、ownerId（各128字符）、warehouseCode=HZ|SZ、sortOrder=asc|desc。page默认1，pageSize默认50，仅20/50/100。列表按采购组分页，展开明细按来源履约行分页。按组内最早可见B端履约收款时间排序，空值双向最后。

导出：共用过滤，不接受分页；`mode=selected`须提供1–100个唯一groupIds，`mode=filtered`不提供groupIds。最多10,000组、50,000商品明细行。每行重复采购号以方便筛选。输出前重新获取授权、订单归属及关联，变化返回409 `purchase_groups_changed`；不可用上游返回503，绝不降级成Demo。

## 员工网关新增合同（尚待FOP团队实现、发布及联调）

`FopHttpProvider`以已有服务端鉴权和员工委托身份调用 `POST {FOP_EMPLOYEE_API_URL}/purchase-links`，请求 `{ subject: {tenantId,userId}, orderIds: string[] }`。此路径是员工网关合同，不是现有金蝶 `/v2/.../queryPurchase` 路径，也不能把另一个前端的应用Token当作员工数据权限。

返回 `PurchaseLinkSnapshot`（代码：backend/src/modules/fop-data/procurement-groups.types.ts）：

```json
{
  "subject": {"tenantId":"test-tenant","userId":"employee"},
  "orders": [
    {"orderId":"SO-ID-1","obligations":[
      {"purchase":{"id":"PO-ID-1","number":"CG001","supplier":{"id":"SUP-1","name":"供应商"},"purchaseType":"online","platform":"1688","platformOrderNumber":"5127891553471031616","payment":"paid","placement":"placed","paidAt":"2026-10-29T08:00:00+08:00"},
       "lines":[{"fulfillmentLineId":"SO-ENTRY-1","purchaseLineId":"PO-ENTRY-1","sku":"SKU-A","quantity":5,"shippedQuantity":2}]}
    ]}
  ]
}
```

合同要点：

1. 每个请求订单必须恰有一个entry；遗漏、重复、错误subject、矛盾单头或非法数量均拒绝。禁止截取第一页伪装完整快照。
2. `obligations=null`表示接口数据不完整，整次查询失败，不生成业务待办；`[]`表示经权威确认没有未结采购义务（如无需采购或已完成）；`purchase=null`加有效来源lines表示明确尚未创建采购单的需求。已知无权限的关联不能伪装成null purchase。权限不足无法判断时必须报错，不能以业务待确认代替。
3. 一笔履约可对应多张采购单，一张采购单可对应多笔履约；同一履约下同一采购只出现一个obligation，多SKU放在lines。以采购内码分组，采购号/平台订单号作为字符串，不用数值转换。
4. quantity/shippedQuantity为**归属于该履约来源的有效数量，使用来源SKU单位**。排除取消/退款失效义务，数量有限非负、quantity>0、shipped<=quantity；跨采购来源总量不得超过履约SKU数量。组合品/采购单位转换必须由FOP给出权威来源口径，不用整张采购行数量复制给每个来源，也不做比例猜分。
5. payment取paid/unpaid/partial/refunded/unknown；placement取pending/placed/unknown。paid+placed且有未发数量进入已采购待发货，其余未结义务进入待采购。已完成义务退出待办。paidAt仅真实采购付款时间，缺失null，不回退客户收款或建单时间。
6. `/permissions`必须给独立`allowedPurchaseOrderIds`；平台再次与允许履约订单、本地本人/部门/全量范围求交，并在关联请求后重新读取最新归属。组头、展开、导出均执行相同限制。
7. 现有供应商催办合同必须与本合同使用相同采购ID、来源ID及来源未发数量。催办仍按“本履约采购催办”打开，只返回有权、已付未发采购。不得以父履约整单付款状态排除其中已付采购；不执行采购、支付或自动发送消息。

## 后台源码依据与待核实项

核对 `/Library/VSCode/dtr5b` 中 `OrderPurchaseCostQueryService`：源关联读取采购 `hzkj_billentry.hzkj_salbillnumber`，校验 `hzkj_salbillid`、`hzkj_salbillentryid`，按商品/供应商形成多对多关系。还需IT确认上述字段在实际租户版本的完整取值、单位转换、退取消后的有效量、来源发货分配和真实采购付款时间。

本地Demo已统一分组和催办采购身份，采用可见的周批次合并样本。它不是FOP真实数据。云端测试中原采购查询授权仍需补齐，员工网关本合同未被本次代码实现替代；待提供已部署网关及可用授权后，再以真实一对多/多对一、跨员工、取消/退款样本验收。


## 采购整单催办更新

每张采购单必定只有一个供应商。分组页催办入口仅在已采购待发货采购组头展示，展开履约明细不再重复入口。

新增 GET `purchase-groups/{groupId}/supplier-follow-up` 和其 `/launch`：沿用本页筛选（queue必须procurement_shipping），launch另传contactVersion。服务端以当前有权的来源读取既有供应商适配器，只保留该采购ID并校验单头供应商一致性；返回前、打开前均重新确认组及授权。弹窗只展示采购号、1688号、唯一供应商/旺旺信息，不显示代表某个来源的商品数量。现有履约视图催办功能保留，仍可以选择该履约涉及的多张采购单。

采购催办与组头右侧“履约单数 / SKU数”同行，避免新增一行高度；仍针对一张采购单的唯一供应商，不改变原数据权限。

## 采购渠道与 SKU 采购资料（最新业务修正）

SKU建档时维护采购链接和供应商，不存在“采购来源待确认”的正常业务流程。已有采购单的分类由FOP单头事实提供：`purchaseType=offline|online`；线下`platform=null`且无平台订单号，线上`platform=1688|other`。不得以缺少1688号推断线下、未知或未建采购单。待建采购单仍为真实的订单执行阶段，不能与采购货源是否维护混同。

页面在供应商名称旁显示“线下采购 / 线上·1688 / 线上·其他平台”，Excel增加采购类型/采购平台列并将原1688订单号列更名平台订单号。1688专属推单文案和旺旺催办仅适用1688；线下/其他平台显示FOP催办提示，采购分组催办接口也拒绝非1688平台（409），暂未实现其他平台联系人适配。

源码核对：`PurorderbillPlugIn.assignment`（约334–400行）从`hzkj_pur_supplier`按SKU及`hzkj_isfirst=1`读取`hzkj_supplier`和`hzkj_url`，带入采购分录与单头供应商；`propertyChanged`读取`billtype`并设置`hzkj_biztype`。本库未找到测试租户“线上/线下”的具体单据类型编码及其他平台字典，网关须按租户真实配置映射上述规范字段；未声称原queryPurchase已提供这些字段。SKU货源资料与采购单到履约单的数量归属是两个不同合同，后者仍需完整权威数据。

## 待创建采购单统一组

全部明确 `purchase=null` 的需求使用同一 `groupId=uncreated`，不再按客户、供应商、SKU或履约单分组。组内仍按履约单展示，一笔履约多个待建义务合并到同一行的lines，并验证重复来源及总量。`uncreatedCount` 是待建履约单行数；组头数量、分页展开、所选/全量导出仍只含当前授权和筛选范围。接口数据缺失仍报错，不进入待建组。

待创建采购单组固定在采购组列表首位，优先级高于收款升降序；分页与导出沿用相同顺序。默认收起，支持手动或本页全部展开。查看入口名称为“按履约单查看 / 按采购单查看”。

采购进度筛选：`purchaseStage=uncreated|placement_pending|payment_pending|refund_pending`，仅`queue=procurement`，省略表示全部。退款优先，再判未下单/推单，已下单且未付或部分付款进入待付；不同采购渠道共用placement事实，不将未知事实当成未付款。列表、合计、展开与两种导出同条件；已采购待发货传此参数返回400。
