# ECharts 前端全量诊断

更新日期：2026-10-23（UTC+8），保留2026-10-22诊断。范围：`work-app/frontend` 全部 ECharts 实例、调用组件、直接相关 API 客户端、统计工具、路由、权限与测试。本文源码路径均相对于 `work-app/`。原诊断行号保留作历史定位；方案2及后续扩展应以当前函数／组件名定位，最终验证见 VERIFICATION.md。

原始诊断为只读；本轮按方案2更新了收款口径、来源拆分和工作台下钻，并修复 FE-01/FE-02。本文历史测试只证明当时结果，不能代替本轮验证。没有访问生产 FOP。结论区分“源码已实现”“本地测试已验证”“未实现”“生产待验证”，不能将 mock/stub 测试等同于真实浏览器或生产验收。

## 1. 覆盖范围与结论

2026-10-22初始全量搜索 `echarts`、`EChart`、`dataZoom`、`toolbox` 的历史基线为 **1 个 ECharts 初始化包装器、3 个业务调用文件、6 处 `<EChart>` 模板调用点、9 类面向用户的逻辑图表**，当时未发现另外的原生 `echarts.init` 实例、饼图、地图或独立第三方图表包装器。后续物流G10–G11和本次个人收款／净毛利G12–G13追加如下，不能将历史调用数当成当前全量数量。

- 包装器：`frontend/src/components/charts/EChart.vue:3`、`:60`。
- 业务调用：`frontend/src/views/autoflow/FopDashboardView.vue:222`、`:247`、`:257`；`frontend/src/components/order-volume/OrderVolumeResults.vue:67`、`:68`；`frontend/src/components/order-volume/CustomerOrderResults.vue:103`。
- 依赖声明：`frontend/package.json:28` 为 `echarts: ^6.1.0`；构建对 ECharts 和 zrender 分块：`frontend/vite.config.ts:31`。依赖声明范围不等同于生产部署版本。
- 入口：`/dashboard` 显示全部分析；`/workbench/:role?queue=order-analysis` 复用业务订单和客户订单两组分析。证据：`frontend/src/router/index.ts:28`、`:34`；`frontend/src/views/autoflow/WorkbenchView.vue:47`；`frontend/src/views/autoflow/FopDashboardView.vue:261`。

已有回款环比、合计、客户数量与金额并列、Top 10 + 其他、分仓、订单下钻、原生弹窗、暗色主题与响应式布局。原诊断证实的 **P2 日期标注和 P3 重复请求问题现已修复**，原证据保留于第 7 节。未发现可据本次前端证据认定的 P0/P1 问题；这不构成生产授权或财务口径正确性的证明。

## 2. 图表逐项盘点

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
| G12 个人收款趋势 | `SalesPerformanceView.vue`，`periods[].orderAmount/stockAmount`收款来源柱与collectionsAmount合计线 | 销售工作台；from/to、month/week/day、授权ownerId；金额是独立分录实收，按paidAt归期 | 同筛选收款明细；统计表倒序和分页；数据来源、UTC+8、USD及asOf可见 |
| G13 个人净毛利趋势 | 同页面，settledGrossProfit与estimatedGrossProfit两条独立曲线 | 已审核月结期间delta／预计贡献；归属月/日不沿用收款日，结算与预计不加成总利润 | null断线及待补充分期提示；月结参考独立展示；利润明细有收入／成本、上期已确认、版本、原币和FX |

表内短文件名的完整路径分别为 `frontend/src/views/autoflow/FopDashboardView.vue`、`frontend/src/components/order-volume/OrderVolumeResults.vue`、`frontend/src/components/order-volume/CustomerOrderResults.vue`、`frontend/src/components/order-volume/order-volume.css`。

## 3. API 字段级消费契约

公共 HTTP 客户端使用 `baseURL=/api`、cookie 凭证、30 秒超时，并直接返回 `response.data`，没有额外 `data` 包装层；会丢弃旧会话响应。证据：`frontend/src/api/index.ts:17`、`:31`。以下路径包含 `/api` 前缀。

### 3.1 Dashboard：GET `/api/autoflow/integrations/fop/dashboard`

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

### 3.2 订单聚合：GET `/api/autoflow/integrations/fop/order-volume`

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

### 3.3 客户搜索：GET `/api/autoflow/integrations/fop/order-volume/customers`

请求 `{ keyword, department?, page, pageSize:10 }`；keyword trim 后必须非空，输入最长 100 字符。结果 `{ source, items:[{id,code,name,departments:string[]}],total,page,pageSize }`。只有“编码不区分大小写完全匹配、items 中恰好一个匹配且 total=1”才自动选中；名称匹配仍点候选。搜索不传日期或仓库，因此可找到当前订单范围为零的获授权客户。证据：`OrderVolumeAnalysis.vue:83`、`:89`、`:92`、`:145`；完整类型 `frontend/src/api/fop-order-volume.ts:24`。

### 3.4 下钻：GET `/api/autoflow/integrations/fop/order-volume/orders`

请求继承聚合 `query`，新增 `workbenchRole`、可选 `seriesId/periodId/detailWarehouse`、`page/pageSize`（默认 1/20）。下钻路由为 `RoleWorkbench`，query 带 `queue=order-volume`；从 Dashboard 下钻先刷新岗位权限并取首个可用角色，从岗位页下钻沿用当前角色。证据：`OrderVolumeAnalysis.vue:99`；`frontend/src/views/autoflow/OrderVolumeOrdersView.vue:25`。

响应是 `FopOrderPage`，不是新造的图表明细格式：`source,items,total,totals,page,pageSize`。当前表格消费 `items[].id/orderNumber/shopifyOrderNumber/customerName/customerCode/items[].sku/name/imageUrl/variant/quantity/paymentStatus/amount/currency/organization.name/department.name/owner.name/salesperson/warehouse/carrier/paidAt/createdAt`；金额 totals 是全部筛选结果的 `{orderCount,itemQuantity,amountsByCurrency:[{currency,amount}]}`，不得仅返回当前页合计。证据：`frontend/src/api/fop-orders.ts:3`、`:11`、`:52`；`OrderVolumeOrdersView.vue:49`。

数量下钻仍调用订单明细，订单 totals 是订单金额。金额下钻改为 `/api/autoflow/integrations/fop/order-volume/receipts`，继承客户查询、seriesId/periodId/detailWarehouse，返回同一数量 Top10／other 客户集合中的有效 USD 收款分录。分仓和期间筛选不重新排名；收款 totals.amount 与图表实收口径一致，不能用订单金额替代对账。

## 4. 统计口径、金额与合计

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

## 5. 交互、状态与权限核查

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

## 6. 历史本地测试证据与盲区

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

## 7. 历史问题与修复状态

FE-01：refresh 在发起请求前保存 submitted，成功后 appliedRange/appliedYear 使用该快照。FE-02：首次 refresh 不再提升 orderVolumeRevision，后续全局刷新才提升。以下保留原复现证据；本轮回归结果见 VERIFICATION.md。

### FE-01 · P2 · 注册趋势可能标上未查询过的日期范围

**触发条件：**Dashboard 请求未完成时用户编辑注册日期；不需越权、不需畸形 API 响应。日期输入在 busy 期间仍可编辑，查询按钮被禁用。

**证据：**`frontend/src/views/autoflow/FopDashboardView.vue:112` 用调用时 from/to 发请求；`:117` 在 await 后重新读当前 from/to 作为 appliedRange；`:216`、`:217` 输入未绑定 disabled；`:221` 展示 appliedRange 与旧请求结果。

**复现：**延迟 dashboard 响应 → 请求原范围 A → 请求在途把开始日期改成 B（例如 2020-01-01）→ 返回 A 的合法统计（例如 23）→ 页面总量仍为23，旁边范围却显示 B—原结束日，而网络只请求过 A 一次。临时 Vitest 已断言：`getFopDashboard` 调用次数=1、请求 from≠B、标题范围包含B、总量=23。

**影响：**用户可能把 A 的统计读成 B 的统计；截图/导出旁边的数据说明也可能错误。金额图本身不受此日期标注问题影响。

**建议验收：**将请求快照作为 appliedRange 来源，或请求中锁日期；无论选择哪种实现，慢请求期间修改输入后，已显示统计范围必须等于对应实际请求范围。本轮已按上述方式修复。

### FE-02 · P3 · Dashboard 首次进入重复发起两组订单聚合请求

**触发条件：**正常首次挂载 `/dashboard`，不需要手动刷新。

**证据：**两个 OrderVolumeAnalysis 以 revision=0 挂载，`frontend/src/components/order-volume/OrderVolumeAnalysis.vue:80` 的 immediate watch 已调用 load；父组件 `frontend/src/views/autoflow/FopDashboardView.vue:124` 的 onMounted(refresh) 又在 `:106` 增加 revision，`:261`、`:262` 触发两子组件相同 query 再请求。

**复现：**mock 网络 pending 并挂载完整 Dashboard（不 stub OrderVolumeAnalysis）→ 记录 getOrderVolume 调用 → organization 两次、customer 两次，分别字段完全相同。临时 Vitest 已验证 4 次调用及两组参数相等。

**影响：**初次进入为这两个面板发送4次而非2次聚合请求；requestId 会丢弃旧响应，因此未证实重复展示或错误合计。额外后端成本与耗时要以生产测量为准，不能仅凭重复请求推断服务超载。

**建议验收：**区分首次加载与用户全局刷新；首次每面板只请求1次，全局刷新仍各请求1次。本轮已按上述方式修复。

## 8. 未实现与生产待验证清单

下列为明确功能边界或验收事项，不作为本次新发现的生产故障计数。

1. **未实现：**注册会员点下钻；除注册图外的图表导出、分析数据 CSV/XLSX 导出；分析筛选/图例/滑窗返回恢复；跨图图例联动；任意窗口缩放；弹窗局部错误重试实际路径；图形键盘漫游。是否新增应按业务优先级决定。
2. **生产数据：**对授权账号样本逐一核对每一图、表格、API、明细订单；核对注册 count 定义、回款金额源字段、支付/退款/取消状态、USD 过滤、非 USD 排除笔数、订单去重与金额精度。前端展示代码不能证明这些外部事实。
3. **时间边界：**跨年12月基线、UTC+8 午夜/月末与浏览器本地日期差异、当月截至目前、未来日期 null、历史全年与周跨年、日期跨度大时性能。Dashboard 和订单分析现已统一 UTC+8，历史直接使用浏览器本地时间的差异已修订；真实源时间戳仍须验证。
4. **权限边界：**系统管理员无业务权限、部门及子部门、员工本人、禁用/解绑/绑定变化、跨租户、生产权限接口不可用；保证聚合、options、搜索、明细使用相同有效授权，且不能靠编辑 URL 扩大范围。
5. **数量与金额对账：**总计=明细集合但不重复累计总计行；Top10+other(+unassigned)覆盖全量；分仓数组与总体一致；数量Top10和金额同集合；全部筛选结果 totals 独立于分页；other 点击必须严格回到同一剩余集合。
6. **真实图形验收：**亮/暗色、中/英文、窄屏、超长名称、同名业务员/客户、大金额、正负环比、零值/稀疏值、图例滚动、滑块拖动/触屏、多图联动、弹窗测量与关闭清理、SVG下载内容与字体。现有测试未覆盖这些完整视觉行为。
7. **可用性/性能：**长日期范围最多多年每日数组、分仓及客户金额双图的实际 SVG节点数/帧率、低端设备、窗口反复 resize、反复打开弹窗、网络超时/权限失败重试。前端未实现请求 AbortController，只阻止晚结果写回；不应把“丢弃旧响应”当作“请求已取消”。

## 附录 A：两项问题的可运行诊断片段

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


## 9. 物流运费前端审计补充

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

## 10. 销售个人收款与净毛利前端审计补充

本次前端源码入口为 `frontend/src/views/autoflow/SalesPerformanceView.vue`，API为 `frontend/src/api/fop-sales-performance.ts`，明细为 `frontend/src/components/sales-performance/SalesPerformanceDetails.vue`。新增页面与已有EChart包装器共用展示基础；本节描述合同与检查点，**不宣称测试或真实浏览器验收完成**。本地功能验证与生产FOP验收分开记录。

| 消费或交互 | 合同与检查点 |
| --- | --- |
| 查询与日期 | GET `/api/autoflow/integrations/fop/sales-performance`，from/to/grain及可选ownerId；周按周一分桶并裁切所选范围。默认本年初至UTC+8今天；后台限制日期从2020起、结束不晚于今天且跨度差最多365天；不能传历史asOf |
| 人员候选 | 使用响应owners、selectedOwner、canSelectOwner；个人不显示可越权切换入口，经理／业务管理员仅能在授权候选中选择；姓名同名时保持稳定ID，不自己构造全员目录 |
| 收款金额 | orderAmount=履约实收、stockAmount=全款备货实收、collectionsAmount=两者之和；总计线不与来源柱再次相加。全款备货使用不能另造第二笔回款；明细FopReceipt.orderAmount是应收核对字段，语义不同 |
| 净毛利 | 已结算与预计分别展示、预计用明确标识，不生成合并“总利润”；amount为当期净毛利贡献，允许负数。不能用收款金额直接减成本或用页面缓存重新算月结 |
| 无日分配 | settledGrossProfit=null显示“—／待补充分期明细”，图表connectNulls=false；unallocatedSettlements月结参考与日／周小计分开；不得均摊月差额或把null格式化为$0 |
| 状态 | profitStatus为none/estimated/settled/mixed/unallocated；mixed不是完成结算、也不是可相加许可。已结算表示对应版本已审核，不代表该订单未来再无调整 |
| 明细请求 | GET `/sales-performance/details`继承已应用from/to/grain/ownerId，kind=receipts或profit，可选periodId；page/pageSize只影响当前行，不改变完整筛选totals；不另传客户端权限列表 |
| 利润明细 | 显示归属日／月、状态／版本、审批及截止、收入和调整、商品／运费／退款／退货／其他成本、previousRecognizedProfit和roundingAdjustment；源CNY与USD、FX方向／日期／来源可核对；财务手续费归otherCost等分类由后台定义 |
| 金额精度 | 前端只格式化返回USD分币，不采用当前Dashboard汇率重算历史月结。换汇尾差为审计分量，不能与其他成本混写；展示负数符号和null区别 |
| 日期归属 | 收款按paidAt，利润按recognitionMonth/date；approvedAt、knownAt、cutoffAt是追溯／资格信息，不能替代利润日。历史range展示当前已审核该月值，不表示历史审批回放 |
| 图表和统计表 | 时间轴升序，统计表倒序、固定列宽；图表使用EChart滑块并保持外层滚动；筛选切换重置分页／关闭旧明细，标题来自实际应用条件 |
| 失败和会话 | 加载／失败／换人／退出／换号清理旧金额与候选，递增请求标识丢弃晚到响应；明细无权限也应使父统计失效，不能保留先前金额；403与合法空数据、503与0分开 |
| 数据来源 | source=mock明确显示MOCK；无真实provider不展示“已接通FOP”。asOf是本次计算时刻，不能写为上游最后同步成功或账期关闭时间 |

实际视觉验收至少包含AT-18–AT-24、D16–D22：本人和经理、当前未结算、历史完整月、部分月／日周null、负调整、月结参考、长姓名、窄屏／暗色、筛选竞态及明细分页。组件单测若使用图表stub，不能证明SVG、tooltip、滑块、断线和弹窗布局正确。完整测试及截图记录只以VERIFICATION为准；FOP事件账本、真实授权、换汇和财务对账仍由T21–T26完成。
