# HyperZone ECharts / Dashboard 后台契约审计

更新日期：2026-10-23（UTC+8），保留2026-10-22审计。依据当前工作区源码、DTO、序列化器、前端API类型与历史测试；方案2、运费及销售个人收款／净毛利契约同步。未连接或验证真实FOP生产服务。FOP为金蝶云苍穹上的HyperZone自研应用，后台 `/Library/VSCode/dtr5b` 只读核查。

机器可读交付：[hyperzone-analytics.openapi.json](../openapi/hyperzone-analytics.openapi.json)，OpenAPI **3.1.1**。物流阶段为19条路径／19个操作／82个模型／8组通用错误响应，本次追加销售分析及明细两项契约；最新数量以机器文件为准。仅列平台HTTP接口，未实现的FOP上游签名、同步和分页接口没有被写成已实现路径。格式依据[OpenAPI 3.1.1官方规范](https://spec.openapis.org/oas/v3.1.1.html)。

## 1. 当前交付判断

图表所需的前后端聚合、查询、权限交集、明细钻取与分页汇总已经存在；**生产FOP数据接入尚未完成**。`UsersModule`只选择`DemoFopDataProvider`或`UnconfiguredFopDataProvider`，没有真实FOP数据适配器。演示仅在`FOP_DATA_MODE=demo`且`NODE_ENV`为`development/test/local`生效。没有演示开关时保持未配置状态，不会把fixture当真实业务数据展示。

客户 `series.amounts` 与 Dashboard `receipts` 已改为**独立授权的收款分录**：`amount=hzkj_real_receive_amt`；源单已支付、已审核且收款单已审核，来源履约＋全款备货，排除押金备货与样品，按支付时刻 UTC+8 归月。`orderAmount`、`handlingFee` 保留核对；使用已全款备货库存的履约不补回产品款。钱包授信可产生此类结算，因此不等同于银行新增现金流。历史期间按当前有效状态重算，未新增结账锁定、部分退款／冲销系统。

数量仍只计已支付、已审核履约订单；备货不计数量。客户金额沿用数量 Top10／other 集合，只有全款备货回款的客户仍能搜索、进入总计／other。独立 `allowedReceiptIds` 缺失即无收款授权，且需 receipts scope；无 scope 时客户省略 amounts、Dashboard 回款为空、收款明细 403。客户金额和 Dashboard 均提供履约／全款备货来源拆分。

物流运费新增独立发运单成本快照，使用 `allowedFreightIds` 与 `freight` scope，不从订单／收款授权推导。原币、原额、USD汇率及日期/来源强制保留，折算必须一致；已审核已确认的正成本按确认时间UTC+8归期。确认不等于最终结算，费用分录停用与首次候选规则使补收退款和后续调价仍有生产缺口，详见第8节。

## 2. 传输与错误边界

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

## 3. 已实现Endpoint清单

下表路径均相对于`/api`；各响应均为裸对象，字段定义以OpenAPI为准。

| 方法与路径 | operationId | 输入与成功响应 | 权限/行为 |
|---|---|---|---|
| GET `/autoflow/integrations/fop/data-access` | `getFopDataAccess` | 无query；`DataAccess` | 无业务权限也可检查状态；仅ready输出source/mode |
| GET `/autoflow/integrations/fop/order-volume` | `getOrderVolume` | `category`与时间条件；`OrderVolume` | 至少一个入口角色，租户/allowlist/业务范围求交 |
| GET `/autoflow/integrations/fop/order-volume/customers` | `searchOrderCustomers` | keyword、department、分页；`OrderCustomerPage` | keyword trim后1..100字符；pageSize默认10、最大50 |
| GET `/autoflow/integrations/fop/order-volume/orders` | `getOrderVolumeDetails` | 图表同查询+workbenchRole+series/period/明细仓；`OrderPage` | 必须拥有所传入口角色；不是履约队列筛选 |
| GET `/autoflow/integrations/fop/fulfillment-orders` | `getFulfillmentOrders` | queue、departmentId、search、orderNumber、分页；`FulfillmentOrderPage`（含部门选项，按收款升序） | queue对应角色强制校验；可选workbenchRole若不匹配则400 |
| GET `/autoflow/integrations/fop/receipts` | `getReceipts` | from/to、部门/员工/客户/仓库/来源、workbenchRole、分页；`ReceiptPage` | 独立收款 scope 与分录 allowlist；UTC+8 有效 USD 分录，分页前合计 |
| GET `/autoflow/integrations/fop/order-volume/receipts` | `getOrderVolumeReceipts` | customer 同图表查询及下钻参数；`ReceiptPage` | 先重建完整数量 Top10/other 集合，再收窄期间和仓库 |
| GET `/autoflow/integrations/fop/freight` | `getFreight` | grain/year、可选weekOf/warehouse/carrierCode；`FreightData` | freight scope与独立成本allowlist；月/周/年、USD、完整上期环比、partial |
| GET `/autoflow/integrations/fop/freight/details` | `getFreightDetails` | 同分析查询＋periodId/comparisonPeriod/workbenchRole/分页；`FreightPage` | 岗位权限再校验；current默认，previous完整上期；分页前USD/原币合计 |
| GET `/autoflow/integrations/fop/sales-performance` | `getSalesPerformance` | from/to/grain、可选ownerId；`PerformanceData` | sales工作台入口＋独立receipts/sales_profit scopes和各自IDs；本人锁定，经理／业务管理员选授权人员；预计与结算分开 |
| GET `/autoflow/integrations/fop/sales-performance/details` | `getSalesPerformanceDetails` | 同查询＋kind/periodId?/page/pageSize；`PerformancePage` | 相同人员和资源权限；收款／毛利明细分开，分页前总计，未分配月结参考单列 |
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

## 4. 字段、聚合口径与源码追踪

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
| Dashboard队列 | 当前全部授权订单，日期控件不影响队列；review/异常为sales，dispatch待履约、procurement待采购、allocation待配货、shipping待出库分别对应原岗位角色；fulfillmentProgress独立状态驱动五队列（最新需求第9节） | `dto/workbench.dto.ts`、`fop-data.service.ts:15`及`:203` |
| Dashboard注册 | 注册明细优先，按owner/部门业务范围过滤后合并、补0、校验重复键；缺台账时只有业务admin读取旧日汇总 | `fop-registration.ts`、`fop-data.service.ts:224` |
| Dashboard金额 | 独立收款分录，UTC+8 支付月；履约＋全款备货；上年12月 previousAmount/previousBreakdown，basis=actual_received | `fop-receipts.ts`、`fop-business-time.ts` |
| Dashboard任务/异常 | task.time 按 UTC+8 显示；异常 id 实际 orderNumber，不是 order.id | `fop-data.service.ts` |
| 本地Dashboard | 本地工作流/线索/outreach表，readBusinessOwners限定范围；funnel.value当前固定0 | `autoflow.service.ts:73`、`:604`及对应map函数 |
| 实时性元数据 | asOf/updatedAt是本次计算时间，没有upstreamUpdatedAt/snapshotId | `order-volume.ts:140`、`fop-data.service.ts:196`及`:254` |

`required`、显式`null`与字段缺失分别建模：例如paidAt、carrier、trackingNumber、exception允许null；organization/department/owner/customerCode缺失时省略；data-access的source/mode仅ready存在。`registrationDepartments`及Dashboard的businessScope在当前后端始终输出，即使前端旧类型写成可选或未声明，本规范也按实际输出记录。`ReceiptSeries`可表示marketing或员工，`ReceiptDepartment`才限定报表部门；两者描述独立。

### 仓库、物流、部门与金额对账

已审核履约的 warehouseCode 必须 HZ/SZ、carrierCode 必须 YT/4PX/WB/YW/JS/OTHER；缺失或未映射属于适配错误，不能正常归入未分配／其他。OTHER 仅接受可信适配器明确映射的已知其他服务商。全款备货必须有国内仓库，carrierCode=null 表示不适用，不能计入物流量。报表部门归一化为 sales1..sales4，不能用前端筛选代替授权。

数量 series 满足 total=sum(非 null values)，每期 HZ＋SZ=values。客户金额来自各自授权收款账本，来源拆分和仓库拆分各自合计为总实收；不得用订单明细 amountsByCurrency 与实收直接对等。收款 totals 在分页前汇总；收款行数、履约订单数、商品件数是不同单位。分录单条及累计均验证非负安全分币；订单旧总计的完整异常校验不因此自动完成。

## 5. FOP/provider现状与接入缺口

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

## 6. 接入验收要求（尚待真实FOP环境执行）

1. 以 HYPERZONE_FOP_SOURCE_MAPPING.md 已确认的实体、字段与状态为起点，取得实际发布 FOP HTTP 文档及脱敏样本，核验收款行 ID、源单关联、两类审核与支付、客户/员工/部门/仓库/物流、币种和支付时间；源码证据不能替代线上协议验证。
2. 对每个本地账户验证绑定唯一性、租户边界、独立订单／收款白名单、部门后代范围、员工归属及撤权即时生效；无权限时不能退回演示数据。
3. 对图表、同筛选明细、分页总计三方对账，包含空授权、重复分录拒收、未知已审核仓库/物流拒收、非USD、缺客户ID、未来日、跨月UTC+8、TopN/other、无注册台账等边界。
4. 按已确认方案2与财务业务结算对账：分录实收、订单金额和手续费分开，排除样品／押金备货，预付库存履约不补回产品款；包含钱包授信、迟审核、零追加收款和跨月用库存场景。
5. 定义上游超时、限流、失败重试、缓存权限键、数据新鲜度和一致性要求；进行真实规模吞吐/内存测试。当前前端axios超时30秒，不代表上游SLA已完成。

## 7. 历史诊断验证记录与本轮边界

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


## 8. 物流运费新增契约与生产差距

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

## 9. 销售个人收款与净毛利新增契约及FOP实施缺口

本工程以 `sales-performance.types.ts`、`sales-performance.ts`、`fop-data.service.ts` 和provider边界实现平台合同；前端/BFF／Mock交付及测试状态以VERIFICATION为准。**正式FOP只读HTTP、事件台账、历史成本／汇率、月结差额和真实用户权限仍需T21–T26实施验收，不能标为FOP ready。**

### 9.1 归一接口与校验

| 主题 | 本工程契约／当前实现 | FOP真实适配责任 |
| --- | --- | --- |
| 查询 | from/to为UTC+8业务日，2020起、不晚于今天，日期差最多365天；grain=month/week/day，周一分桶并裁切范围；ownerId可选 | 来源完整分页；不得把分页第一批当全量；新HTTP不接受历史asOf回放参数 |
| 响应 | source/query/timeZone/currency/asOf、owners/selectedOwner/canSelectOwner、periods/totals/unallocatedSettlements | source=fop必须来自真实配置的provider；asOf为本次查询时间，不代表上游一致快照或关账时刻 |
| 双资源权限 | sales入口＋receipts及sales_profit两个scope，独立allowedReceiptIds/allowedProfitIds，与tenant、本地本人／部门求交；无需枚举订单来推导许可 | 绑定真实用户，不用共用管理员扩大范围；独立成本／利润字段可见权和人员目录需映射 |
| 公开字段 | `FopProfitCandidate`的tenantId/departmentPathIds仅在服务端；publicProfit白名单重建FopProfit | 原始私有字段不能透传；未获授权候选先过滤，再校验／公开 |
| 利润日期 | recognitionMonth必填；estimated必须有recognitionDate，settled允许null；knownAt/cutoffAt必填；settled需approvedAt和settlementId | 发生／获知／审核日期不能互代；目前已知的历史月结可展示，不能据此声称历史审批回放 |
| 状态与运费 | estimated要求freightBasis=estimated、settlementId/approvedAt=null；settled要求frozen、有效审批和结算ID | 未结算即使有实际运费仍用预估；missing不是0；已审核来源冻结，不从当前成本重算 |
| 去重和版本 | id重复拒收；同订单同recognitionMonth多条已结算视为歧义拒收；一条已结算替换该组全部预计；预计同日期／同版本重复拒收 | 如上游同月有多版本，先规范成一个可追溯当期权威贡献；预计日内多事件需先归一日贡献，不能提交重复快照 |
| 当前asOf | 晚于查询时刻knownAt／approvedAt、未来recognitionDate不进入；客户端不能传权限或历史asOf | 各分量发生时间、knownAt、审批与cutoff证据由上游账本保证；BFF不能从合计行反推未来成本是否混入 |
| 未分配 | 无日归属月结在完整月使用；周／天／部分月settledGrossProfit=null、unallocatedCount及月结参考；参考不进入日周小计 | 需要日分配则提供权威分配明细；不能用审核日、付款日或均摊替代 |
| 明细与总计 | kind=receipts或profit；periodId必须在同一查询生成的桶内；page≥1、pageSize≤100；total/totals在分页前计算 | 统计和明细同账本、同授权；只有一种kind的数组返回行，另一数组为空；不能前端累计当前页当总计 |

`orderAmount/stockAmount/collectionsAmount`表示履约／全款备货／合计的实收业绩，复用方案2；不要与单条收款的orderAmount应收字段混淆。`settledGrossProfit/estimatedGrossProfit`沿用接口名称但业务含义是净毛利贡献，两项分列，不提供合并总利润。profitCount和receiptCount为事实行数，不能当订单数量。

### 9.2 金额恒等式与结算审计

`amount = incomeAmount + adjustmentIncome − productCost − freightCost − refundCost − returnCost − otherCost − previousRecognizedProfit + roundingAdjustment`。原始金额和结果允许有符号的分币；每项及合计必须有限、安全，amount与分量严格到分一致。roundingAdjustment仅为可审计换汇尾差，绝对值不超过0.10 USD。不能靠改变otherCost或尾差掩盖遗漏业务项。

所有公开分量为USD；保留originalAmount/originalCurrency/fxRateToUsd/fxRateDate/fxRateSource，原币USD要求rate=1，按显式汇率精确十进制HALF_UP到分验证正负原额的USD结果。FOP权威结算是CNY冻结delta，适配器不得用当前FX或当前收入成本重写它。逐分量换汇与最终delta换汇的尾差需可追溯；当前Dashboard汇率不是历史审计汇率。

FOP累计收入已经包含调整，`adjustmentIncome`单列时必须先从基础收入剔除，避免再加一次。全款备货按使用量转入收入与成本；备货收款不能再次确认为利润收入。国内采购物流、仓储、财务手续费在otherCost等约定分组中各计一次。previousRecognizedProfit用于从累计快照得到本期贡献，不能同时再减已扣过的前值。退款／退货收入冲减、成本返还与新增支出须分别定义符号，不能对一笔事件双扣。

### 9.3 当前FOP源码的P0差距

1. 月报只有C审核的月结净毛利delta和冻结归属；订单历史记录只有结算月、审核写入日、cutoff，没有权威日贡献。完整月可适配，周／天分配尚未具备。
2. `calculateRealtime`传null cutoff，缺国际运费按0；本次未结算强制预估的需求不能直接复用。候选按订单创建时间而非利润事件日。
3. 采购查询无cutoff；备货传入cutoff但未使用、忽略使用时间／状态；仓储明确不按通知日期截止。即便换用月结calculate(order,cutoff)，仍不能保证历史期间预计贡献不含未来事件。
4. 当前收款／调整按业务时间筛选，但读取当前审核状态；FX缺少历史取价能力；运费服务忽略源币种且后续费用／退款采集停用。需要发生／known／approved时间、版本、显式币种和事件账本，不能用0填缺口。
5. 未发现毛利分析HTTP发布证据。月报service接收空owner、org≤0不加组织过滤；实时非业务员默认组织全部。新个人入口必须独立身份／授权，不直接暴露服务参数。

逐项文件与行号证据见 `HYPERZONE_FOP_SOURCE_MAPPING.md` 第10节；这五项是已读源码限制，不是对线上部署行为的猜测。执行T21–T26、回填H23–H28并完成D16–D22／AT-18–AT-24后才能判定真实接入完成。本文不记录未经运行的测试通过数量。

## 10. 全局逐图授权与聚合范围审计

新图表许可在资源许可之前校验；真实数据仍受tenant、独立资源allowlist及本人/部门范围约束。CH-02部门回款与CH-03业务员回款必须使用分离响应字段，综合dashboard也不得附带明确禁止图表的数据。组织汇总必须校验独立FOP部门授权并只返回聚合，不能从当前个人记录伪造完整部门值。`Top10`、`other`、客户总数、占比、上期基线、仓库拆分与分页总计均在同一授权事实集上计算。

合同审计关注：未知图表默认拒绝；账号override唯一且不能扩大记录范围；PUT仅系统管理员；管理角色不授业务范围；明细chartId只能证明所请求的固定业务入口而不能任意选宽权限；经理个人默认绑定员工，缺失则不选择他人；客户当前归属与冻结历史分开。实际测试及代码检查结果统一记录VERIFICATION，本节不是测试通过证明。
