# FOP 工作台与用户数据权限接入

Entry: `/dashboard`, authenticated, provides overview metrics and fulfillment links. Fulfillment details belong to `/workbench/:role`; `/` opens the current account’s default authorized workbench. Existing sales overview features are retained in the sales workbench.

## 当前状态

本地演示已启用后端 Mock：ECharts、履约面板、工作台明细共用预留 HTTP API，响应明确标记 `source: 'mock'`。组织架构、员工与SKU订单均有可验收的关联数据；组织变更可保存。详见 [Demo验收与API约定](FOP_DEMO_ACCEPTANCE.md)。

生产或未开启Demo模式时，真实FOP适配器仍默认未配置。未绑定账号拒绝访问，管理员不绕过数据授权；任何实时接口失败都不会回退到Mock。

注册日期区间最多366天，年份作用于回款分析；两者不改变履约待办队列。统计资源权限与订单权限分别校验。

## 月度回款环比

Dashboard 的「部门月度回款分析」「业务员月度回款分析」各自提供“上月环比”开关。默认展示金额，勾选后图表、摘要、明细和合计仅展示差额；明细及图表提示同时展示带正负号的环比百分比。差额为本月金额减上月金额，比例为差额除以上月金额。当前月按截至目前的回款与上月整月对比，页面明确标注。

`GET /autoflow/integrations/fop/dashboard` 的 `receipts` 增加 `previousMonth`（例如 `2025-12`）。营销中心、各部门及各业务员系列均增加 `previousAmount`，单位 USD；与 `amounts` 使用相同账本、归属及用户数据权限。基准月金额不计入当年回款合计。只有上年12月存在回款的业务员仍保留系列，以展示1月的减少。

示例：`{ "previousMonth": "2025-12", "months": ["2026-01", "2026-02"], "marketingCenter": { "id": "marketing", "name": "营销中心", "previousAmount": 80, "amounts": [100, 50] }, "departments": [...] }`。1月差额 `+20 USD / +25%`，2月差额 `-50 USD / -50%`。

真实适配器需返回完整授权范围内的基准月账本，不能把未查询的历史数据当作0。兼容旧响应缺少基准月时，首月显示“无上月数据”；上月为0且本月非0时，差额照常显示，比例显示“—（上月为0）”；两月均0显示0%。合计为可比月份差额之和，合计比例为差额合计除以对应上月金额之和，不累加或平均各月份百分比，不重复累加营销中心与部门、部门与个人。

## 数据边界

浏览器只传清单类型、搜索和分页等业务条件。用户身份由后端从登录会话取得，再逐次读取数据库中的 FOP 绑定；不接受客户端指定其他用户或租户。FOP 密钥、权限表达式及授权订单 ID 不发往浏览器。

具体管理 API、默认拒绝规则、适配器契约和验收步骤见 [FOP 用户数据权限](FOP_USER_DATA_ACCESS.md)。

## Source evidence and unresolved mappings

Read-only reference project: `/Library/VSCode/dtr5b`.

| Surface | Source evidence | Confirmation required before live integration |
| --- | --- | --- |
| Pending review, allocation, shipment, dispatch | Reference screenshot; `ordercenter/allocation/AllocationConstants.java` defines `hzkj_orders`, `hzkj_alloc_bill`, `hzkj_deliver_bill`, `hzkj_deliver_order`, allocation `pending` and order paid/processing/shipped states | Exact entity, counting unit, status filter, tenant/owner scope and cancelled-order exclusion for each card. Do not treat enum values across entities as interchangeable. |
| Daily registrations | Reference screenshot | Customer/member entity, registration timestamp, timezone, uniqueness and daily boundaries |
| Exceptions and tasks | Reference screenshot; fulfillment entities above | Exception criteria, aging clock, task ownership, priority, due time and detail links |
| Exchange rates | Reference screenshot; `fund/task/ObtainTheTaxRateTask.java` discusses conversion to USD | Official table, currency pair, direct/indirect rate and effective date. Current UI leaves rates empty until the integration is verified. |
| Collections | `ordercenter/plugin/form/ReceiptPerformanceReportFormPlugin.java` documents audited, successful receipts from fulfillment/sample and fully paid stock orders; excludes wallet, deposit stock and after-sales sources | Confirm whether the screenshot's department monthly metric uses this same rule. Confirm department attribution, refunds, date field, currency conversion and monthly aggregation. Current UI leaves collections empty until its permissions and mappings are verified. |

Department labels follow the screenshot. The local receipt report is customer/salesperson based and limits its own query to 30 days; it is not an existing monthly department Dashboard API. No endpoint or field mapping has been invented.

## 履约订单明细清单

入口：`/workbench/allocation?queue=allocation`，同时校验登录与账号岗位授权。旧 `/dashboard/orders?queue=allocation` 自动跳转，并保留搜索、精确订单号和分页参数。四个履约卡片、今日任务、异常订单数量和异常订单行均可点击。会员及回款保留图表位置，数据权限接入前不展示统计。

“待打单”已改为“待发运”，前端队列键由 `printing` 改为 `dispatch`；原“待发货”继续使用 `shipping`。以下是应用层统一的业务口径，**并非已验证的 FOP 原始状态码映射**。对接时需由后端确认实际业务含义，不能直接将这些键映射成现有 FOP 枚举。

| queue | 标题 / 唯一业务状态列 | 应用层筛选条件 |
| --- | --- | --- |
| review | 待审核 / 审核状态 | 审核待处理 |
| procurement | 待采购 / 采购状态 | 已审核、已支付、待采购 |
| allocation | 待配货 / 配货状态 | 已审核、已支付、待配货 |
| dispatch | 待发运 / 发运状态 | 已支付、已配货、待发运 |
| shipping | 待发货 / 发货状态 | 已支付、已发运、待发货 |
| exceptions | 异常订单 / 异常原因、异常时长 | 已支付、未发货、存在异常 |

所有队列排除已取消和已退款订单。支付状态是始终显示的基础字段。面板计数、今日任务数量、异常订单与明细由后端在当前 FOP 用户授权订单范围内计算；每次请求重新核验权限，非共享全局统计。详情支持订单编号、Shopify 单号、客户、店铺、SKU 搜索，按订单分页，每笔订单可包含多个商品；切换岗位或清单会清除上一清单搜索和页码。页面支持加载、空清单、请求失败、无效参数、图片加载失败及过期异步响应保护。

### 履约订单预留 API 契约（后端授权已实现，真实 FOP 数据尚未接入）

前端入口：`frontend/src/api/fop-orders.ts`。

- `getFopOrders(query)`：调用后端履约订单接口；岗位和 FOP 用户数据权限均由服务端校验。
- `getFopOrdersFromApi(query)`：兼容别名，与上述函数相同。此路径是 AutoFlow 后端适配接口，**不是现成的 FOP 接口**。
- 请求：`GET /api/autoflow/integrations/fop/fulfillment-orders`。
- 参数：`queue` 必填；`search` 可选模糊搜索；`orderNumber` 可选精确订单号；`page` 为从 1 开始的整数；`pageSize` 为 1–100，页面提供 10 / 20 / 50。
- 响应：`FopOrderPage`，包含 `source: 'fop' | 'mock'`、`items: FopOrder[]`、`total`（同一过滤条件下订单总数）、`totals`、`page`、`pageSize`。Mock 与正式接入使用同一合同。
- `totals` 为权限及搜索条件过滤后、分页前的完整合计：`{ orderCount, itemQuantity, amountsByCurrency: [{ currency, amount }] }`。多商品订单金额只计一次，不同币种分开；空结果为订单数 0、商品件数 0、币种数组为空。前端底部“筛选合计”使用该字段，不能累加当前页来冒充全部结果。具体口径见 [全局列表合计约定](./TABLE_TOTALS.md)。
- 订单字段：`id`、`orderNumber`、`shopifyOrderNumber`、`customerName`、`storeName`、`items[]`（`sku/name/imageUrl/variant/quantity`）、`amount/currency`、`paymentStatus`、`reviewStatus/procurementStatus/allocationStatus/dispatchStatus/shippingStatus`、`warehouse/carrier/trackingNumber/salesperson`、`createdAt/paidAt`、`cancelled`、`exception`。完整枚举和可空字段以 TypeScript 类型为准。

后端已在分页前完成租户/用户权限范围及队列过滤、取消/退款排除、关键词和精确订单号交集过滤，并使用稳定排序；不能只返回未过滤的一页让前端筛选。商品图片应返回可供当前用户读取的 HTTPS 地址，时间为带时区的 ISO 8601 字符串。真实请求失败须返回错误，禁止静默切换 Mock。

正式接入时实现后端 `FopDataProvider` 即可为面板和清单提供同一授权数据来源。两次独立请求不保证 FOP 数据快照完全相同；如业务需要，应由适配器提供统一快照机制。当前没有调用真实 FOP 服务。


## 五类工作台与账号权限

Dashboard 只承载履约概览和跳转。明细表格、搜索、分页、刷新均在工作台内。销售工作台保留原来的客户开发、工作流、建联及客户线索概览。

| 业务角色 | 工作台 | 功能 |
| --- | --- | --- |
| sales | `/workbench/sales` | 客户开发概览、待审核、异常订单 |
| procurement | `/workbench/procurement` | 待采购订单 |
| allocation | `/workbench/allocation` | 待配货订单 |
| dispatch | `/workbench/dispatch` | 待发运订单 |
| warehouse | `/workbench/warehouse` | 待发货订单 |

`users.workbench_roles` 是独立于 `users.role`（admin/user）的业务角色数组；一个账号可有 0–5 个岗位。迁移 `1784728000000-AddWorkbenchRoles` 为历史和新账号默认赋予 sales，不提升管理员身份。数据库和请求 DTO 都约束合法值及重复岗位。管理员有效拥有全部岗位，普通用户按数据库实际配置授权。

- `GET /api/workbench/access` 返回当前有效 `{roles,isAdmin}`。
- `GET /api/workbench/:role/access` 逐次读取当前数据库授权；未授权 403，非法岗位 400。
- `GET /api/users/workbench-accounts?page=1&pageSize=20&search=...` 仅管理员可访问，返回安全账号字段和总数。
- `PUT /api/users/:id/workbench-roles` 仅管理员可更新，body 为 `{workbenchRoles: [...]}`；空数组撤销全部岗位。
- 管理页面：`/admin/workbenches`，管理员侧栏入口“员工权限管理”。

前端每次进入工作台/角色管理页均向服务端刷新授权；普通用户仅见已授权岗位。手动修改 URL 或 localStorage 不能授予权限。后端不信任 JWT 中可能过期的权限声明，每次按 userId 读取当前角色；撤权或管理员降级在后续请求生效。现有销售概览接口 `/api/autoflow/dashboard` 同样要求 sales 岗位。岗位权限限定工作台入口和相应接口，原有其他业务模块的所有者隔离和权限保持原规则。

用户自行修改资料或头像不能写入岗位；资料更新采用字段级更新，避免并发覆盖管理员的授权变更。角色管理不修改账号的系统管理员身份。履约数据授权是独立边界：岗位决定可用功能，FOP 用户权限决定可读业务数据；两者必须同时满足。
