# HyperZone ECharts 全面诊断与 API 对接需求

核对日期：2026-10-22。适用对象：前端、平台后端、FOP（金蝶云苍穹上的 HyperZone 自研应用）开发、测试与实施人员。

## 1. 交付结论与阅读方式

本轮覆盖仓库中所有 ECharts 运行入口：共享 EChart 包装器、注册会员、部门回款、业务员回款、业务订单量趋势/排名、客户订单量/金额排名、客户趋势弹窗，以及物流运费并列柱状图和单服务商趋势弹窗。履约卡片、任务、异常、工作日历虽不全部属于 ECharts，仍核对其图表相关数据依赖和边界。

当前项目具备前后端分析契约、服务端演示数据、用户级权限过滤与工作台跳转。**真实 FOP 数据提供器、授权解析和组织同步尚未完成；本文件不是已接入金蝶生产环境的证明。** 本轮已按用户确认的方案 2 更新本工程聚合、Mock、前端和契约；历史诊断单独标注，验证结果以 VERIFICATION.md 为准。后台源码只读核查，未改生产应用。

交付件：

- 本文 Markdown 与同名 HTML：接口清单、字段字典、统计口径、FOP 映射要求、验收用例、实现差距。
- `docs/openapi/hyperzone-analytics.openapi.json`：可供 Swagger Editor、Apifox、Postman 等支持 OpenAPI 的工具导入的契约；描述当前平台 HTTP API，而非虚构的金蝶原生接口。
- `ECHARTS_FRONTEND_AUDIT.md`、`ECHARTS_BACKEND_CONTRACT_AUDIT.md`：独立诊断证据，内容也收录在本文附录。
- `VERIFICATION.md`：本次实际检查与限制。
- `FOLLOW_UP_CHECKLIST.md`：第7章补充的后续待办与人工核对清单；按T/H编号记录优先级、建议负责人、输入、产物和完成标准，并提供脱敏验收样本及回填模板。

采用 [OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) 的 `paths`、`operationId`、`parameters`、`requestBody`、`responses`、`components/schemas`、`securitySchemes` 结构。可空使用 JSON Schema 的 `null` 类型；必填与可空分别表达。该版本选择用于稳定契约，不宣称它是最新规范版本。

## 2. 图表与业务模块总览

| 编号 | 图表/功能 | 查询与展示 | API/字段依赖 | 明细与交互 |
| --- | --- | --- | --- | --- |
| CH-01 | 每日注册会员统计 | 开始/结束日期；右上角一个部门维度；营销中心显示部门汇总，具体部门显示合计及业务员 | `dashboard.registrations`、`registrationDepartments[].counts`、`salespeople[].counts` | 图例、提示框、日期清单；当前没有注册会员逐条名单 API |
| CH-02 | 部门月度回款分析 | 年份；营销中心＋四业务部；独立上月环比 | `receipts.months`、`previousMonth`、`marketingCenter`、`departments[].amounts/previousAmount` | 金额/差额/比例；合计；月份倒排；环比自动展开明细，取消保持展开 |
| CH-03 | 业务员月度回款分析 | 与部门回款共用年份；指定部门；部门合计与员工并列；独立环比 | `receipts.departments[].salespeople[]` | 固定表格列宽；金额/环比明细；可进入工作台收款分录下钻 |
| CH-04 | 业务订单量趋势 | 年份最前；物流服务商/组织/业务员；类别明细；月/周/日；仓库及分仓 | `order-volume.query/periods/series/warehouses` | 最新时间窗；图表点击进入对应工作台订单清单 |
| CH-05 | 业务订单量排名 | 同 CH-04 条件；含汇总对象和明细 | `series.total/kind/entityId` | 汇总不重复累加；业务员 Top 5＋其他；服务商固定顺序 |
| CH-06 | 客户订单量排名 | 日期范围、部门、仓库、分仓；Top 10＋其他 | `category=customer`；`series.total/warehouses` | 客户表每人两行；点击趋势打开弹窗；仓库数量可下钻 |
| CH-07 | 客户回款业绩对比 | 与 CH-06 完全相同客户集合和顺序 | `series.amounts.currency/total/values/warehouses/breakdown/excludedOrderCount` | `$`，两仓金额比较、合计及占比；不另取“金额Top 10” |
| CH-08 | 客户订单量趋势弹窗 | 按客户名/编码搜索后选择，或从排名点趋势；继承日期/部门/仓库 | `order-volume/customers`；`order-volume?customerId=...` | 居中弹窗、关闭/ESC、每日明细、滑块拖动、分仓 |
| CH-09 | 客户回款业绩趋势弹窗 | 与 CH-08 同筛选、同日期；与数量趋势同步拖动 | `series.amounts.values/warehouses` | 数量/金额双图，明细按日期倒排 |
| CH-10 | 物流运费分析 | 月/周/年、年份、周锚点及仓库；合计、云途YT、4PX、万邦WB、燕文YW、极速JS、其他固定顺序并列柱状 | `freight.query/periods/series/totals`；实际成本按确认时间 UTC+8 归期、USD | 独立环比开关、倒序统计表、固定列宽；开启环比展开表格，关闭不收起；仅拖动滑块调整横轴 |
| CH-11 | 单物流服务商运费趋势 | 继承已应用时间/仓库，按选中carrierCode显示该服务商 | 复用freight响应筛选单商；接口也支持carrierCode；各期 amount/previousAmount/delta/percent | 居中趋势弹窗；发运单原币/汇率/成本明细进入当前可访问岗位工作台 |
| AUX-01 | 履约卡片/异常/任务 | 当前授权队列，不跟随注册日期范围 | `dashboard.queues/exceptions/tasks`、`fulfillment-orders` | Dashboard 仅统计和跳转；业务明细在岗位工作台 |
| AUX-02 | 工作日历 | US纽约、EUR柏林、AUD悉尼；周一至周五09:00–17:00 | 浏览器时间＋`Intl` 时区，无独立HTTP接口 | 当地当前时间、工作状态、UTC+8转换、夏令时；不含公共假日 |

详尽交互、源码定位、已知缺陷和测试边界见附录的前端诊断。

## 3. 对接架构与责任边界

```text
浏览器 ECharts / 工作台
  → 平台 /api（会话、DTO验证、数据权限）
  → FopDataService（授权交集、租户隔离、去重、汇总、公开字段序列化）
  → FopDataProvider（当前 Demo 或 Unconfigured）
  → 待实现：金蝶云苍穹用户授权、组织、客户、订单、收款分录、物流成本、注册等网络适配
```

1. 浏览器仅提交业务筛选条件，不提交有效权限、FOP 用户身份或订单授权列表。
2. 平台读取登录用户的 `fopTenantId/fopUserId`、业务角色、部门/员工标识与岗位角色。
3. FOP 适配器解析该用户真实授权，返回同一 `subject` 的订单 allowlist、独立收款分录 allowlist、独立 `allowedFreightIds` 与分析资源授权；服务端再做本地业务范围交集，不能让本地业务管理员绕过 FOP 租户与用户授权。物流成本必须有 `freight` analytics scope；订单／收款授权均不能推导成本授权。
4. 订单／收款／运费候选记录携带服务端专用 `tenantId`、必要部门祖先路径，验证后只向浏览器返回公开字段。组织路径不得依赖浏览器传入。
5. 新适配器不得在故障、超时、权限撤销时回退到全量数据或 Mock；应维持既有 403/503 语义。
6. `asOf/updatedAt` 当前是响应生成时间，不代表 FOP 一致性快照、最后同步成功时间或账期关闭时间。真实接入如需一致性，应新增并正式版本化 `snapshotId/sourceUpdatedAt/permissionVersion` 等字段；它们目前不是已实现字段。

## 4. 统一统计口径与待对齐项

### 4.1 日期与时间

统一口径：订单与收款统计按 `paidAt` 先转换 UTC+8，再取业务日期/月；范围包含开始和结束当天。传输时间戳必须携带时区（推荐 ISO 8601 UTC `Z`），纯业务日期使用 `YYYY-MM-DD`。

当前订单、收款、Dashboard 日期默认值和校验均使用 UTC+8。历史诊断中的直接截取支付字符串月份、UTC／浏览器本地上限差异已由共享业务时间转换替换；跨月和跨年仍须在真实源数据联调时核验。

- 按月：当年1月至当前月；历史年份12个月。
- 按周：参考周及前三周，四组；跨年周仍按真实日期区间。
- 按天：所选月自然日数，未来日期返回 `null`，已发生且无订单为 `0`。
- 客户分析：只有 `from/to` 日期范围，不传年份、粒度、月份/参考周；后台生成每日序列用于客户弹窗。
- 收款环比：必须提供前一年12月基线及每个连续月份的金额。缺基线显示“无上月数据”，上月为0且本月非0时显示差额但不伪造百分比。

### 4.2 订单、金额与回款

方案 2：已支付、源单已审核且收款单已审核的履约与全款备货收款，按支付月计入客户、业务员和部门业绩；押金备货及样品不计入。订单数与业绩金额使用不同事实资源、独立授权。

| 项目 | 当前实现／要求 |
| --- | --- |
| 订单计数 | 履约订单 ID 去重；paymentStatus=paid、reviewStatus=approved、未取消、有效且不晚于当前时刻的 paidAt；备货不计订单数，多 SKU 只计 1 单 |
| 实收业绩 | 每条收款分录 amount 映射 hzkj_real_receive_amt，非表头重复分摊、非订单 amount；独立 allowedReceiptIds 与 receipts scope，缺失权限默认不授予 |
| 订单金额与手续费 | 收款 orderAmount 映射 hzkj_samount、handlingFee 映射 hzkj_handle_fee，保留用于对账，不替代实收 |
| 全款备货 | 支付当月计入业绩；源履约使用预付库存时产品款已免除，不补回产品款、不再次扣减、不重复计算备货收款 |
| 客户金额 | 客户 amounts 来自同一收款账本；仅 USD，来源 breakdown 为 fulfillment/fullPaymentStock。缺 receipts scope 时省略 amounts，不以 0 伪装无权 |
| 金额精度 | 逐条转整数分后累加，单条及累计均验证非负安全精度；不隐式换汇；兼容名 excludedOrderCount 现表示非 USD 排除的收款分录数 |
| 列表合计 | 收款 totals 覆盖完整筛选范围，receiptCount 为行数，来源金额之和等于 amount；订单 totals 仍为订单数、件数及各币种订单金额 |
| 部门合计 | 营销中心=授权范围内四业务部之和；部门合计=本部门业务员之和，不重复累加汇总和明细 |
| 环比 | 差额=本月−上月；比例=差额/abs(上月)×100%；上年 12 月同账本基线；总比例用合计基数重算 |
| 财务边界 | 钱包授信可生成有效结算收款，因此实收业绩不等于新增银行现金流。历史期间按当前有效审核／取消状态重算，未新增结账锁定或退款冲销系统 |

已确认实体、字段和原始状态见 [源码映射](HYPERZONE_FOP_SOURCE_MAPPING.md)。旧 ReceiptPerformanceReportFormPlugin 包含样品且按订单金额统计，不能直接替代此次口径；审核时间响应字段、正式 HTTP 传输和非 USD 折算仍待接口样本确认。

### 4.3 排名、组织和仓库

- 物流默认顺序：云途YT、4PX、万邦WB、燕文YW、极速JS、其他；已知其他服务商可由可信适配器映射 OTHER；已审核履约缺失／未知物流代码必须拒收，不作为正常“其他”。
- 客户按订单量取前十；其他客户合并一项；金额图使用相同客户集合。各仓库不各自重排 Top 10，确保横向对比一致。仅有全款备货回款、订单数为 0 的客户仍可搜索并进入总计／other。
- 明细“其他”必须先用整个查询范围确定集合，再缩小日期/仓库，不能在单日重新排名后产生不同成员。
- 已审核履约仓库必须为 HZ/SZ，缺失／未知是适配契约错误；UNASSIGNED 仅保留兼容字段。全款备货有国内仓库，海外物流不适用，carrierCode=null。
- 下属团队由适配器映射至四个固定业务报表部门 `sales1...sales4`。组织树可自定义，但自定义组织树不会自动改变报表固定部门模型。
- 名称保留中文和英文别名；统计人员为外贸业务员/伙伴。`owner.id` 是稳定业务员工标识，不能用名称或本地登录邮箱替代。

### 4.4 物流运费的独立成本事实

运费取已审核发运单 `hzkj_deliver_bill.hzkj_actual_freight`，按 `hzkj_actual_freight_time` 确认时间 UTC+8 归期。它是物流商实际成本快照，不使用客户支付运费、预估报价或订单金额推算。当前资格为 `reviewStatus=approved`、`costStatus=confirmed`、正数金额和已发生的非空确认时刻；未审核、未确认、零费用及未来确认不纳入。正数已确认成本缺确认时间属于契约错误，不能回退发运日／审核日。

| 项目 | 当前实现／必须保持的边界 |
| --- | --- |
| 唯一粒度 | 每个发运单 ID 一条当前成本快照；重复 ID 拒收。一个履约订单多次发运可产生多条成本，不能按订单号去重 |
| 币种 | `originalAmount/originalCurrency` 保留源金额和明确原币；`fxRateToUsd/fxRateDate/fxRateSource` 必须显式提供。USD 本币汇率也必须为1；其他币种不得默认当 CNY 或 USD |
| 折算校验 | `amount=originalAmount×fxRateToUsd` 以十进制精确乘法按 HALF_UP 到分（1.50×0.15=0.23），不采用二进制浮点乘积后直接round，`currency=USD`；原额与USD结果最多两位小数；单条、乘积及累计须安全、有限，金额按分累加。缺汇率、折算不符、非法币种／金额不得静默混加 |
| 月粒度 | 选定年1月至 UTC+8 当前月；历史年为12月；1月比较前一年完整12月 |
| 周粒度 | 周一开始，锚点所在周及前三周。weekOf 默认当年今天、历史年12月31日；显式锚点必须属于 year 且不晚于今天；跨年周及其上一周完整读取 |
| 年粒度 | 所选年及前四年，显示区间最早2020；即便首个显示年为2020，其完整2019年基期仍需读取 |
| 未完周期 | `periods[].partial=true` 明示未结束周期（含周期末当天），本期to截到UTC+8今天。本期仅含当前已确认金额，与完整上一期比较；不能宣称为同期进度增长率或已关账数据 |
| 环比 | amount、previousAmount、delta 和 percent 同时返回；delta=本期−上期，percent=delta/abs(上期)×100（25表示25%）。上期0且本期>0为null，显示“上期为0”；双0为0。合计比例用合计基数重算，不能加各期百分比 |
| 服务商 | 无 carrierCode 时合计＋YT/4PX/WB/YW/JS/OTHER；过滤单商时合计＋该商。合计不与明细再次相加；OTHER仅为可信适配器明确映射的其他真实服务商 |
| 独立成本权限 | `freight` scope 缺失403；`allowedFreightIds` 缺失或为空返回空范围。有效范围=FOP成本授权∩租户∩本人／部门及下属／业务管理员范围；系统管理身份、订单可见性和页面筛选均不扩大权限 |
| 下钻与分页 | GET `/freight/details` 要求有效 `workbenchRole`，携带原查询、可选 periodId/carrierCode 与 comparisonPeriod。current 默认本期，previous选择同周期完整上期；periodId必须来自该查询。total/totals按完整筛选范围计算，分页不改变合计；原币按币种分别合计 |
| 最终结算边界 | FOP费用分录已停用，重派／退费采集未启用；常规候选只查首次未得到正运费的单据，不能保证后续调价刷新。确认时间只证明写入苍穹，不证明最终账单、付款或全部补收退款已入账 |

真实 FOP 只读成本查询、最终结算定义、币种和历史汇率、后续调价／补收退款、真实服务商映射及字段级成本可见权仍待联调。平台 Mock 已按独立事实实现，不能据此关闭这些生产核对项。

## 5. FOP 上游字段映射需求清单

以下是平台逻辑字段。实体、状态与金额字段已经只读核对 `/Library/VSCode/dtr5b`，证据见源码映射；实际发布 URL、操作契约、鉴权、分页及脱敏响应仍待后台团队提供。平台 HTTP 路径不能直接当作云苍穹原生路径。

| 资源 | 必需逻辑字段 | 类型/约束 | 用途与对接要求 |
| --- | --- | --- | --- |
| 绑定主体 | `tenantId`, `userId` | 非空稳定字符串；与本地绑定成对对应 | 响应主体必须与请求主体一致；停用/离职/转岗后即时撤销旧授权 |
| 用户授权 | `subject`, `allowedOrderIds[]`, `allowedReceiptIds[]`, `allowedFreightIds[]`, `analyticsScopes[]` | 订单、收款分录、运费分别授权；独立白名单缺失／空数组=该资源无记录；分析范围rates/registrations/receipts/freight | 授权与数据读取不可跨用户复用；本地admin不等于FOP超级用户；freight scope缺失403 |
| 组织 | `id`, `name`, `parentId`, `type`, `enabled`（后两项为目录同步需求） | 主键稳定，父级可空，无环 | FOP目录同步尚未实现；明确同步/手工修改优先级和删除语义 |
| 部门 | `department.id/name`, `departmentPathIds[]`, `salesDepartmentCode` | 祖先路径来自可信源；报表部门sales1–sales4 | 支持经理管辖子部门；业务报表归口不能靠文本模糊匹配 |
| 员工 | `owner.id/name`, 岗位/部门归属、中文名/英文名、在职状态 | employeeId独立于登录账号ID | 两类名字展示可合成name；领导不混入业务员业绩序列；伙伴可列入 |
| 客户 | `customerId`, `customerCode`, `customerName` | 稳定ID；编码可搜索；名称不能作主键 | 排名、名称/编码查询、权限过滤结果；重复名称按ID区分 |
| 订单标识 | `id`, `orderNumber`, `shopifyOrderNumber`, `storeName` | 主键全租户唯一或与tenant复合唯一 | 不得用明细行ID作为订单ID；Shopify单号可能仅店铺内唯一 |
| 订单金额与支付 | amount、currency、paymentStatus、reviewStatus、paidAt、cancelled | paid/unpaid/refunded；pending/approved；paidAt 可空且带时区 | 订单 amount 仅用于订单明细，不代替实收；订单量需 paid＋approved |
| 订单时间 | `createdAt`, `paidAt` | ISO8601时间戳；paidAt=null为未获取/未支付，不回退createdAt | 排序与支付日期统计独立于创建日期 |
| SKU行 | `items[].productId/sku/name/imageUrl/variant/quantity` | quantity为数量，图片可空，产品ID可缺失 | 一订单多SKU；失效图片降级；图片地址应为获授权可访问资源 |
| 履约状态 | `reviewStatus`, `procurementStatus`, `allocationStatus`, `dispatchStatus`, `shippingStatus` | 枚举见完整schema | 分别映射审核、采购、配货、发运、仓库出库状态；不能合并一个大状态字段 |
| 仓库 | `warehouseCode`, `warehouse` | 已审核履约／收款必须 HZ/SZ；未知拒收 | 订单分仓对比。若同单跨仓，需另行约定“订单归属仓”或“按仓发运单数”，不得直接双计订单 |
| 服务商 | `carrierCode`, `carrier`, `trackingNumber` | 标准代码映射；名称/跟踪号可空 | 固定六类，已知其他明确映射 OTHER，未知／缺失不能掩盖；备货 carrierCode=null |
| 异常 | `exception.reason/hours` | stock/address/tracking；hours为持续时长 | 异常清单和任务，是否可同单多异常需定义 |
| 注册会员 | `registrationEntries[].date/salesDepartmentCode/owner/count/departmentPathIds` | 每日+员工计数；非负安全整数，日期完整 | 非管理员须提供员工粒度可过滤记录；仅日汇总无法实现本人/部门隔离 |
| 收款分录 | id、sourceType、documentId/Number、amount/orderAmount/handlingFee/currency、paidAt、reviewStatus、receiptReviewStatus、paymentStatus、客户/owner/部门/仓库/items | 独立分录 ID，tenantId／departmentPathIds 仅服务端；实际应收／手续费／实收分别保留；公开端点只返回有效 USD 分录 | 已实现 FopReceipt、GET /receipts 与 /order-volume/receipts；多笔分录不重复计订单数，不复制表头实收到各行 |
| 物流成本快照 | id、documentNumber、orderNumber、trackingNumber、carrierCode/Name、channelName、warehouseCode/warehouse、客户/owner/部门、originalAmount/Currency、fxRateToUsd/Date/Source、amount/currency、confirmedAt、reviewStatus、costStatus | 发运单表头当前实际成本；tenantId／departmentPathIds只在可信服务端候选；USD折算有明确原币及汇率证据 | FopFreight、GET /freight及/freight/details；独立成本授权；确认不等于最终结算，补收退款与历史调价机制待核对 |
| 增量同步 | 更新时间、删除/失效标记、分页游标、授权版本、一致性快照 | 新适配器设计要求，非现有响应字段 | 大数据量不能靠浏览器下载全部订单；约定全量、增量、重试与断点恢复 |

### 后台团队需回填

每个资源提供：实际服务域名（环境隔离）、实体标识、操作编码、字段Key、认证/签名方式、用户授权传递方式、分页参数、限流和超时规则、错误码、样例脱敏报文、可联调账号、数据刷新周期、字段含义负责人。没有资料的项标记“待确认”，不得通过猜测补全。

## 6. 联调与验收用例

| 编号 | 场景 | 验收要求 |
| --- | --- | --- |
| AT-01 | 管理/业务权限分离 | 管理员+none可维护组织/账户但不能读图表业务；普通用户+business admin可读其FOP允许的数据但不能改系统权限 |
| AT-02 | 部门经理/业务员 | 经理仅本部门及授权子部门；业务员仅本人；搜索候选、排名、汇总、明细、导出不能越权 |
| AT-03 | 权限变更在途 | 换绑定/撤岗/撤部门后旧请求不得返回旧权限数据；退出/换号清除缓存 |
| AT-04 | 授权为空和上游故障 | 空授权返回空范围；无绑定403、未配置/故障503；不以0或Mock掩盖错误 |
| AT-05 | 月末/年末UTC+8 | 23:59:59与00:00:00前后，图表、回款、明细属于同一正确日期/月；前一年12月用于1月环比 |
| AT-06 | 环比边界 | 正负差额与百分比；上月=0、有/无基线、缺月；勾选自动展开，取消不收起，列宽不变 |
| AT-07 | 客户双指标 | 每客户恰好履约订单量/回款业绩两行；两图同客户顺序；Top10＋Other覆盖全量；金额与收款行对账，数量与履约订单对账；仅备货客户 count=0、amount>0 不丢失 |
| AT-08 | 分仓 | HZ＋SZ=总量/总额；未知已审核履约维度应报契约错误；点击仓库数值进入该仓明细；切单仓时禁止重复“分仓对比” |
| AT-09 | 数据异常 | 重复订单、多SKU、缺paidAt、未来支付、取消、全额退款、非USD、负金额、超精度金额、未知代码分别明确处理 |
| AT-10 | 分页和筛选 | 切页不改变筛选总计；Other下钻不重新排名；客户编码精确匹配优先；所有非法参数/多余权限参数拒绝 |
| AT-11 | 交互与主题 | 滚轮只滚外层；点击面板不改横轴；只拖滑块；最新时间窗；弹窗立即可见、ESC关闭、焦点恢复；暗色和窄屏可读 |
| AT-12 | 实际渲染与导出 | 真浏览器检查SVG、Tooltip、图例、ResizeObserver、图片导出；stub单测不替代此项 |
| AT-13 | 大规模真实数据 | 用实际业务量压测权限集合、全量聚合、客户搜索及大日期跨度；先协商响应时间和容量指标，再签收 |
| AT-14 | 文案和数据一致性 | 当前条件与最后成功应用条件分离；在途改筛选不能改变已返回数据标题；失败不把旧图标成新条件 |
| AT-15 | 运费事实及原币折算 | 已审核已确认正运费计入；重复发运单、缺确认时间、缺汇率、USD汇率非1、折算不符与未知维度明确拒收；同订单多发运单分别计成本 |
| AT-16 | 运费周期与对账 | UTC+8跨月/年；月YTD、历史12月、周一4周、近5年；未完期标记；完整跨年上期、0基期、各商与合计、current/previous明细及分页前合计逐项对账 |
| AT-17 | 成本独立授权及交互 | 订单有权但运费无scope为403；空运费授权为空；本人/部门/租户隔离和在途撤权；服务商弹窗、工作台明细、倒序/固定列宽、环比开关与拖动滑块真实浏览器验收 |

## 7. 交付与接入顺序、后续待办及人工核对

1. 按已确认方案 2 与源码字段映射取得正式 FOP 响应样本，核验状态、金额、支付日期及归属。
2. 完成真实用户身份/权限适配，再读取任何业务数据；通过管理与业务权限分离验收。
3. 接入组织、员工、客户与订单明细，完成固定业务部门归口、状态、仓库及服务商标准化。
4. 分别按获授权履约订单和收款分录对账；验证客户 Top10／other 共享集合、来源拆分、分仓及分页前合计。
5. 接入注册明细和回款基线；处理已知边界缺陷，做真实浏览器和规模测试。
6. 先在测试环境小范围员工验收，再切生产；数据库、附件和配置按部署文档单独备份迁移。

本次交付包含当前项目的代码与文档基线；不包含本机数据库、用户密码、密钥和运行产物，也不表示已部署到生产服务器。

本章后续收录 [后续待办与人工核对清单](FOLLOW_UP_CHECKLIST.md)：保留T01–T16、H01–H17、D01–D10，并追加物流运费T17–T20、H18–H22、D11–D15及回填模板。清单以方案2及运费当前快照契约为基线；未确认的生产信息保持待核对，不改写当前业务口径，也不把Mock完成状态当成真实FOP接入完成。



适用基线：方案2代码提交 `d60fd5d`、本次物流运费成本快照扩展、当前 OpenAPI 19个操作／82个模型、HyperZone FOP 源码映射。本文作为完整需求第7章的补充，区分“已经实现”“待开发”“待提供资料”，便于业务、财务、FOP研发与实施人员逐项回填。方案2历史测试数量保留作证据，运费测试结果以 VERIFICATION.md 新增记录为准。

建议负责人仅表示职责，不代表已指定人员或承诺工期。P0表示开始真实接入前必须具备的输入或能力，P1表示正式上线前必须完成，P2表示确认存在需求后安排；它们不是漏洞等级。未完成项不因 Mock 验收通过而关闭。

### 已确认基线，不重复征求方案选择

| 事项 | 已确认／已实现 | 后续只需核对的边界 |
| --- | --- | --- |
| 后台与源码 | FOP为金蝶云苍穹上的自研 HyperZone；源码 `/Library/VSCode/dtr5b`；事实已写入 agent.md | 核查源码版本与实际部署版本、已发布的只读接口 |
| 回款方案 | 采用方案2：合格履约收款＋全款备货收款，按 UTC+8 支付月份计入；押金备货排除 | 不重新选择SKU还原方案；核对真实分录、退款、迟审及历史修正 |
| 实收金额 | 当前 `basis=actual_received`，`amount=hzkj_real_receive_amt`；`orderAmount=hzkj_samount`、`handlingFee=hzkj_handle_fee`单列 | 核对线上字段含义及各支付渠道实收完整性；如考核制度不同，登记明确变更，不静默换金额字段 |
| 不重复计款 | 全款备货在收款月计入；后续履约只计实际追加收款，不补回已支付产品款，不再扣一次备货 | 核对多次收款、零补款、跨月使用、退回库存等真实样本 |
| 资格与数量 | 收款要求源单已支付、已审核且收款单已收、已审核；履约订单量单独按订单ID计数；备货不增加订单量 | 源订单、收款两类状态必须分别映射，不把“已收”直接等同于源单已审核 |
| 仓库与物流 | FOP已控制审核通过的履约仓库／物流渠道完整；备货有国内仓库、海外物流不适用 | 需提供真实ID映射和多仓／多包裹规则；无需新增“补齐已审核订单仓库、物流”的人工流程 |
| 权限 | 系统管理权限与业务范围独立；管理员／部门经理／业务员范围已实现；订单与收款独立授权 | 真实FOP授权、员工绑定和全部业务模块的生产归属尚待接入；业务管理员不能绕过FOP许可 |
| 前端与演示 | Dashboard跳转工作台；回款明细、来源拆分、分仓、环比、客户Top10＋其他及纯备货客户展示已实现 | 真实接口、正式员工及数据对账仍待联调；不重复安排已完成页面开发 |
| 币种与其他来源 | 当前业绩仅统计USD，显示 `$`，不自动换汇；样品、押金备货、钱包充值不加入本次收款业绩 | 非USD、退款／调整、钱包授信含义按下方清单核对；新增指标需单独变更契约 |
| 物流实际成本 | 发运单已审核且已确认的实际运费，按确认时间UTC+8归期；独立成本Mock、分析/明细契约、月周年度与完整上期环比 | 源确认不是最终结算或银行付款；后续补收、退款、重派和调价不能靠首次快照覆盖 |
| 运费币种与授权 | 保留原币/原额、明确USD汇率及日期/来源；折算金额必须一致；独立allowedFreightIds与freight scope | 不推断所有运费为CNY；订单可见不等于成本可见；真实历史汇率、FOP成本和字段权限待H18–H22确认 |

### 后续开发与交付待办

所有事项当前均未完成生产验收；“已有基础”指本工程已经存在的实现，不表示该待办整体完成。关联的 H 编号在下一节提供具体回填要求。

| 编号 | 优先级／当前状态 | 待办与已有基础 | 前置人工输入 | 完成标准与交付物 | 建议负责 |
| --- | --- | --- | --- | --- | --- |
| T01 | P0 · 待资料 | 建立正式接入资料包和业务差异记录；已有字段级OpenAPI及源码证据 | H01–H13、H16 | 每项有答复人、版本、脱敏样本或明确“不适用”；确定本期接入边界、未决项和处理方式 | 产品／实施牵头，FOP研发、财务、业务配合 |
| T02 | P0 · 待开发 | 实现真实 `FopDataProvider` 只读网络适配、认证、分页读取、错误映射；当前仅Demo/Unconfigured | H01、H02、H04、H15 | 测试环境用真实FOP身份取得订单、收款和注册资源；403/503可辨别；超时和撤权不回退Mock或全量数据；维护真实上游到平台接口映射表 | FOP研发＋平台后端 |
| T03 | P0 · 待开发／核对 | 建立正式账号—租户用户—业务员工—部门映射、员工停用及调岗流程；已有账号绑定和管理接口 | H03、H04、H12 | 管理员、经理、业务员、仅管理无业务范围账号分别验收；映射可追溯；禁用／解除绑定／离职后的旧请求和会话不再取得业务数据 | IT／实施＋平台后端 |
| T04 | P0 · 待真实联调 | 将FOP资源授权接入全部业务模块；已有本地业务角色过滤及订单、收款独立allowlist | H02–H04、H12 | 搜客工作流、线索、沟通、报价、跟进移交、订单、注册、收款的读取／写入／搜索／汇总／下载分别有权限矩阵；可授权不一致的订单与收款样本通过；不把订单授权代替全部资源授权 | FOP研发＋平台后端＋测试 |
| T05 | P1 · 待开发 | 正式组织、员工、客户目录同步；当前组织是按管理员账号隔离的Mock设计空间 | H03、H04、H06 | 明确FOP主数据与前端自定义组织的维护边界；映射四个业务报表部门及下级团队；跨账号正式目录一致；不把Mock种子ID写入生产绑定 | FOP研发＋实施＋平台后端 |
| T06 | P1 · 待适配 | 完成履约、SKU、队列状态、仓库和服务商映射及订单全字段运行时校验；当前订单校验尚不如收款完整 | H05、H10、H11、H16 | 源状态→平台枚举字典和样本测试；审核通过的未知仓库／物流拒收并可定位；负数／非数字金额、非法数量、时间及重复订单有明确处理；单据多SKU不重复计单 | FOP研发＋平台后端＋仓储物流业务 |
| T07 | P0 · 待适配／对账 | 接入真实收款分录、稳定事实ID、源单关联、双审核和支付门槛；已有方案2聚合与独立收款接口 | H05–H09、H13、H16 | 不按源单号去重收款、不复制表头实收到每行；各渠道头行对账；履约／备货分别映射；原始数据到图表、客户、部门、业务员和分页总计可逐条追溯 | FOP研发＋平台后端＋财务 |
| T08 | P1 · 待人工定界 | 处理退款、部分退款、拒付、撤审／取消、备货类型变更与历史修正；当前是有效正向收款的实时重算 | H08、H09、H16 | 真实存在的流程均有处理规则和样本；若保留现口径，明确其不提供净退款业绩／关账的边界；若需冲销，先定义独立调整事实、关联键、符号、日期和授权，再扩展API及页面，不把负数塞入现有非负amount | 财务／业务负责人＋产品＋FOP研发 |
| T09 | P1 · 待适配 | 接入注册会员按日、部门、业务员事实；已有分维度聚合和权限过滤 | H04、H06、H14、H16 | 注册事件定义、去重与归属一致；员工级记录可过滤；每日／部门／个人合计可对账；不得用全公司每日总数伪造员工明细 | 客户业务负责人＋FOP研发＋平台后端 |
| T10 | P1 · 待设计／开发 | 图表与下钻的数据一致性、增量同步、授权刷新、新鲜度；当前每次查询独立聚合，asOf只是计算时间 | H02、H08、H15 | 明确快照一致或实时变化的产品约定；若引入snapshotId/sourceUpdatedAt/permissionVersion须正式更新契约；Top10/其他、仓库及分页可复现；即便使用历史快照也必须重新校验当前权限 | 平台后端＋FOP研发＋产品 |
| T11 | P1 · 待容量输入 | 生产聚合、权限集合与客户搜索性能；当前全量拉取后内存统计，客户日期跨度未设业务上限 | H01、H15 | 用真实量级与并发压测；确定查询跨度、分页／游标、索引和必要预聚合；分页截断不可被当全量结果；达到双方记录的响应与刷新指标后签收，不预设未经确认的SLA | 平台后端＋FOP研发＋测试／运维 |
| T12 | P1 · 待兼容核对 | 统一交叉参数校验及前端类型与OpenAPI必填字段；当前weekOf可跨year、部分无关参数可被忽略 | H15 | 按当前契约记录受影响调用，再决定兼容／版本升级；非法组合、边界日期、金额来源缺失都有明确响应；实际HTTP响应通过JSON Schema及跨字段长度／合计验证 | 平台前后端＋测试 |
| T13 | P1 · 待真实样本 | 真实FOP对账与用户验收；已有468项代码测试和Mock浏览器、HTTP验证基线 | H03、H16、H17 | 完成下方最小验收数据包；原始账本—统计—明细—合计一致；按权限分别复核同名客户、零补款、跨月、环比、纯备货和分仓；业务与财务保留验收记录 | 测试＋财务＋各岗位代表 |
| T14 | P1 · 待专项验证 | 真浏览器全图表交互、中文长名称、SKU图片、暗色／窄屏、键盘、导出验证 | H16、H17 | 本期指定浏览器与设备验收；测试SVG下载、图例、Tooltip、缩放、弹窗焦点和滚轮；图片鉴权／失效降级可用；不把stub图表单测当视觉验收 | 前端＋测试 |
| T15 | P1 · 待实施安排 | 测试到生产切换、备份恢复、配置和运维观测；已有本地构建及隔离启动验证 | H01、H03、H15、H17 | 确认发布版本、环境配置、首批账号与回滚步骤；检查迁移／附件备份、错误告警与同步延迟；生产故障不得退回Mock；上线后抽样复核真实数据 | IT／运维＋实施＋平台后端 |
| T16 | P2 · 待需求确认 | 可选扩展：多部门经理、报表部门扩展、财务关账、跨币种业绩、逐条会员名单、分析表导出、公共假日日历 | H04、H08、H13、H14、H17 | 仅对明确需要的项目另立需求、权限和接口版本；没有需求的标注暂不实施；不将这些可选项计入本期已交付功能 | 产品＋相关业务负责人 |
| T17 | P0 · 待真实接入 | 实现发运单实际成本只读接口与独立成本授权；已有本工程聚合/明细、Mock及权限边界 | H01、H18、H21、H22 | 以真实绑定用户和组织查询成本；freight scope及allowedFreightIds独立，不用订单量报表权限替代；明确字段可见性；无权403、空授权空、故障503，统计与明细同范围 | FOP研发＋平台后端＋IT |
| T18 | P0 · 待确认／适配 | 建立真实运费币种及USD汇率映射；已有原币、汇率日期/来源、折算一致性合同 | H19、H22 | 每种真实币种提供原额、取价规则和历史汇率；USD原币rate=1；缺币种/汇率、不一致和溢出拒收；原币分组和USD合计逐条对账 | 财务＋FOP研发＋平台后端 |
| T19 | P0 · 待业务定界 | 核实“已确认”与最终结算、首次同步后调价／补收／退款／重派的关系；当前仅表头快照 | H18、H20 | 若保留快照，业务明确接受范围及历史修订规则；若要求完整净结算，先建立独立费用/调整事实、稳定ID、关联、方向、时间、版本及授权后扩展契约；不可把未采集调整当0 | 财务＋物流负责人＋产品＋FOP研发 |
| T20 | P1 · 待真实验收 | 物流运费真实样本、跨期基线、权限、页面及性能验收；已有本工程图表/弹窗/工作台链路 | H16、H18–H22 | D11–D15对账；月YTD/历史12月、4周、5年与完整跨年上期；未完期提示；图表、原币、current/previous明细及分页合计一致；真实多账号、浏览器与业务量签收 | 测试＋财务＋物流＋平台前后端 |

### 需要人工核对、说明与提供资料的清单

请按 H 编号回填。资料已经存在时提供位置和版本即可；尚不存在时注明负责人及预计提供时间。无需在聊天或需求文档中填写密码、Token、私钥，认证材料通过公司认可的后端配置渠道交接。

| 编号 | 建议答复方 | 需要核对、阐述或提供的信息 | 当前基线与影响 | 关联待办 |
| --- | --- | --- | --- | --- |
| H01 | FOP研发／IT | 测试与生产域名、网关前缀、租户／数据中心标识、应用及发布版本；只读订单、收款、注册、目录、权限接口的URL、方法、操作码、请求／响应脱敏样本；认证／续期、分页上限、限流、超时、错误码及可访问网络条件；认证配置交接位置 | `/Library/VSCode/dtr5b`当前源码不是线上部署证明；平台19个API也不是金蝶原生地址；收款手续费维护写接口不能作为分析查询接口 | T01、T02、T11、T15 |
| H02 | FOP权限开发／IT | 实际如何以绑定用户执行或校验数据权限；业务对象权限／组织范围／字段权限；收款能否按分录授权；无权、无数据、禁用用户、错误返回如何区分；授权更新与缓存失效机制；提供至少两名权限不同用户的预期结果 | 当前服务端分别使用subject、订单ID集合、收款分录ID集合和analyticsScopes；本地再次做租户及业务范围交集；若生产只支持表头授权，需说明其如何安全转换为分录授权 | T02–T04、T10 |
| H03 | IT／人事／部门负责人 | 正式账号清单：前端登录邮箱、姓名、FOP tenantId/userId、员工稳定ID、部门稳定ID、在职状态、系统管理角色、五类工作台岗位、businessRole及其departmentId/employeeId；哪些人员首批验收；入职、停用、离职、转岗由谁维护 | 模拟员工不是前端登录账号；不使用姓名／邮箱充当FOP主键；系统管理员不自动具有业务管理员范围，Demo账号授权不能复制为全员模板 | T03–T05、T13、T15 |
| H04 | 业务／组织管理员／IT | 正式组织树及稳定ID、四业务部归口表、二三级子部门；部门经理含哪些下属团队；是否有人同时负责多个非上下级部门、兼岗或跨部门协作；前端组织自定义是独立业务组织还是要回写FOP；全部业务模块本地记录如何对应FOP员工／部门 | 当前一名经理仅配置一个departmentId及其后代；系统管理不等于查看所有数据；组织设计为账号内Mock空间；固定sales1–sales4报表不会随任意新增节点自动扩展 | T03–T05、T09、T16 |
| H05 | FOP研发／财务 | 收款表头ID、分录ID的真实返回字段和稳定性；源单号hzkj_src_order如何定位源实体及稳定documentId；各实体审核、已支付／已收、取消／退款状态的真实编码和组合；实际支付、收款回写、源单审核及收款审核的时间字段、时区和精度；正常、支付成功未审核、源单与收款审核不一致、多次付款的样本 | 已知履约与备货的hzkj_receipt_status枚举不同；源单已支付与收款已收必须同时成立；同一源单多次收款不能按源单去重；不能假设每个表头只有一行 | T06、T07 |
| H06 | 销售负责人／财务／FOP研发 | 明确绩效客户采用订货客户hzkj_customer还是付款客户hzkj_pay_customer；代付、母子客户、客户合并／改编码如何归属；业务员采用源单hzkj_operator、收款hzkj_bizperson还是客户当前hzkj_biz_user；部门采用哪个字段；是否按支付时历史归属或当前归属重算；跨部门／共同业绩如何分配 | 当前归一字段只有customerId、owner、department及salesDepartmentCode，不能同时表达多个归属规则。建议历史业绩归属稳定、查看权限按当前授权另算，但这只是待核对建议，未作为新的生产规则实施 | T01、T05、T07、T09 |
| H07 | 财务／支付开发 | 核对hzkj_real_receive_amt、hzkj_samount、hzkj_handle_fee、表头hzkj_rec_amount/hzkj_receive_amount/hzkj_total_payable的真实含义与样本等式；提供各实际支付渠道、人工收款、零手续费、不同手续费的头行对账；旧业绩报表与新报表差额解释 | 当前固定用分录实收，单列订单金额和手续费；旧插件用订单金额且包含样品。Demo的2%仅为样例，不能推广为生产费率；若财务要求改变考核基数须登记变更，不在适配层偷偷替换 | T01、T07、T13 |
| H08 | 财务／业务负责人 | 支付后次月才审核、历史补录／撤审、跨月多次付款时，历史报表是否允许回补；是否存在关账锁定；全款备货源单分次支付是否存在、何时满足“已支付”；0追加支付履约的已支付状态和paidAt如何提供；需要回溯多少年、是否有上年12月完整基线 | 时间归属已确认按UTC+8支付月份，不改为审核月；当前按有效状态重算，没有关账。若整单最后付清才满足资格，较早分录可能在之后回补原支付月，须用真实场景确认；零额订单不应伪造收款事件 | T07、T08、T10、T16 |
| H09 | 财务／售后／订单负责人 | 是否存在部分退款、全额退款、拒付、取消后退款、收款调整、备货退货／转押金／转全款、支付失败重试或冲正；分别提供原单／收款／退款或调整ID、关联关系、状态、金额、时间、币种、责任人；说明原支付月重算还是调整发生月冲减 | 当前排除已取消／已全退有效事实，未实现部分退款及负向调整流水。押金备货仍排除；钱包充值D、调整E、RMA F不能未经定义直接并入正向收款；存在相关流程时是上线口径待办，不能简单当不存在 | T07、T08、T13 |
| H10 | 仓库／订单负责人／FOP研发 | 杭州、深圳仓真实ID与编码；履约表头仓、商品行仓、备货收货仓如何对应；是否同单跨仓、分批出库、仓间调拨或存在其他仓；若有多仓，说明订单量分摊／归属及金额分摊规则并提供样本 | 已审核履约仓库非空是既定事实；问题是维度映射和多仓归属，不是要求人工补空仓。当前每个订单／收款只有HZ或SZ一个归属，不能向两仓各计全额／完整订单量 | T06、T07、T13 |
| H11 | 物流／订单负责人／FOP研发 | YT、4PX、WB、YW、JS及真实其他服务商ID映射；明确图表以审核时决策渠道的服务商还是实际发运服务商为准；改渠道、多包裹、多渠道、重发时如何计数；待审核、采购、配货、发运、出库及异常队列对应哪些FOP状态／操作 | 物流完整性已由FOP控制，但决策／实际发运字段不是同一事实。当前统计履约订单，不是发运单或包裹数；备货物流为不适用，不能映射OTHER；现有队列键不代表已核实所有FOP状态码 | T01、T06、T13 |
| H12 | 财务／IT／各模块负责人 | 钱包余额／授信消费、充值、还款、账期结算是否参与本指标，提供一次充值—消费／授信—还款链路；各岗位能否看实收、单据金额、手续费或仅订单数量；报价、客户资料、沟通、跟进、附件与导出各自的数据归属和授权来源 | 当前钱包业务结算可进入合格收款，充值不加第二次；不是银行新增现金流。现有receipts scope是资源级，不具备每个金额列独立遮蔽能力；若要求隐藏手续费等，需额外字段授权设计 | T03、T04、T07、T13 |
| H13 | 财务／FOP研发 | 实际存在的币种、是否全量USD；若需要非USD合并业绩，提供目标币种、汇率来源、取价日、费率、精度及差额归属；历史缺币种或缺分录实收如何核对补齐 | 当前仅USD计业绩；非USD明确排除、不隐式换汇；显示层缺省美元不能代替收款源币种。全为USD也请明确记录，以关闭该项而不建设不需要的换汇功能 | T07、T08、T16 |
| H14 | 客户业务负责人／FOP研发 | “注册会员”是账户、客户主体还是店铺；注册时间字段、去重ID、删除／合并／测试账户处理；日期时区；推荐／归属业务员与部门何时确定；是否有伙伴或无归属客户；提供日明细或日＋员工计数及期望总数 | 当前API支持按日／部门／员工汇总，非管理员须有可过滤的员工粒度；未提供逐条会员名单API。不能拿订单客户首次付款日期替代注册日期 | T09、T13、T16 |
| H15 | IT／运维／业务／FOP研发 | 历史年限、订单／收款／注册总量与日增量、SKU行数、账号和并发量、最大查询范围；同步或实时方式、容许延迟、目标响应时间；上游游标／更新时间／删除标记、限流；图表到下钻期间允许的变化及权限撤销时效 | 当前全量候选内存统计，asOf/updatedAt不是源更新时间；没有快照／授权版本合同，前端30秒超时也不是承诺SLA。用实际业务量决定优化，不能用Demo数据量作上线容量结论 | T02、T10–T12、T15 |
| H16 | FOP研发／财务／测试／各岗位代表 | 按下方“最小验收数据包”提供脱敏原始报文、完整筛选条件、预期纳入／排除原因、按客户／业务员／部门／仓库的数量与金额；覆盖不同权限账号和一条完整跨月备货链路 | 当前468项测试、19组HTTP契约检查均是本地实现／Mock证据，不能替代真实FOP对账；敏感信息可脱敏，但主键关联与金额等式要保留一致性 | T06–T09、T13、T14 |
| H17 | 产品／IT／业务负责人 | 本期模块范围、试点账号与验收人、浏览器／分辨率／设备、正式域名与部署责任、备份／恢复和切换安排；是否确需分析表导出、逐条会员名单、多部门经理、公共假日等可选能力；SKU图片的授权访问方式 | 目前只有部分图表SVG导出，不能称已提供所有分析表Excel/PDF导出；工作日历为三个代表城市的标准工作周、无节假日。本项决定上线验收范围，不自动授权新功能或生产发布 | T13–T16 |

#### 物流运费人工核对项（追加，保留原编号）

| 编号 | 建议答复方 | 需要核对、阐述或提供的信息 | 当前基线与影响 | 关联待办 |
| --- | --- | --- | --- | --- |
| H18 | 财务／物流／FOP研发 | 各服务商“实际运费”取数是首笔扣款、已计费、账单确认、最终结算还是银行实付；确认时间、源收费时间、财务账期的区别；燕文第一条记录与急速最新timeIn是否最终；提供源账单—发运单—付款的脱敏关联样本及最终状态定义 | 当前hzkj_actual_freight_time为写入确认时刻；本工程按该时刻UTC+8归期，不改称实付时间。源码不能证明最终结算；若新指标需最终结算，须明确新状态/时间字段 | T17、T19、T20 |
| H19 | 财务／汇率维护方／FOP研发 | YT/4PX/WB/YW/JS/其他的原币字段与真实币种；USD折算采用哪一日、哪个来源、汇率方向和精度；历史汇率覆盖及修正流程；缺币种、缺汇率、原额调价时如何处理；提供原额×汇率=USD的样例 | YT/4PX/WB/YW写原币金额，JS写CNY；Rmb变量名不证明币种。当前每条必须originalAmount/Currency及fxRateToUsd/Date/Source，USD本币rate=1；不隐式混加或用Mock汇率 | T18、T20 |
| H20 | 财务／物流／售后／FOP研发 | 首次正运费后是否补收、退款、燃油/偏远附加费、重派、人工调价；事件ID、原单关联、正负方向、原币、发生/确认日期、状态、版本；自动重查或人工维护流程；已结期是否回写或调整期冲销 | 费用单据体停用，重派/退费采集注释；常规候选仅空/0金额，首次正数后不自动修订。当前每发运单只保留一条快照，不能表达完整调整流水 | T19、T20 |
| H21 | 财务／FOP权限开发／IT | 哪些岗位/用户可见物流成本、原币、汇率与利润相关字段；正式单据/组织/字段权限如何以绑定用户校验；成本可见与订单可见不同的正反例；撤权/离职/调岗时效；独立allowlist的真实获取方式 | 当前需freight scope＋allowedFreightIds＋租户/本地业务范围交集；缺scope403，空IDs为空；单量报表“无业务员档案则组织全员”的规则不能继承为成本授权 | T17、T20 |
| H22 | 物流／仓库／FOP研发 | 六类服务商真实ID/编码映射、实际渠道与物流订单/跟踪号语义、杭州/深圳仓归属、客户/业务员/部门来源；一个订单多发运单、多包裹、重发、跨仓、改渠道的样本；已知其他与未知代码区分；真实只读查询URL、分页和更新字段 | 固定YT/4PX/WB/YW/JS/OTHER仅归一代码，不能直接当生产ID；成本按发运单，不按订单号去重。JS同步POST是写接口，不能充当分析查询 | T17、T18、T20 |

### 最小验收数据包

每组资料至少包括：环境／版本、脱敏FOP用户与授权范围、查询时间（UTC+8）、原始单据和收款分录稳定ID、源状态、归属字段、原币金额及手续费、预期统计结果。示例中的 $1,000／$60 是当前可复现Mock值，真实样本可以不同，但计算关系必须可追溯。

| 样本 | 必须覆盖的事实 | 预期核对点 |
| --- | --- | --- |
| D01 普通履约与多SKU | 已付＋双审核；同单多商品；至少两种真实付款方式／手续费情况（不存在则注明） | 订单只计1单；实收／订单金额／手续费不混用；头行对账 |
| D02 全款备货跨月使用 | 上月备货付款、本月使用该库存履约并另收运费／税费 | 备货在上月、补款在本月；例如1000＋60=1060；不还原产品款；数量只计履约 |
| D03 仅备货与零补款 | 有备货但无履约客户；另含无追加付款的履约（若存在） | 前者订单0但金额可见；后者订单计数和paidAt有真实依据，不伪造收款 |
| D04 资格与排除 | 押金备货、样品、未付、源单未审、收款未审、支付失败、未来日期 | 按既定口径逐条说明排除；源单／收款状态不互相推定 |
| D05 多笔／多行与跨期 | 一源单多次付款、一收款多分录、迟审核、上年12月及UTC+8月末边界 | 不按源单误去重、不重复表头金额；月份／环比基线及历史回补符合回填规则 |
| D06 客户与归属变化 | 同名客户、代付、客户或员工转部门、营销伙伴 | 主键不混淆；历史归属、当前访问权和业绩分配各自正确 |
| D07 仓库／物流 | 两仓、六类服务商、改渠道；多仓／多包裹若存在则追加 | 两仓与总计对账；备货无物流；订单数与包裹数不混用 |
| D08 退款／调整／币种 | H09、H13中实际存在的流程，含部分退款和授信链路 | 能解释当前报表边界；需新调整模型的不能以正向收款测试代替验收 |
| D09 授权与隔离 | 全业务管理员、仅管理无业务、经理、本人；跨租户、收款／订单权限不一致、停用／撤权 | 搜索候选、合计、明细、分页与全部业务模块均按当前授权；无权字段／资源不泄露 |
| D10 排名与注册 | 超过10个有履约客户、纯备货客户；按日／员工注册样本 | Top10＋其他全量不重不漏；下钻沿同一集合；部门合计等于成员，营销中心等于四部 |

真实环境无某类场景时，由对应负责人注明“不存在／暂不在本期”，说明依据；保留合成边界测试，不声称该类生产流程已验收。

#### 物流运费验收数据（追加）

| 样本 | 必须覆盖的事实 | 预期核对点 |
| --- | --- | --- |
| D11 成本资格与多次发运 | 同订单两张发运单、未审核、未确认、0成本、已确认缺时间、未来时间和重复ID；源账单状态说明 | 只统计有效正快照；两个发运单分别计费；异常拒收或资格排除与契约一致；不拿客户运费对账 |
| D12 原币与汇率 | 至少USD与一种真实非USD；不同汇率日期/来源；缺汇率、USD非1、折算不符、精度/溢出边界 | USD折算按分一致；原币分别合计；禁止把所有服务商当人民币；不能用Dashboard当前汇率替代历史汇率 |
| D13 周期与完整基期 | UTC+8月末/年末，跨年周，历史12月、当年未完月/周/年，2020首年及2019基期，0→0和0→正数 | 四周周一开始、近五年；partial可见；完整上一期、跨年基期、null/0比例正确；current/previous明细与图表合计一致 |
| D14 独立成本授权 | 订单可见但成本不可见、freight scope缺失、空运费IDs、两租户同类单据、部门后代/本人、管理员、在途撤权 | 缺scope403、空IDs合法空；不通过订单或本地管理员扩大范围；公开响应不含tenantId/departmentPathIds |
| D15 后续修订及页面 | 首次同步后真实补收/退款/重派/调价链路；六类服务商映射；趋势弹窗、工作台分页与原币字段，筛选在途变化 | 确认源账单能否完整覆盖；未覆盖流程记录边界，不能显示为已完成结算；表格倒序/列宽、环比展开、拖动滑块、错误/会话清理和分页前合计验收 |

### 回填格式与完成规则

可复制以下模板，每个H编号一份答复。涉及新字段时写明 **原始实体＋字段Key＋类型＋可空性＋枚举＋脱敏值**；涉及新业务规则时给出纳入、排除和跨月例子。

| 回填栏 | 填写内容 |
| --- | --- |
| 清单编号 | H__（可关联多个，但逐项写结论） |
| 答复人与日期 | 姓名／岗位／日期；跨业务口径注明财务与业务核对人 |
| 状态 | 待提供／已提供待核对／有差异待决策／已核对／不适用（注明原因） |
| 业务说明／结论 | 现行业务怎么发生；采用哪个字段或规则；明确与当前实现是否一致 |
| 资料与证据 | 文档／接口平台／源码／样本位置、环境和版本；不填写凭证本体 |
| 对照样本与预期 | 源单和分录关联、筛选范围、应纳入／排除、数量与金额等式 |
| 差异与处置 | 保持当前口径／需变更；影响哪些T编号、API字段和历史数据；尚未决策则保持待办 |
| 下一步与责任 | 负责岗位／人员、计划提供时间（未安排则填待安排）；验收结果链接 |

关闭待办应有对应产物或验证记录：人工资料已提供不等于适配代码已完成；接口可调用不等于权限／财务已对账；某项只在Mock通过不能标为生产已验收。后续变更同时更新本清单、OpenAPI、Mock和需求正文中受影响的部分。

### 建议推进顺序

1. **先收齐关键资料：**H01／H02接口与授权、H03账号映射、H05分录ID与状态、H06归属、H07金额字段、H08／H09跨期调整。固定方案2继续作为当前基线，存在差异的逐项登记。
2. **再做只读测试接入：**T02–T07在指定测试环境推进；以最小账号范围校验权限，再接入真实账本和主数据，随后补注册事实。不能用共享管理员身份绕过员工权限完成“演示式接入”。
3. **完成口径和规模验收：**T08–T14依据已回填规则验证退款边界、跨期、快照／实时一致性、性能、浏览器和各岗位数据范围；未决项注明影响本期上线还是可后置。
4. **按已批准范围实施发布：**T15完成试点和部署验收；T16仅对确需扩展的能力另行安排。本清单不预设上线日期，也不代表已执行生产发布。

## 8. OpenAPI 接口清单与请求/响应定义

本规范覆盖 **19 个操作、82 个数据模型**。以下清单由同目录 OpenAPI JSON 生成。Base URL 为 `/api`，表中路径不重复此前缀。响应为实际裸 JSON，不额外包装成 `{code,data}`。时间序列数值数组必须与对应时间轴等长：counts 对应 registrations、amounts 对应 months、values 及 warehouses 内数组对应 periods；items/series/options 等集合不适用。该跨字段规则需联调测试，单纯 schema 校验不能证明。

| 方法 | 路径 | operationId | 用途 |
| --- | --- | --- | --- |
| GET | `/autoflow/integrations/fop/data-access` | `getFopDataAccess` | 读取FOP绑定及访问状态 |
| GET | `/autoflow/integrations/fop/order-volume` | `getOrderVolume` | 读取订单量及客户USD金额图表 |
| GET | `/autoflow/integrations/fop/order-volume/orders` | `getOrderVolumeDetails` | 图表series/period钻取订单 |
| GET | `/autoflow/integrations/fop/order-volume/customers` | `searchOrderCustomers` | 搜索授权客户 |
| GET | `/autoflow/integrations/fop/fulfillment-orders` | `getFulfillmentOrders` | 读取履约队列订单 |
| GET | `/autoflow/integrations/fop/dashboard` | `getFopDashboard` | 读取FOP仪表盘 |
| GET | `/workbench/access` | `getWorkbenchAccess` | 读取当前工作台入口权限 |
| GET | `/workbench/{role}/access` | `getWorkbenchRoleAccess` | 校验指定入口权限 |
| GET | `/users/workbench-accounts` | `listWorkbenchAccounts` | 管理员分页列出账户权限 |
| PUT | `/users/{id}/workbench-roles` | `updateWorkbenchRoles` | 设置入口角色 |
| PUT | `/users/{id}/fop-binding` | `updateFopBinding` | 绑定或解绑FOP身份 |
| PUT | `/users/{id}/business-scope` | `updateBusinessScope` | 设置业务范围 |
| PUT | `/users/{id}/management-role` | `updateManagementRole` | 设置系统管理角色 |
| GET | `/organization` | `getOrganizationWorkspace` | 读取本地组织/员工上下文 |
| GET | `/autoflow/dashboard` | `getLocalAutoflowDashboard` | 读取本地AutoFlow业务概览 |
| GET | `/autoflow/integrations/fop/order-volume/receipts` | `getOrderVolumeReceipts` | 客户同一数量排名集合下钻收款分录 |
| GET | `/autoflow/integrations/fop/receipts` | `getReceipts` | 读取获授权实收分录及完整筛选合计 |
| GET | `/autoflow/integrations/fop/freight` | `getFreight` | 物流实际运费聚合及完整上期环比 |
| GET | `/autoflow/integrations/fop/freight/details` | `getFreightDetails` | 岗位工作台物流运费发运单明细 |


### 8.1 公共鉴权与响应说明


字段级源码快照，仅记录已实现HTTP路由，不将计划FOP上游写为paths。响应裸JSON，无{code,data,message}包装。required=序列化必有；type:null=显式空值；可省略字段不在required中。参数跨字段依赖及已知口径差距见操作描述和配套审计。示例为脱敏契约样例，不是生产数据。 FOP为金蝶云苍穹上的HyperZone自研应用，源码只读核实；本工程方案2收款聚合和Mock已实现，真实生产网络适配器仍未配置。订单与收款各自授权，回款采用实际结算分录，统一UTC+8。 物流运费使用独立freight scope及allowedFreightIds，已实现Mock成本快照；必须保留原币与明确USD折算，按确认时间归期。最终结算、补收退款、调价及真实成本查询/授权仍待核对。

- `BearerAuth`：Authorization: Bearer <JWT>；角色每次查当前数据库。；type=http，in=Authorization，name=bearer。

- `SessionCookie`：浏览器使用HttpOnly会话cookie；和Bearer是OR，提取器优先cookie，过期cookie可能覆盖有效Bearer导致401。；type=apiKey，in=cookie，name=autoflow_session。


### 8.2 读取FOP绑定及访问状态

`GET /api/autoflow/integrations/fop/data-access` · operationId: `getFopDataAccess`


无query；空DTO拒绝额外字段。允许businessRole=none并返回denied。FOP失败通常转为200状态对象，不抛503；ready允许空订单授权。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/autoflow/integrations/fop/data-access
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


无查询/路径参数。


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: DataAccess |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |


200 响应示例（application/json）：

```json
{
  "binding": {
    "tenantId": "demo:example",
    "userId": "example"
  },
  "businessScope": {
    "role": "salesperson",
    "departmentId": null,
    "employeeId": "employee-example"
  },
  "status": "ready",
  "source": "mock",
  "mode": "demo"
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/fop-data/fop-data.service.ts`。


### 8.3 读取订单量及客户USD金额图表

`GET /api/autoflow/integrations/fop/order-volume` · operationId: `getOrderVolume`


至少一个工作台角色；绑定、租户、独立订单／收款 allowlist 与 businessScope 求交。时间模式二选一：grain+year，day 另需 month；或 category=customer 且 from/to 同时提供，禁止 grain/year/month/weekOf。日期为 2020-01-01 至 UTC+8 今天含首尾。订单数仅 paid、reviewStatus=approved、有效 paidAt<=asOf、未取消的履约订单；非 carrier 要求报表部门。备货不计订单数。未来日 null，已发生空期 0。客户有 receipts scope 时 amounts 来自独立授权的有效收款分录，无 scope 省略 amounts。Top10 按履约数量，只有备货回款的客户仍进入总计／other 和搜索。筛选参数不能扩大权限。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/autoflow/integrations/fop/order-volume?category=organization&grain=month&year=2026&warehouse=ALL
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


交叉参数规则：

```json
[
  "customerId仅customer",
  "objectId仅carrier/salesperson",
  "from/to与grain/year/month/weekOf互斥",
  "timeline需要grain/year且day需要month",
  "weekOf当前不要求与year同年",
  "warehouse默认ALL"
]
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `category` | query | string | 是 | carrier物流、organization组织、salesperson业务员、customer客户。 | enum=["carrier", "organization", "salesperson", "customer"] |
| `grain` | query | string | 否 | month年内月份；week近4个完整周一至周日；day整月逐日。 | enum=["month", "week", "day"] |
| `year` | query | integer | 否 | 2020至UTC+8 当前年；week也要求year但由weekOf决定实际分桶。 | minimum=2020; maximum=9999 |
| `from` | query | string (date) | 否 | 仅客户区间；和to同时存在。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `to` | query | string (date) | 否 | 仅客户区间，不晚于UTC+8 今天；当前无最大跨度限制。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `month` | query | integer | 否 | grain=day必填；其他grain忽略。 | minimum=1; maximum=12 |
| `weekOf` | query | string (date) | 否 | week锚点，默认UTC+8 今天；2020至今天，不强制与year同年。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `department` | query | SalesDepartment | 否 | 报表部门过滤代码sales1..sales4，非权限departmentId。 | enum=["sales1", "sales2", "sales3", "sales4"] |
| `objectId` | query | string | 否 | 仅carrier/salesperson，物流代码或owner.id；未知ID返回空。 | minLength=1; maxLength=200 |
| `customerId` | query | string | 否 | 仅customer；未知/越权ID返回空。 | minLength=1; maxLength=200 |
| `warehouse` | query | string | 否 | ALL全仓，HZ杭州，SZ深圳；UNASSIGNED仅兼容查询，已审核履约／有效收款不得未知仓；默认ALL。 | enum=["ALL", "HZ", "SZ", "UNASSIGNED"]; default="ALL" |


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: OrderVolume |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |
| 503 | 503：FOP provider未配置或调用异常；不会降级mock。 | application/json: FopError |


200 响应示例（application/json）：

```json
{
  "source": "mock",
  "query": {
    "category": "customer",
    "from": "2026-10-21",
    "to": "2026-10-21",
    "warehouse": "ALL"
  },
  "timeZone": "UTC+8",
  "asOf": "2026-10-22T08:00:00.000Z",
  "total": 1,
  "customerCount": 1,
  "periods": [
    {
      "id": "2026-10-21",
      "label": "2026-10-21",
      "from": "2026-10-21",
      "to": "2026-10-21",
      "future": false
    }
  ],
  "series": [
    {
      "id": "total",
      "label": "订单合计",
      "kind": "total",
      "total": 1,
      "values": [
        1
      ],
      "warehouses": {
        "HZ": [
          1
        ],
        "SZ": [
          0
        ],
        "UNASSIGNED": [
          0
        ]
      },
      "amounts": {
        "currency": "USD",
        "total": 125.5,
        "values": [
          125.5
        ],
        "warehouses": {
          "HZ": [
            125.5
          ],
          "SZ": [
            0
          ],
          "UNASSIGNED": [
            0
          ]
        },
        "excludedOrderCount": 0,
        "breakdown": {
          "fulfillment": 125.5,
          "fullPaymentStock": 0
        }
      }
    },
    {
      "id": "customer:customer-example",
      "label": "示例客户",
      "kind": "detail",
      "total": 1,
      "values": [
        1
      ],
      "warehouses": {
        "HZ": [
          1
        ],
        "SZ": [
          0
        ],
        "UNASSIGNED": [
          0
        ]
      },
      "amounts": {
        "currency": "USD",
        "total": 125.5,
        "values": [
          125.5
        ],
        "warehouses": {
          "HZ": [
            125.5
          ],
          "SZ": [
            0
          ],
          "UNASSIGNED": [
            0
          ]
        },
        "excludedOrderCount": 0,
        "breakdown": {
          "fulfillment": 125.5,
          "fullPaymentStock": 0
        }
      },
      "entityId": "customer-example",
      "code": "C001"
    }
  ],
  "options": {
    "departments": [
      {
        "id": "sales1",
        "label": "业务一部"
      }
    ],
    "objects": [
      {
        "id": "employee-example",
        "label": "示例业务员"
      }
    ]
  }
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/fop-data/fop-data.service.ts`, `backend/src/modules/fop-data/order-volume.dto.ts`, `backend/src/modules/fop-data/order-volume.ts`。


### 8.4 图表series/period钻取订单

`GET /api/autoflow/integrations/fop/order-volume/orders` · operationId: `getOrderVolumeDetails`


至少一个工作台角色；绑定、租户、独立订单／收款 allowlist 与 businessScope 求交。时间模式二选一：grain+year，day 另需 month；或 category=customer 且 from/to 同时提供，禁止 grain/year/month/weekOf。日期为 2020-01-01 至 UTC+8 今天含首尾。订单数仅 paid、reviewStatus=approved、有效 paidAt<=asOf、未取消的履约订单；非 carrier 要求报表部门。备货不计订单数。未来日 null，已发生空期 0。客户有 receipts scope 时 amounts 来自独立授权的有效收款分录，无 scope 省略 amounts。Top10 按履约数量，只有备货回款的客户仍进入总计／other 和搜索。筛选参数不能扩大权限。 额外要求 workbenchRole；先完整范围重建 TopN/other，再收窄 period/detailWarehouse，查询仓和明细仓取交集。按 paidAt 倒序/id 排序，totals 在分页前计算；此端点返回履约订单金额，不是实收明细。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/autoflow/integrations/fop/order-volume/orders?category=customer&from=2026-01-01&to=2026-10-22&warehouse=ALL&workbenchRole=sales&seriesId=total&page=1&pageSize=20
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `category` | query | string | 是 | carrier物流、organization组织、salesperson业务员、customer客户。 | enum=["carrier", "organization", "salesperson", "customer"] |
| `grain` | query | string | 否 | month年内月份；week近4个完整周一至周日；day整月逐日。 | enum=["month", "week", "day"] |
| `year` | query | integer | 否 | 2020至UTC+8 当前年；week也要求year但由weekOf决定实际分桶。 | minimum=2020; maximum=9999 |
| `from` | query | string (date) | 否 | 仅客户区间；和to同时存在。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `to` | query | string (date) | 否 | 仅客户区间，不晚于UTC+8 今天；当前无最大跨度限制。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `month` | query | integer | 否 | grain=day必填；其他grain忽略。 | minimum=1; maximum=12 |
| `weekOf` | query | string (date) | 否 | week锚点，默认UTC+8 今天；2020至今天，不强制与year同年。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `department` | query | SalesDepartment | 否 | 报表部门过滤代码sales1..sales4，非权限departmentId。 | enum=["sales1", "sales2", "sales3", "sales4"] |
| `objectId` | query | string | 否 | 仅carrier/salesperson，物流代码或owner.id；未知ID返回空。 | minLength=1; maxLength=200 |
| `customerId` | query | string | 否 | 仅customer；未知/越权ID返回空。 | minLength=1; maxLength=200 |
| `warehouse` | query | string | 否 | ALL全仓，HZ杭州，SZ深圳；UNASSIGNED仅兼容查询，已审核履约／有效收款不得未知仓；默认ALL。 | enum=["ALL", "HZ", "SZ", "UNASSIGNED"]; default="ALL" |
| `workbenchRole` | query | WorkbenchRole | 是 | 工作台入口权限；与业务范围、系统管理权限独立。 | enum=["sales", "procurement", "allocation", "dispatch", "warehouse"] |
| `detailWarehouse` | query | VolumeWarehouse | 否 | HZ 杭州、SZ 深圳；UNASSIGNED 仅兼容查询/数组键，已审核履约不得缺失或未知仓库。 | enum=["HZ", "SZ", "UNASSIGNED"] |
| `seriesId` | query | string | 否 | 回传series.id；省略total；未知ID返回200空集。 | minLength=1; maxLength=220 |
| `periodId` | query | string | 否 | 回传periods.id；不属于当前查询400；省略全部期间。 | pattern="^\\d{4}-\\d{2}(?:-\\d{2})?$" |
| `page` | query | integer | 否 | — | default=1; minimum=1; maximum=1000000 |
| `pageSize` | query | integer | 否 | — | default=20; minimum=1; maximum=100 |


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: OrderPage |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |
| 503 | 503：FOP provider未配置或调用异常；不会降级mock。 | application/json: FopError |


200 响应示例（application/json）：

```json
{
  "source": "mock",
  "items": [],
  "total": 0,
  "totals": {
    "orderCount": 0,
    "itemQuantity": 0,
    "amountsByCurrency": []
  },
  "page": 1,
  "pageSize": 20
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/fop-data/fop-data.service.ts`, `backend/src/modules/fop-data/order-volume.dto.ts`, `backend/src/modules/fop-data/order-volume.ts`, `backend/src/modules/fop-data/fop-order-totals.ts`。


### 8.5 搜索授权客户

`GET /api/autoflow/integrations/fop/order-volume/customers` · operationId: `searchOrderCustomers`


至少一个工作台角色。授权已审核、未取消未退款、有报表部门及 customerId 的订单（可含未支付），与独立授权的有效收款客户共同构建目录；没有收款 scope 时只用订单。只有全款备货收款的客户可搜索。编码精确命中优先，随后编码/ID 排序。无日期／仓库参数，未知字段 400。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/autoflow/integrations/fop/order-volume/customers?keyword=C001&page=1&pageSize=10
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `keyword` | query | string | 是 | trim后非空，编码/名称忽略大小写包含匹配。 | minLength=1; maxLength=100 |
| `department` | query | SalesDepartment | 否 | 固定报表部门：业务一部至四部；不是组织节点ID。 | enum=["sales1", "sales2", "sales3", "sales4"] |
| `page` | query | integer | 否 | — | default=1; minimum=1; maximum=1000000 |
| `pageSize` | query | integer | 否 | — | default=10; minimum=1; maximum=50 |


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: OrderCustomerPage |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |
| 503 | 503：FOP provider未配置或调用异常；不会降级mock。 | application/json: FopError |


200 响应示例（application/json）：

```json
{
  "source": "mock",
  "items": [
    {
      "id": "customer-example",
      "code": "C001",
      "name": "示例客户",
      "departments": [
        "业务一部"
      ]
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 10
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/fop-data/fop-data.service.ts`, `backend/src/modules/fop-data/order-volume.dto.ts`, `backend/src/modules/fop-data/order-volume.ts`。


### 8.6 读取履约队列订单

`GET /api/autoflow/integrations/fop/fulfillment-orders` · operationId: `getFulfillmentOrders`


queue角色：review/exceptions=sales，procurement=procurement，allocation=allocation，dispatch=dispatch，shipping=warehouse。均排除取消/退款；review=reviewStatus pending；procurement=approved+paid+procurement pending；allocation=approved+paid+allocation pending；dispatch=paid+allocated+dispatch pending；shipping=paid+dispatched+shipping pending；exceptions=paid+未shipped+exception非null。按createdAt倒序/id排序，totals全筛选集。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/autoflow/integrations/fop/fulfillment-orders?queue=allocation&workbenchRole=allocation&page=1&pageSize=20
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `queue` | query | string | 是 | — | enum=["review", "exceptions", "procurement", "allocation", "dispatch", "shipping"] |
| `workbenchRole` | query | WorkbenchRole | 否 | 可选，提供时必须匹配queue所需角色，否则400。 | enum=["sales", "procurement", "allocation", "dispatch", "warehouse"] |
| `search` | query | string | 否 | trim/忽略大小写，匹配orderNumber/shopifyOrderNumber/customerName/storeName/items.sku。 | maxLength=200 |
| `orderNumber` | query | string | 否 | FOP业务订单号精确匹配，不trim。 | maxLength=100 |
| `page` | query | integer | 否 | — | default=1; minimum=1; maximum=1000000 |
| `pageSize` | query | integer | 否 | — | default=20; minimum=1; maximum=100 |


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: OrderPage |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |
| 503 | 503：FOP provider未配置或调用异常；不会降级mock。 | application/json: FopError |


200 响应示例（application/json）：

```json
{
  "source": "mock",
  "items": [],
  "total": 0,
  "totals": {
    "orderCount": 0,
    "itemQuantity": 0,
    "amountsByCurrency": []
  },
  "page": 1,
  "pageSize": 20
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/fop-data/fop-data.service.ts`, `backend/src/modules/users/dto/workbench.dto.ts`, `backend/src/modules/fop-data/fop-order-totals.ts`。


### 8.7 读取FOP仪表盘

`GET /api/autoflow/integrations/fop/dashboard` · operationId: `getFopDashboard`


from<=to，end-start<=365 天（含首尾最多 366 天），to<=UTC+8 今天，year<=UTC+8 当前年。from/to 仅注册，year 仅回款；队列／异常／任务不受日期筛选。rates/registrations/receipts 分别需 analyticsScopes；无 scope 返回空。注册明细按业务范围过滤，缺失时仅业务 admin 可读旧日汇总。回款以独立授权的 hzkj_real_receive_amt 分录为准：USD、paid、源单与收款单均 approved、未取消且支付已发生，来源履约＋全款备货，不含押金／样品，按 UTC+8 支付月归属。包含来源拆分和上年12月基线；非银行现金流保证。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/autoflow/integrations/fop/dashboard?from=2026-10-16&to=2026-10-22&year=2026
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `from` | query | string (date) | 是 | 公历日期YYYY-MM-DD。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `to` | query | string (date) | 是 | 公历日期YYYY-MM-DD。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `year` | query | integer | 是 | — | minimum=2020; maximum=9999 |


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: FopDashboard |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |
| 503 | 503：FOP provider未配置或调用异常；不会降级mock。 | application/json: FopError |


200 响应示例（application/json）：

```json
{
  "businessScope": {
    "role": "admin",
    "departmentId": null,
    "employeeId": null
  },
  "source": "mock",
  "updatedAt": "2026-10-22T08:00:00.000Z",
  "queues": {
    "review": 0,
    "allocation": 0,
    "dispatch": 0,
    "shipping": 0
  },
  "rates": [],
  "registrations": [],
  "registrationDepartments": [],
  "tasks": [],
  "exceptions": [],
  "receipts": {
    "currency": "USD",
    "months": [],
    "marketingCenter": null,
    "departments": [],
    "basis": "actual_received",
    "timeZone": "UTC+8"
  }
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/fop-data/fop-data.service.ts`, `backend/src/modules/fop-data/fop-data.dto.ts`, `backend/src/modules/fop-data/fop-registration.ts`, `backend/src/modules/fop-data/fop-receipts.ts`, `backend/src/modules/fop-data/fop-business-time.ts`。


### 8.8 读取当前工作台入口权限

`GET /api/workbench/access` · operationId: `getWorkbenchAccess`


允许businessRole=none；当前数据库重新读取授权，不信任JWT角色。无Query DTO，额外query当前忽略。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/workbench/access
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


无查询/路径参数。


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: WorkbenchAccess |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |


200 响应示例（application/json）：

```json
{
  "roles": [
    "sales"
  ],
  "isAdmin": false,
  "businessRole": "salesperson"
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/users/workbench-access.service.ts`。


### 8.9 校验指定入口权限

`GET /api/workbench/{role}/access` · operationId: `getWorkbenchRoleAccess`


未知role400，已知但未授权403。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/workbench/sales/access
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `role` | path | WorkbenchRole | 是 | 工作台入口权限；与业务范围、系统管理权限独立。 | enum=["sales", "procurement", "allocation", "dispatch", "warehouse"] |


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: WorkbenchAccess |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |


200 响应示例（application/json）：

```json
{
  "roles": [
    "sales"
  ],
  "isAdmin": false,
  "businessRole": "salesperson"
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/users/workbench-access.service.ts`。


### 8.10 管理员分页列出账户权限

`GET /api/users/workbench-accounts` · operationId: `listWorkbenchAccounts`


仅系统role=admin；businessRole=none也可管理。按displayId/id排序；响应仅items/total。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/users/workbench-accounts?page=1&pageSize=20
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `page` | query | integer | 否 | — | default=1; minimum=1; maximum=1000000 |
| `pageSize` | query | integer | 否 | — | default=20; minimum=1; maximum=100 |
| `search` | query | string | 否 | trim，username/email/displayId忽略大小写包含匹配；SQL通配符转义。 | maxLength=200 |


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: WorkbenchAccountPage |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |


200 响应示例（application/json）：

```json
{
  "items": [],
  "total": 0
}
```


实现证据：`backend/src/modules/users/users.controller.ts`, `backend/src/modules/users/users.service.ts`, `backend/src/modules/users/workbench-access.service.ts`。


### 8.11 设置入口角色

`PUT /api/users/{id}/workbench-roles` · operationId: `updateWorkbenchRoles`


仅系统管理员。替换全数组，[]撤销入口；不修改FOP绑定/业务范围。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
PUT /api/users/00000000-0000-4000-8000-000000000001/workbench-roles
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `id` | path | string (uuid) | 是 | 本地UUID。 | — |


请求体：`application/json`；必需：True；模型：`UpdateWorkbenchRoles`。


```json
{
  "workbenchRoles": [
    "sales",
    "allocation"
  ]
}
```


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: WorkbenchAccount |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 404 | 404：目标本地用户不存在。 | application/json: HttpError |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |


实现证据：`backend/src/modules/users/users.controller.ts`, `backend/src/modules/users/users.service.ts`, `backend/src/modules/users/workbench-access.service.ts`。


### 8.12 绑定或解绑FOP身份

`PUT /api/users/{id}/fop-binding` · operationId: `updateFopBinding`


仅系统管理员。两字段同时非空或同时null；同一FOP身份只能绑定一个账户，冲突409。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
PUT /api/users/00000000-0000-4000-8000-000000000001/fop-binding
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `id` | path | string (uuid) | 是 | 本地UUID。 | — |


请求体：`application/json`；必需：True；模型：`UpdateFopBinding`。


```json
{
  "tenantId": "tenant-example",
  "userId": "employee-example"
}
```


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: WorkbenchAccount |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 404 | 404：目标本地用户不存在。 | application/json: HttpError |
| 409 | 409：FOP身份重复绑定或尝试撤销自身系统管理权限。 | application/json: HttpError |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |


实现证据：`backend/src/modules/users/users.controller.ts`, `backend/src/modules/users/users.service.ts`, `backend/src/modules/users/workbench-access.service.ts`。


### 8.13 设置业务范围

`PUT /api/users/{id}/business-scope` · operationId: `updateBusinessScope`


仅系统管理员。经理要求departmentId，销售要求employeeId；未分配字段显式null。当前不验证ID属于真实FOP目录。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
PUT /api/users/00000000-0000-4000-8000-000000000001/business-scope
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `id` | path | string (uuid) | 是 | 本地UUID。 | — |


请求体：`application/json`；必需：True；模型：`UpdateBusinessScope`。


```json
{
  "role": "department_manager",
  "departmentId": "department-example",
  "employeeId": null
}
```


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: WorkbenchAccount |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 404 | 404：目标本地用户不存在。 | application/json: HttpError |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |


实现证据：`backend/src/modules/users/users.controller.ts`, `backend/src/modules/users/users.service.ts`, `backend/src/modules/users/workbench-access.service.ts`。


### 8.14 设置系统管理角色

`PUT /api/users/{id}/management-role` · operationId: `updateManagementRole`


仅系统管理员。不改变业务范围；不能撤销自己管理权限，409；事务内重新校验操作者。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
PUT /api/users/00000000-0000-4000-8000-000000000001/management-role
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `id` | path | string (uuid) | 是 | 本地UUID。 | — |


请求体：`application/json`；必需：True；模型：`UpdateManagementRole`。


```json
{
  "role": "admin"
}
```


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: WorkbenchAccount |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 404 | 404：目标本地用户不存在。 | application/json: HttpError |
| 409 | 409：FOP身份重复绑定或尝试撤销自身系统管理权限。 | application/json: HttpError |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |


实现证据：`backend/src/modules/users/users.controller.ts`, `backend/src/modules/users/users.service.ts`, `backend/src/modules/users/workbench-access.service.ts`。


### 8.15 读取本地组织/员工上下文

`GET /api/organization` · operationId: `getOrganizationWorkspace`


仅系统管理员。每个本地账户独立mock组织，非FOP目录；首次GET可在事务内初始化种子，有本地写副作用。空Query DTO拒绝额外字段。组织写接口不在本规范。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/organization
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


无查询/路径参数。


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: OrganizationWorkspace |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |


200 响应示例（application/json）：

```json
{
  "source": "mock",
  "nodes": [],
  "employees": [],
  "canEdit": true
}
```


实现证据：`backend/src/modules/organization/organization.controller.ts`, `backend/src/modules/organization/organization.service.ts`, `backend/src/modules/organization/organization.types.ts`。


### 8.16 读取本地AutoFlow业务概览

`GET /api/autoflow/dashboard` · operationId: `getLocalAutoflowDashboard`


需要sales入口与当前业务范围，readBusinessOwners限定同租户/部门或本人。无查询DTO，额外query当前忽略。无FOP source/updatedAt；funnel.value固定0不表示真实金额。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/autoflow/dashboard
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


无查询/路径参数。


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: LocalDashboard |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |


200 响应示例（application/json）：

```json
{
  "metrics": {
    "activeWorkflows": 0,
    "newLeads": 0,
    "readyOutreach": 0,
    "replies": 0,
    "opportunities": 0
  },
  "funnel": [
    {
      "key": "new",
      "label": "New",
      "count": 0,
      "value": 0
    },
    {
      "key": "qualified",
      "label": "Qualified",
      "count": 0,
      "value": 0
    },
    {
      "key": "contacted",
      "label": "Contacted",
      "count": 0,
      "value": 0
    },
    {
      "key": "replied",
      "label": "Replied",
      "count": 0,
      "value": 0
    },
    {
      "key": "opportunity",
      "label": "Opportunity",
      "count": 0,
      "value": 0
    },
    {
      "key": "won",
      "label": "Won",
      "count": 0,
      "value": 0
    },
    {
      "key": "lost",
      "label": "Lost",
      "count": 0,
      "value": 0
    },
    {
      "key": "invalid",
      "label": "Invalid",
      "count": 0,
      "value": 0
    }
  ],
  "recentWorkflows": [],
  "topLeads": [],
  "nextTasks": []
}
```


实现证据：`backend/src/modules/autoflow/autoflow.controller.ts`, `backend/src/modules/autoflow/autoflow.service.ts`, `backend/src/modules/autoflow/autoflow.types.ts`, `backend/src/modules/users/business-data-access.ts`。


### 8.17 客户同一数量排名集合下钻收款分录

`GET /api/autoflow/integrations/fop/order-volume/receipts` · operationId: `getOrderVolumeReceipts`


仅 category=customer；沿用客户统计时间、部门、仓库及完整查询范围数量 Top10/other 客户集合，再应用 periodId/detailWarehouse。需要 workbenchRole、receipts scope 与独立 allowedReceiptIds；没有 scope 返回403，缺失/空白名单为空。订单 allowlist 不能替代收款授权。只返回有效 USD 履约／全款备货分录；不含押金、样品。状态、UTC+8 日期及来源口径同 Dashboard。total/totals 分页前计算，按 paidAt 倒序/id 稳定排序；客户端不能传身份/权限字段。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/autoflow/integrations/fop/order-volume/receipts?category=customer&from=2026-09-01&to=2026-10-22&warehouse=ALL&workbenchRole=sales&seriesId=total&page=1&pageSize=20
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `category` | query | "customer" | 是 | — | — |
| `grain` | query | string | 否 | month年内月份；week近4个完整周一至周日；day整月逐日。 | enum=["month", "week", "day"] |
| `year` | query | integer | 否 | 2020至UTC+8 当前年；week也要求year但由weekOf决定实际分桶。 | minimum=2020; maximum=9999 |
| `from` | query | string (date) | 否 | 仅客户区间；和to同时存在。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `to` | query | string (date) | 否 | 仅客户区间，不晚于UTC+8 今天；当前无最大跨度限制。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `month` | query | integer | 否 | grain=day必填；其他grain忽略。 | minimum=1; maximum=12 |
| `weekOf` | query | string (date) | 否 | week锚点，默认UTC+8 今天；2020至今天，不强制与year同年。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `department` | query | SalesDepartment | 否 | 报表部门过滤代码sales1..sales4，非权限departmentId。 | enum=["sales1", "sales2", "sales3", "sales4"] |
| `objectId` | query | string | 否 | 仅carrier/salesperson，物流代码或owner.id；未知ID返回空。 | minLength=1; maxLength=200 |
| `customerId` | query | string | 否 | 仅customer；未知/越权ID返回空。 | minLength=1; maxLength=200 |
| `warehouse` | query | string | 否 | ALL全仓，HZ杭州，SZ深圳；UNASSIGNED仅兼容查询，已审核履约／有效收款不得未知仓；默认ALL。 | enum=["ALL", "HZ", "SZ", "UNASSIGNED"]; default="ALL" |
| `workbenchRole` | query | WorkbenchRole | 是 | 工作台入口权限；与业务范围、系统管理权限独立。 | enum=["sales", "procurement", "allocation", "dispatch", "warehouse"] |
| `detailWarehouse` | query | VolumeWarehouse | 否 | HZ 杭州、SZ 深圳；UNASSIGNED 仅兼容查询/数组键，已审核履约不得缺失或未知仓库。 | enum=["HZ", "SZ", "UNASSIGNED"] |
| `seriesId` | query | string | 否 | 回传series.id；省略total；未知ID返回200空集。 | minLength=1; maxLength=220 |
| `periodId` | query | string | 否 | 回传periods.id；不属于当前查询400；省略全部期间。 | pattern="^\\d{4}-\\d{2}(?:-\\d{2})?$" |
| `page` | query | integer | 否 | — | default=1; minimum=1; maximum=1000000 |
| `pageSize` | query | integer | 否 | — | default=20; minimum=1; maximum=100 |


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: ReceiptPage |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |
| 503 | 503：FOP provider未配置或调用异常；不会降级mock。 | application/json: FopError |


200 响应示例（application/json）：

```json
{
  "source": "mock",
  "timeZone": "UTC+8",
  "total": 0,
  "page": 1,
  "pageSize": 20,
  "totals": {
    "receiptCount": 0,
    "currency": "USD",
    "amount": 0,
    "fulfillmentAmount": 0,
    "fullPaymentStockAmount": 0,
    "orderAmount": 0,
    "handlingFee": 0
  },
  "items": []
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/fop-data/fop-data.service.ts`, `backend/src/modules/fop-data/order-volume.dto.ts`, `backend/src/modules/fop-data/order-volume.ts`, `backend/src/modules/fop-data/fop-receipts.ts`。


### 8.18 读取获授权实收分录及完整筛选合计

`GET /api/autoflow/integrations/fop/receipts` · operationId: `getReceipts`


Dashboard回款下钻。from/to 必填且严格有效，2020-01-01<=from<=to<=UTC+8 今天，含首尾；当前无最大跨度。department/ownerId/customerId/warehouse/sourceType 仅收窄范围。需拥有 workbenchRole、receipts scope 及独立 allowedReceiptIds；无 scope 403，缺失/空 allowlist 合法空结果。按绑定租户与部门/员工业务范围过滤，读取前后复核本地授权变化。有效分录要求 USD、paid、源单及收款单均 approved、未取消、已发生 paidAt，来源仅履约或全款备货。实收不是银行现金保证，源单金额与手续费单独返回。畸形授权分录/重复ID为503，禁止由订单金额合成。total/totals 分页前计算，paidAt倒序/id稳定排序；未知身份/权限参数400。


实现状态：implemented


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/autoflow/integrations/fop/receipts?from=2026-09-01&to=2026-10-22&warehouse=ALL&workbenchRole=sales&page=1&pageSize=20
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `from` | query | string (date) | 是 | — | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `to` | query | string (date) | 是 | — | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `department` | query | SalesDepartment | 否 | 固定报表部门：业务一部至四部；不是组织节点ID。 | enum=["sales1", "sales2", "sales3", "sales4"] |
| `ownerId` | query | string | 否 | — | minLength=1; maxLength=200 |
| `customerId` | query | string | 否 | — | minLength=1; maxLength=200 |
| `warehouse` | query | string | 否 | — | enum=["ALL", "HZ", "SZ"]; default="ALL" |
| `sourceType` | query | string | 否 | — | enum=["fulfillment", "full_payment_stock"] |
| `workbenchRole` | query | WorkbenchRole | 是 | 工作台入口权限；与业务范围、系统管理权限独立。 | enum=["sales", "procurement", "allocation", "dispatch", "warehouse"] |
| `page` | query | integer | 否 | — | default=1; minimum=1; maximum=1000000 |
| `pageSize` | query | integer | 否 | — | default=20; minimum=1; maximum=100 |


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON响应。 | application/json: ReceiptPage |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |
| 503 | 503：FOP provider未配置或调用异常；不会降级mock。 | application/json: FopError |


200 响应示例（application/json）：

```json
{
  "source": "mock",
  "timeZone": "UTC+8",
  "total": 0,
  "page": 1,
  "pageSize": 20,
  "totals": {
    "receiptCount": 0,
    "currency": "USD",
    "amount": 0,
    "fulfillmentAmount": 0,
    "fullPaymentStockAmount": 0,
    "orderAmount": 0,
    "handlingFee": 0
  },
  "items": []
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/fop-data/fop-data.service.ts`, `backend/src/modules/fop-data/fop-receipts.dto.ts`, `backend/src/modules/fop-data/fop-receipts.ts`, `backend/src/modules/fop-data/fop-business-time.ts`。


### 8.19 物流实际运费聚合及完整上期环比

`GET /api/autoflow/integrations/fop/freight` · operationId: `getFreight`


独立成本权限：必须有freight analytics scope，否则403；allowedFreightIds缺失/空数组返回空范围，不能从订单或收款授权推导。服务端与租户、本地本人/部门及下属/业务管理员范围求交，系统管理员也不能绕过。每次请求复查绑定和授权变化；客户端不得传tenantId、userId、授权白名单或scope。只纳入已审核、已确认、正数且确认时刻已发生的发运单快照。原币、明确汇率日期/来源及折算一致性必需，目标USD；确认时间按UTC+8，不是银行付款或最终结算证明。真实FOP网络适配器未完成，Mock为独立成本样本。 返回合计与固定六类服务商并列系列；carrierCode过滤时仅合计与该商。单服务商趋势在居中弹窗展示；原始发运单在工作台下钻。


实现状态：implemented; server-side mock available; real FOP network adapter pending


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/autoflow/integrations/fop/freight?grain=year&year=2026&warehouse=ALL&carrierCode=YT
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


交叉参数规则：

```json
[
  "grain/year必填；year∈[2020,UTC+8当前年]；warehouse默认ALL。",
  "仅grain=week允许weekOf，必须有效、属于year且不晚于今天；省略时当年today、历史年12-31。",
  "month返回年初至当前月/历史12月；week周一开始连续4周；year最近5年且显示最早2020。",
  "上一期完整自然周期与本期采用相同权限及服务商/仓库过滤，包含跨年基期；partial标识未完成周期。",
  "每个series.values与periods等长同下标；总计不与服务商再次相加；百分比为百分点，零基期规则见FreightValue。"
]
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `grain` | query | FreightGrain | 是 | 见引用模型 | enum=["month", "week", "year"] |
| `year` | query | integer | 是 | 2020至UTC+8当前年；未来年拒绝。周锚点必须属于所选年。 | minimum=2020; maximum=9999 |
| `weekOf` | query | string (date) | 否 | 仅week可传；不传时当年默认UTC+8今天、历史年默认12月31日。必须属于year且不晚于今天；响应回显解析后的锚点。非week传入则400。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `warehouse` | query | string | 否 | ALL=全仓，HZ=杭州仓，SZ=深圳仓；服务端授权范围内过滤，不扩大权限。 | enum=["ALL", "HZ", "SZ"]; default="ALL" |
| `carrierCode` | query | FreightCarrier | 否 | 省略返回合计及固定六类服务商；指定时返回合计及该服务商。 | enum=["YT", "4PX", "WB", "YW", "JS", "OTHER"] |


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON；空授权为零聚合/空明细，不是403。 | application/json: FreightData |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |
| 503 | 503：FOP provider未配置或调用异常；不会降级mock。 | application/json: FopError |


200 响应示例（application/json）：

```json
{
  "source": "mock",
  "query": {
    "grain": "year",
    "year": 2026,
    "warehouse": "ALL",
    "carrierCode": "YT"
  },
  "timeZone": "UTC+8",
  "currency": "USD",
  "dateBasis": "freight_confirmed_at",
  "asOf": "2026-10-22T04:00:00Z",
  "periods": [
    {
      "id": "2022",
      "label": "2022年",
      "from": "2022-01-01",
      "to": "2022-12-31",
      "partial": false,
      "previousFrom": "2021-01-01",
      "previousTo": "2021-12-31"
    },
    {
      "id": "2023",
      "label": "2023年",
      "from": "2023-01-01",
      "to": "2023-12-31",
      "partial": false,
      "previousFrom": "2022-01-01",
      "previousTo": "2022-12-31"
    },
    {
      "id": "2024",
      "label": "2024年",
      "from": "2024-01-01",
      "to": "2024-12-31",
      "partial": false,
      "previousFrom": "2023-01-01",
      "previousTo": "2023-12-31"
    },
    {
      "id": "2025",
      "label": "2025年",
      "from": "2025-01-01",
      "to": "2025-12-31",
      "partial": false,
      "previousFrom": "2024-01-01",
      "previousTo": "2024-12-31"
    },
    {
      "id": "2026",
      "label": "2026年",
      "from": "2026-01-01",
      "to": "2026-10-22",
      "partial": true,
      "previousFrom": "2025-01-01",
      "previousTo": "2025-12-31"
    }
  ],
  "series": [
    {
      "id": "total",
      "label": "合计",
      "kind": "total",
      "totals": {
        "amount": 24,
        "previousAmount": 10,
        "delta": 14,
        "percent": 140
      },
      "values": [
        {
          "amount": 0,
          "previousAmount": 0,
          "delta": 0,
          "percent": 0
        },
        {
          "amount": 0,
          "previousAmount": 0,
          "delta": 0,
          "percent": 0
        },
        {
          "amount": 0,
          "previousAmount": 0,
          "delta": 0,
          "percent": 0
        },
        {
          "amount": 10,
          "previousAmount": 0,
          "delta": 10,
          "percent": null
        },
        {
          "amount": 14,
          "previousAmount": 10,
          "delta": 4,
          "percent": 40
        }
      ],
      "billCount": 2
    },
    {
      "id": "carrier:YT",
      "label": "云途YT",
      "kind": "detail",
      "carrierCode": "YT",
      "totals": {
        "amount": 24,
        "previousAmount": 10,
        "delta": 14,
        "percent": 140
      },
      "values": [
        {
          "amount": 0,
          "previousAmount": 0,
          "delta": 0,
          "percent": 0
        },
        {
          "amount": 0,
          "previousAmount": 0,
          "delta": 0,
          "percent": 0
        },
        {
          "amount": 0,
          "previousAmount": 0,
          "delta": 0,
          "percent": 0
        },
        {
          "amount": 10,
          "previousAmount": 0,
          "delta": 10,
          "percent": null
        },
        {
          "amount": 14,
          "previousAmount": 10,
          "delta": 4,
          "percent": 40
        }
      ],
      "billCount": 2
    }
  ],
  "totals": {
    "amount": 24,
    "previousAmount": 10,
    "delta": 14,
    "percent": 140
  },
  "billCount": 2
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/fop-data/fop-data.service.ts`, `backend/src/modules/fop-data/fop-freight.dto.ts`, `backend/src/modules/fop-data/fop-freight.ts`, `backend/src/modules/fop-data/fop-freight.types.ts`。


### 8.20 岗位工作台物流运费发运单明细

`GET /api/autoflow/integrations/fop/freight/details` · operationId: `getFreightDetails`


独立成本权限：必须有freight analytics scope，否则403；allowedFreightIds缺失/空数组返回空范围，不能从订单或收款授权推导。服务端与租户、本地本人/部门及下属/业务管理员范围求交，系统管理员也不能绕过。每次请求复查绑定和授权变化；客户端不得传tenantId、userId、授权白名单或scope。只纳入已审核、已确认、正数且确认时刻已发生的发运单快照。原币、明确汇率日期/来源及折算一致性必需，目标USD；确认时间按UTC+8，不是银行付款或最终结算证明。真实FOP网络适配器未完成，Mock为独立成本样本。 明细必须通过workbenchRole入口权限；periodId仅能是该查询返回的一期，comparisonPeriod默认current，previous选择完整上期。省略periodId时选择全部显示周期对应范围；确认时间倒序、ID稳定排序。total/totals在分页前计算，越界页仍保留完整合计；原币逐币种合计。


实现状态：implemented; server-side mock available; real FOP network adapter pending


鉴权：`[{"BearerAuth": []}, {"SessionCookie": []}]`。


请求示例（日期和主体为脱敏样例，联调时替换）：

```http
GET /api/autoflow/integrations/fop/freight/details?grain=month&year=2026&warehouse=ALL&carrierCode=YT&periodId=2026-10&comparisonPeriod=current&workbenchRole=sales&page=1&pageSize=20
Authorization: Bearer <有效会话JWT>
Accept: application/json
```


交叉参数规则：

```json
[
  "grain/year必填；year∈[2020,UTC+8当前年]；warehouse默认ALL。",
  "仅grain=week允许weekOf，必须有效、属于year且不晚于今天；省略时当年today、历史年12-31。",
  "month返回年初至当前月/历史12月；week周一开始连续4周；year最近5年且显示最早2020。",
  "上一期完整自然周期与本期采用相同权限及服务商/仓库过滤，包含跨年基期；partial标识未完成周期。",
  "每个series.values与periods等长同下标；总计不与服务商再次相加；百分比为百分点，零基期规则见FreightValue。",
  "periodId必须属于此query返回的periods；page默认1，pageSize默认20且最大100；workbenchRole必填且需持有。"
]
```


| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |
| --- | --- | --- | --- | --- | --- |
| `grain` | query | FreightGrain | 是 | 见引用模型 | enum=["month", "week", "year"] |
| `year` | query | integer | 是 | 2020至UTC+8当前年；未来年拒绝。周锚点必须属于所选年。 | minimum=2020; maximum=9999 |
| `weekOf` | query | string (date) | 否 | 仅week可传；不传时当年默认UTC+8今天、历史年默认12月31日。必须属于year且不晚于今天；响应回显解析后的锚点。非week传入则400。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `warehouse` | query | string | 否 | ALL=全仓，HZ=杭州仓，SZ=深圳仓；服务端授权范围内过滤，不扩大权限。 | enum=["ALL", "HZ", "SZ"]; default="ALL" |
| `carrierCode` | query | FreightCarrier | 否 | 省略返回合计及固定六类服务商；指定时返回合计及该服务商。 | enum=["YT", "4PX", "WB", "YW", "JS", "OTHER"] |
| `periodId` | query | string | 否 | 仅选择当前查询返回的一期；省略覆盖所有显示期；不能使用任意日期扩大范围。 | pattern="^\\d{4}(?:-\\d{2}(?:-\\d{2})?)?$" |
| `comparisonPeriod` | query | string | 否 | current为本期（默认）；previous为对应完整上一期；省略periodId时选择全部显示期对应的上期并集，重复日期不重复计费。 | enum=["current", "previous"]; default="current" |
| `workbenchRole` | query | WorkbenchRole | 是 | 必须是当前账户可访问岗位，单据明细在工作台展示。 | enum=["sales", "procurement", "allocation", "dispatch", "warehouse"] |
| `page` | query | integer | 否 | 页码。 | default=1; minimum=1; maximum=1000000 |
| `pageSize` | query | integer | 否 | 每页条数。 | default=20; minimum=1; maximum=100 |


| 状态码 | 说明 | Content-Type / 响应模型 |
| --- | --- | --- |
| 200 | 成功，裸JSON；空授权为零聚合/空明细，不是403。 | application/json: FreightPage |
| 400 | 400：DTO失败、未知DTO字段、日期或跨参数条件错误。 | application/json: HttpError |
| 401 | 401：缺失/过期/无效JWT或账户不存在。 | application/json: HttpError |
| 403 | 403：入口/系统管理权限不足、业务禁用、绑定/范围缺失、FOP拒绝或请求期间授权变更。 | application/json: ErrorResponse |
| 429 | 429：AppModule全局默认每60秒120次；实际计数受部署IP/代理策略影响。 | application/json: HttpError |
| 500 | 500：未捕获服务/数据库异常。 | application/json: HttpError |
| 503 | 503：FOP provider未配置或调用异常；不会降级mock。 | application/json: FopError |


200 响应示例（application/json）：

```json
{
  "source": "mock",
  "timeZone": "UTC+8",
  "currency": "USD",
  "dateBasis": "freight_confirmed_at",
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "items": [
    {
      "id": "delivery-example",
      "documentNumber": "DEL-001",
      "orderNumber": "ORDER-001",
      "trackingNumber": "LOG-001",
      "carrierCode": "YT",
      "carrierName": "云途",
      "channelName": "示例实际渠道",
      "warehouseCode": "HZ",
      "warehouse": "杭州仓",
      "customerId": "customer-example",
      "customerCode": "C001",
      "customerName": "示例客户",
      "organization": {
        "id": "org-example",
        "name": "示例组织"
      },
      "department": {
        "id": "department-example",
        "name": "业务一部"
      },
      "owner": {
        "id": "employee-example",
        "name": "示例业务员"
      },
      "salesDepartmentCode": "sales1",
      "originalAmount": 100,
      "originalCurrency": "CNY",
      "fxRateToUsd": 0.14,
      "fxRateDate": "2026-10-22",
      "fxRateSource": "mock-contract-example",
      "amount": 14,
      "currency": "USD",
      "confirmedAt": "2026-10-21T16:30:00Z",
      "reviewStatus": "approved",
      "costStatus": "confirmed"
    }
  ],
  "totals": {
    "billCount": 1,
    "amount": 14,
    "originalAmounts": [
      {
        "currency": "CNY",
        "amount": 100
      }
    ]
  },
  "range": {
    "from": "2026-10-01",
    "to": "2026-10-22"
  }
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/fop-data/fop-data.service.ts`, `backend/src/modules/fop-data/fop-freight.dto.ts`, `backend/src/modules/fop-data/fop-freight.ts`, `backend/src/modules/fop-data/fop-freight.types.ts`。


## 9. 字段级数据字典

模型引用按名称交叉查阅。例如 `OrderVolumeData.series[] → VolumeSeries.amounts → VolumeAmounts`；每一层字段均在下表列出。必填是相对于当前父对象；父对象本身可选时不强制创建。可空只以类型中的 `null` 或 `anyOf/oneOf` null 分支为准。示例不是生产值。内部 FOP 提供器模型若标注为内部，则不能从浏览器直接传入。


### DataSource


mock=本地演示；fop标签本身不证明真实上游已接通。

类型：`string`；约束：enum=["mock", "fop"]。


### WorkbenchRole


工作台入口权限；与业务范围、系统管理权限独立。

类型：`string`；约束：enum=["sales", "procurement", "allocation", "dispatch", "warehouse"]。


### BusinessRole




类型：`string`；约束：enum=["none", "admin", "department_manager", "salesperson"]。


### SalesDepartment


固定报表部门：业务一部至四部；不是组织节点ID。

类型：`string`；约束：enum=["sales1", "sales2", "sales3", "sales4"]。


### VolumeWarehouse


HZ 杭州、SZ 深圳；UNASSIGNED 仅兼容查询/数组键，已审核履约不得缺失或未知仓库。

类型：`string`；约束：enum=["HZ", "SZ", "UNASSIGNED"]。


### CarrierCode


固定顺序 YT/4PX/WB/YW/JS/OTHER；OTHER 仅用于可信适配器明确映射的其他服务商，未知或缺失代码拒收。

类型：`string`；约束：enum=["YT", "4PX", "WB", "YW", "JS", "OTHER"]。


### Money


币种主单位（USD为美元），不是分。汇总按moneyToCents四舍五入至分求和后除100；当前部分路径没有非负/安全整数校验。

类型：`number`；约束：example=125.5。


```json
125.5
```


### NamedEntity





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 上游实体稳定标识，不依赖展示名称，不保证UUID。 | — |
| `name` | string | 是 | 实体当前展示名称。 | — |


### FopBinding





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `tenantId` | string | 是 | 服务端维护FOP租户ID。 | minLength=1; maxLength=128 |
| `userId` | string | 是 | 服务端维护FOP用户ID。 | minLength=1; maxLength=128 |


### BusinessScope





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `role` | BusinessRole | 是 | 业务数据授权类型；none禁用，admin为授权租户内全业务，经理按部门，销售按员工。 | — |
| `departmentId` | string anyOf null | 是 | 授权部门ID；经理可匹配departmentPathIds下级。 | — |
| `employeeId` | string anyOf null | 是 | 授权员工ID；销售按owner.id匹配。 | — |


### WorkbenchAccess





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `roles` | WorkbenchRole[] | 是 | businessRole=none时[]，admin时全部角色。 | uniqueItems=true |
| `isAdmin` | boolean | 是 | 系统管理权限，与业务admin不同。 | — |
| `businessRole` | BusinessRole | 是 | 当前数据库读取的业务角色，与isAdmin的系统管理权限相互独立。 | — |


### DataAccess


binding/status必有；unbound省略businessScope；仅ready输出source/mode。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `binding` | FopBinding anyOf null | 是 | 账户当前FOP身份；没有绑定时为null；演示模式可返回临时demo身份。 | — |
| `status` | string | 是 | unbound无身份；not_configured没有provider；ready已完成权限解析；unavailable上游失败；denied业务禁用/权限拒绝。 | enum=["unbound", "not_configured", "ready", "unavailable", "denied"] |
| `businessScope` | BusinessScope | 否 | 当前业务范围；unbound返回分支省略此字段。 | — |
| `source` | DataSource | 否 | 仅ready返回，mock为演示provider，fop为真实provider来源标记。 | — |
| `mode` | string | 否 | 仅ready返回；source=mock对应demo，否则live。 | enum=["demo", "live"] |


### FopOrderItem





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `productId` | string | 否 | 缺失/空值时省略。 | — |
| `sku` | string | 是 | SKU编码；参与履约search模糊检索。 | — |
| `name` | string | 是 | 商品展示名称。 | — |
| `imageUrl` | string anyOf null | 是 | 图片URL或data URI；无图null。 | — |
| `variant` | string | 是 | 商品规格/变体描述。 | — |
| `quantity` | number | 是 | 商品件数；当前未运行时验证整数/非负。 | — |


### OrderException





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `reason` | string | 是 | 异常原因：stock库存、address地址、tracking物流跟踪号。 | enum=["stock", "address", "tracking"] |
| `hours` | number | 是 | 异常持续小时。 | — |


### FopOrder


publicOrder白名单输出，不含tenantId、departmentPathIds或任意provider元数据。上游金额/时间等尚无完整运行时schema验证。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `salesDepartmentCode` | SalesDepartment | 否 | 可信适配器归一化后的报表部门；非物流维度统计及收款按此字段归属。 | — |
| `id` | string | 是 | FOP订单ID；授权白名单与去重键。 | — |
| `orderNumber` | string | 是 | FOP业务订单号。 | — |
| `shopifyOrderNumber` | string | 是 | 来源Shopify订单展示号，例如#10401；参与模糊检索。 | — |
| `customerId` | string | 否 | 稳定客户ID；客户去重、客户搜索、筛选与customer:<id> series使用。 | — |
| `customerCode` | string | 否 | 业务侧客户编码，客户搜索可按此字段匹配；缺失时序列化省略。 | — |
| `warehouseCode` | string | 否 | 已审核履约必须 HZ/SZ；缺失或未知代码拒收。 | — |
| `carrierCode` | string | 否 | 已审核履约必须已映射 YT/4PX/WB/YW/JS/OTHER；缺失或未知代码拒收。 | — |
| `customerName` | string | 是 | 客户展示名称，参与履约模糊检索。 | — |
| `storeName` | string | 是 | 所属店铺展示名称，参与履约模糊检索。 | — |
| `items` | FopOrderItem[] | 是 | 订单商品行；商品数量汇总来自全部items.quantity。 | — |
| `organization` | NamedEntity | 否 | 订单所属组织ID与名称；上游未提供时省略。 | — |
| `department` | NamedEntity | 否 | 订单所属实际部门ID与名称；用于经理直接部门范围匹配。 | — |
| `owner` | NamedEntity | 否 | 订单归属业务员工ID与名称；owner.id用于员工权限和业务员分组。 | — |
| `amount` | Money | 是 | 订单总金额，单位为currency主单位；当前不是独立实收金额。 | — |
| `currency` | string | 是 | trim+uppercase，空值默认USD；不会换汇。 | — |
| `paymentStatus` | string | 是 | paid已支付、unpaid未支付、refunded已退款；统计要求paid，review队列可含unpaid。 | enum=["paid", "unpaid", "refunded"] |
| `reviewStatus` | string | 是 | pending待审核，approved已审核。 | enum=["pending", "approved"] |
| `procurementStatus` | string | 是 | pending待采购，purchased已采购，not_required无需采购。 | enum=["pending", "purchased", "not_required"] |
| `allocationStatus` | string | 是 | pending待配货，allocated已配货，not_ready尚未进入配货环节。 | enum=["pending", "allocated", "not_ready"] |
| `dispatchStatus` | string | 是 | pending待调度，dispatched已调度，not_ready尚未进入调度环节。 | enum=["pending", "dispatched", "not_ready"] |
| `shippingStatus` | string | 是 | pending待发货，shipped已发货，not_ready尚未进入发货环节。 | enum=["pending", "shipped", "not_ready"] |
| `warehouse` | string | 是 | 展示名，不用于归仓。 | — |
| `carrier` | string anyOf null | 是 | 物流服务商展示名；无服务商为null，不用于统计归类。 | — |
| `trackingNumber` | string anyOf null | 是 | 物流跟踪号；尚未生成时null。 | — |
| `salesperson` | string | 是 | 展示名，权限使用owner.id。 | — |
| `createdAt` | string (date-time) | 是 | 订单创建时间，履约列表按此时间降序，时刻相同按id排序。 | — |
| `paidAt` | string (date-time) anyOf null | 是 | 带明确时区的订单支付时刻，转换 UTC+8 归桶；缺失不回退 createdAt。 | — |
| `cancelled` | boolean | 是 | true表示订单取消，从订单量/收款/履约队列排除。 | — |
| `exception` | OrderException anyOf null | 是 | 订单异常详情；无异常明确为null。 | — |

组合规则 `allOf`：`见 schema`。完整约束见 OpenAPI JSON。


```json
{
  "id": "order-example",
  "orderNumber": "AF-EXAMPLE-001",
  "shopifyOrderNumber": "#10401",
  "salesDepartmentCode": "sales1",
  "customerId": "customer-example",
  "customerCode": "C001",
  "warehouseCode": "HZ",
  "carrierCode": "YT",
  "customerName": "示例客户",
  "storeName": "示例店铺",
  "organization": {
    "id": "organization-example",
    "name": "营销中心"
  },
  "department": {
    "id": "department-example",
    "name": "业务一部"
  },
  "owner": {
    "id": "employee-example",
    "name": "示例业务员"
  },
  "items": [
    {
      "productId": "product-example",
      "sku": "SKU-001",
      "name": "示例商品",
      "imageUrl": null,
      "variant": "蓝色",
      "quantity": 2
    }
  ],
  "amount": 125.5,
  "currency": "USD",
  "paymentStatus": "paid",
  "reviewStatus": "approved",
  "procurementStatus": "purchased",
  "allocationStatus": "allocated",
  "dispatchStatus": "dispatched",
  "shippingStatus": "shipped",
  "warehouse": "杭州仓",
  "carrier": "云途YT",
  "trackingNumber": "EXAMPLE-TRACKING",
  "salesperson": "示例业务员",
  "createdAt": "2026-10-21T01:00:00Z",
  "paidAt": "2026-10-21T01:15:00Z",
  "cancelled": false,
  "exception": null
}
```


### CurrencyAmount





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `currency` | string | 是 | USD排首位，其他币种字典序。 | — |
| `amount` | Money | 是 | 完整筛选集该币种订单amount的分币精度汇总，单位仍为币种主单位。 | — |


### OrderTotals


分页前授权筛选全集汇总；total=totals.orderCount，不是当前页小计。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `orderCount` | integer | 是 | 授权且匹配全部筛选条件的订单数量，与分页外total相等。 | minimum=0 |
| `itemQuantity` | number | 是 | 完整筛选订单items.quantity之和。 | — |
| `amountsByCurrency` | CurrencyAmount[] | 是 | 原币种分别汇总、不换汇；空集[]。 | — |


### OrderPage


越界页200且items=[]；total/totals保留完整筛选集。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `source` | DataSource | 是 | 本次返回数据的provider来源。 | — |
| `items` | FopOrder[] | 是 | 当前页订单；非授权订单在分页前已剔除，越界页为空。 | — |
| `total` | integer | 是 | 授权筛选后的总订单数，与当前页items长度无关。 | minimum=0 |
| `totals` | OrderTotals | 是 | 分页前完整筛选集订单数、商品件数及分币种金额合计。 | — |
| `page` | integer | 是 | 本次页码，从1开始。 | minimum=1; maximum=1000000 |
| `pageSize` | integer | 是 | 本次每页大小，最多100。 | minimum=1; maximum=100 |


### OrderVolumeQuery


响应回显DTO转换后的查询。请求warehouse可省略，默认ALL。时间轴grain/year与客户from/to二选一，业务条件见操作描述。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `category` | string | 是 | carrier物流、organization组织、salesperson业务员、customer客户。 | enum=["carrier", "organization", "salesperson", "customer"] |
| `grain` | string | 否 | month年内月份；week近4个完整周一至周日；day整月逐日。 | enum=["month", "week", "day"] |
| `year` | integer | 否 | 2020至UTC+8 当前年；week也要求year但由weekOf决定实际分桶。 | minimum=2020; maximum=9999 |
| `from` | string (date) | 否 | 仅客户区间；和to同时存在。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `to` | string (date) | 否 | 仅客户区间，不晚于UTC+8 今天；当前无最大跨度限制。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `month` | integer | 否 | grain=day必填；其他grain忽略。 | minimum=1; maximum=12 |
| `weekOf` | string (date) | 否 | week锚点，默认UTC+8 今天；2020至今天，不强制与year同年。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `department` | SalesDepartment | 否 | 报表部门过滤代码sales1..sales4，非权限departmentId。 | — |
| `objectId` | string | 否 | 仅carrier/salesperson，物流代码或owner.id；未知ID返回空。 | minLength=1; maxLength=200 |
| `customerId` | string | 否 | 仅customer；未知/越权ID返回空。 | minLength=1; maxLength=200 |
| `warehouse` | string | 是 | ALL全仓，HZ杭州，SZ深圳；UNASSIGNED仅兼容查询，已审核履约／有效收款不得未知仓；默认ALL。 | enum=["ALL", "HZ", "SZ", "UNASSIGNED"]; default="ALL" |

组合规则 `oneOf`：`见 schema`, `见 schema`。完整约束见 OpenAPI JSON。

组合规则 `allOf`：`见 schema`, `见 schema`, `见 schema`。完整约束见 OpenAPI JSON。


### VolumePeriod





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 月YYYY-MM；周一或日期YYYY-MM-DD。 | pattern="^\\d{4}-\\d{2}(?:-\\d{2})?$" |
| `label` | string | 是 | 图表横轴显示文本；月为n月，周为MM-DD—MM-DD，日为日期文本。 | — |
| `from` | string (date) | 是 | 含首日，UTC+8 日历。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `to` | string (date) | 是 | 含末日，UTC+8 日历。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `future` | boolean | 是 | 首日晚于UTC+8 今天。 | — |


### CountValues


与periods等长同序；null=未来日期，0=已到日期无单。

类型：`integer / null[]`；约束：—。


### AmountValues


与periods等长同序；USD主单位；null=未来。

类型：`number / null[]`；约束：—。


### CountWarehouses


三仓键始终存在，每期之和等于series.values。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `HZ` | CountValues | 是 | 当前series杭州仓每期订单量，数组下标与periods一致。 | — |
| `SZ` | CountValues | 是 | 当前series深圳仓每期订单量，数组下标与periods一致。 | — |
| `UNASSIGNED` | CountValues | 是 | 兼容数组键；已审核履约仓库必须 HZ/SZ，正常为0，未来为null。 | — |


### AmountWarehouses





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `HZ` | AmountValues | 是 | HZ 仓每期有效 USD 实收，periods 下标对齐，未来为 null。 | — |
| `SZ` | AmountValues | 是 | SZ 仓每期有效 USD 实收，periods 下标对齐，未来为 null。 | — |
| `UNASSIGNED` | AmountValues | 是 | 兼容数组键；有效收款仓库必须 HZ/SZ，正常为0，未来为null。 | — |


### VolumeAmounts


仅 customer 且有 receipts scope 时返回；独立收款分录按与数量相同客户集合、日期及仓库过滤，不由订单金额合成，不隐式换汇。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `currency` | "USD" | 是 | 固定 USD；非 USD 收款分录计入兼容字段 excludedOrderCount。 | — |
| `total` | Money | 是 | 本系列完整查询范围内有效 USD 收款实收合计。 | — |
| `values` | AmountValues | 是 | 按periods逐期汇总的USD金额，主单位美元，未来期null。 | — |
| `warehouses` | AmountWarehouses | 是 | 同一series同一期的USD金额按HZ/SZ/UNASSIGNED拆分。 | — |
| `excludedOrderCount` | integer | 是 | 保留旧字段名；现表示因非 USD 排除的收款分录数，不是订单数。 | minimum=0 |
| `breakdown` | ReceiptBreakdown | 是 | 见引用模型/接口说明 | — |


### VolumeSeries





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | total、other、carrier:<code>、department:<code>、employee:<id>、customer:<id>。 | — |
| `label` | string | 是 | 图例和tooltip显示的系列名称，可为合计、部门、员工、客户或物流名称。 | — |
| `kind` | string | 是 | total合计，detail对象明细，other未进入TopN对象合并，unassigned缺失业务员归属。 | enum=["total", "detail", "other", "unassigned"] |
| `entityId` | string | 否 | 对象ID；合计/其他/缺失归属可省略。 | — |
| `code` | string | 否 | 客户编码，其他维度通常省略。 | — |
| `total` | integer | 是 | 当前系列整个时间范围订单总量；总计系列不可再与明细系列相加。 | minimum=0 |
| `values` | CountValues | 是 | 与periods数组一一对应的订单数量，未来日为null，其余空期0。 | — |
| `warehouses` | CountWarehouses | 是 | 当前系列订单量按三仓拆分，三个数组均与periods对齐。 | — |
| `amounts` | VolumeAmounts | 否 | 客户有效 USD 实收及履约／全款备货来源拆分；无 receipts scope 或非客户维度省略。 | — |


### Option





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 可传回筛选参数的稳定值；部门为sales1..4，物流为固定代码，员工为owner.id。 | — |
| `label` | string | 是 | 下拉筛选选项显示文本。 | — |


### VolumeOptions





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `departments` | Option[] | 是 | 授权有效订单涉及报表部门，不按日期/仓库限缩。 | — |
| `objects` | Option[] | 是 | carrier固定6物流；其他维度为部门内授权业务员，按名称排序。 | — |


### OrderVolume


业务员 Top5、客户 Top10 按已支付已审核履约数量排序；客户 Top10 仅 count>0，只有备货收款的客户归 other（显式 customerId 时正常显示该客户）。金额来自同客户集合的独立收款。物流固定顺序。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `source` | DataSource | 是 | provider数据来源mock或fop。 | — |
| `query` | OrderVolumeQuery | 是 | 实际经DTO转换并补默认warehouse后的查询回显；未传可选字段省略。 | — |
| `timeZone` | "UTC+8" | 是 | 统一业务日/月界线 UTC+8（固定 +08:00）。 | — |
| `asOf` | string (date-time) | 是 | 聚合时刻，不是源数据刷新时刻或共享快照。 | — |
| `total` | integer | 是 | 完整授权筛选集已支付且已审核履约订单数；备货不计数。 | minimum=0 |
| `customerCount` | integer | 是 | 筛选范围内非空客户 ID 去重；customer 类别包含有效收款客户，可含订单数为0的全款备货客户。 | minimum=0 |
| `periods` | VolumePeriod[] | 是 | 图表时间桶；所有series.values和warehouse数组共享同一下标。 | — |
| `series` | VolumeSeries[] | 是 | 总计及各对象系列；排序/TopN以完整查询范围订单数确定。 | — |
| `options` | VolumeOptions | 是 | 根据授权有效订单生成的可选部门和对象，不表示额外授权。 | — |

组合规则 `allOf`：`见 schema`。完整约束见 OpenAPI JSON。


### OrderCustomer





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 稳定客户ID，用于customerId过滤。 | — |
| `code` | string | 是 | 缺失为空串。 | — |
| `name` | string | 是 | 客户展示名称，同一ID按首次出现订单填充。 | — |
| `departments` | string[] | 是 | 报表部门中文名称，非ID。 | — |


### OrderCustomerPage


无totals；按授权未取消未退款订单构建客户集，包含未支付，不受图表日期/仓库筛选。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `source` | DataSource | 是 | provider数据来源。 | — |
| `items` | OrderCustomer[] | 是 | 当前页授权客户搜索结果。 | — |
| `total` | integer | 是 | keyword和department筛选后的客户总数。 | minimum=0 |
| `page` | integer | 是 | 当前页码，从1开始。 | minimum=1; maximum=1000000 |
| `pageSize` | integer | 是 | 当前每页客户数，最多50。 | minimum=1; maximum=50 |


### ExchangeRate





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `currency` | string | 是 | 三位大写货币代码，例如USD/EUR/GBP。 | pattern="^[A-Z]{3}$" |
| `cnyPerUnit` | number | 是 | 1币种单位对应人民币；仅展示，未用于金额换汇。 | exclusiveMinimum=0 |


### DailyRegistration





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `date` | string (date) | 是 | 注册统计归属日，按provider已经归属的YYYY-MM-DD读取。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `count` | integer | 是 | 当天当前业务范围已授权注册数量；非订单数量。 | minimum=0 |


### RegistrationSalesperson





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 注册归属员工ID，与可信registrationEntries.owner.id一致。 | — |
| `name` | string | 是 | 注册归属员工展示名。 | — |
| `counts` | integer[] | 是 | 与registrations日期对齐。 | — |


### RegistrationDepartment





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | SalesDepartment | 是 | 固定报表部门sales1..4。 | — |
| `name` | string | 是 | 固定报表部门中文名称。 | — |
| `counts` | integer[] | 是 | 部门每日注册量，与registrations数组日期同序；等于salespeople每日求和。 | — |
| `salespeople` | RegistrationSalesperson[] | 是 | 该部门有注册台账的员工系列，按员工ID排序。 | — |


### DashboardQueues





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `review` | integer | 是 | 无对应角色为0；不受日期筛选。 | minimum=0 |
| `allocation` | integer | 是 | 无对应角色为0；不受日期筛选。 | minimum=0 |
| `dispatch` | integer | 是 | 无对应角色为0；不受日期筛选。 | minimum=0 |
| `shipping` | integer | 是 | 无对应角色为0；不受日期筛选。 | minimum=0 |


### DashboardException





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | orderNumber，非FopOrder.id。 | — |
| `customer` | string | 是 | 异常订单客户名称。 | — |
| `reason` | string | 是 | 异常原因代码：库存stock、地址address、物流单号tracking。 | enum=["stock", "address", "tracking"] |
| `hours` | number | 是 | 异常持续小时数，来自授权订单exception.hours。 | — |


### DashboardTask





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 任务卡稳定键，与kind相同。 | enum=["review", "allocation", "shipping"] |
| `kind` | string | 是 | review审核、allocation配货、shipping发货。 | enum=["review", "allocation", "shipping"] |
| `count` | integer | 是 | 对应队列当前待处理数，只输出大于0且有入口权限的队列。 | minimum=0 |
| `time` | string | 是 | 最早待办创建时刻转换 UTC+8 后的 HH:mm；无可用时刻为空字符串。 | — |
| `priority` | string | 是 | allocation为normal，其余high。 | enum=["high", "normal"] |


### ReceiptSeries





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 营销中心 marketing、报表部门 sales1..4、业务员 owner.id。 | — |
| `name` | string | 是 | 营销中心、报表部门或业务员工展示名。 | — |
| `previousAmount` | Money | 是 | 所选 year 上一年12月、同一权限及来源口径的 USD 实收合计。 | — |
| `amounts` | Money[] | 是 | 各 UTC+8 支付月份 USD 实收，与 receipts.months 对齐。 | — |
| `breakdown` | ReceiptBreakdownValues | 是 | 见引用模型/接口说明 | — |
| `previousBreakdown` | ReceiptBreakdown | 是 | 见引用模型/接口说明 | — |


### ReceiptDepartment





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 固定报表部门代码sales1..4。 | — |
| `name` | string | 是 | 固定报表部门中文名称。 | — |
| `previousAmount` | Money | 是 | 所选 year 上一年12月、同一权限及来源口径的 USD 实收合计。 | — |
| `amounts` | Money[] | 是 | 各 UTC+8 支付月份 USD 实收，与 receipts.months 对齐。 | — |
| `salespeople` | ReceiptSeries[] | 是 | 按稳定业务员 ID 排序；授权分录必须有 owner，不能制造未分配业绩。 | — |
| `breakdown` | ReceiptBreakdownValues | 是 | 见引用模型/接口说明 | — |
| `previousBreakdown` | ReceiptBreakdown | 是 | 见引用模型/接口说明 | — |


### DashboardReceipts


方案2独立授权的USD实收分录：已支付、源单及收款单均已审核，履约＋全款备货，排除押金／样品／取消／退款／未来支付。按 UTC+8 支付月归属，使用预付库存不补回产品款。无 scope 时 months/departments=[]、marketingCenter=null，仍返回 basis/timeZone。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `currency` | "USD" | 是 | 固定 USD；非 USD 分录不进入业绩。 | — |
| `months` | string[] | 是 | UTC+8 当前年截至当前月；历史年12个月；无 scope 为空。 | — |
| `previousMonth` | string | 否 | 用于第一月环比的上年12月；仅months非空时存在。 | pattern="^\\d{4}-12$" |
| `marketingCenter` | ReceiptSeries anyOf null | 是 | 四部门金额合计系列；没有receipts权限时明确null。 | — |
| `departments` | ReceiptDepartment[] | 是 | 有receipts scope固定4部门，否则空。 | — |
| `basis` | "actual_received" | 是 | 见引用模型/接口说明 | — |
| `timeZone` | "UTC+8" | 是 | 见引用模型/接口说明 | — |


### FopDashboard





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `businessScope` | BusinessScope | 是 | 此次响应所使用的当前业务数据范围。 | — |
| `source` | DataSource | 是 | provider来源标识，不是独立金融系统来源。 | — |
| `updatedAt` | string (date-time) | 是 | 本次计算时刻，非上游刷新时间。 | — |
| `queues` | DashboardQueues | 是 | 审核、配货、调度、发货当前队列数量；无入口权限时对应0。 | — |
| `rates` | ExchangeRate[] | 是 | 无rates scope空。 | — |
| `registrations` | DailyRegistration[] | 是 | 明细台账补齐0；仅旧汇总时只业务admin可读且不补齐日期。 | — |
| `registrationDepartments` | RegistrationDepartment[] | 是 | 后端始终输出；无台账/权限空。 | — |
| `tasks` | DashboardTask[] | 是 | 审核/配货/发货中有权限且非空的任务卡；不含调度或采购。 | — |
| `exceptions` | DashboardException[] | 是 | 仅sales有权限。 | — |
| `receipts` | DashboardReceipts | 是 | 独立授权的 USD 实收分录按 UTC+8 月度汇总，含履约／全款备货来源拆分及上年12月基线。 | — |


```json
{
  "businessScope": {
    "role": "admin",
    "departmentId": null,
    "employeeId": null
  },
  "source": "mock",
  "updatedAt": "2026-10-22T08:00:00Z",
  "queues": {
    "review": 2,
    "allocation": 1,
    "dispatch": 0,
    "shipping": 3
  },
  "rates": [
    {
      "currency": "USD",
      "cnyPerUnit": 7.12
    }
  ],
  "registrations": [
    {
      "date": "2026-10-21",
      "count": 2
    }
  ],
  "registrationDepartments": [
    {
      "id": "sales1",
      "name": "业务一部",
      "counts": [
        2
      ],
      "salespeople": [
        {
          "id": "employee-example",
          "name": "示例业务员",
          "counts": [
            2
          ]
        }
      ]
    },
    {
      "id": "sales2",
      "name": "业务二部",
      "counts": [
        0
      ],
      "salespeople": []
    },
    {
      "id": "sales3",
      "name": "业务三部",
      "counts": [
        0
      ],
      "salespeople": []
    },
    {
      "id": "sales4",
      "name": "业务四部",
      "counts": [
        0
      ],
      "salespeople": []
    }
  ],
  "tasks": [
    {
      "id": "review",
      "kind": "review",
      "count": 2,
      "time": "01:00",
      "priority": "high"
    },
    {
      "id": "allocation",
      "kind": "allocation",
      "count": 1,
      "time": "02:00",
      "priority": "normal"
    },
    {
      "id": "shipping",
      "kind": "shipping",
      "count": 3,
      "time": "03:00",
      "priority": "high"
    }
  ],
  "exceptions": [
    {
      "id": "AF-EXAMPLE-001",
      "customer": "示例客户",
      "reason": "stock",
      "hours": 8
    }
  ],
  "receipts": {
    "currency": "USD",
    "months": [
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10"
    ],
    "previousMonth": "2025-12",
    "marketingCenter": {
      "id": "marketing",
      "name": "营销中心",
      "previousAmount": 100,
      "amounts": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        125.5
      ],
      "breakdown": {
        "fulfillment": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          125.5
        ],
        "fullPaymentStock": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      "previousBreakdown": {
        "fulfillment": 100,
        "fullPaymentStock": 0
      }
    },
    "departments": [
      {
        "id": "sales1",
        "name": "业务一部",
        "previousAmount": 100,
        "amounts": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          125.5
        ],
        "salespeople": [
          {
            "id": "employee-example",
            "name": "示例业务员",
            "previousAmount": 100,
            "amounts": [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              125.5
            ],
            "breakdown": {
              "fulfillment": [
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                125.5
              ],
              "fullPaymentStock": [
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0
              ]
            },
            "previousBreakdown": {
              "fulfillment": 100,
              "fullPaymentStock": 0
            }
          }
        ],
        "breakdown": {
          "fulfillment": [
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            125.5
          ],
          "fullPaymentStock": [
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0
          ]
        },
        "previousBreakdown": {
          "fulfillment": 100,
          "fullPaymentStock": 0
        }
      },
      {
        "id": "sales2",
        "name": "业务二部",
        "previousAmount": 0,
        "amounts": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ],
        "salespeople": [],
        "breakdown": {
          "fulfillment": [
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0
          ],
          "fullPaymentStock": [
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0
          ]
        },
        "previousBreakdown": {
          "fulfillment": 0,
          "fullPaymentStock": 0
        }
      },
      {
        "id": "sales3",
        "name": "业务三部",
        "previousAmount": 0,
        "amounts": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ],
        "salespeople": [],
        "breakdown": {
          "fulfillment": [
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0
          ],
          "fullPaymentStock": [
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0
          ]
        },
        "previousBreakdown": {
          "fulfillment": 0,
          "fullPaymentStock": 0
        }
      },
      {
        "id": "sales4",
        "name": "业务四部",
        "previousAmount": 0,
        "amounts": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ],
        "salespeople": [],
        "breakdown": {
          "fulfillment": [
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0
          ],
          "fullPaymentStock": [
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0
          ]
        },
        "previousBreakdown": {
          "fulfillment": 0,
          "fullPaymentStock": 0
        }
      }
    ],
    "basis": "actual_received",
    "timeZone": "UTC+8"
  }
}
```


### WorkbenchAccount





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | 是 | 本地账户UUID，权限写接口path参数使用。 | — |
| `displayId` | string | 是 | 六位展示号。 | — |
| `email` | string | 是 | 账户登录邮箱。 | — |
| `username` | string | 是 | 账户显示用户名。 | — |
| `role` | string | 是 | 系统管理角色：admin可配置账户，user不可；不授予业务数据范围。 | enum=["admin", "user"] |
| `workbenchRoles` | WorkbenchRole[] | 是 | 存储的工作台入口角色数组；有效权限还受businessScope影响。 | uniqueItems=true |
| `businessScope` | BusinessScope | 是 | 独立业务角色、部门和员工范围。 | — |
| `fopBinding` | FopBinding anyOf null | 是 | 真实FOP租户/用户绑定，未绑定时null；不包含密码或JWT。 | — |


### WorkbenchAccountPage


只有items/total，没有page/pageSize/source/totals。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `items` | WorkbenchAccount[] | 是 | 本页账户及权限配置。 | — |
| `total` | integer | 是 | 符合search的账户总数。 | minimum=0 |


### UpdateWorkbenchRoles





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `workbenchRoles` | WorkbenchRole[] | 是 | 替换目标账户全部入口角色，最多5种不可重复；[]撤销所有存储入口角色。 | maxItems=5; uniqueItems=true |


### UpdateManagementRole





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `role` | string | 是 | 设置系统管理角色admin或user；不修改业务数据权限。 | enum=["admin", "user"] |


### UpdateFopBinding


字符串trim；两字段同时非空或同时null解绑，不能缺失。

类型：`object oneOf object`；约束：—。

组合规则 `oneOf`：`object`, `object`。完整约束见 OpenAPI JSON。


### UpdateBusinessScope





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `role` | BusinessRole | 是 | 设置独立业务权限：经理必须有departmentId，销售必须有employeeId。 | — |
| `departmentId` | string / null | 是 | 字符串先trim；未分配显式null。 | minLength=1; maxLength=128 |
| `employeeId` | string / null | 是 | 字符串先trim；未分配显式null。 | minLength=1; maxLength=128 |

组合规则 `allOf`：`见 schema`, `见 schema`。完整约束见 OpenAPI JSON。


### OrganizationNode





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | 是 | 本地组织树节点UUID。 | — |
| `parentId` | string (uuid) anyOf null | 是 | 上级节点UUID；根组织节点为null。 | — |
| `name` | string | 是 | 组织或部门显示名称。 | — |
| `kind` | string | 是 | organization根组织或department部门节点。 | enum=["organization", "department"] |
| `sortOrder` | integer | 是 | 同级显示排序数，越小越靠前。 | — |


### OrganizationEmployee





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | 是 | 本地员工UUID，不自动等于FOP用户ID。 | — |
| `name` | string | 是 | 本地演示组织员工姓名。 | — |
| `code` | string | 是 | 本地员工编码，排序依据。 | — |
| `email` | string | 是 | 本地员工邮箱，种子使用hyperzone.example。 | — |
| `departmentId` | string (uuid) | 是 | 所属本地部门节点UUID。 | — |
| `workbenchRoles` | WorkbenchRole[] | 是 | 演示员工岗位角色，不等于当前登录账户实际入口授权。 | — |


### OrganizationWorkspace





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `source` | "mock" | 是 | 当前始终mock，非FOP目录。 | — |
| `nodes` | OrganizationNode[] | 是 | 当前管理员账户独立组织树节点。 | — |
| `employees` | OrganizationEmployee[] | 是 | 当前管理员账户独立员工目录；尚未与FOP真实目录同步。 | — |
| `canEdit` | boolean | 是 | GET要求系统管理员，正常true。 | — |


### LeadStatus




类型：`string`；约束：enum=["new", "qualified", "contacted", "replied", "opportunity", "won", "lost", "invalid"]。


### WorkflowRun





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | 是 | 本地UUID。 | — |
| `displayId` | string | 是 | 工作流显示编号。 | — |
| `parentWorkflowRunId` | string (uuid) anyOf null | 是 | 父工作流UUID，无父版本时null。 | — |
| `rootWorkflowRunId` | string (uuid) anyOf null | 是 | 版本链根工作流UUID，无根引用时null。 | — |
| `revisionNo` | integer | 是 | 工作流修订版本号。 | — |
| `name` | string | 是 | 工作流名称。 | — |
| `seedType` | string | 是 | 搜索种子类型keyword关键词或image图片。 | enum=["keyword", "image"] |
| `seedValue` | string | 是 | 关键词文本或图片输入值。 | — |
| `targetMarket` | string | 是 | 目标市场代码/名称。 | — |
| `searchOptions` | object | 是 | Google搜索选项：短语精确、标题、排除平台、查找店主Facebook。 | additionalProperties=false |
| `searchOptions.exactPhrase` | boolean | 是 | 见引用模型/接口说明 | — |
| `searchOptions.titleMatch` | boolean | 是 | 见引用模型/接口说明 | — |
| `searchOptions.excludeMarketplaces` | boolean | 是 | 见引用模型/接口说明 | — |
| `searchOptions.findOwnerFacebook` | boolean | 是 | 见引用模型/接口说明 | — |
| `status` | string | 是 | 工作流当前生命周期状态。 | enum=["draft", "running", "completed", "failed", "cancelled"] |
| `currentStage` | string | 是 | 工作流当前执行阶段。 | enum=["seed", "ad_discovery", "store_detection", "lead_cleaning", "lead_scoring", "message_generation", "outreach", "crm"] |
| `progress` | number | 是 | 当前执行进度数值。 | — |
| `leadCount` | integer | 是 | 数量。 | minimum=0 |
| `failureReason` | string anyOf null | 是 | 最近失败原因；本地Dashboard映射未传任务失败信息时null。 | — |
| `failureCode` | string anyOf null | 是 | 标准化失败分类；无失败null。 | — |
| `failureProvider` | string anyOf null | 是 | 失败来源服务；未知或无失败null。 | — |
| `failureRetryable` | boolean | 是 | 失败是否允许重试。 | — |
| `archivedAt` | string (date-time) anyOf null | 是 | 归档时间，未归档null。 | — |
| `createdAt` | string (date-time) | 是 | 带时区ISO8601时间戳。 | — |
| `updatedAt` | string (date-time) | 是 | 带时区ISO8601时间戳。 | — |


### LeadContact





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `type` | string | 是 | 联系方式渠道类型。 | enum=["facebook", "whatsapp", "email", "instagram", "other", "linkedin", "website", "phone"] |
| `value` | string | 是 | 规范化联系方式值。 | — |
| `label` | string anyOf null | 是 | 联系方式备注，无备注null。 | — |
| `verified` | boolean | 是 | 是否验证该联系方式。 | — |
| `sourceUrl` | string anyOf null | 是 | 来源页面URL，无来源null。 | — |
| `sourceType` | string | 是 | 来源类型标记。 | — |
| `verificationStatus` | string | 是 | 证据验证状态：已验证、观察到、未验证。 | enum=["verified", "observed", "unverified"] |
| `confidence` | number | 是 | 联系方式可信度分数。 | — |
| `evidence` | object | 是 | 提供者扩展证据字典。 | additionalProperties=true |
| `sourcePageTitle` | string anyOf null | 是 | 来源页面标题，无值null。 | — |
| `sourcePageKind` | string anyOf null | 是 | 来源页面类别，无值null。 | — |
| `extractedFrom` | string | 是 | 提取来源标记，优先evidence.extractedFrom，缺失回退sourceType。 | — |


### LeadAdEvidence





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `provider` | string | 是 | 广告证据提供方。 | — |
| `evidenceSource` | string | 是 | 广告证据来源类型。 | — |
| `platform` | string | 是 | 广告所属平台，未知unknown。 | enum=["facebook", "instagram", "tiktok", "unknown"] |
| `adId` | string anyOf null | 是 | 平台广告ID，缺失null。 | — |
| `sourceUrl` | string | 是 | 证据URL。 | — |
| `isDirectAdLink` | boolean | 是 | 是否为可直达广告的链接。 | — |
| `confidence` | number | 是 | 广告关联可信度分数。 | — |
| `matchReasons` | string[] | 是 | 广告与线索匹配理由文本数组。 | — |


### LeadWorkflowDiscovery





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `workflowRunId` | string (uuid) | 是 | 本地UUID。 | — |
| `workflowDisplayId` | string | 是 | 发现线索的工作流展示编号。 | — |
| `workflowName` | string | 是 | 发现线索的工作流名称。 | — |
| `workflowCreatedAt` | string (date-time) | 是 | 带时区ISO8601时间戳。 | — |
| `discoveredAt` | string (date-time) | 是 | 带时区ISO8601时间戳。 | — |
| `score` | number | 是 | 该次工作流发现线索时记录的评分。 | — |


### StoreLead





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | 是 | 本地UUID。 | — |
| `workflowRunId` | string (uuid) anyOf null | 是 | 关联工作流UUID，未关联null。 | — |
| `brandName` | string | 是 | 店铺/品牌名称。 | — |
| `domain` | string | 是 | 规范化店铺域名。 | — |
| `storeUrl` | string | 是 | 店铺主页URL。 | — |
| `productUrl` | string anyOf null | 是 | 发现时商品页URL，缺失null。 | — |
| `ownerFacebookUrl` | string anyOf null | 是 | 通过店主搜索得到的Facebook地址，缺失null。 | — |
| `discoverySources` | string[] | 是 | 发现来源服务枚举数组。 | — |
| `source` | string | 是 | 来源展示标记。 | — |
| `country` | string | 是 | 国家代码/名称。 | — |
| `language` | string | 是 | 主要语言。 | — |
| `category` | string | 是 | 商品/业务分类。 | — |
| `shopifyConfidence` | number | 是 | Shopify识别可信度。 | — |
| `adActivityScore` | number | 是 | 广告活跃度评分。 | — |
| `trafficScore` | number | 是 | 流量评分。 | — |
| `contactScore` | number | 是 | 联系方式完整性评分。 | — |
| `totalScore` | number | 是 | 线索总评分，用于topLeads排序。 | — |
| `status` | LeadStatus | 是 | 线索当前销售阶段状态。 | — |
| `discoveryStatus` | string | 是 | 首次发现或重复发现。 | enum=["first_seen", "seen_before"] |
| `discoveryCount` | integer | 是 | 数量。 | minimum=0 |
| `workflowDiscoveries` | LeadWorkflowDiscovery[] | 是 | 同一线索相关工作流发现记录。 | — |
| `recommendedAngle` | string | 是 | 推荐联系切入点文本。 | — |
| `contacts` | LeadContact[] | 是 | 去重并按渠道/可信度排序的联系方式。 | — |
| `adEvidence` | LeadAdEvidence[] | 是 | 广告证据数组；Dashboard未传scoreReasons时通常为空。 | — |
| `createdAt` | string (date-time) | 是 | 带时区ISO8601时间戳。 | — |


### OutreachTemplateOptions





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `quoteMode` | string | 是 | 报价模板模式：无报价、商品、物流或组合。 | enum=["none", "product", "logistics", "combined"] |
| `includeProductVisual` | boolean | 是 | 是否包含商品视觉信息。 | — |
| `emphasizeSupplier` | boolean | 是 | 是否强调供应商能力。 | — |
| `emphasizeLogistics` | boolean | 是 | 是否强调物流能力。 | — |
| `productImageUrl` | string anyOf null | 是 | 商品图片URL，无图null。 | — |
| `verifiedQuoteContext` | string anyOf null | 是 | 经验证报价上下文，无上下文null。 | — |


### OutreachTask





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | 是 | 本地UUID。 | — |
| `leadId` | string (uuid) | 是 | 本地UUID。 | — |
| `leadName` | string | 是 | 关联线索品牌名，无线索回退Unknown lead。 | — |
| `customer` | object | 是 | 关联客户摘要。 | additionalProperties=false |
| `customer.id` | string (uuid) | 是 | 本地UUID。 | — |
| `customer.name` | string | 是 | 见引用模型/接口说明 | — |
| `customer.domain` | string | 是 | 见引用模型/接口说明 | — |
| `customer.storeUrl` | string | 是 | 见引用模型/接口说明 | — |
| `customer.country` | string | 是 | 见引用模型/接口说明 | — |
| `customer.category` | string | 是 | 见引用模型/接口说明 | — |
| `customer.totalScore` | number | 是 | 见引用模型/接口说明 | — |
| `customer.status` | LeadStatus | 是 | 见引用模型/接口说明 | — |
| `contactChannels` | object[] | 是 | 可联系渠道数组，排除website并按优先级排序。 | — |
| `contactChannels[].type` | string | 是 | 见引用模型/接口说明 | enum=["facebook", "whatsapp", "email", "instagram", "other", "linkedin", "website", "phone"] |
| `contactChannels[].value` | string | 是 | 见引用模型/接口说明 | — |
| `contactChannels[].label` | string anyOf null | 是 | 见引用模型/接口说明 | — |
| `contactChannels[].verified` | boolean | 是 | 见引用模型/接口说明 | — |
| `contactChannels[].confidence` | number | 是 | 见引用模型/接口说明 | — |
| `channel` | string | 是 | 此次联系使用的渠道。 | enum=["facebook", "whatsapp", "email", "instagram", "other"] |
| `status` | string | 是 | 任务生命周期状态。 | enum=["draft", "ready", "sent", "replied", "skipped", "failed"] |
| `message` | string | 是 | 待发送或已生成消息正文。 | — |
| `targetContact` | string anyOf null | 是 | 目标联系人地址，无值null。 | — |
| `subject` | string anyOf null | 是 | 邮件/消息主题，无值null。 | — |
| `templateKey` | string | 是 | 模板组合标识。 | — |
| `templateOptions` | OutreachTemplateOptions | 是 | 本次模板选项；未设置时返回默认对象。 | — |
| `sendUrl` | string anyOf null | 是 | 打开外部发送工具的URL，不能生成时null。 | — |
| `recommendedNextAction` | string | 是 | 建议下一步操作文本。 | — |
| `nextFollowUpAt` | string (date-time) anyOf null | 是 | 计划下次跟进时间，未安排null。 | — |
| `owner` | string | 是 | 任务归属账户用户名，未知回退Unassigned。 | — |
| `createdAt` | string (date-time) | 是 | 带时区ISO8601时间戳。 | — |


### FollowUpStage





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `key` | LeadStatus | 是 | 固定销售阶段键，与LeadStatus一致。 | — |
| `label` | string | 是 | 销售阶段英文显示名。 | — |
| `count` | integer | 是 | 数量。 | minimum=0 |
| `value` | 0 | 是 | 当前固定0，未接成交金额。 | — |


### LocalDashboard


本地数据库业务概览，与FOP Dashboard不同；无source/updatedAt/包装层。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `metrics` | object | 是 | 当前授权本地业务范围的工作流、线索、待联系、回复和机会数量。 | additionalProperties=false |
| `metrics.activeWorkflows` | integer | 是 | 数量。 | minimum=0 |
| `metrics.newLeads` | integer | 是 | 数量。 | minimum=0 |
| `metrics.readyOutreach` | integer | 是 | 数量。 | minimum=0 |
| `metrics.replies` | integer | 是 | 数量。 | minimum=0 |
| `metrics.opportunities` | integer | 是 | 数量。 | minimum=0 |
| `funnel` | FollowUpStage[] | 是 | 固定8种状态。 | — |
| `recentWorkflows` | WorkflowRun[] | 是 | 最近未归档工作流。 | maxItems=5 |
| `topLeads` | StoreLead[] | 是 | 最高分线索。 | maxItems=5 |
| `nextTasks` | OutreachTask[] | 是 | ready待发送任务。 | maxItems=5 |


### HttpError





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `statusCode` | integer | 是 | 数值HTTP状态码，与响应HTTP状态一致。 | — |
| `message` | string oneOf string[] | 是 | Nest错误字符串；DTO错误通常为字符串数组。 | — |
| `error` | string | 否 | 部分异常带Bad Request/Forbidden等短语；默认401/429可省略。 | — |


### FopError


显式对象异常只有code/message，不含statusCode/error；HTTP为403或503。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `code` | string | 是 | 可供前端i18n映射的业务错误码；具体HTTP状态由对应响应定义。 | enum=["business_access_disabled", "business_scope_required", "fop_binding_required", "fop_not_configured", "fop_permission_denied", "fop_binding_changed", "fop_unavailable"] |
| `message` | string | 是 | 固定公开消息，不回传上游秘密。 | — |


### ErrorResponse




类型：`HttpError oneOf FopError`；约束：—。

组合规则 `oneOf`：`HttpError`, `FopError`。完整约束见 OpenAPI JSON。


### ReceiptBreakdown


履约与全款备货实收拆分，二者之和等于总实收；押金备货不计入。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `fulfillment` | Money | 是 | 见引用模型/接口说明 | minimum=0 |
| `fullPaymentStock` | Money | 是 | 见引用模型/接口说明 | minimum=0 |


### ReceiptBreakdownValues


与 Dashboard receipts.months 同下标；每期两来源之和等于 amounts。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `fulfillment` | Money[] | 是 | 见引用模型/接口说明 | — |
| `fullPaymentStock` | Money[] | 是 | 见引用模型/接口说明 | — |


### FopReceipt


公开收款分录白名单，不含 tenantId、departmentPathIds、权限或未确认的 approvedAt。使用预付全款库存的履约产品款已在源单免除，禁止补回或再扣减；不重复复制表头实收。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 唯一收款分录 ID，独立授权及去重键，不是重复的收款表头 ID。 | — |
| `documentId` | string | 是 | 源履约或备货单稳定 ID；可信适配器解析，不以显示单号替代。 | — |
| `documentNumber` | string | 是 | 源单业务单号，原收款 entryentity.hzkj_src_order 为单号而非 ID。 | — |
| `customerId` | string | 是 | 业务归属客户稳定 ID。 | — |
| `customerCode` | string | 是 | 客户编码，未提供时空字符串。 | — |
| `customerName` | string | 是 | 客户展示名。 | — |
| `warehouse` | string | 是 | 国内仓库展示名。 | — |
| `sourceType` | string | 是 | 归一来源。公开有效分录端点只返回履约及全款备货，押金备货不进入业绩，样品不在本资源范围。 | enum=["fulfillment", "full_payment_stock", "deposit_stock"] |
| `organization` | NamedEntity | 否 | 见引用模型/接口说明 | — |
| `department` | NamedEntity | 是 | 见引用模型/接口说明 | — |
| `owner` | NamedEntity | 是 | 见引用模型/接口说明 | — |
| `salesDepartmentCode` | SalesDepartment | 是 | 见引用模型/接口说明 | — |
| `warehouseCode` | string | 是 | 见引用模型/接口说明 | enum=["HZ", "SZ"] |
| `carrierCode` | CarrierCode anyOf null | 是 | 履约必须已映射服务商；全款／押金备货必须 null，表示不适用。未知物流不能兜底为 OTHER。 | — |
| `amount` | Money | 是 | 收款分录 hzkj_real_receive_amt 实收，业务结算含钱包授信，并非银行现金流保证。 | minimum=0 |
| `orderAmount` | Money | 是 | 收款分录 hzkj_samount 订单金额，不用于实收业绩。 | minimum=0 |
| `handlingFee` | Money | 是 | 收款分录 hzkj_handle_fee 手续费，单独保留用于对账。 | minimum=0 |
| `currency` | string | 是 | 明确原币种，不隐式换汇；公开业绩分录页仅 USD。 | pattern="^[A-Z]{3}$" |
| `paidAt` | string / null | 是 | 带明确时区的支付时刻，转换 UTC+8 归日／月；有效分录页必为已发生的非空时刻。 | — |
| `reviewStatus` | string | 是 | 源履约或备货单审核，不等于收款单审核。 | enum=["pending", "approved"] |
| `receiptReviewStatus` | string | 是 | 收款单审核，业绩要求源单及收款单均 approved。 | enum=["pending", "approved"] |
| `paymentStatus` | string | 是 | 归一支付状态。paid 必须同时满足源履约／备货订单的支付条件及收款单已收条件（hzkj_receive_status=B）；不能只根据收款单 B 推定源单已支付。源单两类枚举不同，按已核实映射处理。 | enum=["paid", "unpaid", "refunded"] |
| `cancelled` | boolean | 是 | 见引用模型/接口说明 | — |
| `items` | FopOrderItem[] | 是 | 见引用模型/接口说明 | — |

组合规则 `allOf`：`见 schema`。完整约束见 OpenAPI JSON。


```json
{
  "id": "receipt-line-example",
  "sourceType": "full_payment_stock",
  "documentId": "stock-example",
  "documentNumber": "STOCK-001",
  "customerId": "customer-example",
  "customerCode": "C001",
  "customerName": "示例客户",
  "department": {
    "id": "department-example",
    "name": "业务一部"
  },
  "owner": {
    "id": "employee-example",
    "name": "示例业务员"
  },
  "salesDepartmentCode": "sales1",
  "warehouseCode": "HZ",
  "warehouse": "杭州仓",
  "carrierCode": null,
  "amount": 98,
  "orderAmount": 100,
  "handlingFee": 2,
  "currency": "USD",
  "paidAt": "2026-10-21T16:30:00Z",
  "reviewStatus": "approved",
  "receiptReviewStatus": "approved",
  "paymentStatus": "paid",
  "cancelled": false,
  "items": [
    {
      "sku": "SKU-001",
      "name": "示例备货商品",
      "imageUrl": null,
      "variant": "蓝色",
      "quantity": 2
    }
  ]
}
```


### ReceiptTotals


完整筛选范围分页前合计；receiptCount 为分录数，fulfillmentAmount+fullPaymentStockAmount=amount；订单金额和手续费不替代实收。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `receiptCount` | integer | 是 | 见引用模型/接口说明 | minimum=0 |
| `currency` | "USD" | 是 | 见引用模型/接口说明 | — |
| `amount` | Money | 是 | 见引用模型/接口说明 | minimum=0 |
| `fulfillmentAmount` | Money | 是 | 见引用模型/接口说明 | minimum=0 |
| `fullPaymentStockAmount` | Money | 是 | 见引用模型/接口说明 | minimum=0 |
| `orderAmount` | Money | 是 | 见引用模型/接口说明 | minimum=0 |
| `handlingFee` | Money | 是 | 见引用模型/接口说明 | minimum=0 |


### ReceiptPage


仅独立授权、USD、paid、源单 approved、收款 approved、未取消、已发生的履约／全款备货分录。按 paidAt 倒序、id 稳定排序；total=totals.receiptCount；越界页 items=[] 但保留完整合计。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `source` | DataSource | 是 | 见引用模型/接口说明 | — |
| `timeZone` | "UTC+8" | 是 | 见引用模型/接口说明 | — |
| `total` | integer | 是 | 见引用模型/接口说明 | minimum=0 |
| `totals` | ReceiptTotals | 是 | 见引用模型/接口说明 | — |
| `page` | integer | 是 | 见引用模型/接口说明 | minimum=1; maximum=1000000 |
| `pageSize` | integer | 是 | 见引用模型/接口说明 | minimum=1; maximum=100 |
| `items` | FopReceipt allOf 见 schema[] | 是 | 见引用模型/接口说明 | — |


```json
{
  "source": "mock",
  "timeZone": "UTC+8",
  "total": 0,
  "page": 1,
  "pageSize": 20,
  "totals": {
    "receiptCount": 0,
    "currency": "USD",
    "amount": 0,
    "fulfillmentAmount": 0,
    "fullPaymentStockAmount": 0,
    "orderAmount": 0,
    "handlingFee": 0
  },
  "items": []
}
```


### FreightCarrier


实际发运服务商的可信标准映射。OTHER仅为已知其他服务商；未知或缺失不得兜底。固定展示顺序YT/4PX/WB/YW/JS/OTHER。

类型：`string`；约束：enum=["YT", "4PX", "WB", "YW", "JS", "OTHER"]。


### FreightGrain


month=所选年年初到当前月（历史年12月）；week=锚点所在周及前三周，周一开始；year=所选年及前四年，最早2020。

类型：`string`；约束：enum=["month", "week", "year"]。


### FreightQuery


已解析的运费查询回显，week时含解析后weekOf；浏览器请求warehouse可省略默认ALL。时间按UTC+8确认时间归期。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `grain` | FreightGrain | 是 | 见引用模型/接口说明 | — |
| `year` | integer | 是 | 2020至UTC+8当前年；未来年拒绝。周锚点必须属于所选年。 | minimum=2020; maximum=9999 |
| `weekOf` | string (date) | 否 | 仅week可传；不传时当年默认UTC+8今天、历史年默认12月31日。必须属于year且不晚于今天；响应回显解析后的锚点。非week传入则400。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `warehouse` | string | 是 | ALL=全仓，HZ=杭州仓，SZ=深圳仓；服务端授权范围内过滤，不扩大权限。 | enum=["ALL", "HZ", "SZ"]; default="ALL" |
| `carrierCode` | FreightCarrier | 否 | 省略返回合计及固定六类服务商；指定时返回合计及该服务商。 | — |

组合规则 `allOf`：`见 schema`。完整约束见 OpenAPI JSON。


```json
{
  "grain": "month",
  "year": 2026,
  "warehouse": "ALL"
}
```


### FopFreight


公开运费成本快照白名单；每发运单一条，不含tenantId/departmentPathIds。源费用分录已停用，未覆盖完整重派、补收、退款与历史调价账本。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 发运单稳定ID；当前成本快照唯一键，独立allowlist授权键；重复ID拒收。 | minLength=1 |
| `documentNumber` | string | 是 | 发运单billno，非订单号。 | minLength=1 |
| `orderNumber` | string | 是 | hzkj_order_no对应源履约订单号；同一订单可有多条发运单成本。 | minLength=1 |
| `trackingNumber` | string / null | 是 | 源hzkj_logistics_orderno物流订单号；可空；具体跟踪号语义待真实接口确认。 | minLength=1 |
| `carrierCode` | FreightCarrier | 是 | 见引用模型/接口说明 | — |
| `carrierName` | string | 是 | 真实服务商展示名称。 | minLength=1 |
| `channelName` | string | 是 | 发运单实际物流渠道名称。 | minLength=1 |
| `warehouseCode` | string | 是 | 实际发运仓库，未知拒收。 | enum=["HZ", "SZ"] |
| `warehouse` | string | 是 | 实际发运仓库展示名称。 | minLength=1 |
| `customerId` | string | 是 | 稳定客户ID。 | minLength=1 |
| `customerCode` | string | 是 | 非空客户编码，可信适配器提供；不可用空值替代。 | minLength=1 |
| `customerName` | string | 是 | 客户名称。 | minLength=1 |
| `organization` | NamedEntity | 否 | 发运单组织；可信源提供。 | — |
| `department` | NamedEntity | 否 | 成本归属部门；部门权限不得由浏览器提供。 | — |
| `owner` | NamedEntity | 否 | 发运单业务员稳定ID及名称。 | — |
| `salesDepartmentCode` | SalesDepartment | 否 | 见引用模型/接口说明 | — |
| `originalAmount` | number | 是 | hzkj_actual_freight原币实际成本，至多两位小数的安全分币；非客户收费或预估价。公开有效明细为正数。 | minimum=0; maximum=90071992547409.9 |
| `originalCurrency` | string | 是 | hzkj_textfield1明确原币种，标准大写三字母代码；不得统一假定CNY。 | pattern="^[A-Z]{3}$" |
| `fxRateToUsd` | number | 是 | 每1单位原币折合USD；必须显式、有限且>0，USD原币必须1。 | exclusiveMinimum=0 |
| `fxRateDate` | string (date) | 是 | 该条成本采用的汇率业务日期；不是响应生成日期的隐式替代。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `fxRateSource` | string | 是 | 可追溯的汇率来源；Mock来源不能用于生产。 | minLength=1 |
| `amount` | number | 是 | USD成本=originalAmount×fxRateToUsd，按十进制精确乘法HALF_UP到分（1.50×0.15=0.23），不先做二进制浮点乘法再round。后端验证一致性、安全分币和累计安全性；缺汇率、不一致或超过两位小数的原额/结果拒收。 | minimum=0; maximum=90071992547409.9 |
| `currency` | "USD" | 是 | 统一分析与展示币种。 | — |
| `confirmedAt` | string / null | 是 | hzkj_actual_freight_time，带时区的实际运费确认时刻；UTC+8归期。公开有效明细必须非空且已发生；不是最终结账或银行付款证明。 | — |
| `reviewStatus` | string | 是 | 发运单审核；billstatus=C映射approved。 | enum=["approved", "pending"] |
| `costStatus` | string | 是 | 适配器归一成本确认状态；不能宣称源存在同名枚举。 | enum=["confirmed", "pending"] |

组合规则 `allOf`：`见 schema`。完整约束见 OpenAPI JSON。


```json
{
  "id": "delivery-example",
  "documentNumber": "DEL-001",
  "orderNumber": "ORDER-001",
  "trackingNumber": "LOG-001",
  "carrierCode": "YT",
  "carrierName": "云途",
  "channelName": "示例实际渠道",
  "warehouseCode": "HZ",
  "warehouse": "杭州仓",
  "customerId": "customer-example",
  "customerCode": "C001",
  "customerName": "示例客户",
  "organization": {
    "id": "org-example",
    "name": "示例组织"
  },
  "department": {
    "id": "department-example",
    "name": "业务一部"
  },
  "owner": {
    "id": "employee-example",
    "name": "示例业务员"
  },
  "salesDepartmentCode": "sales1",
  "originalAmount": 100,
  "originalCurrency": "CNY",
  "fxRateToUsd": 0.14,
  "fxRateDate": "2026-10-22",
  "fxRateSource": "mock-contract-example",
  "amount": 14,
  "currency": "USD",
  "confirmedAt": "2026-10-21T16:30:00Z",
  "reviewStatus": "approved",
  "costStatus": "confirmed"
}
```


### FopFreightCandidate


仅可信FOP provider内部候选契约，不是HTTP输入或公开响应。先做主体、租户、独立成本授权和业务范围交集，再序列化公开字段。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 发运单稳定ID；当前成本快照唯一键，独立allowlist授权键；重复ID拒收。 | minLength=1 |
| `documentNumber` | string | 是 | 发运单billno，非订单号。 | minLength=1 |
| `orderNumber` | string | 是 | hzkj_order_no对应源履约订单号；同一订单可有多条发运单成本。 | minLength=1 |
| `trackingNumber` | string / null | 是 | 源hzkj_logistics_orderno物流订单号；可空；具体跟踪号语义待真实接口确认。 | minLength=1 |
| `carrierCode` | FreightCarrier | 是 | 见引用模型/接口说明 | — |
| `carrierName` | string | 是 | 真实服务商展示名称。 | minLength=1 |
| `channelName` | string | 是 | 发运单实际物流渠道名称。 | minLength=1 |
| `warehouseCode` | string | 是 | 实际发运仓库，未知拒收。 | enum=["HZ", "SZ"] |
| `warehouse` | string | 是 | 实际发运仓库展示名称。 | minLength=1 |
| `customerId` | string | 是 | 稳定客户ID。 | minLength=1 |
| `customerCode` | string | 是 | 非空客户编码，可信适配器提供；不可用空值替代。 | minLength=1 |
| `customerName` | string | 是 | 客户名称。 | minLength=1 |
| `organization` | NamedEntity | 否 | 发运单组织；可信源提供。 | — |
| `department` | NamedEntity | 否 | 成本归属部门；部门权限不得由浏览器提供。 | — |
| `owner` | NamedEntity | 否 | 发运单业务员稳定ID及名称。 | — |
| `salesDepartmentCode` | SalesDepartment | 否 | 见引用模型/接口说明 | — |
| `originalAmount` | number | 是 | hzkj_actual_freight原币实际成本，至多两位小数的安全分币；非客户收费或预估价。公开有效明细为正数。 | minimum=0; maximum=90071992547409.9 |
| `originalCurrency` | string | 是 | hzkj_textfield1明确原币种，标准大写三字母代码；不得统一假定CNY。 | pattern="^[A-Z]{3}$" |
| `fxRateToUsd` | number | 是 | 每1单位原币折合USD；必须显式、有限且>0，USD原币必须1。 | exclusiveMinimum=0 |
| `fxRateDate` | string (date) | 是 | 该条成本采用的汇率业务日期；不是响应生成日期的隐式替代。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `fxRateSource` | string | 是 | 可追溯的汇率来源；Mock来源不能用于生产。 | minLength=1 |
| `amount` | number | 是 | USD成本=originalAmount×fxRateToUsd，按十进制精确乘法HALF_UP到分（1.50×0.15=0.23），不先做二进制浮点乘法再round。后端验证一致性、安全分币和累计安全性；缺汇率、不一致或超过两位小数的原额/结果拒收。 | minimum=0; maximum=90071992547409.9 |
| `currency` | "USD" | 是 | 统一分析与展示币种。 | — |
| `confirmedAt` | string / null | 是 | hzkj_actual_freight_time，带时区的实际运费确认时刻；UTC+8归期。公开有效明细必须非空且已发生；不是最终结账或银行付款证明。 | — |
| `reviewStatus` | string | 是 | 发运单审核；billstatus=C映射approved。 | enum=["approved", "pending"] |
| `costStatus` | string | 是 | 适配器归一成本确认状态；不能宣称源存在同名枚举。 | enum=["confirmed", "pending"] |
| `tenantId` | string | 是 | 成本源所属租户，必须与绑定主体匹配。 | minLength=1 |
| `departmentPathIds` | string[] | 否 | 部门及子部门范围检查；不得由浏览器传入。 | uniqueItems=true |

组合规则 `allOf`：`见 schema`。完整约束见 OpenAPI JSON。


```json
{
  "id": "delivery-example",
  "documentNumber": "DEL-001",
  "orderNumber": "ORDER-001",
  "trackingNumber": "LOG-001",
  "carrierCode": "YT",
  "carrierName": "云途",
  "channelName": "示例实际渠道",
  "warehouseCode": "HZ",
  "warehouse": "杭州仓",
  "customerId": "customer-example",
  "customerCode": "C001",
  "customerName": "示例客户",
  "organization": {
    "id": "org-example",
    "name": "示例组织"
  },
  "department": {
    "id": "department-example",
    "name": "业务一部"
  },
  "owner": {
    "id": "employee-example",
    "name": "示例业务员"
  },
  "salesDepartmentCode": "sales1",
  "originalAmount": 100,
  "originalCurrency": "CNY",
  "fxRateToUsd": 0.14,
  "fxRateDate": "2026-10-22",
  "fxRateSource": "mock-contract-example",
  "amount": 14,
  "currency": "USD",
  "confirmedAt": "2026-10-21T16:30:00Z",
  "reviewStatus": "approved",
  "costStatus": "confirmed",
  "tenantId": "tenant-example",
  "departmentPathIds": [
    "department-example"
  ]
}
```


### FreightPeriod


UTC+8自然周期。响应升序，统计表可倒序；previous范围不是截至同日的同比进度。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 回传下钻的期间ID：月YYYY-MM、周周一YYYY-MM-DD、年YYYY；必须属于当前查询。 | pattern="^\\d{4}(?:-\\d{2}(?:-\\d{2})?)?$" |
| `label` | string | 是 | 期间展示文本。 | — |
| `from` | string (date) | 是 | 本期起日，UTC+8，含当日。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `to` | string (date) | 是 | 本期统计末日，UTC+8，含当日；未结束周期截到当前业务日期，不晚于今天。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `partial` | boolean | 是 | 本期自然周期尚未结束，含周期末当天；to截到今天。当前累计金额与完整上期比较，应醒目标识，不能当已关账或同期进度。 | — |
| `previousFrom` | string (date) | 是 | 完整上一自然周期起日，可能跨年或早于2020。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `previousTo` | string (date) | 是 | 完整上一自然周期末日。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |


### FreightValue


环比指标；总计按合计金额与合计基数重新计算比例，不相加百分比。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `amount` | number | 是 | 本期获授权有效USD实际成本。 | minimum=0; maximum=90071992547409.9 |
| `previousAmount` | number | 是 | 完整上期同仓库/服务商和权限范围USD成本。 | minimum=0; maximum=90071992547409.9 |
| `delta` | number | 是 | 本期减上期的USD差额，可为负。 | — |
| `percent` | number / null | 是 | delta/abs(previousAmount)×100，25表示25%；上期0且本期>0为null，双0为0；不输出Infinity/NaN。 | — |


```json
{
  "amount": 14,
  "previousAmount": 10,
  "delta": 4,
  "percent": 40
}
```


### FreightSeries


固定合计在前；无服务商过滤时随后为YT/4PX/WB/YW/JS/OTHER。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | total 或 carrier:YT 等稳定系列ID；下钻使用carrierCode而非把系列ID当权限。 | pattern="^(total&#124;carrier:(YT&#124;4PX&#124;WB&#124;YW&#124;JS&#124;OTHER))$" |
| `label` | string | 是 | 合计或服务商展示名称。 | — |
| `kind` | string | 是 | total汇总，detail单服务商；两者并列展示但不能重复累加。 | enum=["total", "detail"] |
| `carrierCode` | FreightCarrier | 否 | detail时存在；total省略。 | — |
| `totals` | FreightValue | 是 | 显示期间金额之和及各期完整上期基数之和。 | — |
| `values` | FreightValue[] | 是 | 与periods严格等长同下标。 | — |
| `billCount` | integer | 是 | 本系列显示期间的有效发运单数，不是履约订单数。 | minimum=0 |

组合规则 `allOf`：`见 schema`。完整约束见 OpenAPI JSON。


### FreightData


当前用户独立成本授权内的运费聚合。缺freight scope=403；空/缺失allowedFreightIds=各期0值空范围。source=mock明确演示；真实FOP网络适配未完成。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `source` | DataSource | 是 | 见引用模型/接口说明 | — |
| `query` | FreightQuery | 是 | 见引用模型/接口说明 | — |
| `timeZone` | "UTC+8" | 是 | 统计时区。 | — |
| `currency` | "USD" | 是 | 分析目标币种。 | — |
| `dateBasis` | "freight_confirmed_at" | 是 | 明确采用实际运费确认时间。 | — |
| `asOf` | string (date-time) | 是 | 响应计算时刻，非源更新时间、最终账单或一致性快照。 | — |
| `periods` | FreightPeriod[] | 是 | 升序周期数组。 | — |
| `series` | FreightSeries[] | 是 | 合计及服务商并列系列。 | minItems=2; maxItems=7 |
| `totals` | FreightValue | 是 | 与series[kind=total].totals一致。 | — |
| `billCount` | integer | 是 | 显示期间有效发运单总数，不重复加各系列。 | minimum=0 |


```json
{
  "source": "mock",
  "query": {
    "grain": "year",
    "year": 2026,
    "warehouse": "ALL",
    "carrierCode": "YT"
  },
  "timeZone": "UTC+8",
  "currency": "USD",
  "dateBasis": "freight_confirmed_at",
  "asOf": "2026-10-22T04:00:00Z",
  "periods": [
    {
      "id": "2022",
      "label": "2022年",
      "from": "2022-01-01",
      "to": "2022-12-31",
      "partial": false,
      "previousFrom": "2021-01-01",
      "previousTo": "2021-12-31"
    },
    {
      "id": "2023",
      "label": "2023年",
      "from": "2023-01-01",
      "to": "2023-12-31",
      "partial": false,
      "previousFrom": "2022-01-01",
      "previousTo": "2022-12-31"
    },
    {
      "id": "2024",
      "label": "2024年",
      "from": "2024-01-01",
      "to": "2024-12-31",
      "partial": false,
      "previousFrom": "2023-01-01",
      "previousTo": "2023-12-31"
    },
    {
      "id": "2025",
      "label": "2025年",
      "from": "2025-01-01",
      "to": "2025-12-31",
      "partial": false,
      "previousFrom": "2024-01-01",
      "previousTo": "2024-12-31"
    },
    {
      "id": "2026",
      "label": "2026年",
      "from": "2026-01-01",
      "to": "2026-10-22",
      "partial": true,
      "previousFrom": "2025-01-01",
      "previousTo": "2025-12-31"
    }
  ],
  "series": [
    {
      "id": "total",
      "label": "合计",
      "kind": "total",
      "totals": {
        "amount": 24,
        "previousAmount": 10,
        "delta": 14,
        "percent": 140
      },
      "values": [
        {
          "amount": 0,
          "previousAmount": 0,
          "delta": 0,
          "percent": 0
        },
        {
          "amount": 0,
          "previousAmount": 0,
          "delta": 0,
          "percent": 0
        },
        {
          "amount": 0,
          "previousAmount": 0,
          "delta": 0,
          "percent": 0
        },
        {
          "amount": 10,
          "previousAmount": 0,
          "delta": 10,
          "percent": null
        },
        {
          "amount": 14,
          "previousAmount": 10,
          "delta": 4,
          "percent": 40
        }
      ],
      "billCount": 2
    },
    {
      "id": "carrier:YT",
      "label": "云途YT",
      "kind": "detail",
      "carrierCode": "YT",
      "totals": {
        "amount": 24,
        "previousAmount": 10,
        "delta": 14,
        "percent": 140
      },
      "values": [
        {
          "amount": 0,
          "previousAmount": 0,
          "delta": 0,
          "percent": 0
        },
        {
          "amount": 0,
          "previousAmount": 0,
          "delta": 0,
          "percent": 0
        },
        {
          "amount": 0,
          "previousAmount": 0,
          "delta": 0,
          "percent": 0
        },
        {
          "amount": 10,
          "previousAmount": 0,
          "delta": 10,
          "percent": null
        },
        {
          "amount": 14,
          "previousAmount": 10,
          "delta": 4,
          "percent": 40
        }
      ],
      "billCount": 2
    }
  ],
  "totals": {
    "amount": 24,
    "previousAmount": 10,
    "delta": 14,
    "percent": 140
  },
  "billCount": 2
}
```


### FreightDetailsQuery


已解析运费明细查询。HTTP请求warehouse/page/pageSize可省略并取默认；periodId需与基础查询匹配。query非公开响应字段，此模型用于字段字典。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `grain` | FreightGrain | 是 | 见引用模型/接口说明 | — |
| `year` | integer | 是 | 2020至UTC+8当前年；未来年拒绝。周锚点必须属于所选年。 | minimum=2020; maximum=9999 |
| `weekOf` | string (date) | 否 | 仅week可传；不传时当年默认UTC+8今天、历史年默认12月31日。必须属于year且不晚于今天；响应回显解析后的锚点。非week传入则400。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `warehouse` | string | 是 | ALL=全仓，HZ=杭州仓，SZ=深圳仓；服务端授权范围内过滤，不扩大权限。 | enum=["ALL", "HZ", "SZ"]; default="ALL" |
| `carrierCode` | FreightCarrier | 否 | 省略返回合计及固定六类服务商；指定时返回合计及该服务商。 | — |
| `periodId` | string | 否 | 仅选择当前查询返回的一期；省略覆盖所有显示期；不能使用任意日期扩大范围。 | pattern="^\\d{4}(?:-\\d{2}(?:-\\d{2})?)?$" |
| `comparisonPeriod` | string | 否 | current为本期（默认）；previous为对应完整上一期；省略periodId时选择全部显示期对应的上期并集，重复日期不重复计费。 | enum=["current", "previous"]; default="current" |
| `workbenchRole` | WorkbenchRole | 是 | 必须是当前账户可访问岗位，单据明细在工作台展示。 | — |
| `page` | integer | 是 | 页码。 | default=1; minimum=1; maximum=1000000 |
| `pageSize` | integer | 是 | 每页条数。 | default=20; minimum=1; maximum=100 |


### FreightTotals


分页前成本合计；不改变分页条件时切页不改变totals。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `billCount` | integer | 是 | 完整筛选范围发运单数，等于FreightPage.total。 | minimum=0 |
| `amount` | number | 是 | 完整筛选范围USD折算成本，非当前页小计。 | minimum=0; maximum=90071992547409.9 |
| `originalAmounts` | object[] | 是 | 完整筛选范围原币分组；空范围为空数组。 | — |
| `originalAmounts[].currency` | string | 是 | 原币种。 | pattern="^[A-Z]{3}$" |
| `originalAmounts[].amount` | number | 是 | 该币种原币金额合计。 | minimum=0; maximum=90071992547409.9 |


### FreightPage


独立成本授权加岗位权限；total/totals分页前计算，越界页items=[]且合计保留；不公开tenantId/departmentPathIds。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `source` | DataSource | 是 | 见引用模型/接口说明 | — |
| `timeZone` | "UTC+8" | 是 | 统计时区。 | — |
| `currency` | "USD" | 是 | 目标币种。 | — |
| `dateBasis` | "freight_confirmed_at" | 是 | 日期口径。 | — |
| `total` | integer | 是 | 完整筛选范围的发运单数。 | minimum=0 |
| `page` | integer | 是 | 页码。 | minimum=1; maximum=1000000 |
| `pageSize` | integer | 是 | 页容量。 | minimum=1; maximum=100 |
| `items` | FopFreight allOf 见 schema[] | 是 | 当前页公开已审核、已确认、正运费且确认时刻已发生的发运单，确认时间倒序、ID稳定排序。 | — |
| `totals` | FreightTotals | 是 | 见引用模型/接口说明 | — |
| `range` | object | 是 | 请求实际选择的周期范围；并集由有效查询周期推导。 | additionalProperties=false |
| `range.from` | string (date) | 是 | 选定本期或上期并集的起始日，UTC+8，含首日。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `range.to` | string (date) | 是 | 选定周期并集末日，含末日；current未完期截到UTC+8今天，previous使用完整上期末日。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |


```json
{
  "source": "mock",
  "timeZone": "UTC+8",
  "currency": "USD",
  "dateBasis": "freight_confirmed_at",
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "items": [
    {
      "id": "delivery-example",
      "documentNumber": "DEL-001",
      "orderNumber": "ORDER-001",
      "trackingNumber": "LOG-001",
      "carrierCode": "YT",
      "carrierName": "云途",
      "channelName": "示例实际渠道",
      "warehouseCode": "HZ",
      "warehouse": "杭州仓",
      "customerId": "customer-example",
      "customerCode": "C001",
      "customerName": "示例客户",
      "organization": {
        "id": "org-example",
        "name": "示例组织"
      },
      "department": {
        "id": "department-example",
        "name": "业务一部"
      },
      "owner": {
        "id": "employee-example",
        "name": "示例业务员"
      },
      "salesDepartmentCode": "sales1",
      "originalAmount": 100,
      "originalCurrency": "CNY",
      "fxRateToUsd": 0.14,
      "fxRateDate": "2026-10-22",
      "fxRateSource": "mock-contract-example",
      "amount": 14,
      "currency": "USD",
      "confirmedAt": "2026-10-21T16:30:00Z",
      "reviewStatus": "approved",
      "costStatus": "confirmed"
    }
  ],
  "totals": {
    "billCount": 1,
    "amount": 14,
    "originalAmounts": [
      {
        "currency": "CNY",
        "amount": 100
      }
    ]
  },
  "range": {
    "from": "2026-10-01",
    "to": "2026-10-22"
  }
}
```


### FopFreightAuthorization


仅内部FopPermissionGrant中与成本有关的投影，不是新的HTTP端点或客户端可写权限。仍须与租户、本地业务范围及当前岗位授权求交，并复查请求中途授权变更。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `subject` | object | 是 | 可信provider解析主体，必须与服务端绑定完全匹配。 | additionalProperties=false |
| `subject.tenantId` | string | 是 | 绑定租户。 | minLength=1 |
| `subject.userId` | string | 是 | 绑定FOP用户。 | minLength=1 |
| `allowedFreightIds` | string[] | 否 | 独立成本白名单，缺失或空为无运费记录；不能从allowedOrderIds/allowedReceiptIds推导。 | uniqueItems=true |
| `analyticsScopes` | string[] | 否 | 运费两个端点均要求包含freight；缺失/不包含返回403。 | uniqueItems=true |


## 10. 前端功能诊断与复现证据


诊断日期：2026-10-22。范围：`work-app/frontend` 全部 ECharts 实例、调用组件、直接相关 API 客户端、统计工具、路由、权限与测试。本文源码路径均相对于 `work-app/`。原诊断行号保留作历史定位；方案2修改后应以当前函数／组件名定位，最终验证见 VERIFICATION.md。

原始诊断为只读；本轮按方案2更新了收款口径、来源拆分和工作台下钻，并修复 FE-01/FE-02。本文历史测试只证明当时结果，不能代替本轮验证。没有访问生产 FOP。结论区分“源码已实现”“本地测试已验证”“未实现”“生产待验证”，不能将 mock/stub 测试等同于真实浏览器或生产验收。

### 1. 覆盖范围与结论

全量搜索 `echarts`、`EChart`、`dataZoom`、`toolbox` 确认：只有 **1 个 ECharts 初始化包装器、3 个业务调用文件、6 处 `<EChart>` 模板调用点、9 类面向用户的逻辑图表**。没有发现另外的原生 `echarts.init` 实例、饼图、地图或独立第三方图表包装器。

- 包装器：`frontend/src/components/charts/EChart.vue:3`、`:60`。
- 业务调用：`frontend/src/views/autoflow/FopDashboardView.vue:222`、`:247`、`:257`；`frontend/src/components/order-volume/OrderVolumeResults.vue:67`、`:68`；`frontend/src/components/order-volume/CustomerOrderResults.vue:103`。
- 依赖声明：`frontend/package.json:28` 为 `echarts: ^6.1.0`；构建对 ECharts 和 zrender 分块：`frontend/vite.config.ts:31`。依赖声明范围不等同于生产部署版本。
- 入口：`/dashboard` 显示全部分析；`/workbench/:role?queue=order-analysis` 复用业务订单和客户订单两组分析。证据：`frontend/src/router/index.ts:28`、`:34`；`frontend/src/views/autoflow/WorkbenchView.vue:47`；`frontend/src/views/autoflow/FopDashboardView.vue:261`。

已有回款环比、合计、客户数量与金额并列、Top 10 + 其他、分仓、订单下钻、原生弹窗、暗色主题与响应式布局。原诊断证实的 **P2 日期标注和 P3 重复请求问题现已修复**，原证据保留于第 7 节。未发现可据本次前端证据认定的 P0/P1 问题；这不构成生产授权或财务口径正确性的证明。

### 2. 图表逐项盘点

| ID / 图表 | 组件、数据及系列 | 筛选与统计口径 | 交互与状态 |
|---|---|---|---|
| G01 每日注册会员趋势 | `FopDashboardView.vue:140`；`registrations[].date/count` 构成横轴/营销中心合计，`registrationDepartments[].counts/salespeople[].counts` 构成部门或业务员系列 | 日期 `from/to` 调 API；“营销中心/部门”只切换已返回的授权系列。营销中心视图为总计与部门平级；部门视图为部门总计与业务员平级；标题合计只取第一条系列，避免重复相加（`:45`、`:55`） | 平滑折线、滚动图例、轴 tooltip、无 dataZoom；唯一配置 SVG 下载的图表（`:145`）。无图形下钻。授权/空数据文案与明细表见 `:222`、`:225` |
| G02 部门月度回款 | `FopDashboardView.vue:188`；`receipts.marketingCenter`（可选）与 `departments[]` 并列柱形 | `year` 调 API；金额统一 USD。年度 KPI 只累加 departments.amounts；不把营销中心总计再次加入。可切换“上月环比”（`:56`、`:61`、`:244`） | 月序轴、滚动图例、最新 6 个月固定宽度滑窗、tooltip、绝对额/差额柱形及零基准线；明细按月份倒序；月份／系列点击进入工作台收款明细；无导出按钮（`:151`、`:164`、`:248`） |
| G03 业务员月度回款 | `FopDashboardView.vue:189`；所选部门合计及该部门 `salespeople[]` | 与 G02 共用年度请求；部门切换在客户端完成；部门合计与个人并列，不堆叠、不重复相加。单独 MoM 开关（`:69`、`:75`、`:253`） | 最新 6 月固定滑窗；与 G02 不联动滑窗。月份／业务员可下钻独立收款明细；无业务员时仍可展示部门合计并附“暂无业务员”提示（`:257`、`:258`）；明细默认展开，启用 MoM 自动展开 |
| G04 业务订单量趋势（可分仓） | `OrderVolumeResults.vue:28`；所有 `series[].values` 或 `warehouses[code]` | 类别 carrier/organization/salesperson；month/week/day；year、month、weekOf、department、objectId、warehouse。`kind=total` 总计折线，月度明细柱形，周/日明细折线（`:37`） | 月最新 6 期、日最新 14 个已发生日、周 4 期；图例；点击非未来点以 seriesId/periodId/warehouse 下钻。分仓时独立 HZ/SZ 图，有未分配量才增加第三图，共用最大 Y 轴、联动滑窗（`:24`、`:27`、`:48`、`:59`） |
| G05 业务订单量区间对比/服务商分布 | `OrderVolumeResults.vue:41`；`series.filter(kind !== total)`，横向柱形 `series.total` | 完整查询周期，不随趋势滑窗重算；保留 API 返回顺序；carrier 文案为固定顺序，其他类别为区间对比 | 图形点击按该行 id 下钻，省略 periodId；分仓模式由 CSS 隐藏排名，保留趋势与表格（`order-volume.css:1`）；无独立导出 |
| G06 客户订单量 Top 10 + 其他 | `CustomerOrderResults.vue:48`、`:103`，`rankingOnly=true, metric=orders` | customer 类别，明确 `from/to` 含首尾日期；department、warehouse；按 API 给出的数量 Top 10 集合及顺序显示，前端不再次排序或选 Top 10（`:21`、`:106`） | 横向柱形；分仓时同一客户行显示 HZ/SZ/可选未分配多柱。点击真实客户进入单客户趋势弹窗；点击 other/unassigned 下钻订单（`:75`）。同名客户显示 code |
| G07 客户回款业绩对比 | 与 G06 同一组件，`metric=amount`；`series[].amounts.total/warehouses` | **沿用数量 Top 10 客户集合与顺序，不是金额 Top 10**；USD 两位小数。非 USD 收款分录数由兼容字段 `excludedOrderCount` 提示；数量来自履约账本（`:98`、`:106`） | 与数量图并列；分仓组与客户顺序一致；金额柱和金额单元格进入客户同一集合的 USD 收款明细；数量入口仍进入履约订单 |
| G08 单客户每日订单量趋势 | `CustomerOrderResults.vue:63`，弹窗中 `rankingOnly=false, metric=orders`；只用 `kind=total` 的 values/warehouses | 新请求继承已应用的日期、部门、仓库，并新增 customerId。默认最近 14 天；无 MoM | 折线；分仓为同一图中的仓库系列；与金额图滑窗联动；点击非未来点以 `seriesId=total, periodId, detailWarehouse?` 下钻（`:83`、`:86`） |
| G09 单客户每日回款业绩趋势 | 同 G08，`metric=amount`；`total.amounts.values/warehouses` | 同一客户集合、同一日期／仓库映射；金额来自独立授权 USD 收款分录，包含全款备货 | 金额轴与数量轴独立，只有时间窗口同步；表格显示每日数量与金额并按日期倒序；缺失 amounts 显示 `—`，不伪造 0（`:31`、`:35`、`:119`） |
| G10 物流实际运费并列柱状 | `FreightAnalysis.vue` / `FreightResults.vue`，独立 `GET /freight`；periods、合计与YT/4PX/WB/YW/JS/OTHER的FreightValue系列 | month/week/year、year、weekOf、warehouse；已审核且已确认正成本，按UTC+8确认时间归期；USD目标币种 | 总计独立，不重复相加；未完期partial提示；完整上期环比；统计表倒序、固定列宽，开启环比展开、关闭保持；仅拖动滑块改横轴 |
| G11 单物流服务商趋势弹窗 | `FreightTrendDialog.vue`，复用已返回响应，按选中carrierCode筛出单商；接口另支持carrierCode查询 | 继承已应用时间/仓库，0基期比例为null或0，前端不自造百分比 | 居中弹窗；原始成本从柱/表下钻当前可访问岗位工作台，展示原币、汇率与USD；分页前合计 |

表内短文件名的完整路径分别为 `frontend/src/views/autoflow/FopDashboardView.vue`、`frontend/src/components/order-volume/OrderVolumeResults.vue`、`frontend/src/components/order-volume/CustomerOrderResults.vue`、`frontend/src/components/order-volume/order-volume.css`。

### 3. API 字段级消费契约

公共 HTTP 客户端使用 `baseURL=/api`、cookie 凭证、30 秒超时，并直接返回 `response.data`，没有额外 `data` 包装层；会丢弃旧会话响应。证据：`frontend/src/api/index.ts:17`、`:31`。以下路径包含 `/api` 前缀。

#### 3.1 Dashboard：GET `/api/autoflow/integrations/fop/dashboard`

契约类型：`frontend/src/api/fop-dashboard.ts:2`；请求与校验：`:20`、`:28`。

| 请求字段 | 前端行为 / API 必须保持的含义 |
|---|---|
| `from`, `to` | `YYYY-MM-DD`；严格日历合法性；from ≤ to；结束不晚于 UTC+8 今天；两日差 ≤365（即最多 366 个含首尾日期）。日期用于注册趋势。表单默认 UTC+8 最近 7 天 |
| `year` | 整数，2020 至 UTC+8 当前年；UI 只列最近 5 年。年份用于回款，日期不应改变回款口径 |
| 用户身份 / scope | 客户端此请求只显式取出 from/to/year，额外 userId 等不随请求发送。授权由后端确定；不能把统计部门选择当成授权边界 |
| 响应字段 | 图表 / UI 消费方式与约束 |
|---|---|
| `source: mock\|fop` | 顶部 MOCK/用户范围标识；不决定授权 |
| `updatedAt: string` | 数据更新时间；客户端 `Date` 解析，按 UTC+8 显示 |
| `registrations[].date`, `.count` | X 轴原始日期及营销中心每日数量；前端依 API 顺序显示，不排序 |
| `registrationDepartments[]`（可选）`.id/.name/.counts` | 部门选择值、展示名、与 registrations 一一对应的每日数组 |
| `.salespeople[].id/.name/.counts` | 所选部门的业务员曲线；counts 同样按 registrations 下标对齐 |
| `receipts.currency` | 类型限制为 USD；显示层直接用 USD 格式，不做汇率换算 |
| `receipts.basis/timeZone` | 后端必有 actual_received／UTC+8，前端旧类型兼容可选不表示新服务端可省略；说明实际结算口径，不是银行现金流水 |
| `ReceiptSeries.breakdown/previousBreakdown` | 履约、全款备货来源金额分别展示；每月两来源之和等于 amounts，上年12月拆分与 previousAmount 对应 |
| `receipts.months[]` | `YYYY-MM` 时间轴；图表使用原顺序，明细独立倒序但保留原下标。应升序、无重复、与全部金额数组等长；最新摘要直接取 `.at(-1)` |
| `receipts.previousMonth`（可选） | 首月环比的基线月份；例如 2026-01 的有效基线必须是 2025-12，不接受其他月份冒充 |
| `receipts.marketingCenter`（可选/null）`.id/.name/.amounts/.previousAmount` | 部门图的总计系列；name 可省略；previousAmount 可省略或 null 表示基线未知，不等于 0 |
| `receipts.departments[].id/.name/.amounts/.previousAmount` | 部门图、年度 KPI、部门选择及环比；name 缺失时回退 sales1–sales4 的本地名称或 id |
| `receipts.departments[].salespeople[]` `.id/.name/.amounts/.previousAmount` | 业务员图与明细；按同一 months 下标对齐 |
| `queues.review/allocation/dispatch/shipping` | 非 ECharts，但同一个响应中用于履约卡片；不能因图表日期/年份误改队列快照 |
| `exceptions[].id/customer/reason/hours`, `tasks[].id/kind/count/time/priority` | 订单异常与待办列表，同响应依赖 |
| `rates[]` `.currency/.cnyPerUnit` | 类型保留，但当前 Dashboard 模板/图表未消费，不应为了图表前端臆造汇率展示需求 |

`registrations`、`receipts`、`departments` 等必需集合缺失会使消费组件访问失败；当前前端没有运行时 schema 校验。数组错位、排序错误或后端 scope 错误不会被 TypeScript 在运行时兜底；这是联调契约要求，不代表已观察到生产坏数据。渲染中局部 `?? 0` 不能作为服务端遗漏值可以当零的协议。

#### 3.2 订单聚合：GET `/api/autoflow/integrations/fop/order-volume`

类型与传输：`frontend/src/api/fop-order-volume.ts:4`、`:7`、`:19`、`:28`。查询生成：`frontend/src/components/order-volume/OrderVolumeAnalysis.vue:37`。

| 请求字段 | 前端发送条件 |
|---|---|
| `category` | 必需；carrier / organization / salesperson / customer |
| `grain` | 业务分析发送 month/week/day；客户日期模式不发送 |
| `year` | 业务分析总是携带；周模式 UI 隐藏年份但对象仍携带。周范围应以 weekOf 定义，而不是把此 year 当另一道冲突过滤 |
| `month` | 仅业务 grain=day 发送 1–12 |
| `weekOf` | 仅业务 grain=week 发送 YYYY-MM-DD；页面文案为“所选周及前三周” |
| `from`, `to` | 仅客户模式发送已应用范围；min=2020-01-01、结束不晚于 UTC+8 今天；日期编辑需“查询”才更新 appliedRange。此处前端未限定最大跨度 |
| `department` | 非空才发送；切换会清空 objectId、搜索结果和选中客户 |
| `objectId` | 非空才发送；carrier 或 salesperson 明细对象；选项来自 API |
| `customerId` | 仅打开单客户弹窗时叠加；排名请求不带此字段 |
| `warehouse` | 始终发送 ALL / HZ / SZ / UNASSIGNED |
| `split` | **不发送**；分仓只是利用一次响应中的 warehouses 重新呈现；非 ALL 时禁用 |
| 响应字段 | 必需消费点 |
|---|---|
| `source` | mock 徽标 |
| `query` | API 实际应用的规范化查询；下钻使用 result.query，不从 UI 临时输入重建（`OrderVolumeAnalysis.vue:109`） |
| `timeZone` | 协议值及界面统一 UTC+8；日期格式化使用固定 +08:00 对应的运行时时区，其他业务时区未实现 |
| `asOf` | 可解析时间戳；更新时间 |
| `total` | 获授权且满足条件的订单总量；KPI、空态判断、数量份额分母 |
| `customerCount` | 涉及客户数；前端不从 Top 10 行数推算 |
| `periods[].id/.label/.from/.to/.future` | 对齐序列、展示标签、区间摘要、下钻 periodId；future 点禁用下钻；需升序且未来周期在尾部 |
| `series[].id/.label/.kind` | 稳定 id 用于颜色/下钻，label 用于图例，kind=total/detail/other/unassigned 决定总计与明细语义 |
| `series[].entityId/.code`（可选） | 客户 kind=detail 需 entityId 才能开趋势；code 区分同名客户 |
| `series[].total/.values` | 完整查询期数量和按 periods 下标对齐的 number/null 数组；null 用于未来/未知，不等于 0 |
| `series[].warehouses.HZ/SZ/UNASSIGNED` | 三个数组均需存在并与 periods 对齐。前端依此分仓、合计、显示未分配组 |
| `series[].amounts.currency/total/values/warehouses/excludedOrderCount`（可选） | 客户金额必须有同一组 periods/warehouse 映射；currency 类型为 USD。缺少 amounts 时金额显示 `—`。仅总计系列的 excludedOrderCount 用于整体提示 |
| `series[].amounts.breakdown` | fulfillment／fullPaymentStock 两项为该客户集合完整期间的实收来源；金额点击调用收款明细。没有 receipts scope 时不显示金额图，提示金额不可查看，不伪造 0 |
| `options.departments[].id/.label` | 当前 scope 可查询部门；前端不会再验证这些选项是否越权 |
| `options.objects[].id/.label` | 当前类别/部门的可查询对象；无客户端硬编码业务员名单 |

当前 API 客户端直接传递 query，未像 Dashboard 一样在 API 函数内验证日期、页码或枚举。业务表单有基本约束，**服务端必须独立校验**，不能依赖 TypeScript 类型或 `<input>` 限制。上述结论是职责边界，不是发现越权。

前端保留 UNASSIGNED 数组／渲染分支用于兼容旧合同；当前有效已审核履约与收款只接受 HZ/SZ，正常 UNASSIGNED 为0。未知／缺失的已审核仓库或物流在服务端按契约错误拒收，不能把兼容分支当作新业务类别。

#### 3.3 客户搜索：GET `/api/autoflow/integrations/fop/order-volume/customers`

请求 `{ keyword, department?, page, pageSize:10 }`；keyword trim 后必须非空，输入最长 100 字符。结果 `{ source, items:[{id,code,name,departments:string[]}],total,page,pageSize }`。只有“编码不区分大小写完全匹配、items 中恰好一个匹配且 total=1”才自动选中；名称匹配仍点候选。搜索不传日期或仓库，因此可找到当前订单范围为零的获授权客户。证据：`OrderVolumeAnalysis.vue:83`、`:89`、`:92`、`:145`；完整类型 `frontend/src/api/fop-order-volume.ts:24`。

#### 3.4 下钻：GET `/api/autoflow/integrations/fop/order-volume/orders`

请求继承聚合 `query`，新增 `workbenchRole`、可选 `seriesId/periodId/detailWarehouse`、`page/pageSize`（默认 1/20）。下钻路由为 `RoleWorkbench`，query 带 `queue=order-volume`；从 Dashboard 下钻先刷新岗位权限并取首个可用角色，从岗位页下钻沿用当前角色。证据：`OrderVolumeAnalysis.vue:99`；`frontend/src/views/autoflow/OrderVolumeOrdersView.vue:25`。

响应是 `FopOrderPage`，不是新造的图表明细格式：`source,items,total,totals,page,pageSize`。当前表格消费 `items[].id/orderNumber/shopifyOrderNumber/customerName/customerCode/items[].sku/name/imageUrl/variant/quantity/paymentStatus/amount/currency/organization.name/department.name/owner.name/salesperson/warehouse/carrier/paidAt/createdAt`；金额 totals 是全部筛选结果的 `{orderCount,itemQuantity,amountsByCurrency:[{currency,amount}]}`，不得仅返回当前页合计。证据：`frontend/src/api/fop-orders.ts:3`、`:11`、`:52`；`OrderVolumeOrdersView.vue:49`。

数量下钻仍调用订单明细，订单 totals 是订单金额。金额下钻改为 `/api/autoflow/integrations/fop/order-volume/receipts`，继承客户查询、seriesId/periodId/detailWarehouse，返回同一数量 Top10／other 客户集合中的有效 USD 收款分录。分仓和期间筛选不重新排名；收款 totals.amount 与图表实收口径一致，不能用订单金额替代对账。

### 4. 统计口径、金额与合计

Dashboard 金额下钻请求 `/api/autoflow/integrations/fop/receipts`，由月份产生 UTC+8 的 from/to；当前月截止今天，带 department／ownerId 及授权 workbenchRole。工作台 `FopReceiptsView.vue` 接收 `queue=receipts`，客户模式调用同集合端点 `/order-volume/receipts`，Dashboard 模式调用 `/receipts`。页面展示来源、源单号、客户／编码、SKU、实收、单据金额、手续费、部门／业务员、仓库、物流与支付时间；全款备货物流明确“不适用”。

收款页 totals 是完整筛选合计，不按当前页推算；sourceType 筛选仅在 Dashboard 明细模式提供。权限失败、切账号和迟到响应不能沿用旧明细。独立分录资源需 receipts scope 与 allowedReceiptIds，订单授权不能推导金额权限。源单已支付且已审核、收款单已审核后才纳入；押金备货／样品不纳入。使用预付全款库存不补回产品款。订单数为0但有全款备货回款的客户必须显示并可查询。

| 检查点 | 当前实现与证据 | 边界 |
|---|---|---|
| 订单纳入范围 | 页面明确“获授权、有支付时间、已支付且已审核的履约订单，排除已取消及全额退款”，支付日期按UTC+8；`OrderVolumeAnalysis.vue:137` | 前端不重新扫描原始订单以证明过滤；实际支付/取消/退款/权限含义须在服务端与 FOP 数据验收 |
| 数量 Top 10 + 其他 | 两个客户指标共用 `series.filter(kind !== total)` 及相同 yAxis；`CustomerOrderResults.vue:21`、`:55`、`:106` | Top 10 选取、并列排序、other/unassigned 分组由后端完成；不能根据前端标签认定服务端算法正确 |
| 不重复累加 | 注册 KPI 取第一条总计；回款 KPI 只加 departments；订单 KPI 取 data.total；客户金额 KPI 取 kind=total.amounts.total | 总计与明细同时画出用于比较；图例隐藏系列不会重算 KPI/份额；服务端须保证 total 与明细/仓库可对账 |
| 金额精度 | USD 显示 2 位小数；`sumMoney` 对每个数先转换分再累加；`frontend/src/utils/tableTotals.ts:2`、`frontend/src/utils/currency.ts:12` | 非统一汇率转换。统计金额已由 API 汇总；前端不计算交易历史汇率 |
| 单月环比 | 用“上一个日历月”，不是简单取数组前一项；delta=本月−上月；实现比例=delta/abs(previous)×100；`frontend/src/utils/receiptChanges.ts:6`、`:11` | 页面文案写“÷上月”；现有非负回款条件下一致。若生产允许负基线，应明确 abs 口径；本次未将未证实负回款作为缺陷 |
| 12 月基线 | 1 月仅在 previousMonth 正好是上年 12 月时使用 previousAmount；缺失基线或断月显示“无上月数据” | 不以 0 替代缺失；0→0 为0%；0→非0为“上月为0”，不输出无穷百分比 |
| 环比合计 | 只聚合可比月份；差额合计除对应上月金额合计（实现取绝对分母）；`receiptChanges.ts:20` | 非“各月百分比求和”或“年增长率”；December 基线不计入当年回款 KPI |
| 分仓 | 业务趋势独立图同 Y 最大值；客户排名同客户多柱；客户趋势每指标内多仓库折线；未分配按数量存在性决定是否显示 | 数量/金额两指标各自 Y 轴；排名分仓不重新产生每仓 Top 10；ALL 是查询范围，不是额外仓库系列 |
| 空与未知 | 客户仅在订单 total=0 且实收 total=0 时显示空态；仅备货客户保留金额；未来值 null、金额缺失显示 `—`；未授权错误与合法 0 不合并 | Dashboard 在 loading 时也会因 data 清空显示“暂无”占位，顶部 busy/刷新状态可区分，但没有每图独立骨架 |

### 5. 交互、状态与权限核查

| 能力 | 已实现 / 未实现 / 待验证 |
|---|---|
| 渲染与清理 | 包装器按需注册 Bar/Line、Aria、DataZoom、Grid、Legend、MarkLine、Tooltip、Toolbox、SVGRenderer；`EChart.vue:8`。onMounted init，ResizeObserver + RAF resize，卸载 dispose 并移除窗口指针监听；`:58`、`:74`。真实 SVG 销毁、内存与 resize 压测未做 |
| 滑窗与滚轮 | 包装器会删除 **所有 inside dataZoom**，并强制 slider `brushSelect=false, zoomLock=true`，因此是固定宽度平移而非任意缩放；`:31`。拖动位移≥3px 才接受 datazoom；单击轨道跳转会被回滚；`:39`、`:47`。这是明确设计和现有测试覆盖，不应误报为滚轮缩放故障 |
| 联动 | 业务分仓趋势与客户数量/金额趋势通过暴露的 `zoom()` 静默 dispatchAction，同步窗口且不产生递归事件。回款上下两图没有联动。图例选择也不跨图同步 |
| 图例 | 注册/回款及非 carrier 业务趋势为 scroll；carrier 趋势 plain；客户分仓排名与客户趋势为 plain。采用 ECharts 默认图例显隐行为。没有单独的 legendselectchanged 持久化逻辑 |
| 主题与重新渲染 | 主题为共享 reactive isDark + localStorage；图表 option 随主题改变轴线/网格/文字色。每次 option 更新使用 `notMerge:true`（`EChart.vue:35`），不保存用户图例/滑窗交互状态；主题、语言、模式变更后回到 option 定义的默认窗口是当前行为。实际颜色对比度与视觉重绘未验收 |
| 响应式 | ResizeObserver 已接入；Dashboard 1024/640、订单图 1100/640、客户图 1100 断点；弹窗尺寸 `100dvh`、宽度最大1160，手机边距24；`FopDashboardView.vue:305`、`CustomerOrderResults.vue:143`、`CustomerTrendDialog.vue:47`、`:65`。未跑真实多视口截图 |
| 页面与弹窗滚动 | 页面捕获纵向 wheel 转给外层 main，保留横向/ctrl/meta 手势；`frontend/src/components/layout/AppLayout.vue:27`、`frontend/src/utils/pageWheel.ts:2`。弹窗捕获转给弹窗 body，背景禁止滚动；`CustomerTrendDialog.vue:41`、`:64`。嵌套表格纵向 wheel 不独立滚动是当前策略 |
| 单客户弹窗 | 原生 dialog.showModal；标题、编码、已应用范围；首次可测量后才挂载图表；关闭按钮、Escape、遮罩关闭；还原 opener 焦点；`CustomerTrendDialog.vue:17`、`:24`、`:32`。jsdom 只模拟 showModal，真实焦点陷阱/触屏/原生 top layer 待浏览器验收 |
| 下钻 | 业务点、排名、数量表、客户金额表、分仓单元格与总计均有路由；未来点/日期禁用。注册仍无会员下钻；回款月份／系列以及客户金额均有独立收款下钻。路由详情保留 query，分页只更新 page |
| 返回分析 | 明细“返回分析”执行 router.back；分析筛选保存在组件 ref，未序列化到分析页面 URL，也未使用持久化 store。卸载后返回会重新初始化筛选、窗口和选中状态；不是保留原分析快照的实现 |
| 加载/错误/空 | 订单主面板、客户搜索、客户趋势均有 loading；requestId 阻止旧结果覆盖。主请求错误 reset 清空结果/候选/选中客户并提供重试；Dashboard 请求开始即清旧数据、错误显示权限映射文案。客户 selectedError 分支虽存在，但 loadSelected catch 实际 reset 并赋值外层 error（`OrderVolumeAnalysis.vue:74`、`:148`），所以当前不会在弹窗内显示其局部重试，而会关闭弹窗并清整块结果 |
| 会话与授权 | HTTP 拒绝旧会话响应；App RouterView 以 sessionEpoch 为 key 整体重挂载（`frontend/src/App.vue:6`）；订单组件监听 onSessionReset 清数据（`OrderVolumeAnalysis.vue:112`）。岗位路由实时刷新可用角色（`router/index.ts:154`）。页面展示不是最终授权控制，真实跨用户/跨部门数据隔离仍必须由服务端验收 |
| 数据源 | Dashboard/订单图展示 source=mock 标记；没有前端失败后自动造数 fallback。FOP 未配置/未绑定/无权/服务不可用/绑定变化有明确错误映射（`frontend/src/api/fop-access.ts:16`） |
| 导出 | **仅 G01** 配置 `toolbox.saveAsImage.type=svg`；其余图与分析表无 CSV/XLSX/PDF/PNG/SVG 导出入口，不能借用其他业务的 ExportDialog 认定已支持。SVG 真实下载与中文字体待验证 |
| 无障碍 | 包装器 role=img/aria-label，各 option aria.enabled；弹窗有标题/描述关联，表格链接提供替代下钻；图形本身没有自建键盘漫游/筛选功能。屏幕阅读器实际输出未验证 |

### 6. 历史本地测试证据与盲区

下述为方案2实施前的诊断结果，保留作历史证据；当前修改后的测试与浏览器结果以 VERIFICATION.md 为准。

2026-10-22 在现有依赖下执行以下命令，退出码 **0**，**12 个测试文件 / 58 个用例通过**：

```sh
npm run test --workspace=frontend -- \
  src/tests/FopDashboardView.test.ts \
  src/tests/OrderVolumeAnalysis.test.ts \
  src/tests/OrderVolumeOrdersView.test.ts \
  src/tests/orderVolume.test.ts \
  src/tests/fopDashboard.test.ts \
  src/tests/chart-interaction.test.ts \
  src/tests/receiptChanges.test.ts \
  src/tests/tableTotals.test.ts \
  src/tests/page-wheel.test.ts \
  src/tests/currency.test.ts \
  src/tests/session-isolation.test.ts \
  src/tests/workbench-routing.test.ts
```

| 测试文件 | 直接覆盖 |
|---|---|
| `frontend/src/tests/FopDashboardView.test.ts:24` | MoM 独立切换、December 基线、金额/比例 tooltip、合计不重复、按部门选择、注册维度、权限失败清数据、日期/年份转发 |
| `frontend/src/tests/OrderVolumeAnalysis.test.ts:33` | 客户日期模式、非法日期、排名/搜索/弹窗、晚响应竞态、分仓数量及金额一致顺序、下钻参数、授权撤销、session reset、总计 |
| `frontend/src/tests/OrderVolumeOrdersView.test.ts:9` | 客户日期下钻保持 from/to、不编造 grain/year、详情空合计 |
| `frontend/src/tests/chart-interaction.test.ts:20` | 删除 inside、锁滑窗、拒绝点轨道跳转、接受指针拖动并发 zoom |
| `frontend/src/tests/orderVolume.test.ts:5` | 最新14日/6月/4周默认窗口、稳定对象色、服务商独立色 |
| `frontend/src/tests/receiptChanges.test.ts:5` | 缺基线/断月不当0、分精度、0基线、合计 |
| 其他本次文件 | 金额格式/分求和、纵向 wheel 外层滚动、会话晚响应隔离、岗位路由 |

**测试限制：**`FopDashboardView.test.ts:10` 和 `OrderVolumeAnalysis.test.ts:11` stub 掉 EChart；`chart-interaction.test.ts:9` mock echarts/core。现有用例验证 option/事件分支，不验证真实图像、图例点击、SVG下载、长名称遮挡、移动端触控、ResizeObserver 实际布局或 FPS。OrderVolumeAnalysis 的主测试入口总是 `customer:true`（`:28`），业务 carrier/organization/salesperson 筛选与所有真实分仓交互没有同等组件级覆盖。此次没有跑生产网络、后端全量测试或浏览器端到端测试。

另为第 7 节两项问题建立临时诊断测试，实际挂载 Dashboard、只 mock 网络与图形渲染，**2 个断言错误行为的用例通过**；随后删除临时文件。没有把“已知错误行为的诊断断言通过”误写成修复通过。

### 7. 历史问题与修复状态

FE-01：refresh 在发起请求前保存 submitted，成功后 appliedRange/appliedYear 使用该快照。FE-02：首次 refresh 不再提升 orderVolumeRevision，后续全局刷新才提升。以下保留原复现证据；本轮回归结果见 VERIFICATION.md。

#### FE-01 · P2 · 注册趋势可能标上未查询过的日期范围

**触发条件：**Dashboard 请求未完成时用户编辑注册日期；不需越权、不需畸形 API 响应。日期输入在 busy 期间仍可编辑，查询按钮被禁用。

**证据：**`frontend/src/views/autoflow/FopDashboardView.vue:112` 用调用时 from/to 发请求；`:117` 在 await 后重新读当前 from/to 作为 appliedRange；`:216`、`:217` 输入未绑定 disabled；`:221` 展示 appliedRange 与旧请求结果。

**复现：**延迟 dashboard 响应 → 请求原范围 A → 请求在途把开始日期改成 B（例如 2020-01-01）→ 返回 A 的合法统计（例如 23）→ 页面总量仍为23，旁边范围却显示 B—原结束日，而网络只请求过 A 一次。临时 Vitest 已断言：`getFopDashboard` 调用次数=1、请求 from≠B、标题范围包含B、总量=23。

**影响：**用户可能把 A 的统计读成 B 的统计；截图/导出旁边的数据说明也可能错误。金额图本身不受此日期标注问题影响。

**建议验收：**将请求快照作为 appliedRange 来源，或请求中锁日期；无论选择哪种实现，慢请求期间修改输入后，已显示统计范围必须等于对应实际请求范围。本轮已按上述方式修复。

#### FE-02 · P3 · Dashboard 首次进入重复发起两组订单聚合请求

**触发条件：**正常首次挂载 `/dashboard`，不需要手动刷新。

**证据：**两个 OrderVolumeAnalysis 以 revision=0 挂载，`frontend/src/components/order-volume/OrderVolumeAnalysis.vue:80` 的 immediate watch 已调用 load；父组件 `frontend/src/views/autoflow/FopDashboardView.vue:124` 的 onMounted(refresh) 又在 `:106` 增加 revision，`:261`、`:262` 触发两子组件相同 query 再请求。

**复现：**mock 网络 pending 并挂载完整 Dashboard（不 stub OrderVolumeAnalysis）→ 记录 getOrderVolume 调用 → organization 两次、customer 两次，分别字段完全相同。临时 Vitest 已验证 4 次调用及两组参数相等。

**影响：**初次进入为这两个面板发送4次而非2次聚合请求；requestId 会丢弃旧响应，因此未证实重复展示或错误合计。额外后端成本与耗时要以生产测量为准，不能仅凭重复请求推断服务超载。

**建议验收：**区分首次加载与用户全局刷新；首次每面板只请求1次，全局刷新仍各请求1次。本轮已按上述方式修复。

### 8. 未实现与生产待验证清单

下列为明确功能边界或验收事项，不作为本次新发现的生产故障计数。

1. **未实现：**注册会员点下钻；除注册图外的图表导出、分析数据 CSV/XLSX 导出；分析筛选/图例/滑窗返回恢复；跨图图例联动；任意窗口缩放；弹窗局部错误重试实际路径；图形键盘漫游。是否新增应按业务优先级决定。
2. **生产数据：**对授权账号样本逐一核对每一图、表格、API、明细订单；核对注册 count 定义、回款金额源字段、支付/退款/取消状态、USD 过滤、非 USD 排除笔数、订单去重与金额精度。前端展示代码不能证明这些外部事实。
3. **时间边界：**跨年12月基线、UTC+8 午夜/月末与浏览器本地日期差异、当月截至目前、未来日期 null、历史全年与周跨年、日期跨度大时性能。Dashboard 和订单分析现已统一 UTC+8，历史直接使用浏览器本地时间的差异已修订；真实源时间戳仍须验证。
4. **权限边界：**系统管理员无业务权限、部门及子部门、员工本人、禁用/解绑/绑定变化、跨租户、生产权限接口不可用；保证聚合、options、搜索、明细使用相同有效授权，且不能靠编辑 URL 扩大范围。
5. **数量与金额对账：**总计=明细集合但不重复累计总计行；Top10+other(+unassigned)覆盖全量；分仓数组与总体一致；数量Top10和金额同集合；全部筛选结果 totals 独立于分页；other 点击必须严格回到同一剩余集合。
6. **真实图形验收：**亮/暗色、中/英文、窄屏、超长名称、同名业务员/客户、大金额、正负环比、零值/稀疏值、图例滚动、滑块拖动/触屏、多图联动、弹窗测量与关闭清理、SVG下载内容与字体。现有测试未覆盖这些完整视觉行为。
7. **可用性/性能：**长日期范围最多多年每日数组、分仓及客户金额双图的实际 SVG节点数/帧率、低端设备、窗口反复 resize、反复打开弹窗、网络超时/权限失败重试。前端未实现请求 AbortController，只阻止晚结果写回；不应把“丢弃旧响应”当作“请求已取消”。

### 附录 A：两项问题的可运行诊断片段

以下是本次实际运行的诊断主体，供历史复核，不是当前契约样例。若回到原诊断版本，将代码临时保存为 `frontend/src/tests/echarts-audit-diagnostic.test.ts`，从 `work-app/` 执行 `npm run test --workspace=frontend -- src/tests/echarts-audit-diagnostic.test.ts`。它们断言**历史错误行为存在**；当前修复版本不应再通过这些错误断言，须使用正确行为回归测试。此片段不应作为长期回归测试原样提交。本次运行后已删除临时文件，保留此文档中的可复核代码。

```ts
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import FopDashboardView from '@/views/autoflow/FopDashboardView.vue'
import { getFopDashboard, type FopDashboardData } from '@/api/fop-dashboard'
import { getOrderVolume } from '@/api/fop-order-volume'

vi.mock('@/components/layout', () => ({
  AppLayout: { template: '<div><slot /></div>' },
}))
vi.mock('@/components/FopDataAccessNotice.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/WorkCalendar.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/charts/EChart.vue', () => ({
  default: { name: 'EChart', props: ['option', 'label'], template: '<div />' },
}))
vi.mock('@/api/fop-dashboard', async importOriginal => ({
  ...await importOriginal<object>(), getFopDashboard: vi.fn(),
}))
vi.mock('@/api/fop-order-volume', () => ({
  getOrderVolume: vi.fn(), searchOrderCustomers: vi.fn(),
}))
vi.mock('@/composables/useWorkbenchAccess', () => ({
  refreshWorkbenchAccess: vi.fn(),
  useWorkbenchAccess: () => ({ roles: { value: [] } }),
}))

const sample: FopDashboardData = {
  source: 'fop', updatedAt: '2026-10-22T00:00:00Z',
  queues: { review: 0, allocation: 0, dispatch: 0, shipping: 0 },
  rates: [], registrations: [{ date: '2026-10-20', count: 23 }],
  exceptions: [], tasks: [],
  receipts: { currency: 'USD', months: [], departments: [] },
}
let wrapper: ReturnType<typeof mount> | undefined
async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div />' } },
  ] })
  await router.push('/')
  wrapper = mount(FopDashboardView, { global: {
    plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })],
    stubs: { RouterLink: RouterLinkStub },
  } })
  return wrapper
}
beforeEach(() => {
  vi.mocked(getFopDashboard).mockReset()
  vi.mocked(getOrderVolume).mockReset().mockImplementation(() => new Promise(() => {}))
})
afterEach(() => { wrapper?.unmount() })

describe('ECharts audit: assertions of current incorrect behavior', () => {
  it('FE-01: displays an unqueried range after inputs change during the request', async () => {
    let resolve!: (data: FopDashboardData) => void
    vi.mocked(getFopDashboard).mockReturnValue(new Promise(r => { resolve = r }))
    const view = await setup()
    const request = { ...vi.mocked(getFopDashboard).mock.calls[0]![0] }
    const input = view.findAll('input[type=date]')[0]!
    expect(input.attributes('disabled')).toBeUndefined()
    await input.setValue('2020-01-01')
    resolve(sample)
    await flushPromises()
    expect(request.from).not.toBe('2020-01-01')
    expect(getFopDashboard).toHaveBeenCalledTimes(1)
    expect(view.find('.chart-summary small').text()).toContain('2020-01-01')
    expect(view.find('.chart-summary strong').text()).toBe('23')
  })
  it('FE-02: makes two identical startup requests per order-analysis panel', async () => {
    vi.mocked(getFopDashboard).mockResolvedValue(sample)
    await setup()
    await flushPromises()
    const calls = vi.mocked(getOrderVolume).mock.calls.map(([q]) => q)
    expect(calls.filter(q => q.category === 'organization')).toHaveLength(2)
    expect(calls.filter(q => q.category === 'customer')).toHaveLength(2)
    expect(calls[0]).toEqual(calls[2])
    expect(calls[1]).toEqual(calls[3])
  })
})
```


### 9. 物流运费前端审计补充

物流运费与客户收费、订单金额、回款业绩分别使用独立事实与请求。界面显示“实际运费／确认时间”，不能将确认时间改为银行实付日或宣称最终结算；原币和汇率字段在工作台明细用于复核。当前生产FOP未接入，Mock标识必须保留。

| 消费或交互 | 合同与检查点 |
| --- | --- |
| 请求 | GET `/api/autoflow/integrations/fop/freight`传grain/year，warehouse默认ALL；weekOf仅week且属于year；carrierCode是固定6类。返回query为已解析条件，不能用正在编辑的条件标注旧结果 |
| 周期 | periods升序用于图轴、统计明细倒序。月YTD/历史12月、周一4周、年最近5年；未完期to截到UTC+8今天，partial醒目标未完周期（含末日当天）。上一期是完整自然周期，与当前未完期比较需要说明 |
| 统计值 | 使用API amount/previousAmount/delta/percent；null表示上期为0且本期非0，显示“上期为0”，双0为0%；percent=25显示25%，不是0.25%；汇总直接取totals |
| 图表与表格 | 合计/服务商并列，不堆叠；合计不再次累加。独立环比开关，开启自动展开统计表，关闭不收起；固定列宽避免跳动。复用EChart滑块拖动边界，滚轮滚动页面 |
| 趋势 | 服务商居中弹窗从当前已返回数据筛出单商、继承已应用时间/仓库，不另外发请求，不把任意陈旧查询标题带入；关闭/ESC及焦点、暗色、窄屏需真实浏览器验收 |
| 明细 | GET `/api/autoflow/integrations/fop/freight/details`必须有workbenchRole；保持基础查询、carrierCode、periodId、comparisonPeriod。current默认、previous完整上期；不得在Dashboard另造无权限成本列表 |
| 分页 | 全筛选发运单数、USD金额与分原币合计使用返回totals，非当前页求和；换页仅改page。原始金额、币种、汇率方向/日期/来源及确认时间应可核对 |
| 访问及错误 | freight scope缺失403与空allowlist合法空数据区分。切账号/会话、加载失败、筛选竞态必须清理或拒绝旧成本；前端岗位可见不取代服务端成本授权 |

源码定位：`frontend/src/components/freight/FreightAnalysis.vue`、`FreightResults.vue`、`FreightTrendDialog.vue`、`frontend/src/utils/freight.ts`、`frontend/src/api/fop-freight.ts`、`frontend/src/views/autoflow/FopFreightView.vue`。工作台路由为`/workbench/:role/freight`（RoleWorkbenchFreight），由WorkbenchView和路由守卫校验岗位入口。以上已核对源码；测试、HTTP和浏览器实际验收状态以VERIFICATION.md为准。真实最终结算定义、汇率、后续补收退款/调价、成本可见权及服务商映射见H18–H22，不用本地Mock截图关闭生产待办。


## 11. 后端契约诊断与生产接入差距


审计日期：2026-10-22。依据当前工作区源码、DTO、序列化器、前端API类型与测试；方案 2 实现后同步契约；未连接或验证真实 FOP 生产服务。FOP 为金蝶云苍穹上的 HyperZone 自研应用，后台 `/Library/VSCode/dtr5b` 只读核查。

机器可读交付：[hyperzone-analytics.openapi.json](../openapi/hyperzone-analytics.openapi.json)，OpenAPI **3.1.1**，**19条路径、19个操作、82个数据模型、8组通用错误响应**。物流运费新增2个操作及13个模型；仅列当前平台HTTP接口，未实现的 FOP 上游签名、同步和分页接口没有被写成已实现路径。格式依据[OpenAPI 3.1.1官方规范](https://spec.openapis.org/oas/v3.1.1.html)。

### 1. 当前交付判断

图表所需的前后端聚合、查询、权限交集、明细钻取与分页汇总已经存在；**生产FOP数据接入尚未完成**。`UsersModule`只选择`DemoFopDataProvider`或`UnconfiguredFopDataProvider`，没有真实FOP数据适配器。演示仅在`FOP_DATA_MODE=demo`且`NODE_ENV`为`development/test/local`生效。没有演示开关时保持未配置状态，不会把fixture当真实业务数据展示。

客户 `series.amounts` 与 Dashboard `receipts` 已改为**独立授权的收款分录**：`amount=hzkj_real_receive_amt`；源单已支付、已审核且收款单已审核，来源履约＋全款备货，排除押金备货与样品，按支付时刻 UTC+8 归月。`orderAmount`、`handlingFee` 保留核对；使用已全款备货库存的履约不补回产品款。钱包授信可产生此类结算，因此不等同于银行新增现金流。历史期间按当前有效状态重算，未新增结账锁定、部分退款／冲销系统。

数量仍只计已支付、已审核履约订单；备货不计数量。客户金额沿用数量 Top10／other 集合，只有全款备货回款的客户仍能搜索、进入总计／other。独立 `allowedReceiptIds` 缺失即无收款授权，且需 receipts scope；无 scope 时客户省略 amounts、Dashboard 回款为空、收款明细 403。客户金额和 Dashboard 均提供履约／全款备货来源拆分。

物流运费新增独立发运单成本快照，使用 `allowedFreightIds` 与 `freight` scope，不从订单／收款授权推导。原币、原额、USD汇率及日期/来源强制保留，折算必须一致；已审核已确认的正成本按确认时间UTC+8归期。确认不等于最终结算，费用分录停用与首次候选规则使补收退款和后续调价仍有生产缺口，详见第8节。

### 2. 传输与错误边界

| 项目 | 当前实际行为 | 源码证据 |
|---|---|---|
| 基础路径 | `servers.url=/api`；各path不再重复`/api` | `backend/src/main.ts`的`setGlobalPrefix('api')`；`frontend/src/api/index.ts`的`baseURL` |
| 响应包裹 | Controller直接返回对象；无`{code,data,message}`成功包裹。前端拦截器返回`response.data` | `workbench.controller.ts`、`RequestAuditInterceptor`原样返回`value`、`frontend/src/api/index.ts` |
| 鉴权 | JWT Bearer或`autoflow_session` cookie二选一；提取顺序cookie优先 | `backend/src/modules/auth/jwt.strategy.ts` |
| 即时授权 | JWT只提供身份；每次查当前账户role/businessRole，FOP读前后复查绑定、业务范围和入口授权 | `jwt-auth.guard.ts`、`fop-data.service.ts:59`及`assertUnchanged` |
| 参数验证 | 全局`whitelist + forbidNonWhitelisted + transform`；有DTO的图表接口禁止客户端传tenantId/userId/scope等额外字段 | `main.ts`、`fop-data.dto.ts`、`order-volume.dto.ts`、`fop-receipts.dto.ts` |
| 无DTO接口 | `/workbench/access`、`/workbench/{role}/access`及本地`/autoflow/dashboard`没有Query DTO，额外query当前忽略；不能笼统声称所有接口拒绝未知参数 | 对应controller签名 |
| 缓存 | JWT guard以及相关controller设置`Cache-Control: private, no-store`；全局限流可能先于JWT guard运行 | `jwt-auth.guard.ts`、`app.module.ts` |
| 标准错误 | Nest通用错误为`{statusCode,message,error?}`；DTO的message通常为字符串数组。默认401可只有statusCode/message | DTO校验、`UnauthorizedException`/`ForbiddenException` |
| 业务错误 | 显式对象异常为`{code,message}`，不自动补statusCode/error；实际HTTP仍403/503 | `fop-data.service.ts`的`permissions/providerCall` |
| 限流 | 全局默认60秒120次，超限429；实际限流键受部署IP/代理配置影响 | `app.module.ts` |

业务错误码：403包含`business_access_disabled`、`business_scope_required`、`fop_binding_required`、`fop_permission_denied`、`fop_binding_changed`；503包含`fop_not_configured`、`fop_unavailable`。入口权限不足仍可返回Nest标准403而没有业务code。`GET data-access`将已识别的FOP失败转换为HTTP 200的`status`；前端不能仅靠HTTP 200判断数据已就绪。

### 3. 已实现Endpoint清单

下表路径均相对于`/api`；各响应均为裸对象，字段定义以OpenAPI为准。

| 方法与路径 | operationId | 输入与成功响应 | 权限/行为 |
|---|---|---|---|
| GET `/autoflow/integrations/fop/data-access` | `getFopDataAccess` | 无query；`DataAccess` | 无业务权限也可检查状态；仅ready输出source/mode |
| GET `/autoflow/integrations/fop/order-volume` | `getOrderVolume` | `category`与时间条件；`OrderVolume` | 至少一个入口角色，租户/allowlist/业务范围求交 |
| GET `/autoflow/integrations/fop/order-volume/customers` | `searchOrderCustomers` | keyword、department、分页；`OrderCustomerPage` | keyword trim后1..100字符；pageSize默认10、最大50 |
| GET `/autoflow/integrations/fop/order-volume/orders` | `getOrderVolumeDetails` | 图表同查询+workbenchRole+series/period/明细仓；`OrderPage` | 必须拥有所传入口角色；不是履约队列筛选 |
| GET `/autoflow/integrations/fop/fulfillment-orders` | `getFulfillmentOrders` | queue、search、orderNumber、分页；`OrderPage` | queue对应角色强制校验；可选workbenchRole若不匹配则400 |
| GET `/autoflow/integrations/fop/receipts` | `getReceipts` | from/to、部门/员工/客户/仓库/来源、workbenchRole、分页；`ReceiptPage` | 独立收款 scope 与分录 allowlist；UTC+8 有效 USD 分录，分页前合计 |
| GET `/autoflow/integrations/fop/order-volume/receipts` | `getOrderVolumeReceipts` | customer 同图表查询及下钻参数；`ReceiptPage` | 先重建完整数量 Top10/other 集合，再收窄期间和仓库 |
| GET `/autoflow/integrations/fop/freight` | `getFreight` | grain/year、可选weekOf/warehouse/carrierCode；`FreightData` | freight scope与独立成本allowlist；月/周/年、USD、完整上期环比、partial |
| GET `/autoflow/integrations/fop/freight/details` | `getFreightDetails` | 同分析查询＋periodId/comparisonPeriod/workbenchRole/分页；`FreightPage` | 岗位权限再校验；current默认，previous完整上期；分页前USD/原币合计 |
| GET `/autoflow/integrations/fop/dashboard` | `getFopDashboard` | from/to/year均必填；`FopDashboard` | 三类analyticsScopes独立控制；队列另按入口角色 |
| GET `/workbench/access` | `getWorkbenchAccess` | 无参数；`WorkbenchAccess` | 当前账户入口/系统/业务权限摘要 |
| GET `/workbench/{role}/access` | `getWorkbenchRoleAccess` | path角色；`WorkbenchAccess` | 未知角色400，无授权403 |
| GET `/users/workbench-accounts` | `listWorkbenchAccounts` | page/pageSize/search；`WorkbenchAccountPage` | 仅系统管理员；响应只有items/total |
| PUT `/users/{id}/workbench-roles` | `updateWorkbenchRoles` | workbenchRoles数组；`WorkbenchAccount` | 仅系统管理员；替换全量、最多5种、不重复 |
| PUT `/users/{id}/fop-binding` | `updateFopBinding` | tenantId/userId同时非空或同时null；`WorkbenchAccount` | 仅系统管理员；重复绑定409 |
| PUT `/users/{id}/business-scope` | `updateBusinessScope` | role/departmentId/employeeId均必填；`WorkbenchAccount` | 经理需部门，销售需员工；未分配显式null |
| PUT `/users/{id}/management-role` | `updateManagementRole` | role=admin/user；`WorkbenchAccount` | 仅系统管理员；撤销自己权限409 |
| GET `/organization` | `getOrganizationWorkspace` | 无query；`OrganizationWorkspace` | 仅系统管理员；始终mock；首次GET可能初始化本地种子 |
| GET `/autoflow/dashboard` | `getLocalAutoflowDashboard` | 无参数；`LocalDashboard` | sales入口；本地DB业务概览，与FOP Dashboard不同 |

管理员PUT路径ID由`ParseUUIDPipe`验证；目标不存在404。订单明细页码默认1、pageSize默认20且最大100；越界页200空items，但total和totals仍为完整筛选结果。客户搜索最多50条/页。账户列表与订单列表不能共用同一个泛化分页响应类型。

### 4. 字段、聚合口径与源码追踪

| 字段或语义 | 当前值来源/变换 | 源码定位 |
|---|---|---|
| `FopOrder.*` | provider candidate按租户、allowedOrderIds、业务范围筛选并按id去重，再由publicOrder白名单重建 | `fop-data.service.ts:129`的`scopedOrders`与`:33`的`publicOrder` |
| 上游私有字段 | `tenantId`用于租户校验；`departmentPathIds`用于部门后代权限匹配；两者均不输出给客户端 | `fop-data.types.ts`、`business-scope.ts`、`publicOrder` |
| `currency` | trim+uppercase；空值默认USD，未换汇 | `fop-data.service.ts:44` |
| `periods`、时间轴 | 支付时刻转UTC+08:00日期；月、近4周、日；客户区间逐日展开 | `order-volume.ts:7`、`:24` |
| `total/customerCount` | 订单数来自 paid＋approved、未取消且有效已发生 paidAt 的履约；客户集合含有效独立收款客户，备货只增金额 | `order-volume.ts` |
| `series` | 首项total；物流固定6项，业务员Top5，客户Top10，剩余other；名称相同不合并ID | `order-volume.ts:83`至`:113` |
| `values/warehouses` | periods 同下标；未来 null，其余空期0；已审核履约必须已映射 HZ/SZ，UNASSIGNED 仅兼容数组键 | `order-volume.ts`、`fop-data.service.ts` |
| 客户 `amounts` | 有 receipts scope 才输出；同客户集合、日期、仓库的独立收款实收，USD 分币汇总及来源 breakdown；excludedOrderCount 兼容名表示非 USD 分录数 | `order-volume.ts`、`fop-receipts.ts` |
| `detailWarehouse` | 与查询warehouse取交集；先构建完整排名/other，再缩窄明细期间与仓库 | `order-volume.ts:143`至`:150` |
| `totals` | 分页前完整筛选范围；订单数、所有商品件数、原币种金额各自求和；USD排序优先 | `fop-order-totals.ts`、`fop-data.service.ts:167`及`:190` |
| 客户搜索 | 授权已审核有效订单客户（可含未支付）并入有效获授权收款客户；编码精确优先，编码/ID排序 | `order-volume.ts` |
| Dashboard队列 | 当前全部授权订单，日期控件不影响队列；review/异常为sales，采购/配货/调度/仓库分别对应角色 | `dto/workbench.dto.ts`、`fop-data.service.ts:15`及`:203` |
| Dashboard注册 | 注册明细优先，按owner/部门业务范围过滤后合并、补0、校验重复键；缺台账时只有业务admin读取旧日汇总 | `fop-registration.ts`、`fop-data.service.ts:224` |
| Dashboard金额 | 独立收款分录，UTC+8 支付月；履约＋全款备货；上年12月 previousAmount/previousBreakdown，basis=actual_received | `fop-receipts.ts`、`fop-business-time.ts` |
| Dashboard任务/异常 | task.time 按 UTC+8 显示；异常 id 实际 orderNumber，不是 order.id | `fop-data.service.ts` |
| 本地Dashboard | 本地工作流/线索/outreach表，readBusinessOwners限定范围；funnel.value当前固定0 | `autoflow.service.ts:73`、`:604`及对应map函数 |
| 实时性元数据 | asOf/updatedAt是本次计算时间，没有upstreamUpdatedAt/snapshotId | `order-volume.ts:140`、`fop-data.service.ts:196`及`:254` |

`required`、显式`null`与字段缺失分别建模：例如paidAt、carrier、trackingNumber、exception允许null；organization/department/owner/customerCode缺失时省略；data-access的source/mode仅ready存在。`registrationDepartments`及Dashboard的businessScope在当前后端始终输出，即使前端旧类型写成可选或未声明，本规范也按实际输出记录。`ReceiptSeries`可表示marketing或员工，`ReceiptDepartment`才限定报表部门；两者描述独立。

#### 仓库、物流、部门与金额对账

已审核履约的 warehouseCode 必须 HZ/SZ、carrierCode 必须 YT/4PX/WB/YW/JS/OTHER；缺失或未映射属于适配错误，不能正常归入未分配／其他。OTHER 仅接受可信适配器明确映射的已知其他服务商。全款备货必须有国内仓库，carrierCode=null 表示不适用，不能计入物流量。报表部门归一化为 sales1..sales4，不能用前端筛选代替授权。

数量 series 满足 total=sum(非 null values)，每期 HZ＋SZ=values。客户金额来自各自授权收款账本，来源拆分和仓库拆分各自合计为总实收；不得用订单明细 amountsByCurrency 与实收直接对等。收款 totals 在分页前汇总；收款行数、履约订单数、商品件数是不同单位。分录单条及累计均验证非负安全分币；订单旧总计的完整异常校验不因此自动完成。

### 5. FOP/provider现状与接入缺口

| 优先级 | 当前事实与影响 | 证据 | 生产接入要求 |
|---|---|---|---|
| P0 | 没有真实FOP数据provider。API路由/前端图表已实现，不能据此宣称生产对接完成 | `users.module.ts:21`工厂只返回Demo或Unconfigured；`fop-data.types.ts`抽象provider | 明确真实上游鉴权、地址、权限解析、订单/注册/汇率契约，再实现适配器；不凭空约定FOP路由名 |
| 已修订（原 P1） | 原诊断：Dashboard 直接累加订单金额。方案2现使用独立实收分录、来源拆分、源单＋收款双审核与独立授权 | fop-receipts.ts、fop-data.service.ts | 正式源字段样本与跨系统对账仍待完成；钱包授信不代表银行现金流 |
| 已修订（原 P1） | 原诊断：Dashboard 直接 slice 月份，临界支付与订单统计错月。现共用 UTC+8 业务日期，统一当前年/月与日期校验 | fop-business-time.ts、monthlyReceipts | 核验 2026-01-31T16:30:00Z 属于 UTC+8 的2月及跨年基线 |
| 部分修订（原 P1） | 收款单条及累计使用非负安全分币校验；客户业绩与 Dashboard 同源。订单明细金额仍为独立旧合同 | fop-receipts.ts、fop-order-totals.ts | 正式币种策略及订单资源完整运行时验证仍需对齐 |
| P1 | provider 订单尚无完整状态／商品数量运行时 schema；已审核仓库和物流完整性已新增校验。收款必需字段、金额、来源、双审核和归属独立校验，重复授权分录拒收 | publicOrder、publicReceipt、scopedReceipts | 正式适配器须完成源数据映射、错误监控与完整运行时验证 |
| P1 | 当前接口全量拉授权订单后内存过滤、排序、聚合；客户区间没有最大跨度 | `listOrders`返回数组；`order-volume.ts:36`逐日展开；service分页最后slice | 确定数据量、分页/游标完整性、权限快照、增量同步、数据库索引/预聚合和允许日期跨度，再按目标量压测 |
| P1 | 图表与明细各次独立拉数据、重建排名；期间订单变化会使TopN/other和钻取总数漂移 | `getOrderVolume`与`getOrderVolumeDetails`分别调用scopedOrders；asOf非快照ID | 同一图表钻取需共享snapshotId或清晰声明实时一致性边界；不能把当前asOf当稳定版本 |
| P1 | 本地组织模块始终mock且按管理员账户独立播种；权限ID配置未验证真实FOP归属 | `organization.service.ts:88`的`withWorkspace`；`users.service.ts:92` | 建立本地用户—FOP租户/用户—真实员工/部门映射；目录权限与同步流程独立设计，禁止把种子ID当FOP正式ID |
| P2 | weekOf与year可以不同年，周桶实际忽略year；无效objectId返回空，其他grain的month/weekOf可被忽略 | `order-volume.ts:41`至`:59`及`:80` | 在兼容性评估后统一跨参数校验；当前契约如实描述，不把未实现限制写成事实 |
| P2 | `source`是provider标签；asOf/updatedAt只是计算时刻，无法识别真实源数据陈旧程度 | `source`属性与响应构造 | 增加可验证来源、上游刷新时间、同步延迟、snapshot/version指标；目前这些字段为建议，不在已实现paths内 |
| P2 | 前端兼容类型允许部分 Dashboard 字段缺失，实际后端必有 basis/timeZone/breakdown；HTTP 白名单仍剥离服务端元数据 | frontend API types、publicOrder、publicReceipt | 使用 OpenAPI 作真实响应校验，兼容类型不等于后端可省略必需字段 |

当前已有的重要保护：服务端身份绑定、每次权限查库、租户与allowlist交集、业务范围筛选、空订单／收款 allowlist 分别不授予对应资源、跨请求授权变更复查、publicOrder/publicReceipt 字段白名单、provider错误公开信息归一化。待接入适配器应保持这些边界，不以“管理员”“测试环境”或页面筛选器替代服务端权限。

### 6. 接入验收要求（尚待真实FOP环境执行）

1. 以 HYPERZONE_FOP_SOURCE_MAPPING.md 已确认的实体、字段与状态为起点，取得实际发布 FOP HTTP 文档及脱敏样本，核验收款行 ID、源单关联、两类审核与支付、客户/员工/部门/仓库/物流、币种和支付时间；源码证据不能替代线上协议验证。
2. 对每个本地账户验证绑定唯一性、租户边界、独立订单／收款白名单、部门后代范围、员工归属及撤权即时生效；无权限时不能退回演示数据。
3. 对图表、同筛选明细、分页总计三方对账，包含空授权、重复分录拒收、未知已审核仓库/物流拒收、非USD、缺客户ID、未来日、跨月UTC+8、TopN/other、无注册台账等边界。
4. 按已确认方案2与财务业务结算对账：分录实收、订单金额和手续费分开，排除样品／押金备货，预付库存履约不补回产品款；包含钱包授信、迟审核、零追加收款和跨月用库存场景。
5. 定义上游超时、限流、失败重试、缓存权限键、数据新鲜度和一致性要求；进行真实规模吞吐/内存测试。当前前端axios超时30秒，不代表上游SLA已完成。

### 7. 历史诊断验证记录与本轮边界

下表保留方案2实施前的 2026-10-22 诊断证据，不代表此次修改后的测试数量。方案2阶段OpenAPI为17操作／69模型，曾用docs-venv校验186处模型／请求／响应示例（共享响应按位置重复计数）；该历史数字不代表运费新增模型的验证结果。当前代码全量验证、浏览器、实际HTTP契约与生成文件检查以 VERIFICATION.md 为准。

| 验证 | 本次真实结果 | 范围/限制 |
|---|---|---|
| 定向后台单测 | `npm test -- --runInBand --testPathPatterns='src/modules/fop-data/.*spec.ts'`：4 suites、40 tests通过 | 覆盖订单量/客户金额、分币汇总、注册聚合、演示provider；不连接FOP |
| 定向API E2E | `npm run test:e2e -- --testPathPatterns='(fop-data-access\|workbench-access).e2e-spec.ts'`：2 suites、46 tests通过 | 覆盖JWT/权限/状态/DTO/明细/汇总；使用测试替身，不是上游联调 |
| JSON Schema模型/样例 | 64个schema用项目已装Ajv2020编译；31个顶层schema/操作/错误实例通过 | JSON Schema2020-12及formats；含客户amounts与null。主流程另用openapi-spec-validator及递归实例验证 |
| 完整OpenAPI结构 | 最终文件已用`openapi-spec-validator`验证通过，并校验159处模型/请求/响应示例 | 支持3.1.1/JSON Schema2020-12；另有12组本地HTTP响应通过schema校验，不等于真实FOP联调或某个API平台导入已测试 |
| 源码路由审计 | 历史15个操作均有controller/service证据，源码文件记录在各operation的x-source-files | 不生成未实现FOP操作或伪造上游响应 |
| 生产接入 | 未验证 | 没有真实provider、正式凭据、上游样本、生产数据量或跨系统财务对账 |

机器规范的成功与错误样例均为脱敏契约样例，不是截取生产数据。上述定向测试与主流程全量测试存在重叠，不能将数量相加当作独立测试总数。本交付记录现状、风险和接入需求，没有把测试通过等同于生产FOP接入已完成。


### 8. 物流运费新增契约与生产差距

| 主题 | 当前实现合同 | 真实接入仍需验证 |
| --- | --- | --- |
| 事实粒度 | `FopFreight`每发运单一条当前实际成本；`FopFreightCandidate`含内部tenantId和departmentPathIds；公开字段白名单不输出这两项 | 发运单稳定ID、历史修订和多个发运单关联，不按订单号去重 |
| 纳入规则 | 源发运单审核approved、成本confirmed、正金额、已发生确认时刻；源正成本缺时间、重复ID等错误拒收 | C审核码、确认状态归一和各供应商金额真正含义；确认不是银行支付或最终结账 |
| 金额 | 原币/原额/明确汇率日期和来源必需；USD原币rate=1，amount为原额×汇率十进制精确乘法HALF_UP到分（1.50×0.15=0.23），有限安全分币累计 | YT/4PX/WB/YW保留原币，JS为CNY；真实币种、历史汇率和原币精度；禁止拿Rmb变量名猜币种 |
| 权限 | 独立freight scope及allowedFreightIds；缺scope403、缺失/空IDs为空；与租户、本人/部门后代/业务管理员求交；请求后复查授权变化 | FOP运行期单据及字段成本可见权；不沿用单量报表无业务员档案时组织全员的规则 |
| 周期 | month为YTD/历史12月；week周一4周，锚点与year一致；year近5年最早2020；完整跨年基期仍读取；partial标未结束期 | 真实跨年完整成本及汇率覆盖；前台不能把当前部分期与完整上期比较描述为同期同比 |
| 环比 | 本期、完整上期、差额、百分点；0→正值percent=null，0→0为0；各期与总计均按基数重算 | 实际账单不同确认时延及调价引起的历史变化，不能视为已关账业绩 |
| 下钻 | `/freight/details`强制workbenchRole；periodId来自同查询；current/previous；确认时间倒序稳定排序；total/totals分页前计算，原币分组 | 图表与明细为各次当前查询，asOf不是冻结快照；变动期间需明确一致性约定 |
| 结算覆盖 | 仅表头快照，保留明确边界 | 源费用分录已停用，重派/退款采集注释；首次正成本后常规候选不再自动重查；补收退款及历史调价需单独机制 |
| 网络与写接口 | 平台两个GET及Mock并不等于真实FOP已接通 | 尚无已确认分析HTTP接口；JsexpActualFreightController是POST回写维护，不能从分析端调用 |

实现定位：`backend/src/modules/fop-data/fop-freight.types.ts`、`fop-freight.dto.ts`、`fop-freight.ts`、`fop-data.service.ts`、provider，以及 `backend/src/modules/users/workbench.controller.ts`。FOP源证据见源码映射第9节；联调资料和验收标准统一使用T17–T20、H18–H22、D11–D15。实际测试结论仅记录到VERIFICATION.md，本文不以契约或Mock存在推断生产验收通过。


## 12. 本次验证记录与限制


业务方案版本：2026-10-22；最终执行时刻所在业务日期为 2026-10-23（UTC+8）。环境：macOS、Node.js 22.23.3、npm 10.9.9、本地隔离 PostgreSQL 16。执行结果不等同于生产 FOP 验收。

### 本轮物流运费分析验证（2026-10-23 UTC+8）

新增独立实际运费成本资源、月/周/年汇总及环比、工作台明细、单物流商趋势弹窗，使用与公开接口同结构的 Mock。下列结果为本轮执行，不将此前基线重复计数。

| 检查 | 实际结果 | 范围与限制 |
| --- | --- | --- |
| 全量前端测试 | 41 文件、169 用例通过 | 包含成本图表、固定表格、环比本期/上期跳转、请求乱序、会话清空、Other真实服务商名称和路由权限 |
| 全量后端测试 | 38 套、257 用例通过 | UTC+8、月/周/年跨年基期、零基期、精确十进制汇率舍入、重复ID、异常字段、部门路径与独立成本权限 |
| 全量 E2E | 4 套、95 用例通过 | `autoflow_test` 隔离数据库；FOP边界使用stub；新增成本接口鉴权、ID注入拒绝、业务管理员/本人、分页、过滤与脱敏503 |
| Lint、类型与构建 | 通过 | 前后端ESLint；后端临时输出编译；前端vue-tsc/Vite构建及资源打包。仍有既有Browserslist过期及大chunk提示 |
| 隔离生产冒烟 | 通过 | 临时目录+端口3198，健康检查、数据库、Dashboard与`/workbench/dispatch/freight` SPA路由及CSP/nosniff；完成后停止临时进程并清理 |
| OpenAPI与文档 | 19操作、82模型、220处示例通过 | OpenAPI3.1.1、完整MD/HTML同源生成；HTML共享CSS/透明Logo及离线结构校验 |
| 实际本地HTTP | 42组响应Schema通过 | 月/周/年各汇总与明细，加六物流商当前/上期明细；36组服务商周期金额逐项对账一致；并非生产FOP调用 |
| 独立审查 | 已修复发现并复核 | 十进制半分舍入、异常部门路径子串误命中、Other真实服务商名称遗漏；无未解决的实质阻断问题 |

本轮共 **521 个测试用例通过**（169＋257＋95）。未重复累计定向测试、审查复跑与诊断失败试跑。

实际浏览器验收：月度展示最新六个月、周展示四组、年展示近五年；合计与六物流商同级柱状；云途趋势弹窗正常居中、普通金额用折线、环比用柱状；按上期链接跳转发运工作台，UTC+8的9月云途明细合计为 `$91.29`，与对比基期一致。主统计表环比前后八列横坐标/宽度逐项一致，首行均为84px；取消环比后仍展开。金额滚轮测试中页面滚动、图表时间窗口保持不变。数值仅对应当前验收账号与时刻，不代表生产实际金额。

截图：[物流运费面板](freight-analysis-browser-smoke.png)、[服务商趋势弹窗](freight-trend-browser-smoke.png)。未声称覆盖全部设备、图例组合、下载、键盘/屏幕阅读器及所有真实岗位。

新增文档保留旧ID，后续清单共20项T任务、22项H人工核对、15项D验收场景。正式切换FOP前仍需核对“最终结算”定义、首笔费用是否最终金额、原币和历史汇率、调价/补收/退款、服务商映射及成本查看授权。没有把已确认成本快照包装成已付款流水，也没有把真实FOP网络适配器标为已完成。

本轮修复记录：`1.50 × 0.15`应按十进制HALF_UP得到`0.23`，先复现二进制中间乘积的错误拒收后改用BigInt；部门路径为字符串`d10`时不得让部门`d1`命中，先复现后增加数组及元素校验；OTHER分类也必须保留具体物流商名。三个回归均先观察失败再验证修复。

### 上一轮方案 2 验证基线

| 检查 | 实际结果 | 范围/限制 |
| --- | --- | --- |
| 全量前端单测 | 38 文件，152 用例通过 | 包括回款工作台、独立金额/数量下钻、来源筛选、会话失效、UTC+8、图表和路由；部分图表使用 stub |
| 全量后端单测 | 37 套，226 用例通过 | 收款独立授权、双审核/支付资格、跨月备货、UTC+8、Top10/other、异常字段和重复分录拒收 |
| 全量后端 E2E | 4 套，90 用例通过 | 独立 `autoflow_test` 数据库；FOP 边界使用 stub；含两条收款接口的鉴权、分页总计、跨租户隔离及中途权限撤销 |
| ESLint | 前后端通过 | `npm run lint` |
| 后端编译 | 通过 | `tsc -p backend/tsconfig.json --outDir <ignored temporary directory> --incremental false`，不清空运行中的 watch 输出 |
| 前端构建及资源打包 | 通过 | `vue-tsc`、Vite、`npm run package:frontend`；仍有 Browserslist 版本和大于500kB图表 chunk 提示 |
| 隔离生产启动冒烟 | 通过 | 临时目录、端口3198；数据库健康、首页及回款 SPA 路由、CSP、nosniff；随后停止进程、清理临时目录 |
| OpenAPI | 通过 | 3.1.1 结构、69 模型和186处递归示例校验；17条路径/操作 |
| 实际 HTTP 响应 | 19组通过 | 以本地已登录账号读取并校验 JSON Schema；Dashboard、客户分析、收款分页总计三方一致；不是生产FOP请求 |
| 独立审查 | 已完成并修复发现 | 纯备货客户误占Top10、嵌套异常字段穿透已修复；补充待办时间UTC+8转换、重复授权分录ID拒收 |

本轮共 **468 个测试用例通过**（152＋226＋90），不重复累计定向测试和诊断试跑。

### 业务验收证据

- 可复现 Mock 客户 `PRE001`：前一月全款备货 $1,000，本月履约补款 $60；全年回款 $1,060，履约订单量1；两笔收款分别归属各自支付月份，不补回产品款。
- `STC001`：仅有全款备货收款。实际浏览器搜索后显示履约订单0、回款$4,840；杭州仓$3,120、深圳仓$1,720；杭州仓金额下钻显示6笔回款、总计$3,120。
- 实际浏览器点击业务一部当月 $6,422.18，进入回款工作台，合计一致；切换“全款备货”后显示5笔/$3,110，物流服务商“不适用”。源码数据随日期/账号组织变化，上述数值只对应本次验收账号与当时数据。
- 页面截图：[回款工作台来源筛选](collections-receipts-browser-smoke.png)。此图用于布局与数据联动留证，不代表全部角色、日期和浏览器已覆盖。
- 收款金额使用已核实的 `entryentity.hzkj_real_receive_amt`；订单金额/手续费另外保留。源码说明钱包授信也可形成结算，不能将这些数值当作新增银行现金流或会计收入。

### 纠正记录

- 新增计算用例先观察旧实现失败，再实施收款台账；新增重复ID、Top10纯备货客户、异常引用字段、待办UTC+8测试也分别验证了修复前失败。
- 收紧重复ID为503后，首次全量E2E中一条旧测试仍期待重复记录静默去重，因此失败。将该场景拆为正常资格测试和双端点拒收测试后，全量90/90通过；未放宽生产校验。
- 首次隔离生产冒烟放在隐藏目录 `.runtime`，Express的文件发送策略使SPA路径返回404。改用普通临时目录模拟生产目录后首页、深层路由均通过；应用保护策略未改变。

### 未覆盖与接入限制

- 未改写 `/Library/VSCode/dtr5b`，未连接生产HyperZone FOP；本次只读核对源字段、状态、扣费和备货逻辑。真实HTTP路径、稳定收款分录ID发布方式、身份授权、退款调整与历史归属仍需生产联调。
- 当前历史统计按记录的当前有效状态重算；不提供财务关账、退款跨期调整或收入确认制度。非USD不自动换汇；公开收款明细仅列USD，客户金额兼容字段 `excludedOrderCount` 记录排除的非USD收款分录数。
- 缺少 `allowedReceiptIds` 不从订单授权推导；异常收款不回退到订单金额。相同Mock与生产归一契约，不代表真实后台适配器已发布。
- 未运行本轮依赖漏洞审计或生产性能压测；不宣称完整 `ci:local` 原样执行。图例组合、导出下载、触屏、屏幕阅读器及全部岗位仍需专项验收。
- 历史审计附录中的修复前复现仅作为问题证据，不作为当前仍然存在的错误。

### 文档与 Git

MD/HTML从同一需求源及OpenAPI生成，包含FOP源码字段映射和后续待办清单。物流运费补充后的HTML使用共享HyperZone CSS与透明SVG Logo；离线检查通过：新增字段表及两组接口响应表、15个有效页内链接、2处内嵌Logo，并包含移动及打印规则。具体表格数量以本轮生成器输出为准。浏览器工具之前拒绝本地文件URL，本轮未绕过该限制，因此未宣称完成文档的浏览器视觉/打印预览。

提交只包含本工程代码、测试、项目事实和交付文档；运行库、密码、会话和测试日志保留于忽略目录，不进入Git。提交与远端同步结果以Git记录和最终交付消息为准。

### 后续待办清单补充的验证范围

本次后续文档补充以代码提交 `d60fd5d` 为基线，只更新需求、源码映射说明、README和文档生成入口，不改变应用代码、业务口径或OpenAPI字段。新增16项T待办、17项H人工核对、10组D验收场景及回填模板；已检查编号唯一、引用有效、与完整MD/HTML内容同步，生成器仍通过OpenAPI结构及186处示例验证，Git差异检查通过。

上文468项代码测试、19组HTTP响应及浏览器记录是方案2实施时的已完成基线，本次纯文档补充未重新运行这些应用测试，也没有将待办清单中的生产联调事项标为完成。


## 13. HyperZone FOP 源码字段映射


核查日期：2026-10-22。源码目录：`/Library/VSCode/dtr5b`，HEAD：`bd4c115c`（核查当前工作树，不代表生产部署版本）。仅阅读业务 Java、苍穹元数据与转换规则；未连接生产、未读取配置密钥、未修改后端。

本文件区分源码事实、此次业务口径和仍待接口样本确认的映射。FOP 在本项目指金蝶苍穹上的 HyperZone 自定义应用。

### 1. 此次业务口径与已有报表的差异

此次用户明确：客户已支付且公司已审核的履约订单收款，以及**全款备货**订单收款计入月业绩；**押金备货**不计入。备货没有海外承运商；已审核履约订单的仓库、物流渠道由上游校验。履约使用已全款支付的备货后，产品款不会再次收取。

现有 `ReceiptPerformanceReportFormPlugin` 的事实基础很接近，但**不能直接把现有报表输出等同于此次需求**：

- 现有报表读收款单 `hzkj_receive_bill`，要求 `billstatus='C'`、`hzkj_receive_status='B'`，按 `hzkj_receive_time` 筛选。
- 它包含 `A=履约订单`、`B=样品订单`，另包含 `C=备货订单` 且源备货 `hzkj_stock_type='1'` 的分录。此次明确口径未包含样品，不应因旧报表包含 B 自动加入。
- 它明确使用分录 **`hzkj_samount` 订单金额**，并明确不使用实收金额。此次若采用“实收”口径，应独立映射实际金额字段。
- 它校验的是**收款单审核**；未额外查询履约源单 `billstatus`。不能据此认定源订单审核和收款单审核相同。

依据：[报表查询及状态](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/form/ReceiptPerformanceReportFormPlugin.java:178>)（178–310 行），[订单金额口径说明](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/form/ReceiptPerformanceReportFormPlugin.java:396>)（396–454 行）。

### 2. 已确认的实体、类型和状态

| 业务概念 | 原始实体/字段 | 已确认含义 |
| --- | --- | --- |
| 收款单 | `hzkj_receive_bill` | 单据头 `id`、`billno`；分录集合 `entryentity` |
| 履约/样品订单 | `hzkj_orders` | 履约单据类型 `hzkj_billtype.number='hzkj_orders_BT'` |
| 备货订单 | `hzkj_stock_order_new` | 单独实体，不能当履约订单计发货量 |
| 收款源单类型 | `hzkj_src_type` | A 履约、B 样品、C 备货、D 钱包充值、E 收款调整、F 售后 RMA |
| 收款分录源类型 | `entryentity.hzkj_entry_src_type` | 元数据规则随表头源类型赋值；不要假设任意历史数据已正确回填 |
| 收款分录源单 | `entryentity.hzkj_src_order` | 文本单号；转换规则从源单 `billno` 写入，不是源单主键 |
| 收款支付状态 | `hzkj_receive_status` | A 未收、B 已收、C 支付失败 |
| 审核状态 | `billstatus='C'` | 现有收款报表及备货下推校验明确使用 C 表示已审核 |
| 备货类型 | `hzkj_stock_type` | `1` 全款备货；`2` 押金备货 |
| 备货订单状态 | `hzkj_orderstatus` | `0` 已取消；`1` 待支付；`2` 已支付 |
| 履约收款状态 | `hzkj_orders.hzkj_receipt_status` | `0` 未收；`1` 已收 |
| 备货收款状态 | `hzkj_stock_order_new.hzkj_receipt_status` | 元数据 `0` 未收；`1` 部分；`2` 已收，与履约枚举不同 |
| 履约备货使用方式 | `hzkj_orders.hzkj_lock_store` | `0` 不使用；`1` 使用全款备货；`2` 使用押金备货 |

依据：

- [收款来源枚举](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_fund/metadata/hzkj_receive_bill.dym:1867>)（1867–1951 行）；[分录类型随表头](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_fund/metadata/hzkj_receive_bill.dym:1565>)（1565–1583 行）。
- [备货类型](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new.dym:3407>)（3407–3429 行）；[备货订单状态](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new.dym:3625>)（3625–3645 行）；[备货收款状态](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new.dym:2720>)（2720–2747 行）。
- [履约收款状态](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:6435>)（6435–6457 行）；[备货使用方式](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:7929>)（7929–7956 行）。
- [备货已支付且已审核校验](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/convertplugIn/StockOrderPushValidationPlugin.java:18>)（18–39、96–99 行）。这是下推采购/售后/调整单的校验，不是月业绩接口。

**状态适配注意：**PayPal 备货成功回调只在所读分支把 `hzkj_orderstatus` 改为 `2`，不能仅凭备货 `hzkj_receipt_status` 推定支付状态完整性。[回调证据](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/PaypalCallBackController.java:294>)（294–321 行）。

### 3. 金额应保留多个字段，不能混名

| 建议归一字段 | 原始字段 | 源码含义 |
| --- | --- | --- |
| `receiptHeaderAmount` | 收款头 `hzkj_rec_amount` | 实收金额 |
| `amountReceived` | 收款分录 `hzkj_real_receive_amt` | 分录实收金额；适合按源单、类型和权限拆分 |
| `amountReceivable` | 收款分录 `hzkj_samount` | 订单金额/应收金额；旧业绩报表使用此项 |
| `receiptOrderAmount` | 收款头 `hzkj_receive_amount` | 订单金额，不是实收金额 |
| `customerTotalPayable` | 收款头 `hzkj_total_payable` | 客户实付/应付总额；Stripe 计算为订单金额 + 手续费 |
| `handlingFee` | 分录 `hzkj_handle_fee` | 分录手续费；表头为 `hzkj_handling_fee` |
| `productAmount` | 分录 `hzkj_amountfield` | 产品金额 |
| `freightAmount` | 分录 `hzkj_freight` | 运费金额 |
| `fixedTaxFee` | 分录 `hzkj_fixed_tax_fee` | 固定税费 |
| `currency` | 收款头 `hzkj_receive_currency` | 实收币种；不能无条件把不同币种相加 |

依据：[收款头金额命名](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_fund/metadata/hzkj_receive_bill.dym:755>)（755–786 行）；[分录金额命名](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_fund/metadata/hzkj_receive_bill.dym:1067>)（1067–1116 行）；[币种与实收入账](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/fund/plugin/ReceiveBillOperationPlugIn.java:365>)。

在线支付成功时 `PayUtil.applyEntryRealReceiveAmount` 写入：

```text
分录实收金额 = hzkj_samount - hzkj_handle_fee
Stripe 客户应付 = 表头 hzkj_receive_amount + hzkj_handling_fee
```

依据：[手续费和客户应付](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/util/PayUtil.java:37>)（37–65 行）；[分录实收算法](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/util/PayUtil.java:81>)（81–113 行）。这些字段存在业务差异，不应把“客户支付”“订单业绩”“银行净到账”当作同一个金额。

收款审核校验要求支付状态 B、分录实收非零，并校验表头 `hzkj_receive_amount` 等于分录 `hzkj_samount` 合计；**这段校验没有证明表头 `hzkj_rec_amount` 等于分录实收合计**。适配时应对账，不要把表头实收重复复制到每一行。[审核校验](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/fund/plugin/ReceiveBillOperationPlugIn.java:270>)（270–315 行）。

钱包支付可以使用授信额度，仍会生成 B/C 状态的收款单并写入实收。因此此事实表表示订单业务结算；不宜命名为“新增银行现金流水”。钱包充值 D 应与消费时订单结算区分，避免双计。[钱包结算](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/OrderController.java:1417>)（1417–1445 行）。

### 4. 全款备货扣减已在源订单发生

`ReservedStockOrderUtil.waiveProductAmountForSalesOrder` 明确执行：

```text
hzkj_order_amount = 0
hzkj_total_amount = hzkj_fre_quo_amount + hzkj_fixed_tax_fee
```

即全款备货履约只保留运费和固定税费。普通履约恢复金额时，从商品父行 `hzkj_amount` 汇总产品额，再加运费、固定税费。[金额处理](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/util/ReservedStockOrderUtil.java:951>)（951–969 行）。

履约下推收款的转换规则将 `hzkj_total_amount` 写到收款分录 `hzkj_samount`，将 `hzkj_order_amount` 写到产品金额。故分析层**不得再次扣减预付产品款**。[履约转换](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders_hzkj_receive_bill_2361797348159399936.cr:319>)（319–343、377–393 行）。

备货转换规则将备货 `hzkj_order_amount` 写入收款分录 `hzkj_samount`，初始分录实收来自备货 `hzkj_vable_amount`（应收金额）；后续在线支付算法还会更新分录实收。[备货转换](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new_hzkj_receive_bill_2398055344975688704.cr:315>)（315–340 行）。不能只用备货订单总额代替实际收款事件。

### 5. 日期和归属维度

| 归一概念 | 确认字段/建议 | 证据与限制 |
| --- | --- | --- |
| 支付时间 `paidAt` | 收款 `hzkj_receive_time` | 现有业绩按此取时间；是 DateTime，有时区转换元数据 |
| 源订单收款日期 | 两类源订单 `hzkj_receipt_date` | 可作核对字段，不能替代多笔收款事件日期 |
| 审核时间 `approvedAt` | **待真实接口确认** | 当前证据足够确认 C 状态，尚未确认收款/订单继承审核时间字段的响应形式；不得自行把创建时间或支付时间当审核时间 |
| 收款客户 | `hzkj_pay_customer.id/name` | 收款事实上的付款客户 |
| 源订单客户 | `hzkj_customer.id/name` | 履约与备货订货客户，和付款客户保留区分 |
| 客户当前业务员 | `hzkj_pay_customer.hzkj_biz_user` | 旧业绩报表按客户当前业务员归属汇总 |
| 收款业务员 | `hzkj_bizperson` | 旧报表另显示最新收款单上的历史业务员 |
| 源订单业务员 | `hzkj_operator` | 履约和备货均有该字段；毛利权限服务按此归属 |
| 收款销售部门 | `hzkj_dpartment` | 注意原始拼写，不能改成 department |
| 源订单销售部门 | `hzkj_dept` | 履约和备货均有该字段 |
| 履约发货仓库 | `hzkj_dst_warehouse` | 商品行字段另为 `hzkj_orders_billentry.hzkj_warehourse`（原始拼写） |
| 备货收货仓库 | `hzkj_warehouse` | 元数据必填；海外承运商按此次业务规则为不适用 |

依据：[收款查询包含客户和两类业务员](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/form/ReceiptPerformanceReportFormPlugin.java:187>)（187–198、372–390、457–469 行）；[收款部门和业务员](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_fund/metadata/hzkj_receive_bill.dym:843>)（843–857 行）；[备货部门/业务员](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new.dym:1684>)（1684–1701 行）；[备货仓库](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new.dym:3431>)；[履约归属字段](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:4465>)（4465–4508 行）。

时间区间建议使用业务时区中的 `[月初, 下月初)`。已有客户图表明确使用 `Asia/Shanghai`；旧收款业绩插件用 `Calendar`，不能据此断言所有部署时区相同。[现有业务时区](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/OrderController.java:1067>)（1067–1086 行）。

### 6. 物流口径与上游审核

履约审核元数据要求 `hzkj_dst_warehouse != null`，并校验 `hzkj_channel` 实际物流渠道非空。[审核校验](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:5370>)（5370–5436 行）。分析层不应再增加“已审核订单是否已补仓库/承运商”的业务流程。

但源码存在不同阶段物流字段，适配时须明确选用：

- 物流决策：表头 `hzkj_logistics_channel`；渠道分录 `hzkj_channel`，其承运商引用 `hzkj_logistics_providers`。属性显示字段 `hzkj_basedatapropfield3/4` 只是 provider.name 显示。
- 实际发运：商品行 `hzkj_ship_provider` / `hzkj_ship_channel`；表头 `hzkj_ship_provider_name` / `hzkj_ship_channel_name` 是文本汇总。不能把汇总名称当唯一 ID，也不能把发运后字段缺失等同于审核失败。
- 发运事实报表使用独立 `hzkj_deliver_bill`：承运商 `hzkj_logistics_providers`、渠道 `hzkj_logistics_channel1`、仓库 `hzkj_basedatafield`、业务员 `hzkj_bizoperator`，且按发运单 ID 计数。

依据：[决策承运商引用](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:8019>)（8019–8024、8082–8086 行）；[发运字段](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:3610>)（3610–3624、9860–9876、9926–9956 行）；[发运报表事实与字段](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/DeliveredOrderVolumeReportService.java:28>)（28–55、137–164 行）。

### 7. 已有接口/查询能复用什么

下面是**已验证的 Java 注解路径片段**，不是可直接调用的完整 URL。网关前缀、服务地址、鉴权、部署版本未验证。

| 现有代码 | 可参考范围 | 不可直接替代本次需求的原因 |
| --- | --- | --- |
| `ReceiptPerformanceReportFormPlugin` | 收款头去重后加载分录、备货类型筛选、按客户汇总 | 原生苍穹表单插件；未发现对应收款分析 HTTP 导出；金额用订单额，含样品，最多 30 天 |
| `OrderController`，`@ApiController("crm")` + `@ApiMapping("/order")` + `/graphicStatistics` | 单个客户按日订单/付款图表 | 仅履约，付款用订单 `hzkj_curtotalamount`，未实现全款备货收款并集，也不证明公司审核门槛 |
| 同控制器 `/queryOrder` | 客户、订单类型、分页/排序参数 | 客户门户订单查询；不是已验证的组织级业绩账本 |
| 同控制器 `/orderCountStatistics`、`/orderStatistics` | 订单数量与状态分组 | 数量接口不等于收款事实 |
| `DeliveredOrderVolumeReportService` | 当前组织内已审核且已推送的发运单，维度计数 | 使用发运单审核时间 `auditdate` 作发运代理日期，不等于收款日或物流商真实揽收时间 |
| `ReceiveBillController`，`/fund/receiveBill/allocateStripeHandlingFee` | 证明存在收款维护 API | **写操作**，分摊手续费；不是只读分析接口，不应被分析前端调用 |

依据：[订单控制器声明](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/OrderController.java:99>)；[图表接口与付款字段](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/OrderController.java:1061>)（1061–1156 行）；[订单查询](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/OrderController.java:3510>)（3510–3543 行）；[收款维护接口](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/fund/controller/ReceiveBillController.java:14>)（14–46 行）。

权限可参考 `OrderGrossProfitReportPermissionService`：后端每次读取当前用户、当前组织，业务员强制本人；不是相信前端传来的 ownerId。[权限代码](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitReportPermissionService.java:40>)（40–78 行）。这只是已有模式，不代表新接口已接通该权限。

### 8. 适配建议与尚未解决的映射

采用独立、按分录归一的收款事实集合比直接相加两种订单总额更符合源数据：一张收款单可以关联多张订单；同一订单也不能在接口确认前假定只有一张收款单。

建议保留 `receiptId`、`receiptNumber`、`entryId`、`sourceEntity`、`sourceDocumentId`、`sourceDocumentNumber`、源类型/备货类型、支付与两级审核状态、支付时间、金额三个层次（应收/实收/客户支付）、币种和归属维度。源码只确认了 `hzkj_src_order` 文本关联；**分录稳定主键在真实响应中的名称、是否暴露转换关联 ID 均待接口验证**。如可取得分录 ID，用收款 ID + 分录 ID 形成事实唯一键，源单号不可单独作为收款唯一键。

适配顺序建议：

1. 由可信后端确定用户、组织和可访问收款范围；保留按收款 ID 的允许集合，不能把“能看源订单”自动当“能看全部相关收款”。
2. 读取收款头 ID 集合，再加载分录；现有报表采用此方式避免直接连接展开造成重复统计。
3. 按分录源类型和源单号解析来源。A 关联履约实体；C 关联备货且必须 type=1；type=2 永不进入本次业绩。
4. 保留源单与收款单审核状态，按照此次业务口径完成已付款、已审核筛选。现有报表的收款单审核条件不自动证明源单已审核。
5. 以分录实收计此次“实收”指标，并保留应收/手续费用于核对。不得用原平台订单金额、商品明细额重建已减免备货产品款；不得再扣一次备货。
6. 按已明确的业务时区和支付月份汇总。备货承运商标记为不适用；承运商统计采用履约/发运事实，仓库可关联备货收货仓库。

真实接入前仍需验证：

- 可调用的只读收款查询契约、完整网关路径、鉴权方式、分页、增量游标；本次未建立任何生产连接。
- 当前方案2实现已固定以分录实收计业绩、订单金额和手续费另列；真实接入需核对各支付渠道字段含义、退款及授信结算，不能混用三种金额。若财务制度与该基线不同，登记明确变更，见人工核对H07／H09／H12。
- 源订单审核与收款审核的业务关系及审核日期响应。月份已固定按UTC+8支付月；仍需说明迟审核如何回补历史、是否关账锁定，而非重新选择审核月，见H08。
- 收款客户、客户当前业务员、收款业务员、订单业务员之间的归属优先级；需要选择后固定，不能把不同角色姓名混合分组。
- 原始明细 ID、来源 ID 的稳定性，历史分录实收完整性及头行金额一致性。
- 订单决策渠道与实际发运承运商两种维度的选择；一个订单多包裹、多渠道时不能把一笔收款全额重复分配给多个承运商。
- 生产部署是否包含本工作树中的元数据及回调改动。

以上不阻碍前端使用明确标注的演示数据与归一接口边界；它们阻止的是把尚未验证的接口、状态或金额猜测包装成“真实 FOP 已接通”。

后续工作、建议负责人、具体资料与完成标准统一维护在 [后续待办与人工核对清单](FOLLOW_UP_CHECKLIST.md)，并收录到完整需求第7章。

### 9. 物流运费：已核实字段、结算边界与独立权限

本节是本次物流运费分析的只读源码核查结果。平台已有 `/api/autoflow/integrations/fop/freight` 与 `/freight/details` 契约及独立 Mock；**没有证据表明真实 FOP 已发布对应只读分析 HTTP 接口**。下列 Java 服务、任务或表单存在，不代表可以把其名称拼成生产 URL。

#### 9.1 当前实际成本事实

| 平台字段／规则 | FOP 源事实 | 适配说明 |
| --- | --- | --- |
| id / documentNumber | `hzkj_deliver_bill.id/billno` | 每发运单一条当前快照；同一订单多次发运不按订单号去重；重复发运单 ID 拒收 |
| originalAmount | 表头 `hzkj_actual_freight` | 实际物流成本，不是客户收费、预估价格或订单金额 |
| originalCurrency | 表头 `hzkj_textfield1` | 必须从真实币种字段取得，不从 Java 变量的 Rmb 后缀推断 |
| confirmedAt | `hzkj_actual_freight_time` | 同步取得费用后写入苍穹的确认时刻；按 UTC+8 归日／月／周／年；不等于银行付款日或最终结账日 |
| reviewStatus / costStatus | `billstatus='C'`；实际成本为正且有确认时刻 | C映射approved；confirmed是适配器依据已核实金额/时间建立的归一状态，未证明源有同名状态枚举。未确认或零金额不纳入，正数缺时间拒收 |
| carrierCode/Name / channelName | `hzkj_logistics_providers` / `hzkj_logistics_channel1` | 采用发运单实际选择的服务商／渠道；真实编码显式映射YT/4PX/WB/YW/JS/OTHER，不能根据名字猜测，未知不能静默OTHER |
| warehouseCode / warehouse | `hzkj_basedatafield` | 映射真实杭州/深圳仓ID；归一HZ/SZ，不从订单归仓替代发运归仓 |
| customer / owner / organization | `hzkj_customer` / `hzkj_bizoperator` / `org` | 稳定ID及名称；部门/祖先路径需要可信目录或源字段补充，不能按文本推断权限 |
| orderNumber / trackingNumber | `hzkj_order_no` / `hzkj_logistics_orderno` | 源订单号及物流订单号；运输跟踪号另有字段，实际展示语义待真实样本核对，不把物流号作为唯一事实ID |
| fxRateToUsd/Date/Source / amount | 尚无已核实的统一历史USD折算字段 | 平台强制显式原币到USD汇率、取价日与来源，amount须等于精确十进制乘法HALF_UP折算后分币（1.50×0.15=0.23）；USD原币rate=1。Mock汇率仅样例，不能做生产历史汇率 |

源码证据：[实际运费及确认时间元数据](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_logistics/metadata/hzkj_deliver_bill.dym:4001>)；[实际运费币种](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_logistics/metadata/hzkj_deliver_bill.dym:3841>)；[已审核表头成本查询及正数缺时间错误](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/OrderLogisticsCostQueryService.java:37>)；[发运维度字段](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/DeliveredOrderVolumeReportService.java:48>)；[订单号与物流号读取](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/exception/FreightExceptionService.java:81>)。

#### 9.2 原币与“最终结算”的限制

云途、4PX、万邦、燕文任务将供应商返回金额与币种直接写入表头，未在这些写入语句里统一折成人民币或美元。急速同步明确写 CNY。因此 `OrderLogisticsCostQueryService` 的 `actualFreightRmb` 变量名不能证明所有服务商金额均为人民币，不能直接把不同币种相加后标记USD。

证据：[云途金额及币种写入](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/task/SyncYunTuFreightTaskPlugin.java:68>)；[4PX](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/task/Sync4pxFreightTaskPlugin.java:76>)；[万邦](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/task/SyncWanbFreightTaskPlugin.java:68>)；[燕文](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/task/SyncYanWenFreightTaskPlugin.java:69>)；[急速CNY和确认时间](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/JsexpActualFreightSyncService.java:130>)。

`OrderLogisticsCostQueryService` 明确注明费用单据体已移除，`collectSubsequentFees` 调用被注释；保留 redispatch/refund 代码不等于已计入重派或退费。常规候选无独立完成时间字段时，仅选择 `hzkj_actual_freight IS NULL OR =0`，首次正值之后不会由该候选规则自动重新采集。燕文取返回数组第一条；急速解析 `timeIn` 并选择记录，这些读取策略本身不能证明取得最终账单。因此当前能力是“已确认实际成本快照”，不承诺完整物流结算账本、最终实付成本或后续退款净额。

证据：[停用后续费用采集](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/OrderLogisticsCostQueryService.java:83>)；[首次候选条件](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/FreightSyncCandidateService.java:183>)；[燕文第一条记录](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/task/SyncYanWenFreightTaskPlugin.java:69>)；[急速时间解析](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/JsexpActualFreightSyncService.java:190>)。

#### 9.3 成本授权和真实查询接口

`DeliveredOrderVolumeReportService` 限当前组织；有 `hzkj_bizperson` 档案时限制本人，无档案时组织全员。这是该单量报表的规则，不能自动成为物流成本权限，更不能让没有业务员档案的本地账户因此查看组织所有成本。

可信权限模式可参考 `FreightExceptionService.currentOrg/requireRight`：检查当前登录组织、`hasViewPermission` 和单据 `checkOperationRule`。它是可借鉴的服务端权限实现，仍需正式定义运费金额是否有额外字段权限。平台当前同时要求 `freight` analytics scope、独立 `allowedFreightIds`，并与 tenant、本人／部门／业务管理员范围求交；系统管理身份和订单 allowlist 均不授予成本可见性。公开序列化剥离 `tenantId/departmentPathIds`。

证据：[单量报表当前组织和员工范围](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/DeliveredOrderVolumeReportService.java:137>)；[有无业务员档案的分支](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/DeliveredOrderVolumeReportService.java:180>)；[组织及单据权限校验](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/exception/FreightExceptionService.java:49>)。

`JsexpActualFreightController` 的 `/actualFreight` 是 POST同步并回写发运单的维护接口，不是只读分析接口，不应由分析页面调用。[控制器写入行为](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/controller/JsexpActualFreightController.java:23>)。真实只读URL、鉴权、分页完整性、授权刷新和脱敏响应须由FOP研发提供；最终结算、币种汇率、调价补收退款、成本权限和服务商映射分别见 H18–H22。


## 14. 规范来源与文档再生成

OpenAPI 结构参考 [OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html)。产品事实来自本仓库源码和本次诊断，不来自通用规范。HTML 使用项目共享 HyperZone 样式、内嵌 CSS 和透明 SVG Logo，可离线打开及打印。

```sh
python3 -m venv .runtime/local-demo/docs-venv
.runtime/local-demo/docs-venv/bin/pip install -r scripts/docs/requirements.txt
.runtime/local-demo/docs-venv/bin/python scripts/docs/build-analytics-docs.py \
  --style-root /Library/VSCode/.hyperzone/html-style
```

`REQUIREMENTS_OVERVIEW.md` 是业务需求源，接口及字段表从 OpenAPI JSON 生成；修改后执行上述脚本同步两种交付格式。不同机器需提供同版本 HyperZone 共享样式目录；生成后的 HTML 本身无此路径依赖。
