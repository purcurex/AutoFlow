# HyperZone ECharts / Dashboard 后台契约审计

审计日期：2026-10-22。依据当前工作区源码、DTO、序列化器、前端API类型与测试；本次不修改业务代码，也未连接或验证真实FOP生产服务。

机器可读交付：[hyperzone-analytics.openapi.json](../openapi/hyperzone-analytics.openapi.json)，OpenAPI **3.1.1**，**15条路径、15个操作、64个数据模型、8组通用错误响应**。仅列当前已实现的AutoFlow HTTP接口；未实现的FOP上游签名、同步、分页和收款流水接口没有被写成已实现路径。格式依据[OpenAPI 3.1.1官方规范](https://spec.openapis.org/oas/v3.1.1.html)。

## 1. 当前交付判断

图表所需的前后端聚合、查询、权限交集、明细钻取与分页汇总已经存在；**生产FOP数据接入尚未完成**。`UsersModule`只选择`DemoFopDataProvider`或`UnconfiguredFopDataProvider`，没有真实FOP数据适配器。演示仅在`FOP_DATA_MODE=demo`且`NODE_ENV`为`development/test/local`生效。没有演示开关时保持未配置状态，不会把fixture当真实业务数据展示。

客户统计的新增`series.amounts`已经贯穿后端聚合、前端类型和本规范，包含USD总金额、逐期金额、三仓金额及排除订单数。界面称作“收款/回款”的Dashboard数据，实际来自已支付订单的`amount`，**不是独立金融收款台账**；分次付款、部分退款、退款冲销和订单金额与实付金额差异尚未建模。

## 2. 传输与错误边界

| 项目 | 当前实际行为 | 源码证据 |
|---|---|---|
| 基础路径 | `servers.url=/api`；各path不再重复`/api` | `backend/src/main.ts`的`setGlobalPrefix('api')`；`frontend/src/api/index.ts`的`baseURL` |
| 响应包裹 | Controller直接返回对象；无`{code,data,message}`成功包裹。前端拦截器返回`response.data` | `workbench.controller.ts`、`RequestAuditInterceptor`原样返回`value`、`frontend/src/api/index.ts` |
| 鉴权 | JWT Bearer或`autoflow_session` cookie二选一；提取顺序cookie优先 | `backend/src/modules/auth/jwt.strategy.ts` |
| 即时授权 | JWT只提供身份；每次查当前账户role/businessRole，FOP读前后复查绑定、业务范围和入口授权 | `jwt-auth.guard.ts`、`fop-data.service.ts:59`及`assertUnchanged` |
| 参数验证 | 全局`whitelist + forbidNonWhitelisted + transform`；有DTO的图表接口禁止客户端传tenantId/userId/scope等额外字段 | `main.ts`、`fop-data.dto.ts`、`order-volume.dto.ts` |
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
| GET `/autoflow/integrations/fop/fulfillment-orders` | `getFulfillmentOrders` | queue、search、orderNumber、分页；`OrderPage` | queue对应角色强制校验；可选workbenchRole若不匹配则400 |
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
| `total/customerCount` | 当前筛选paid、未取消未退款、有有效paidAt且不在未来的订单；非carrier还要求报表部门；客户ID去重 | `order-volume.ts:63`、`:140` |
| `series` | 首项total；物流固定6项，业务员Top5，客户Top10，剩余other；名称相同不合并ID | `order-volume.ts:83`至`:113` |
| `values/warehouses` | 与periods同下标；未来日null，其余空期0；HZ/SZ以外归UNASSIGNED | `order-volume.ts:20`、`:123`至`:138` |
| 客户新增`amounts` | 仅customer每条series均含currency=USD/total/values/warehouses/excludedOrderCount；筛掉非USD或非finite金额后以分累计 | `order-volume.ts:131`至`:138`；`frontend/src/api/fop-order-volume.ts` |
| `detailWarehouse` | 与查询warehouse取交集；先构建完整排名/other，再缩窄明细期间与仓库 | `order-volume.ts:143`至`:150` |
| `totals` | 分页前完整筛选范围；订单数、所有商品件数、原币种金额各自求和；USD排序优先 | `fop-order-totals.ts`、`fop-data.service.ts:167`及`:190` |
| 客户搜索 | 授权有效订单中按customerId建目录，包含未支付；编码精确命中优先，之后编码/ID排序；departments为中文名 | `order-volume.ts:153`至`:165` |
| Dashboard队列 | 当前全部授权订单，日期控件不影响队列；review/异常为sales，采购/配货/调度/仓库分别对应角色 | `dto/workbench.dto.ts`、`fop-data.service.ts:15`及`:203` |
| Dashboard注册 | 注册明细优先，按owner/部门业务范围过滤后合并、补0、校验重复键；缺台账时只有业务admin读取旧日汇总 | `fop-registration.ts`、`fop-data.service.ts:224` |
| Dashboard金额 | paid订单amount，仅USD/有效报表部门/非负安全分币；`paidAt.slice(0,7)`归月，上年12月做previousAmount | `fop-data.service.ts:227`至`:260` |
| Dashboard任务/异常 | task.time截取最早createdAt的HH:mm；异常id实际orderNumber，不是order.id | `fop-data.service.ts:210`及`:255` |
| 本地Dashboard | 本地工作流/线索/outreach表，readBusinessOwners限定范围；funnel.value当前固定0 | `autoflow.service.ts:73`、`:604`及对应map函数 |
| 实时性元数据 | asOf/updatedAt是本次计算时间，没有upstreamUpdatedAt/snapshotId | `order-volume.ts:140`、`fop-data.service.ts:196`及`:254` |

`required`、显式`null`与字段缺失分别建模：例如paidAt、carrier、trackingNumber、exception允许null；organization/department/owner/customerCode缺失时省略；data-access的source/mode仅ready存在。`registrationDepartments`及Dashboard的businessScope在当前后端始终输出，即使前端旧类型写成可选或未声明，本规范也按实际输出记录。`ReceiptSeries`可表示marketing或员工，`ReceiptDepartment`才限定报表部门；两者描述独立。

### 仓库、物流、部门与金额对账

仓库只按`warehouseCode`映射HZ/SZ/UNASSIGNED；物流只按`carrierCode`映射YT/4PX/WB/YW/JS/OTHER，顺序固定；展示名称不作为稳定键。报表部门必须由可信适配器把实际组织树归一化为sales1..sales4，不能用前端传参代替权限。

每个数量series应满足`total=sum(非null values)`；每期三仓和等于values。客户金额与同一授权订单、时间桶、仓库映射对应，但非USD订单仍计入订单数，金额会排除并增加excludedOrderCount。明细`amountsByCurrency`保留所有币种，因此不能将其混币总和直接与客户USD金额比较。整数分币解决常见0.1+0.2误差，不等于已完成所有金额异常/溢出校验。

## 5. FOP/provider现状与接入缺口

| 优先级 | 当前事实与影响 | 证据 | 生产接入要求 |
|---|---|---|---|
| P0 | 没有真实FOP数据provider。API路由/前端图表已实现，不能据此宣称生产对接完成 | `users.module.ts:21`工厂只返回Demo或Unconfigured；`fop-data.types.ts`抽象provider | 明确真实上游鉴权、地址、权限解析、订单/注册/汇率契约，再实现适配器；不凭空约定FOP路由名 |
| P1 | Dashboard金额不是独立回款账；部分支付/部分退款/冲销没有模型 | `fop-data.types.ts`只有amount/paymentStatus/paidAt；Dashboard直接累加amount | 先确认“已支付订单金额”还是“实际收款净额”；若为后者需要独立交易ID、金额、币种、类型、到账/撤销时间及订单关联 |
| P1 | 统计时区不统一；同一临界支付可出现在不同月份 | `order-volume.ts:7`加8小时；`fop-data.service.ts:235`直接slice月份；当前年/月采用UTC | 统一业务时区与日/月界线；验证`2026-01-31T16:30:00Z`应归上海2月，当前Dashboard归1月 |
| P1 | 金额有效性规则不一致；客户amounts允许负数/超安全分币值，Dashboard单单检查非负安全整数，明细总计未检查 | `order-volume.ts:132`仅USD+finite；`fop-data.service.ts:238`；`fop-order-totals.ts` | 统一单单与累计校验；明确负数是否为退款，不能默默混入订单额；非USD/坏币种不得无审计默认USD |
| P1 | provider订单仅部分结构校验；无完整状态枚举、时间戳、金额、商品数量、报表部门运行时验证 | `scopedOrders`过滤后调用publicOrder；订单枚举主要是TypeScript类型 | 加入可信适配器运行时schema校验和可观测拒收计数；未知部门应明确隔离/映射，避免漏数或聚合异常 |
| P1 | 当前接口全量拉授权订单后内存过滤、排序、聚合；客户区间没有最大跨度 | `listOrders`返回数组；`order-volume.ts:36`逐日展开；service分页最后slice | 确定数据量、分页/游标完整性、权限快照、增量同步、数据库索引/预聚合和允许日期跨度，再按目标量压测 |
| P1 | 图表与明细各次独立拉数据、重建排名；期间订单变化会使TopN/other和钻取总数漂移 | `getOrderVolume`与`getOrderVolumeDetails`分别调用scopedOrders；asOf非快照ID | 同一图表钻取需共享snapshotId或清晰声明实时一致性边界；不能把当前asOf当稳定版本 |
| P1 | 本地组织模块始终mock且按管理员账户独立播种；权限ID配置未验证真实FOP归属 | `organization.service.ts:88`的`withWorkspace`；`users.service.ts:92` | 建立本地用户—FOP租户/用户—真实员工/部门映射；目录权限与同步流程独立设计，禁止把种子ID当FOP正式ID |
| P2 | weekOf与year可以不同年，周桶实际忽略year；无效objectId返回空，其他grain的month/weekOf可被忽略 | `order-volume.ts:41`至`:59`及`:80` | 在兼容性评估后统一跨参数校验；当前契约如实描述，不把未实现限制写成事实 |
| P2 | `source`是provider标签；asOf/updatedAt只是计算时刻，无法识别真实源数据陈旧程度 | `source`属性与响应构造 | 增加可验证来源、上游刷新时间、同步延迟、snapshot/version指标；目前这些字段为建议，不在已实现paths内 |
| P2 | 前端FopOrder类型含可选departmentPathIds，HTTP白名单实际剥离；Dashboard类型遗漏businessScope或将必有字段标可选 | `frontend/src/api/fop-orders.ts`、`fop-dashboard.ts`与publicOrder | 后续可由本规范生成类型或做契约漂移检查；本次不改前端业务源码 |

当前已有的重要保护：服务端身份绑定、每次权限查库、租户与allowlist交集、业务范围筛选、空allowlist不授予任何订单、跨请求授权变更复查、publicOrder字段白名单、provider错误公开信息归一化。待接入适配器应保持这些边界，不以“管理员”“测试环境”或页面筛选器替代服务端权限。

## 6. 接入验收要求（尚待真实FOP环境执行）

1. 获得实际FOP文档与脱敏响应样本，逐字段确认订单ID/客户ID/员工ID/部门祖先/报表部门/仓库/物流/支付状态/原币种/金额/时间戳语义；本规范描述AutoFlow外部契约，不替代尚未获证的FOP上游协议。
2. 对每个本地账户验证绑定唯一性、租户边界、订单白名单、部门后代范围、员工归属及撤权即时生效；无权限时不能退回演示数据。
3. 对图表、同筛选明细、分页总计三方对账，包含空授权、重复ID、未知仓库/物流、非USD、缺客户ID、未来日、跨月UTC+8、TopN/other、无注册台账等边界。
4. 明确收款口径后再对财务系统对账；付款状态不能替代收款交易流水。金额计算统一分币规则、币种策略与异常订单隔离规则。
5. 定义上游超时、限流、失败重试、缓存权限键、数据新鲜度和一致性要求；进行真实规模吞吐/内存测试。当前前端axios超时30秒，不代表上游SLA已完成。

## 7. 实际验证记录与边界

| 验证 | 本次真实结果 | 范围/限制 |
|---|---|---|
| 定向后台单测 | `npm test -- --runInBand --testPathPatterns='src/modules/fop-data/.*spec.ts'`：4 suites、40 tests通过 | 覆盖订单量/客户金额、分币汇总、注册聚合、演示provider；不连接FOP |
| 定向API E2E | `npm run test:e2e -- --testPathPatterns='(fop-data-access\|workbench-access).e2e-spec.ts'`：2 suites、46 tests通过 | 覆盖JWT/权限/状态/DTO/明细/汇总；使用测试替身，不是上游联调 |
| JSON Schema模型/样例 | 64个schema用项目已装Ajv2020编译；31个顶层schema/操作/错误实例通过 | JSON Schema2020-12及formats；含客户amounts与null。主流程另用openapi-spec-validator及递归实例验证 |
| 完整OpenAPI结构 | 最终文件已用`openapi-spec-validator`验证通过，并校验159处模型/请求/响应示例 | 支持3.1.1/JSON Schema2020-12；另有12组本地HTTP响应通过schema校验，不等于真实FOP联调或某个API平台导入已测试 |
| 源码路由审计 | 15个操作均有controller/service证据，源码文件记录在各operation的x-source-files | 不生成未实现FOP操作或伪造上游响应 |
| 生产接入 | 未验证 | 没有真实provider、正式凭据、上游样本、生产数据量或跨系统财务对账 |

机器规范的成功与错误样例均为脱敏契约样例，不是截取生产数据。上述定向测试与主流程全量测试存在重叠，不能将数量相加当作独立测试总数。本交付记录现状、风险和接入需求，没有把测试通过等同于生产FOP接入已完成。
