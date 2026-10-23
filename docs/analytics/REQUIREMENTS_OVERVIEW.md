# HyperZone ECharts 全面诊断与 API 对接需求

更新日期：2026-10-23（UTC+8）；保留2026-10-22既有诊断和需求。适用对象：前端、平台后端、FOP（金蝶云苍穹上的 HyperZone 自研应用）开发、测试与实施人员。

## 1. 交付结论与阅读方式

本轮覆盖仓库中所有 ECharts 运行入口：共享 EChart 包装器、注册会员、部门回款、业务员回款、业务订单量趋势/排名、客户订单量/金额排名、客户趋势弹窗，以及物流运费并列柱状图和单服务商趋势弹窗。履约卡片、任务、异常、工作日历虽不全部属于 ECharts，仍核对其图表相关数据依赖和边界。

当前项目具备前后端分析契约、服务端演示数据、用户级权限过滤与工作台跳转。**真实 FOP 数据提供器、授权解析和组织同步尚未完成；本文件不是已接入金蝶生产环境的证明。** 本轮已按用户确认的方案 2 更新本工程聚合、Mock、前端和契约；历史诊断单独标注，验证结果以 VERIFICATION.md 为准。后台源码只读核查，未改生产应用。

交付件：

- 本文 Markdown 与同名 HTML：接口清单、字段字典、统计口径、FOP 映射要求、验收用例、实现差距。
- `docs/openapi/hyperzone-analytics.openapi.json`：可供 Swagger Editor、Apifox、Postman 等支持 OpenAPI 的工具导入的契约；描述当前平台 HTTP API，而非虚构的金蝶原生接口。
- `ECHARTS_FRONTEND_AUDIT.md`、`ECHARTS_BACKEND_CONTRACT_AUDIT.md`：独立诊断证据，内容也收录在本文附录。
- `VERIFICATION.md`：本次实际检查与限制。
- `IT_HANDOFF.md`：最新全量交付的阅读顺序、实施边界、后台剩余工作和资料输入入口。
- `FOLLOW_UP_CHECKLIST.md`：第7章补充的后续待办与人工核对清单；按T/H编号记录优先级、建议负责人、输入、产物和完成标准，并提供脱敏验收样本及回填模板。

采用 [OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) 的 `paths`、`operationId`、`parameters`、`requestBody`、`responses`、`components/schemas`、`securitySchemes` 结构。可空使用 JSON Schema 的 `null` 类型；必填与可空分别表达。该版本选择用于稳定契约，不宣称它是最新规范版本。

### 1.1 全局强制规则：图表授权与员工数据范围

**优先级：P0，适用于全部业务模块。** 平台定位是公司内部员工办公。登录身份、岗位、员工／部门绑定及FOP授权由服务端读取；先限定数据范围，再做统计、排名、合计、占比、环比、搜索和分页。统计结果不能先按全公司计算再仅隐藏他人明细。图表、趋势、明细、搜索、下载和导出共用有效范围；筛选条件只能缩小范围。

| 身份 | 客户订单分析 | 业务员回款／订单量／物流费用 | 销售个人工作台 |
| --- | --- | --- | --- |
| 业务员 | 本人授权客户Top10＋授权范围内其他客户 | 本人获授权业务事实 | 强制本人 |
| 部门经理 | 管理部门及子部门成员的授权客户Top10＋其他 | 部门成员，包含经理本人；不能查看其他部门明细 | 默认本人；绑定缺失不得静默改成同事个人业绩 |
| 业务数据管理员 | 同租户、FOP许可的全部客户 | 同租户、FOP许可的全部业务事实 | 本人或主动选择的授权业务员 |
| 仅系统管理员 | 不因管理角色获得业务数据 | 组织、账号、角色维护与业务范围独立 | 仍需业务授权及销售岗位 |

客户原有数量排名、金额两行、分仓和趋势结构不变。Top10必须在权限过滤后排序，金额沿用同一客户集合；其他客户、客户数及占比均来自相同授权候选，不泄露全公司数量。例：员工18个符合条件客户，显示其前10个与余下8个合计，不能先取全公司前10再过滤本人。

### 1.2 逐图授权、组织汇总与明细分离

七个稳定授权资源为 `registrations`、`department_receipts`、`salesperson_receipts`、`order_volume`、`customer_orders`、`freight`、`sales_performance`。一个资源可以对应既有主图、排名、表格及趋势弹窗，不重新拆分ECharts页面。岗位／业务角色模板批量决定缺省权限，账号例外通过管理员配置；明确禁止优先，未知新图表默认拒绝。

- 图表可见性：继承／允许／禁止。允许图表不扩大订单、收款、费用或利润资源权限。
- 记录范围：继承／仅本人／本部门；最终不超过账号业务范围及FOP授权。销售、费用和毛利各自资源许可保持独立。
- 组织汇总：继承／不开放／指定业务部门／营销中心，独立于记录范围。只用于注册的组织汇总、部门回款和订单量的组织类别；不支持将客户或业务员图借此变为公司明细。
- 明细和导出：独立配置。图内已授权的统计表不等于底层业务单据明细；查看组织合计不授予成员、客户、订单或费用单据。没有业务导出接口的图不因配置而虚构CSV功能；图片下载也遵守导出能力。

组织统计维度保持原结构，不能以个人金额冒充“部门合计”。完整部门／营销中心汇总仅从独立授权的组织聚合源返回，不通过临时改成管理员、扩大订单白名单或向浏览器下发全量明细实现。普通员工默认没有完整部门汇总；经理默认管理部门；跨部门或营销中心汇总必须有明确本地授权和FOP许可。纯汇总响应不附带业务员／客户／订单标识，切换到成员或明细入口仍校验对应业务数据范围。

部门与营销中心完整汇总、本人／部门授权业务小计分别标明，范围提示不拼入“营销中心”下拉选项。图表布局、色彩、列宽、环比、时间控件、最新月份、USD及UTC+8规范维持原样。

### 1.3 身份、客户归属与历史业绩

登录账号必须绑定稳定员工ID和FOP用户；业务员姓名、邮箱、浏览器传入ownerId均不能决定权限。客户当前所属业务员用于当前客户管理；订单／收款归属用于对应事实的业绩；月结毛利沿用冻结业务员。客户转交不得自动把历史业绩转给新员工，历史可见性须由FOP移交授权明确。只有可信历史访问事实的记录才进入统计，不能靠当前客户姓名／当前归属重写历史。

新FOP适配器默认 `customerOwnershipMode=current_required`，必须提供 `currentCustomerOwner` 及历史访问规则，缺失时返回503。只有显式选择 `legacy_historical` 的旧适配器才可按历史授权事实兼容展示，并返回 `customerOwnershipBasis=historical_attribution` 或 `mixed` 供页面提示；不能声称已实现完整当前客户移交。当前归属用于进一步收窄客户范围，不扩大历史订单／收款访问，也不改变冻结毛利。

经理“包含本人”是指管理部门内自身业务；不自动并入其他部门的个人历史记录，跨部门历史访问仍需明确业务授权。经理Dashboard看部门管理数据，销售工作台默认看本人。单客户搜索是客户维度，不等于经理本人业绩。账号改权、解绑、调岗、禁用或会话切换后重新核验，迟到响应不得恢复撤销数据。权限缺失与合法无数据分开，禁止用0冒充无权限。

## 2. 图表与业务模块总览

| 编号 | 图表/功能 | 查询与展示 | API/字段依赖 | 明细与交互 |
| --- | --- | --- | --- | --- |
| CH-01 | 每日注册会员统计 | 开始/结束日期；右上角一个部门维度；营销中心显示部门汇总，具体部门显示合计及业务员 | `dashboard.registrations`、`registrationDepartments[].counts`、`salespeople[].counts` | 图例、提示框、日期清单；当前没有注册会员逐条名单 API |
| CH-02 | 部门月度回款分析 | 年份；营销中心＋四业务部；独立上月环比 | `departmentReceipts.months`、`previousMonth`、`marketingCenter`、`departments[].amounts/previousAmount` | 金额/差额/比例；合计；月份倒排；环比自动展开明细，取消保持展开 |
| CH-03 | 业务员月度回款分析 | 与部门回款共用年份；指定部门；部门合计与员工并列；独立环比 | `receipts.departments[].salespeople[]` | 固定表格列宽；金额/环比明细；可进入工作台收款分录下钻 |
| CH-04 | 业务订单量趋势 | 年份最前；物流服务商/组织/业务员；类别明细；月/周/日；仓库及分仓 | `order-volume.query/periods/series/warehouses` | 最新时间窗；图表点击进入对应工作台订单清单 |
| CH-05 | 业务订单量排名 | 同 CH-04 条件；含汇总对象和明细 | `series.total/kind/entityId` | 汇总不重复累加；业务员 Top 5＋其他；服务商固定顺序 |
| CH-06 | 客户订单量排名 | 日期范围、部门、仓库、分仓；Top 10＋其他 | `category=customer`；`series.total/warehouses` | 客户表每人两行；点击趋势打开弹窗；仓库数量可下钻 |
| CH-07 | 客户回款业绩对比 | 与 CH-06 完全相同客户集合和顺序 | `series.amounts.currency/total/values/warehouses/breakdown/excludedOrderCount` | `$`，两仓金额比较、合计及占比；不另取“金额Top 10” |
| CH-08 | 客户订单量趋势弹窗 | 按客户名/编码搜索后选择，或从排名点趋势；继承日期/部门/仓库 | `order-volume/customers`；`order-volume?customerId=...` | 居中弹窗、关闭/ESC、每日明细、滑块拖动、分仓 |
| CH-09 | 客户回款业绩趋势弹窗 | 与 CH-08 同筛选、同日期；与数量趋势同步拖动 | `series.amounts.values/warehouses` | 数量/金额双图，明细按日期倒排 |
| CH-10 | 物流运费分析 | 月/周/年、年份、周锚点及仓库；合计、云途YT、4PX、万邦WB、燕文YW、极速JS、其他固定顺序并列柱状 | `freight.query/periods/series/totals`；实际成本按确认时间 UTC+8 归期、USD | 独立环比开关、倒序统计表、固定列宽；开启环比展开表格，关闭不收起；仅拖动滑块调整横轴 |
| CH-11 | 单物流服务商运费趋势 | 继承已应用时间/仓库，按选中carrierCode显示该服务商 | 复用freight响应筛选单商；接口也支持carrierCode；各期 amount/previousAmount/delta/percent | 居中趋势弹窗；发运单原币/汇率/成本明细进入当前可访问岗位工作台 |
| CH-12 | 销售个人收款业绩 | 销售工作台；月/周/天、日期范围；个人强制本人，经理/业务管理员可选授权人员 | `sales-performance.periods` 的 `orderAmount/stockAmount/collectionsAmount`，按收款paidAt归期 | 统计表及收款分录明细；同一筛选下分页前合计；全款备货不重复计款 |
| CH-13 | 销售个人净毛利 | 与CH-12共用筛选；已结算与预计分开，USD；利润使用独立归属日期/月 | `settledGrossProfit/estimatedGrossProfit/unallocatedCount`、`unallocatedSettlements`，不能按paidAt代替利润归属 | 月结来源/版本与收入成本明细；无日分配的月结在周/天显示待拆分，不均摊、不显示为0 |
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

统一口径：订单与收款统计按 `paidAt` 先转换 UTC+8，再取业务日期/月；范围包含开始和结束当天。新增毛利独立使用 `recognitionMonth/recognitionDate`，详见第8节，不沿用付款日。传输时间戳必须携带时区（推荐 ISO 8601 UTC `Z`），纯业务日期使用 `YYYY-MM-DD`。

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
| 履约状态 | `reviewStatus`、`fulfillmentProgress.shopifySync/supplierShipment/stockReadiness/allocationReview/outbound` | 枚举见完整 schema | 审核与五项独立进度驱动待办，见第9节；旧采购／发运字段保留兼容但不驱动五队列 |
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

## 8. 销售个人收款与净毛利（月／周／天）

本节追加2026-10-23需求，保留前述所有模块和编号。交付目标是本工程销售工作台、BFF聚合／明细、独立授权、Mock和机器契约同步；其完成及测试结论以 `VERIFICATION.md` 为准。**这些产物不等于真实FOP已发布查询、具备历史利润账本或通过生产财务验收。** 后台源码本轮只读，真实适配保持未配置边界。

### 8.1 页面、查询和权限

入口为销售工作台，显示所选人员、应用日期、粒度、USD、UTC+8、数据来源和计算时刻。收款图分履约收款／全款备货收款；净毛利图和统计表分已结算／预计，不提供将两者相加的“总利润”。`mixed` 只表示范围内存在两种来源，不意味着可以无条件相加。负毛利和负调整允许展示。

平台接口（相对于 `/api`）为 `GET /autoflow/integrations/fop/sales-performance` 和 `GET /autoflow/integrations/fop/sales-performance/details`。共同查询 `from/to/grain=month|week|day/ownerId?`；明细另有 `kind=receipts|profit`、`periodId?`、`page/pageSize`。响应是裸对象，准确字段以 `backend/src/modules/fop-data/sales-performance.types.ts` 及OpenAPI为准，接口地址不是FOP原生发布地址。

个人账号必须由服务端锁定本人；经理／业务管理员只能选择当前授权交集中的人员。系统管理员身份不自动授予业务权限。利润要求独立 `sales_profit` scope 与 `allowedProfitIds`，收款仍使用 `receipts` 与 `allowedReceiptIds`；不得从订单、收款或运费授权推导利润可见性。人物候选、聚合、明细、分页合计均先做同一租户／身份／业务范围校验。退出、换号、撤权、筛选失败和在途请求不得保留越权旧数据。

### 8.2 收款与利润是两个独立事实

| 概念 | 固定口径／契约 |
| --- | --- |
| 收款日期与金额 | 复用方案2，按有效收款分录 `paidAt` 归UTC+8日/月；`orderAmount` 是本响应的履约收款合计，`stockAmount` 是全款备货收款合计，二者之和为 `collectionsAmount`。此处汇总字段不等于单条 `FopReceipt.orderAmount` 应收订单金额 |
| 利润归属 | `recognitionMonth=YYYY-MM`、`recognitionDate=YYYY-MM-DD|null`；不从paidAt、订单创建日、月结审核日猜测。月结版本关联月与跨期调整月分别保存 |
| 已结算 | 只认已审核月结和对应不可覆盖的订单结算版本。`amount` 是该期净毛利差额；不能累计各版本整单毛利。`approvedAt` 是审核已知门槛，不是经济归属日 |
| 未结算 | `status=estimated`、`freightBasis=estimated`，使用截至asOf已知的收入、采购、库存转入、退款／退货／调价等事实和预估运费；即使已有实际运费，也不能在审核结算前擅自切为实际成本 |
| 结算替换 | 同一订单、同一利润归属月存在合格已审核结算时，以该期权威贡献替换该期预计贡献；不能双计。跨月后续调整独立落入其结算／确认月，不覆盖历史月、不重复确认完整订单利润 |
| 汇总 | `settledGrossProfit:number|null`、`estimatedGrossProfit:number`分别返回；名称沿用接口，业务展示明确为净毛利。`receiptCount/profitCount`是各自事实行数，不是履约订单数 |
| 版本和截止 | `id/orderId/settlementId/version/knownAt/approvedAt/cutoffAt`保留追溯；截至asOf未知、未来发生或未来审核的事实不准进入。响应asOf只是计算边界，历史完备性必须由上游账本证明 |

全款备货回款只进入收款指标。利润仅在有效库存使用时，按用量转入对应销售收入和成本；履约实际追加收款中的产品额已在FOP减免，不补回第二次。`incomeAmount`的认定与收款实收不是同一数值模型，不能拿 `collectionsAmount` 减成本替代利润。

`asOf`由服务端在本次查询生成，查询参数不接受历史asOf回放。查询历史日期范围时，可以展示截至当前查询时刻已完成审核的该月权威结算值；这不表示平台已经能够还原当月末当时的审批状态。发生／known／approved时间和cutoff是上游事实归属及当前截断证据，历史审批回放仍是未交付能力。

### 8.3 月结无法直接拆为周／天

完整自然月可使用 `recognitionDate=null` 的已审核月结贡献，按 `recognitionMonth` 入月。周／天或只覆盖部分月份的查询，无法可靠分配这类月结金额时，`settledGrossProfit=null`，`unallocatedCount>0`，并保留 `unallocatedSettlements[{month,amount,count}]` 作月结参考。页面显示“月结金额待日分配”；参考金额不进入当前日／周小计，也不能按天数均摊。空事实为0、未分配为null、无权／上游错误是不同状态。

预计日／周金额也必须是该期贡献差额。上游应建立带发生时间、获知时间、审核时间和版本的事件账本，或可复现的历史快照差分；**不能把每天的整单累计预计毛利相加**。现有实时FOP报告按订单创建时间筛候选、读取查询时全部当前数据，不能直接作为本接口的历史日报。没有可靠历史事实的部分必须标注不具备能力，不能伪造日归属。

### 8.4 金额构成、币种和审计换汇

契约恒等式：`amount = incomeAmount + adjustmentIncome − productCost − freightCost − refundCost − returnCost − otherCost − previousRecognizedProfit + roundingAdjustment`。所有公开分量和结果均为USD；`otherCost`需明确包含国内采购物流、仓储、财务手续费等未单列成本，每项只归一处。退款收入冲减与退款成本须按真实事实分别映射，不能对同一退款在两个位置重复扣减。`roundingAdjustment`只用于可审计的换汇分币尾差，绝对值不超过0.10 USD，不能隐藏缺项成本或业务调价。

FOP快照的 `hzkj_gp_income_usd/rmb` 已经包含收款调整。适配器若另填 `adjustmentIncome`，必须先从 `incomeAmount` 中扣除该调整；或者收入保留含调整值、独立调整分量为0并在审计明细追溯，不得再次增加调整。备货转入收入／成本只各计一次。已确认的前版本累计利润通过 `previousRecognizedProfit` 抵减，得出本期delta；不能将当前累计利润直接放入 `amount`。

已审核CNY冻结金额应作为权威原额保存，不用最新成本或最新汇率重算历史月结。归一字段保留 `originalAmount/originalCurrency/fxRateToUsd/fxRateDate/fxRateSource`，按有证据的审计换汇规则生成USD差额并验证分量恒等式；USD原币rate=1。若差额原币换汇与逐分量换汇存在舍入差异，必须定义可追溯处理规则，不任意修改成本凑数。缺预估运费、币种、历史汇率或截止证据属于未具备可靠核算能力，不能默认为零。

### 8.5 新增验收场景与实施待办

| 编号 | 场景 | 验收要求 |
| --- | --- | --- |
| AT-18 | 个人与人员选择权限 | 本人强制限定，经理只见授权团队，系统管理不扩大业务；独立利润授权、空集合、跨租户和在途撤权均正确 |
| AT-19 | 支付与利润日期分离 | 跨月支付／首次结算／后续调整分别归期；已结算订单不按付款日重复计完整利润 |
| AT-20 | 预计与月结版本 | 未结算强制预估运费；同订单同月结算替换预计；草稿不可当结算，跨月负调整独立贡献，汇总不合并预计与结算 |
| AT-21 | 无日归属月结 | 完整月按结算月，周／天及部分月返回null／待拆分及月结参考；无均摊、无伪零、无参考额重复合计 |
| AT-22 | asOf与未来事实 | 晚于本次查询asOf的付款、采购、库存使用、退款、退货、调价、汇率、审核或knownAt均排除；历史range可展示当前已审核月结，但不得宣称支持历史审批状态回放 |
| AT-23 | 成本分量与备货防重 | 恒等式到分一致；调整已含收入不重复加，全款备货回款与库存使用不重复确认利润；CNY冻结差额及USD换汇可追溯 |
| AT-24 | 页面、明细及错误 | 月周天／人员切换、倒序固定列表、负数与null、同筛选明细及分页前合计；会话切换、错误和过期响应清空；真实ECharts渲染与窄屏验收另记结果 |

后台缺口及逐项源码证据见源码映射第10节；新增任务T21–T26、人工资料H23–H28、样本D16–D22见后续清单。所有验收结果统一由 `VERIFICATION.md` 记录，需求存在和Mock样例不表示已通过验收。

### 8.6 冻结归属变更与预估撤销

同订单同确认月发生业务员调整时，BFF在已授权业务范围内先做结算替代，再选择业务员，避免管理员选择旧业务员时仍看到已替代的预估。若最终冻结月结属于另一主体且当前用户没有该事实权限，平台不得越权读取其金额用于去重；FOP适配器必须在授权返回前撤销／过滤已替代预估，或提供不含他人金额的可信失效标识。该能力属于T22/T24上线前条件，纳入H25人工核对及D18/D22验收。


## 9. 五类履约待办队列（2026-10-23 修订）

Dashboard 依次显示 **待审核 → 待履约 → 待采购 → 待配货 → 待出库**。原“待发运”改“待履约”，原“待发货”改“待出库”；新增采购卡片。点击卡片直接进入对应岗位工作台清单，订单号、Shopify 单号、客户、商品图片、SKU、数量、金额、支付状态、业务员等字段继续保留。状态列只展示当前队列相关事实，分页及金额／数量合计沿用全筛选结果。

| 顺序／名称 | API 队列键／岗位 | 入选条件（共通：已付款、未取消、未退款） | 清单状态显示 |
| --- | --- | --- | --- |
| 1 待审核 | `review`／sales | `reviewStatus=pending` | 待审核 |
| 2 待履约 | `dispatch`／dispatch | 已审核，`shopifySync=pending/partial` | 待同步 Shopify 发货／部分同步·待完成 |
| 3 待采购 | `procurement`／procurement | 已审核，`supplierShipment=pending/partial` | 供应商未发货／供应商部分发货 |
| 4 待配货 | `allocation`／allocation | 已审核，`stockReadiness=incomplete`，或 `ready` 且 `allocationReview=pending` | 库存未齐套／已齐套·待审核 |
| 5 待出库 | `shipping`／warehouse | 已审核，`stockReadiness=ready`、`allocationReview=approved`、`outbound=pending/partial` | 配货已完成·待出库／部分出库·待完成 |

- Shopify 同步、供应商发货、库存齐套、配货审核、仓库出库是独立事实，不能用单一顺序状态推导。采购下单不等于供应商已发货；已齐套不等于配货已审核；Shopify 已同步不等于仓库已出库。
- **统计粒度为履约订单**。上游先汇总有效 SKU、来源分录及包裹，再提供订单级进度；同队列订单 ID 去重。不同队列允许重叠，五卡数量不得相加称作订单总量。
- 部分同步／部分供应商发货／部分出库仍有剩余事项，计入相应待办。无需采购的备货库存及虚拟商品不能制造供应商待发货；无 Shopify 发货同步需求返回 `not_required`。状态语义与真实枚举由适配器归一化，不能按空字符串猜测。
- 新增 `FopOrder.fulfillmentProgress` 必填对象：`shopifySync`、`supplierShipment`、`stockReadiness`、`allocationReview`、`outbound`。枚举含 `unknown`，只在有明确信息时入选相应队列；缺失／非法进度返回 `503 fop_unavailable`，不悄悄回退旧逻辑或 Mock。
- 保留 `dispatch/shipping` URL 与 API 键及岗位授权，以兼容旧收藏；**这两个键的业务筛选口径已经更新**。既有 `procurementStatus/allocationStatus/dispatchStatus/shippingStatus` 保留兼容，前五队列不再使用这些旧粗粒度字段；异常队列旧口径保持。
- `dashboard.queues` 新增必填 `procurement`；`tasks.kind/id` 扩展到五个队列，有权限且非空才输出，顺序与卡片相同。日期控件仍不影响待办队列。
- 全局数据隔离继续生效：先取登录账号对应的 FOP 订单白名单与本人／部门／管理员交集，再按岗位过滤和统计；没有采购岗位权限不能查看采购清单。卡片、清单、分页合计必须来自同一口径。

**当前落地**：前端、BFF、Mock、OpenAPI 已同步；真实 FOP 网络适配器仍未接通。本次不修改财务统计规则或 FOP 源代码。字段证据见源码映射第12节，后续联调见 T31/H33/D30。
