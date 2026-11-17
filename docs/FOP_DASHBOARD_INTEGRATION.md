# Dashboard会员与回款分析契约

工作台、用户权限和当前集成状态统一见 [项目开发需求说明书](requirements/HyperZone智能办公平台项目开发需求说明书.html)。本文仅保留独立会员/回款分析需求；历史Mock示例不代表当前生产状态。

## 月度回款口径与环比

FOP 是金蝶云苍穹上的自研 HyperZone 应用。方案 2 已落到独立收款分录合同：已支付、源单已审核且收款单已审核的履约及全款备货结算，按支付月份 UTC+8 计入客户、业务员与部门；押金备货、样品不计入，备货不贡献履约订单数。amount 映射分录 hzkj_real_receive_amt，orderAmount 和 handlingFee 分别保留订单金额及手续费。钱包授信可产生结算收款，因此不是银行新增现金流。使用已全款备货的履约订单产品款已在源单免除，不能在分析层补回或再次扣减。

receipts 必有 basis=actual_received、timeZone=UTC+8；营销中心、部门和业务员系列均包含 breakdown: { fulfillment: number[], fullPaymentStock: number[] } 及 previousBreakdown。两来源之和等于金额；上一年 12 月使用同一账本与权限。

Dashboard 的「部门月度回款分析」「业务员月度回款分析」各自提供“上月环比”开关。默认展示金额，勾选后图表、摘要、明细和合计仅展示差额；明细及图表提示同时展示带正负号的环比百分比。差额为本月金额减上月金额，比例为差额除以上月金额。当前月按截至目前的回款与上月整月对比，页面明确标注。

`GET /autoflow/integrations/fop/dashboard` 的 `receipts` 增加 `previousMonth`（例如 `2025-12`）。营销中心、各部门及各业务员系列均增加 `previousAmount`，单位 USD；与 `amounts` 使用相同账本、归属及用户数据权限。基准月金额不计入当年回款合计。只有上年12月存在回款的业务员仍保留系列，以展示1月的减少。

缩略示例：营销中心 `amounts=[100,50]`，`breakdown={fulfillment:[70,20],fullPaymentStock:[30,30]}`，`previousAmount=80`，`previousBreakdown={fulfillment:60,fullPaymentStock:20}`，`previousMonth="2025-12"`。1月差额 `+20 USD / +25%`，2月差额 `-50 USD / -50%`。

真实适配器需返回完整授权范围内的基准月账本，不能把未查询的历史数据当作0。兼容旧响应缺少基准月时，首月显示“无上月数据”；上月为0且本月非0时，差额照常显示，比例显示“—（上月为0）”；两月均0显示0%。合计为可比月份差额之和，合计比例为差额合计除以对应上月金额之和，不累加或平均各月份百分比，不重复累加营销中心与部门、部门与个人。

## 数据边界

`GET /api/autoflow/integrations/fop/receipts` 接收 `from/to`、可选 `department/ownerId/customerId/sourceType`、`warehouse=ALL|HZ|SZ`、必填 `workbenchRole` 与分页；`sourceType` 为 `fulfillment|full_payment_stock`。`GET /api/autoflow/integrations/fop/order-volume/receipts` 继承客户聚合／订单下钻查询，要求 `category=customer`，按完整区间先固定数量 Top 10 与 other 成员，再按期间和明细仓过滤。两接口均需 receipts scope 及独立分录 allowlist，浏览器不能提交权限。

响应 `{ source,timeZone,total,totals,page,pageSize,items }`；`items` 是 USD、有效且获授权的收款分录。`totals` 包含 `receiptCount,currency,amount,fulfillmentAmount,fullPaymentStockAmount,orderAmount,handlingFee`，均按完整筛选范围计算；分页只截取 items。分录按 paidAt 倒序、id 稳定排序，数量是收款行数，不能冒充履约订单数。全款备货 `carrierCode=null` 表示不适用。详见 [订单与客户分析 API](FOP_ORDER_VOLUME_API.md) 及 OpenAPI。

浏览器只传清单类型、搜索和分页等业务条件。用户身份由后端从登录会话取得，再逐次读取数据库中的 FOP 绑定；不接受客户端指定其他用户或租户。FOP 密钥、权限表达式及授权订单 ID 不发往浏览器。

具体管理 API、权限和当前实现状态见 [项目开发需求说明书](requirements/HyperZone智能办公平台项目开发需求说明书.html)。

## Source evidence and unresolved mappings

Read-only reference project: `/Library/VSCode/dtr5b`.

| Surface | Source evidence | Confirmation required before live integration |
| --- | --- | --- |
| Pending review, allocation, shipment, dispatch | Reference screenshot; `ordercenter/allocation/AllocationConstants.java` defines `hzkj_orders`, `hzkj_alloc_bill`, `hzkj_deliver_bill`, `hzkj_deliver_order`, allocation `pending` and order paid/processing/shipped states | Exact entity, counting unit, status filter, tenant/owner scope and cancelled-order exclusion for each card. Do not treat enum values across entities as interchangeable. |
| Daily registrations | Reference screenshot | Customer/member entity, registration timestamp, timezone, uniqueness and daily boundaries |
| Exceptions and tasks | Reference screenshot; fulfillment entities above | Exception criteria, aging clock, task ownership, priority, due time and detail links |
| Exchange rates | Reference screenshot; `fund/task/ObtainTheTaxRateTask.java` discusses conversion to USD | Official table, currency pair, direct/indirect rate and effective date. Current UI leaves rates empty until the integration is verified. |
| Collections | hzkj_receive_bill.entryentity.hzkj_real_receive_amt 为实收，hzkj_samount 为订单金额；源单与收款单审核分别验证 | 已确认方案 2：履约＋全款备货，不含样品／押金备货。旧报表包含样品并使用订单金额，不能直接照搬；正式接口、审核时间字段与币种转换仍须样本核验。 |

后台只读核查和已确认字段详见 [HyperZone FOP 源码映射](analytics/HYPERZONE_FOP_SOURCE_MAPPING.md)。旧收款报表不是现成的部门 Dashboard API；已实现的是本工程聚合与 Mock 契约，正式 FOP 网络适配器仍未配置。
