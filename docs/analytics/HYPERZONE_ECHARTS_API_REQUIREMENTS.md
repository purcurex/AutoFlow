# HyperZone ECharts 全面诊断与 API 对接需求

核对日期：2026-10-22。适用对象：前端、平台后端、FOP（金蝶云苍穹）开发、测试与实施人员。

## 1. 交付结论与阅读方式

本轮覆盖仓库中所有 ECharts 运行入口：共享 EChart 包装器、注册会员、部门回款、业务员回款、业务订单量趋势/排名、客户订单量/金额排名，以及客户趋势弹窗。履约卡片、任务、异常、工作日历虽不全部属于 ECharts，仍核对其图表相关数据依赖和边界。

当前项目具备前后端分析契约、服务端演示数据、用户级权限过滤与工作台跳转。**真实 FOP 数据提供器、授权解析和组织同步尚未完成；本文件不是已接入金蝶生产环境的证明。** 本轮以诊断和需求交付为主，发现的问题保留在问题清单中，不将“测试通过”等同于“没有缺陷”。

交付件：

- 本文 Markdown 与同名 HTML：接口清单、字段字典、统计口径、FOP 映射要求、验收用例、实现差距。
- `docs/openapi/hyperzone-analytics.openapi.json`：可供 Swagger Editor、Apifox、Postman 等支持 OpenAPI 的工具导入的契约；描述当前平台 HTTP API，而非虚构的金蝶原生接口。
- `ECHARTS_FRONTEND_AUDIT.md`、`ECHARTS_BACKEND_CONTRACT_AUDIT.md`：独立诊断证据，内容也收录在本文附录。
- `VERIFICATION.md`：本次实际检查与限制。

采用 [OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) 的 `paths`、`operationId`、`parameters`、`requestBody`、`responses`、`components/schemas`、`securitySchemes` 结构。可空使用 JSON Schema 的 `null` 类型；必填与可空分别表达。该版本选择用于稳定契约，不宣称它是最新规范版本。

## 2. 图表与业务模块总览

| 编号 | 图表/功能 | 查询与展示 | API/字段依赖 | 明细与交互 |
| --- | --- | --- | --- | --- |
| CH-01 | 每日注册会员统计 | 开始/结束日期；右上角一个部门维度；营销中心显示部门汇总，具体部门显示合计及业务员 | `dashboard.registrations`、`registrationDepartments[].counts`、`salespeople[].counts` | 图例、提示框、日期清单；当前没有注册会员逐条名单 API |
| CH-02 | 部门月度回款分析 | 年份；营销中心＋四业务部；独立上月环比 | `receipts.months`、`previousMonth`、`marketingCenter`、`departments[].amounts/previousAmount` | 金额/差额/比例；合计；月份倒排；环比自动展开明细，取消保持展开 |
| CH-03 | 业务员月度回款分析 | 与部门回款共用年份；指定部门；部门合计与员工并列；独立环比 | `receipts.departments[].salespeople[]` | 固定表格列宽；金额/环比明细；暂无收款流水下钻 API |
| CH-04 | 业务订单量趋势 | 年份最前；物流服务商/组织/业务员；类别明细；月/周/日；仓库及分仓 | `order-volume.query/periods/series/warehouses` | 最新时间窗；图表点击进入对应工作台订单清单 |
| CH-05 | 业务订单量排名 | 同 CH-04 条件；含汇总对象和明细 | `series.total/kind/entityId` | 汇总不重复累加；业务员 Top 5＋其他；服务商固定顺序 |
| CH-06 | 客户订单量排名 | 日期范围、部门、仓库、分仓；Top 10＋其他 | `category=customer`；`series.total/warehouses` | 客户表每人两行；点击趋势打开弹窗；仓库数量可下钻 |
| CH-07 | 客户订单金额对比 | 与 CH-06 完全相同客户集合和顺序 | `series.amounts.currency/total/values/warehouses/excludedOrderCount` | `$`，两仓金额比较、合计及占比；不另取“金额Top 10” |
| CH-08 | 客户订单量趋势弹窗 | 按客户名/编码搜索后选择，或从排名点趋势；继承日期/部门/仓库 | `order-volume/customers`；`order-volume?customerId=...` | 居中弹窗、关闭/ESC、每日明细、滑块拖动、分仓 |
| CH-09 | 客户订单金额趋势弹窗 | 与 CH-08 同筛选、同日期；与数量趋势同步拖动 | `series.amounts.values/warehouses` | 数量/金额双图，明细按日期倒排 |
| AUX-01 | 履约卡片/异常/任务 | 当前授权队列，不跟随注册日期范围 | `dashboard.queues/exceptions/tasks`、`fulfillment-orders` | Dashboard 仅统计和跳转；业务明细在岗位工作台 |
| AUX-02 | 工作日历 | US纽约、EUR柏林、AUD悉尼；周一至周五09:00–17:00 | 浏览器时间＋`Intl` 时区，无独立HTTP接口 | 当地当前时间、工作状态、UTC+8转换、夏令时；不含公共假日 |

详尽交互、源码定位、已知缺陷和测试边界见附录的前端诊断。

## 3. 对接架构与责任边界

```text
浏览器 ECharts / 工作台
  → 平台 /api（会话、DTO验证、数据权限）
  → FopDataService（授权交集、租户隔离、去重、汇总、公开字段序列化）
  → FopDataProvider（当前 Demo 或 Unconfigured）
  → 待实现：金蝶云苍穹用户授权、组织、客户、订单、注册等适配
```

1. 浏览器仅提交业务筛选条件，不提交有效权限、FOP 用户身份或订单授权列表。
2. 平台读取登录用户的 `fopTenantId/fopUserId`、业务角色、部门/员工标识与岗位角色。
3. FOP 适配器解析该用户真实授权，返回同一 `subject` 的订单 allowlist 与分析资源授权；服务端再做本地业务范围交集，不能让本地业务管理员绕过 FOP 租户与用户授权。
4. 订单候选记录携带服务端专用 `tenantId`、必要部门祖先路径，验证后只向浏览器返回公开字段。组织路径不得依赖浏览器传入。
5. 新适配器不得在故障、超时、权限撤销时回退到全量数据或 Mock；应维持既有 403/503 语义。
6. `asOf/updatedAt` 当前是响应生成时间，不代表 FOP 一致性快照、最后同步成功时间或账期关闭时间。真实接入如需一致性，应新增并正式版本化 `snapshotId/sourceUpdatedAt/permissionVersion` 等字段；它们目前不是已实现字段。

## 4. 统一统计口径与待对齐项

### 4.1 日期与时间

目标口径：订单统计按 `paidAt` 先转换北京时间（UTC+8），再取业务日期/月；范围包含开始和结束当天。传输时间戳必须携带时区（推荐 ISO 8601 UTC `Z`），纯业务日期使用 `YYYY-MM-DD`。

当前订单量聚合符合该换算；Dashboard 月度回款仍直接截取 `paidAt` 的年月，且当前年/月与部分日期上限使用 UTC/浏览器本地时间。因此跨日、跨月、跨年处存在差异。此为待修项，不能在 FOP 接入时默认为已统一。

- 按月：当年1月至当前月；历史年份12个月。
- 按周：参考周及前三周，四组；跨年周仍按真实日期区间。
- 按天：所选月自然日数，未来日期返回 `null`，已发生且无订单为 `0`。
- 客户分析：只有 `from/to` 日期范围，不传年份、粒度、月份/参考周；后台生成每日序列用于客户弹窗。
- 收款环比：必须提供前一年12月基线及每个连续月份的金额。缺基线显示“无上月数据”，上月为0且本月非0时显示差额但不伪造百分比。

### 4.2 订单、金额与回款

| 项目 | 当前实现/要求 |
| --- | --- |
| 订单计数 | 订单ID去重；订单分析只取已支付、未取消、非全额退款、有效且不晚于当前时刻的支付日期；多SKU订单只计1单 |
| 订单金额 | 每订单 `amount` 计一次，不按SKU行数重复累加；金额按整数分运算后转回小数展示 |
| 客户金额 | 汇总默认/显式 USD 且有效有限数值；其他币种/缺金额保留订单量并计入 `excludedOrderCount`；不进行隐式汇率换算 |
| 列表合计 | `totals` 覆盖完整筛选结果，不是当前页；按币种分组；前端不把不同币种直接相加 |
| 部门合计 | 营销中心=授权范围内四业务部之和；部门合计=授权范围内本部门业务员之和，不再与明细重复累加 |
| 环比 | 差额=本月−上月；比例=差额/abs(上月)×100%；总比例用合计基数重新计算，不能平均各行百分比 |
| “回款”的现状 | 当前由已支付订单的订单金额聚合，未建独立收款流水；分次支付、收款冲销、部分退款及实际净到账金额未建模 |
| FOP须确认 | `amount` 是含税/折扣/运费后的订单应付还是实收；退款及作废规则；非USD原币与折算金额/汇率日期；金额精度及安全上限 |

当前客户金额、回款和列表汇总对负数/超安全整数等异常值的策略并不完全一致，真实适配器须先统一校验；详细证据见后端诊断。

### 4.3 排名、组织和仓库

- 物流默认顺序：云途YT、4PX、万邦WB、燕文YW、极速JS、其他；未知/缺失服务商合并“其他”，不显示“未分配服务商”。
- 客户按订单量取前十；其他客户合并一项；金额图使用相同客户集合。各仓库不各自重排 Top 10，确保横向对比一致。
- 明细“其他”必须先用整个查询范围确定集合，再缩小日期/仓库，不能在单日重新排名后产生不同成员。
- 仓库规范化为 `HZ/SZ/UNASSIGNED`；物流“其他”规则不代表可丢弃未知仓库，未知仓库仍保留以保证总计对账。
- 下属团队由适配器映射至四个固定业务报表部门 `sales1...sales4`。组织树可自定义，但自定义组织树不会自动改变报表固定部门模型。
- 名称保留中文和英文别名；统计人员为外贸业务员/伙伴。`owner.id` 是稳定业务员工标识，不能用名称或本地登录邮箱替代。

## 5. FOP 上游字段映射需求清单

以下是平台所需逻辑字段，**金蝶实体名、字段Key、操作编码和URL均待后台团队提供**。既有平台 HTTP 路径不能直接当作云苍穹原生路径。

| 资源 | 必需逻辑字段 | 类型/约束 | 用途与对接要求 |
| --- | --- | --- | --- |
| 绑定主体 | `tenantId`, `userId` | 非空稳定字符串；与本地绑定成对对应 | 响应主体必须与请求主体一致；停用/离职/转岗后即时撤销旧授权 |
| 用户授权 | `subject`, `allowedOrderIds[]`, `analyticsScopes[]` | 订单ID去重；空数组=无权限；分析范围枚举rates/registrations/receipts | 授权与数据读取不可跨用户复用；本地admin不等于FOP超级用户 |
| 组织 | `id`, `name`, `parentId`, `type`, `enabled`（后两项为目录同步需求） | 主键稳定，父级可空，无环 | FOP目录同步尚未实现；明确同步/手工修改优先级和删除语义 |
| 部门 | `department.id/name`, `departmentPathIds[]`, `salesDepartmentCode` | 祖先路径来自可信源；报表部门sales1–sales4 | 支持经理管辖子部门；业务报表归口不能靠文本模糊匹配 |
| 员工 | `owner.id/name`, 岗位/部门归属、中文名/英文名、在职状态 | employeeId独立于登录账号ID | 两类名字展示可合成name；领导不混入业务员业绩序列；伙伴可列入 |
| 客户 | `customerId`, `customerCode`, `customerName` | 稳定ID；编码可搜索；名称不能作主键 | 排名、名称/编码查询、权限过滤结果；重复名称按ID区分 |
| 订单标识 | `id`, `orderNumber`, `shopifyOrderNumber`, `storeName` | 主键全租户唯一或与tenant复合唯一 | 不得用明细行ID作为订单ID；Shopify单号可能仅店铺内唯一 |
| 金额与支付 | `amount`, `currency`, `paymentStatus`, `paidAt`, `cancelled` | USD默认；paid/unpaid/refunded；paidAt可空且带时区 | 支付/退款/冲销映射、净额规则、部分付款支持待确认 |
| 订单时间 | `createdAt`, `paidAt` | ISO8601时间戳；paidAt=null为未获取/未支付，不回退createdAt | 排序与支付日期统计独立于创建日期 |
| SKU行 | `items[].productId/sku/name/imageUrl/variant/quantity` | quantity为数量，图片可空，产品ID可缺失 | 一订单多SKU；失效图片降级；图片地址应为获授权可访问资源 |
| 履约状态 | `reviewStatus`, `procurementStatus`, `allocationStatus`, `dispatchStatus`, `shippingStatus` | 枚举见完整schema | 分别映射审核、采购、配货、发运、仓库出库状态；不能合并一个大状态字段 |
| 仓库 | `warehouseCode`, `warehouse` | HZ/SZ；未知保留 | 订单分仓对比。若同单跨仓，需另行约定“订单归属仓”或“按仓发运单数”，不得直接双计订单 |
| 服务商 | `carrierCode`, `carrier`, `trackingNumber` | 标准代码映射；名称/跟踪号可空 | 固定六类，未知归OTHER；一个订单多运单映射待确认 |
| 异常 | `exception.reason/hours` | stock/address/tracking；hours为持续时长 | 异常清单和任务，是否可同单多异常需定义 |
| 注册会员 | `registrationEntries[].date/salesDepartmentCode/owner/count/departmentPathIds` | 每日+员工计数；非负安全整数，日期完整 | 非管理员须提供员工粒度可过滤记录；仅日汇总无法实现本人/部门隔离 |
| 回款前置 | 当前订单账本；若要真实现金回款则需收款流水ID、订单ID、实收金额、币种、到账时间、冲销/退款标记 | 后者为新增需求、未实现的HTTP契约 | 先确认业务口径再版本化扩展，不能把多笔流水塞进order.amount导致重复计单 |
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
| AT-07 | 客户双指标 | 每客户恰好订单量/订单金额两行；两图同客户顺序；Top10＋Other覆盖全量；金额和数量合计对账 |
| AT-08 | 分仓 | HZ＋SZ＋未知仓=总量/总额；点击仓库数值进入该仓明细；切单仓时禁止重复“分仓对比” |
| AT-09 | 数据异常 | 重复订单、多SKU、缺paidAt、未来支付、取消、全额退款、非USD、负金额、超精度金额、未知代码分别明确处理 |
| AT-10 | 分页和筛选 | 切页不改变筛选总计；Other下钻不重新排名；客户编码精确匹配优先；所有非法参数/多余权限参数拒绝 |
| AT-11 | 交互与主题 | 滚轮只滚外层；点击面板不改横轴；只拖滑块；最新时间窗；弹窗立即可见、ESC关闭、焦点恢复；暗色和窄屏可读 |
| AT-12 | 实际渲染与导出 | 真浏览器检查SVG、Tooltip、图例、ResizeObserver、图片导出；stub单测不替代此项 |
| AT-13 | 大规模真实数据 | 用实际业务量压测权限集合、全量聚合、客户搜索及大日期跨度；先协商响应时间和容量指标，再签收 |
| AT-14 | 文案和数据一致性 | 当前条件与最后成功应用条件分离；在途改筛选不能改变已返回数据标题；失败不把旧图标成新条件 |

## 7. 交付与接入顺序

1. 确认订单金额与真实回款口径、支付日期时区、FOP实体和字段映射。
2. 完成真实用户身份/权限适配，再读取任何业务数据；通过管理与业务权限分离验收。
3. 接入组织、员工、客户与订单明细，完成固定业务部门归口、状态、仓库及服务商标准化。
4. 用同一获授权账本校验订单趋势、客户Top10、双指标、分仓和工作台明细；逐项对账。
5. 接入注册明细和回款基线；处理已知边界缺陷，做真实浏览器和规模测试。
6. 先在测试环境小范围员工验收，再切生产；数据库、附件和配置按部署文档单独备份迁移。

本次 Git 提交包含当前项目的代码与文档基线；不包含本机数据库、用户密码、密钥和运行产物，也不表示已部署到生产服务器。


## 8. OpenAPI 接口清单与请求/响应定义

本规范覆盖 **15 个操作、64 个数据模型**。以下清单由同目录 OpenAPI JSON 生成。Base URL 为 `/api`，表中路径不重复此前缀。响应为实际裸 JSON，不额外包装成 `{code,data}`。时间序列数值数组必须与对应时间轴等长：counts 对应 registrations、amounts 对应 months、values 及 warehouses 内数组对应 periods；items/series/options 等集合不适用。该跨字段规则需联调测试，单纯 schema 校验不能证明。

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


### 8.1 公共鉴权与响应说明


字段级源码快照，仅记录已实现HTTP路由，不将计划FOP上游写为paths。响应裸JSON，无{code,data,message}包装。required=序列化必有；type:null=显式空值；可省略字段不在required中。参数跨字段依赖及已知口径差距见操作描述和配套审计。示例为脱敏契约样例，不是生产数据。

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


至少一个工作台角色；当前账户绑定、租户、订单allowlist与businessScope求交。时间模式二选一：grain+year必填，day另需month，week默认weekOf=上海今天；或category=customer且from/to同时提供并禁止grain/year/month/weekOf。客户区间2020-01-01至上海今天含首尾。只统计paid、有效paidAt<=asOf、未取消未退款订单；非carrier还要求salesDepartmentCode。未来日null、已到日期无数据0。customer每个series含amounts。筛选参数不能扩大权限。


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
| `year` | query | integer | 否 | 2020至上海当前年；week也要求year但由weekOf决定实际分桶。 | minimum=2020; maximum=9999 |
| `from` | query | string (date) | 否 | 仅客户区间；和to同时存在。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `to` | query | string (date) | 否 | 仅客户区间，不晚于上海今天；当前无最大跨度限制。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `month` | query | integer | 否 | grain=day必填；其他grain忽略。 | minimum=1; maximum=12 |
| `weekOf` | query | string (date) | 否 | week锚点，默认上海今天；2020至今天，不强制与year同年。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `department` | query | SalesDepartment | 否 | 报表部门过滤代码sales1..sales4，非权限departmentId。 | enum=["sales1", "sales2", "sales3", "sales4"] |
| `objectId` | query | string | 否 | 仅carrier/salesperson，物流代码或owner.id；未知ID返回空。 | minLength=1; maxLength=200 |
| `customerId` | query | string | 否 | 仅customer；未知/越权ID返回空。 | minLength=1; maxLength=200 |
| `warehouse` | query | string | 否 | ALL全仓，HZ杭州，SZ深圳，UNASSIGNED未知或未归仓；默认ALL。 | enum=["ALL", "HZ", "SZ", "UNASSIGNED"]; default="ALL" |


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
  "timeZone": "Asia/Shanghai",
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
        "excludedOrderCount": 0
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
        "excludedOrderCount": 0
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


至少一个工作台角色；当前账户绑定、租户、订单allowlist与businessScope求交。时间模式二选一：grain+year必填，day另需month，week默认weekOf=上海今天；或category=customer且from/to同时提供并禁止grain/year/month/weekOf。客户区间2020-01-01至上海今天含首尾。只统计paid、有效paidAt<=asOf、未取消未退款订单；非carrier还要求salesDepartmentCode。未来日null、已到日期无数据0。customer每个series含amounts。筛选参数不能扩大权限。 额外要求拥有workbenchRole，仅校验入口，不过滤履约队列。先完整范围重建TopN/other，再收窄period/detailWarehouse；warehouse与detailWarehouse求交。按paidAt倒序/id稳定排序，totals分页前计算。


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
| `year` | query | integer | 否 | 2020至上海当前年；week也要求year但由weekOf决定实际分桶。 | minimum=2020; maximum=9999 |
| `from` | query | string (date) | 否 | 仅客户区间；和to同时存在。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `to` | query | string (date) | 否 | 仅客户区间，不晚于上海今天；当前无最大跨度限制。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `month` | query | integer | 否 | grain=day必填；其他grain忽略。 | minimum=1; maximum=12 |
| `weekOf` | query | string (date) | 否 | week锚点，默认上海今天；2020至今天，不强制与year同年。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `department` | query | SalesDepartment | 否 | 报表部门过滤代码sales1..sales4，非权限departmentId。 | enum=["sales1", "sales2", "sales3", "sales4"] |
| `objectId` | query | string | 否 | 仅carrier/salesperson，物流代码或owner.id；未知ID返回空。 | minLength=1; maxLength=200 |
| `customerId` | query | string | 否 | 仅customer；未知/越权ID返回空。 | minLength=1; maxLength=200 |
| `warehouse` | query | string | 否 | ALL全仓，HZ杭州，SZ深圳，UNASSIGNED未知或未归仓；默认ALL。 | enum=["ALL", "HZ", "SZ", "UNASSIGNED"]; default="ALL" |
| `workbenchRole` | query | WorkbenchRole | 是 | 工作台入口权限；与业务范围、系统管理权限独立。 | enum=["sales", "procurement", "allocation", "dispatch", "warehouse"] |
| `detailWarehouse` | query | VolumeWarehouse | 否 | 杭州、深圳、未分配。 | enum=["HZ", "SZ", "UNASSIGNED"] |
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


至少一个工作台角色；已授权未取消未退款、有报表部门/customerId的订单构建客户集，包含未支付。编码精确命中优先，后按编码/ID排序。无日期/仓库参数，未知字段400。


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


from<=to，end-start<=365天（含首尾最多366天），to<=UTC今天，year<=UTC当前年。from/to仅注册，year仅收款；队列/异常/任务不受日期筛选。rates/registrations/receipts分别需provider analyticsScopes；无scope返回空。registrationEntries优先并按业务范围过滤，缺失时仅业务admin可读旧registrations。收款为USD已支付订单amount、非独立收款流水，按paidAt.slice(0,7)归月，未统一上海时区。


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
    "departments": []
  }
}
```


实现证据：`backend/src/modules/users/workbench.controller.ts`, `backend/src/modules/fop-data/fop-data.service.ts`, `backend/src/modules/fop-data/fop-data.dto.ts`, `backend/src/modules/fop-data/fop-registration.ts`。


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


杭州、深圳、未分配。

类型：`string`；约束：enum=["HZ", "SZ", "UNASSIGNED"]。


### CarrierCode


固定顺序云途YT/4PX/万邦WB/燕文YW/极速JS/其他；未知代码归OTHER。

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
| `warehouseCode` | string | 否 | HZ/SZ以外或缺失归UNASSIGNED。 | — |
| `carrierCode` | string | 否 | 白名单以外或缺失归OTHER。 | — |
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
| `paidAt` | string (date-time) anyOf null | 是 | 订单量按Asia/Shanghai日期归桶；Dashboard按字符串月份归桶。 | — |
| `cancelled` | boolean | 是 | true表示订单取消，从订单量/收款/履约队列排除。 | — |
| `exception` | OrderException anyOf null | 是 | 订单异常详情；无异常明确为null。 | — |


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
| `year` | integer | 否 | 2020至上海当前年；week也要求year但由weekOf决定实际分桶。 | minimum=2020; maximum=9999 |
| `from` | string (date) | 否 | 仅客户区间；和to同时存在。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `to` | string (date) | 否 | 仅客户区间，不晚于上海今天；当前无最大跨度限制。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `month` | integer | 否 | grain=day必填；其他grain忽略。 | minimum=1; maximum=12 |
| `weekOf` | string (date) | 否 | week锚点，默认上海今天；2020至今天，不强制与year同年。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `department` | SalesDepartment | 否 | 报表部门过滤代码sales1..sales4，非权限departmentId。 | — |
| `objectId` | string | 否 | 仅carrier/salesperson，物流代码或owner.id；未知ID返回空。 | minLength=1; maxLength=200 |
| `customerId` | string | 否 | 仅customer；未知/越权ID返回空。 | minLength=1; maxLength=200 |
| `warehouse` | string | 是 | ALL全仓，HZ杭州，SZ深圳，UNASSIGNED未知或未归仓；默认ALL。 | enum=["ALL", "HZ", "SZ", "UNASSIGNED"]; default="ALL" |

组合规则 `oneOf`：`见 schema`, `见 schema`。完整约束见 OpenAPI JSON。

组合规则 `allOf`：`见 schema`, `见 schema`, `见 schema`。完整约束见 OpenAPI JSON。


### VolumePeriod





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 月YYYY-MM；周一或日期YYYY-MM-DD。 | pattern="^\\d{4}-\\d{2}(?:-\\d{2})?$" |
| `label` | string | 是 | 图表横轴显示文本；月为n月，周为MM-DD—MM-DD，日为日期文本。 | — |
| `from` | string (date) | 是 | 含首日，上海日历。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `to` | string (date) | 是 | 含末日，上海日历。 | pattern="^\\d{4}-\\d{2}-\\d{2}$" |
| `future` | boolean | 是 | 首日晚于上海今天。 | — |


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
| `UNASSIGNED` | CountValues | 是 | 当前series未分配/未知仓每期订单量，数组下标与periods一致。 | — |


### AmountWarehouses





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `HZ` | AmountValues | 是 | 杭州仓每期USD订单金额；数组下标与periods一致，未来值null。 | — |
| `SZ` | AmountValues | 是 | 深圳仓每期USD订单金额；数组下标与periods一致，未来值null。 | — |
| `UNASSIGNED` | AmountValues | 是 | 未分配/未知仓每期USD订单金额；数组下标与periods一致，未来值null。 | — |


### VolumeAmounts


仅customer维度每个series必有；不换汇。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `currency` | "USD" | 是 | 金额统计唯一币种USD；非USD订单不换汇且计入excludedOrderCount。 | — |
| `total` | Money | 是 | 该series在整个查询范围内USD且金额finite的订单amount合计。 | — |
| `values` | AmountValues | 是 | 按periods逐期汇总的USD金额，主单位美元，未来期null。 | — |
| `warehouses` | AmountWarehouses | 是 | 同一series同一期的USD金额按HZ/SZ/UNASSIGNED拆分。 | — |
| `excludedOrderCount` | integer | 是 | 非USD或amount非finite被排除的订单数，仍计入订单量。 | minimum=0 |


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
| `amounts` | VolumeAmounts | 否 | 客户维度新增USD金额对象，含总额/逐期/逐仓金额及排除订单数；非客户维度省略。 | — |


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


业务员Top5、客户Top10按订单量排序，余项other；客户缺失ID不进Top10。物流固定顺序。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `source` | DataSource | 是 | provider数据来源mock或fop。 | — |
| `query` | OrderVolumeQuery | 是 | 实际经DTO转换并补默认warehouse后的查询回显；未传可选字段省略。 | — |
| `timeZone` | "Asia/Shanghai" | 是 | 订单量/客户金额统一日界线Asia/Shanghai（UTC+08:00）。 | — |
| `asOf` | string (date-time) | 是 | 聚合时刻，不是源数据刷新时刻或共享快照。 | — |
| `total` | integer | 是 | 完整授权筛选集已支付订单数，等于id=total系列total。 | minimum=0 |
| `customerCount` | integer | 是 | 非空customerId去重。 | minimum=0 |
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
| `time` | string | 是 | 最早createdAt.slice(11,16)，未转上海时间，可为空。 | — |
| `priority` | string | 是 | allocation为normal，其余high。 | enum=["high", "normal"] |


### ReceiptSeries





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 营销中心为marketing，部门为sales1..4，员工为owner.id；缺员工为__unassigned__。 | — |
| `name` | string | 是 | 营销中心、报表部门或业务员工展示名。 | — |
| `previousAmount` | Money | 是 | 所选year前一年12月金额，0不为null。 | — |
| `amounts` | Money[] | 是 | 与months对齐。 | — |


### ReceiptDepartment





| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 固定报表部门代码sales1..4。 | — |
| `name` | string | 是 | 固定报表部门中文名称。 | — |
| `previousAmount` | Money | 是 | 该部门所选year上一年12月USD已支付订单金额合计。 | — |
| `amounts` | Money[] | 是 | 该部门各月份USD已支付订单金额，与receipts.months同序。 | — |
| `salespeople` | ReceiptSeries[] | 是 | 按员工ID排序；缺owner用__unassigned__。 | — |


### DashboardReceipts


仅USD paid未取消有paidAt/报表部门的订单amount，按paidAt.slice(0,7)归月，cents要求非负安全整数。这是订单金额，不是独立收款流水；无部分付款/退款/冲销模型。previousMonth仅months非空存在。


| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |
| --- | --- | --- | --- | --- |
| `currency` | "USD" | 是 | 固定USD，非USD订单不进入此统计。 | — |
| `months` | string[] | 是 | UTC当前年截至当前月；历史年12个月；无scope为空。 | — |
| `previousMonth` | string | 否 | 用于第一月环比的上年12月；仅months非空时存在。 | pattern="^\\d{4}-12$" |
| `marketingCenter` | ReceiptSeries anyOf null | 是 | 四部门金额合计系列；没有receipts权限时明确null。 | — |
| `departments` | ReceiptDepartment[] | 是 | 有receipts scope固定4部门，否则空。 | — |


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
| `receipts` | DashboardReceipts | 是 | 按已支付订单amount计算的USD月度金额，含上年12月基线，不是收款流水。 | — |


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
      ]
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
            ]
          }
        ]
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
        "salespeople": []
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
        "salespeople": []
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
        "salespeople": []
      }
    ]
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


## 10. 前端功能诊断与复现证据


诊断日期：2026-10-22。范围：`work-app/frontend` 全部 ECharts 实例、调用组件、直接相关 API 客户端、统计工具、路由、权限与测试。本文源码路径均相对于 `work-app/`，行号指本次诊断工作区版本。

本次为只读业务诊断：没有修改业务实现、持久测试或依赖，没有执行 Git 操作；仅新增此文档。没有访问生产 FOP、操作浏览器或实际下载图表。结论区分“源码已实现”“本地测试已验证”“未实现”“生产待验证”，不能将 mock/stub 测试等同于真实浏览器或生产验收。

### 1. 覆盖范围与结论

全量搜索 `echarts`、`EChart`、`dataZoom`、`toolbox` 确认：只有 **1 个 ECharts 初始化包装器、3 个业务调用文件、6 处 `<EChart>` 模板调用点、9 类面向用户的逻辑图表**。没有发现另外的原生 `echarts.init` 实例、饼图、地图或独立第三方图表包装器。

- 包装器：`frontend/src/components/charts/EChart.vue:3`、`:60`。
- 业务调用：`frontend/src/views/autoflow/FopDashboardView.vue:222`、`:247`、`:257`；`frontend/src/components/order-volume/OrderVolumeResults.vue:67`、`:68`；`frontend/src/components/order-volume/CustomerOrderResults.vue:103`。
- 依赖声明：`frontend/package.json:28` 为 `echarts: ^6.1.0`；构建对 ECharts 和 zrender 分块：`frontend/vite.config.ts:31`。依赖声明范围不等同于生产部署版本。
- 入口：`/dashboard` 显示全部分析；`/workbench/:role?queue=order-analysis` 复用业务订单和客户订单两组分析。证据：`frontend/src/router/index.ts:28`、`:34`；`frontend/src/views/autoflow/WorkbenchView.vue:47`；`frontend/src/views/autoflow/FopDashboardView.vue:261`。

已有回款环比、合计、客户数量与金额并列、Top 10 + 其他、分仓、订单下钻、原生弹窗、暗色主题与响应式布局。此次证实 **1 项 P2 数据标注问题、1 项 P3 重复请求问题**，详见第 7 节。未发现可据本次前端证据认定的 P0/P1 问题；这不构成生产授权或财务口径正确性的证明。

### 2. 图表逐项盘点

| ID / 图表 | 组件、数据及系列 | 筛选与统计口径 | 交互与状态 |
|---|---|---|---|
| G01 每日注册会员趋势 | `FopDashboardView.vue:140`；`registrations[].date/count` 构成横轴/营销中心合计，`registrationDepartments[].counts/salespeople[].counts` 构成部门或业务员系列 | 日期 `from/to` 调 API；“营销中心/部门”只切换已返回的授权系列。营销中心视图为总计与部门平级；部门视图为部门总计与业务员平级；标题合计只取第一条系列，避免重复相加（`:45`、`:55`） | 平滑折线、滚动图例、轴 tooltip、无 dataZoom；唯一配置 SVG 下载的图表（`:145`）。无图形下钻。授权/空数据文案与明细表见 `:222`、`:225` |
| G02 部门月度回款 | `FopDashboardView.vue:188`；`receipts.marketingCenter`（可选）与 `departments[]` 并列柱形 | `year` 调 API；金额统一 USD。年度 KPI 只累加 departments.amounts；不把营销中心总计再次加入。可切换“上月环比”（`:56`、`:61`、`:244`） | 月序轴、滚动图例、最新 6 个月固定宽度滑窗、tooltip、绝对额/差额柱形及零基准线；明细按月份倒序；无图形下钻、无导出按钮（`:151`、`:164`、`:248`） |
| G03 业务员月度回款 | `FopDashboardView.vue:189`；所选部门合计及该部门 `salespeople[]` | 与 G02 共用年度请求；部门切换在客户端完成；部门合计与个人并列，不堆叠、不重复相加。单独 MoM 开关（`:69`、`:75`、`:253`） | 最新 6 月固定滑窗；与 G02 不联动滑窗。无业务员时仍可展示部门合计并附“暂无业务员”提示（`:257`、`:258`）；明细默认展开，启用 MoM 自动展开 |
| G04 业务订单量趋势（可分仓） | `OrderVolumeResults.vue:28`；所有 `series[].values` 或 `warehouses[code]` | 类别 carrier/organization/salesperson；month/week/day；year、month、weekOf、department、objectId、warehouse。`kind=total` 总计折线，月度明细柱形，周/日明细折线（`:37`） | 月最新 6 期、日最新 14 个已发生日、周 4 期；图例；点击非未来点以 seriesId/periodId/warehouse 下钻。分仓时独立 HZ/SZ 图，有未分配量才增加第三图，共用最大 Y 轴、联动滑窗（`:24`、`:27`、`:48`、`:59`） |
| G05 业务订单量区间对比/服务商分布 | `OrderVolumeResults.vue:41`；`series.filter(kind !== total)`，横向柱形 `series.total` | 完整查询周期，不随趋势滑窗重算；保留 API 返回顺序；carrier 文案为固定顺序，其他类别为区间对比 | 图形点击按该行 id 下钻，省略 periodId；分仓模式由 CSS 隐藏排名，保留趋势与表格（`order-volume.css:1`）；无独立导出 |
| G06 客户订单量 Top 10 + 其他 | `CustomerOrderResults.vue:48`、`:103`，`rankingOnly=true, metric=orders` | customer 类别，明确 `from/to` 含首尾日期；department、warehouse；按 API 给出的数量 Top 10 集合及顺序显示，前端不再次排序或选 Top 10（`:21`、`:106`） | 横向柱形；分仓时同一客户行显示 HZ/SZ/可选未分配多柱。点击真实客户进入单客户趋势弹窗；点击 other/unassigned 下钻订单（`:75`）。同名客户显示 code |
| G07 客户订单金额对比 | 与 G06 同一组件，`metric=amount`；`series[].amounts.total/warehouses` | **沿用数量 Top 10 客户集合与顺序，不是金额 Top 10**；USD 两位小数。排除币种/金额缺失笔数由 `excludedOrderCount` 提示，数量仍保留（`:98`、`:106`） | 与数量图并列；分仓组与客户顺序一致；金额柱点击同样进入客户趋势/订单，不会自动添加“仅 USD”明细过滤条件 |
| G08 单客户每日订单量趋势 | `CustomerOrderResults.vue:63`，弹窗中 `rankingOnly=false, metric=orders`；只用 `kind=total` 的 values/warehouses | 新请求继承已应用的日期、部门、仓库，并新增 customerId。默认最近 14 天；无 MoM | 折线；分仓为同一图中的仓库系列；与金额图滑窗联动；点击非未来点以 `seriesId=total, periodId, detailWarehouse?` 下钻（`:83`、`:86`） |
| G09 单客户每日订单金额趋势 | 同 G08，`metric=amount`；`total.amounts.values/warehouses` | 同一客户、同一授权订单集合、同一日期/仓库映射；只统计 API 提供的 USD 金额 | 金额轴与数量轴独立，只有时间窗口同步；表格显示每日数量与金额并按日期倒序；缺失 amounts 显示 `—`，不伪造 0（`:31`、`:35`、`:119`） |

表内短文件名的完整路径分别为 `frontend/src/views/autoflow/FopDashboardView.vue`、`frontend/src/components/order-volume/OrderVolumeResults.vue`、`frontend/src/components/order-volume/CustomerOrderResults.vue`、`frontend/src/components/order-volume/order-volume.css`。

### 3. API 字段级消费契约

公共 HTTP 客户端使用 `baseURL=/api`、cookie 凭证、30 秒超时，并直接返回 `response.data`，没有额外 `data` 包装层；会丢弃旧会话响应。证据：`frontend/src/api/index.ts:17`、`:31`。以下路径包含 `/api` 前缀。

#### 3.1 Dashboard：GET `/api/autoflow/integrations/fop/dashboard`

契约类型：`frontend/src/api/fop-dashboard.ts:2`；请求与校验：`:20`、`:28`。

| 请求字段 | 前端行为 / API 必须保持的含义 |
|---|---|
| `from`, `to` | `YYYY-MM-DD`；严格日历合法性；from ≤ to；结束不晚于浏览器本地今天；两日差 ≤365（即最多 366 个含首尾日期）。日期用于注册趋势。表单默认浏览器本地最近 7 天 |
| `year` | 整数，2020 至浏览器本地当前年；UI 只列最近 5 年。年份用于回款，日期不应改变回款口径 |
| 用户身份 / scope | 客户端此请求只显式取出 from/to/year，额外 userId 等不随请求发送。授权由后端确定；不能把统计部门选择当成授权边界 |
| 响应字段 | 图表 / UI 消费方式与约束 |
|---|---|
| `source: mock\|fop` | 顶部 MOCK/用户范围标识；不决定授权 |
| `updatedAt: string` | 数据更新时间；客户端 `Date` 解析，按浏览器本地时区显示 |
| `registrations[].date`, `.count` | X 轴原始日期及营销中心每日数量；前端依 API 顺序显示，不排序 |
| `registrationDepartments[]`（可选）`.id/.name/.counts` | 部门选择值、展示名、与 registrations 一一对应的每日数组 |
| `.salespeople[].id/.name/.counts` | 所选部门的业务员曲线；counts 同样按 registrations 下标对齐 |
| `receipts.currency` | 类型限制为 USD；显示层直接用 USD 格式，不做汇率换算 |
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
| `timeZone` | 类型包含，但前端当前展示固定“北京时间 UTC+8”并用 Asia/Shanghai 格式化 asOf；现有集成应返回 Asia/Shanghai，其他时区未实现 |
| `asOf` | 可解析时间戳；更新时间 |
| `total` | 获授权且满足条件的订单总量；KPI、空态判断、数量份额分母 |
| `customerCount` | 涉及客户数；前端不从 Top 10 行数推算 |
| `periods[].id/.label/.from/.to/.future` | 对齐序列、展示标签、区间摘要、下钻 periodId；future 点禁用下钻；需升序且未来周期在尾部 |
| `series[].id/.label/.kind` | 稳定 id 用于颜色/下钻，label 用于图例，kind=total/detail/other/unassigned 决定总计与明细语义 |
| `series[].entityId/.code`（可选） | 客户 kind=detail 需 entityId 才能开趋势；code 区分同名客户 |
| `series[].total/.values` | 完整查询期数量和按 periods 下标对齐的 number/null 数组；null 用于未来/未知，不等于 0 |
| `series[].warehouses.HZ/SZ/UNASSIGNED` | 三个数组均需存在并与 periods 对齐。前端依此分仓、合计、显示未分配组 |
| `series[].amounts.currency/total/values/warehouses/excludedOrderCount`（可选） | 客户金额必须有同一组 periods/warehouse 映射；currency 类型为 USD。缺少 amounts 时金额显示 `—`。仅总计系列的 excludedOrderCount 用于整体提示 |
| `options.departments[].id/.label` | 当前 scope 可查询部门；前端不会再验证这些选项是否越权 |
| `options.objects[].id/.label` | 当前类别/部门的可查询对象；无客户端硬编码业务员名单 |

当前 API 客户端直接传递 query，未像 Dashboard 一样在 API 函数内验证日期、页码或枚举。业务表单有基本约束，**服务端必须独立校验**，不能依赖 TypeScript 类型或 `<input>` 限制。上述结论是职责边界，不是发现越权。

#### 3.3 客户搜索：GET `/api/autoflow/integrations/fop/order-volume/customers`

请求 `{ keyword, department?, page, pageSize:10 }`；keyword trim 后必须非空，输入最长 100 字符。结果 `{ source, items:[{id,code,name,departments:string[]}],total,page,pageSize }`。只有“编码不区分大小写完全匹配、items 中恰好一个匹配且 total=1”才自动选中；名称匹配仍点候选。搜索不传日期或仓库，因此可找到当前订单范围为零的获授权客户。证据：`OrderVolumeAnalysis.vue:83`、`:89`、`:92`、`:145`；完整类型 `frontend/src/api/fop-order-volume.ts:24`。

#### 3.4 下钻：GET `/api/autoflow/integrations/fop/order-volume/orders`

请求继承聚合 `query`，新增 `workbenchRole`、可选 `seriesId/periodId/detailWarehouse`、`page/pageSize`（默认 1/20）。下钻路由为 `RoleWorkbench`，query 带 `queue=order-volume`；从 Dashboard 下钻先刷新岗位权限并取首个可用角色，从岗位页下钻沿用当前角色。证据：`OrderVolumeAnalysis.vue:99`；`frontend/src/views/autoflow/OrderVolumeOrdersView.vue:25`。

响应是 `FopOrderPage`，不是新造的图表明细格式：`source,items,total,totals,page,pageSize`。当前表格消费 `items[].id/orderNumber/shopifyOrderNumber/customerName/customerCode/items[].sku/name/imageUrl/variant/quantity/paymentStatus/amount/currency/organization.name/department.name/owner.name/salesperson/warehouse/carrier/paidAt/createdAt`；金额 totals 是全部筛选结果的 `{orderCount,itemQuantity,amountsByCurrency:[{currency,amount}]}`，不得仅返回当前页合计。证据：`frontend/src/api/fop-orders.ts:3`、`:11`、`:52`；`OrderVolumeOrdersView.vue:49`。

点击客户金额不增加币种过滤；详情仍包含数量口径的全部订单，并按币种显示总额。金额图只含 USD、订单数仍含非 USD，因此不能直接要求“明细全部金额总和 = 图表 USD 金额”。需按 USD 子集及排除规则对账。

### 4. 统计口径、金额与合计

| 检查点 | 当前实现与证据 | 边界 |
|---|---|---|
| 订单纳入范围 | 页面明确“获授权且有支付时间的已支付订单，排除已取消及全额退款”，支付日期按北京时间 UTC+8；`OrderVolumeAnalysis.vue:137` | 前端不重新扫描原始订单以证明过滤；实际支付/取消/退款/权限含义须在服务端与 FOP 数据验收 |
| 数量 Top 10 + 其他 | 两个客户指标共用 `series.filter(kind !== total)` 及相同 yAxis；`CustomerOrderResults.vue:21`、`:55`、`:106` | Top 10 选取、并列排序、other/unassigned 分组由后端完成；不能根据前端标签认定服务端算法正确 |
| 不重复累加 | 注册 KPI 取第一条总计；回款 KPI 只加 departments；订单 KPI 取 data.total；客户金额 KPI 取 kind=total.amounts.total | 总计与明细同时画出用于比较；图例隐藏系列不会重算 KPI/份额；服务端须保证 total 与明细/仓库可对账 |
| 金额精度 | USD 显示 2 位小数；`sumMoney` 对每个数先转换分再累加；`frontend/src/utils/tableTotals.ts:2`、`frontend/src/utils/currency.ts:12` | 非统一汇率转换。统计金额已由 API 汇总；前端不计算交易历史汇率 |
| 单月环比 | 用“上一个日历月”，不是简单取数组前一项；delta=本月−上月；实现比例=delta/abs(previous)×100；`frontend/src/utils/receiptChanges.ts:6`、`:11` | 页面文案写“÷上月”；现有非负回款条件下一致。若生产允许负基线，应明确 abs 口径；本次未将未证实负回款作为缺陷 |
| 12 月基线 | 1 月仅在 previousMonth 正好是上年 12 月时使用 previousAmount；缺失基线或断月显示“无上月数据” | 不以 0 替代缺失；0→0 为0%；0→非0为“上月为0”，不输出无穷百分比 |
| 环比合计 | 只聚合可比月份；差额合计除对应上月金额合计（实现取绝对分母）；`receiptChanges.ts:20` | 非“各月百分比求和”或“年增长率”；December 基线不计入当年回款 KPI |
| 分仓 | 业务趋势独立图同 Y 最大值；客户排名同客户多柱；客户趋势每指标内多仓库折线；未分配按数量存在性决定是否显示 | 数量/金额两指标各自 Y 轴；排名分仓不重新产生每仓 Top 10；ALL 是查询范围，不是额外仓库系列 |
| 空与未知 | 订单 total=0 显示业务空态；未来值 null、金额缺失显示 `—`；未授权错误与合法 0 不合并 | Dashboard 在 loading 时也会因 data 清空显示“暂无”占位，顶部 busy/刷新状态可区分，但没有每图独立骨架 |

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
| 下钻 | 业务点、排名、数量表、客户金额表、分仓单元格与总计均有路由；未来点/日期禁用。注册与回款无订单/会员下钻，也无图形 click 绑定。路由详情保留 query，分页只更新 page |
| 返回分析 | 明细“返回分析”执行 router.back；分析筛选保存在组件 ref，未序列化到分析页面 URL，也未使用持久化 store。卸载后返回会重新初始化筛选、窗口和选中状态；不是保留原分析快照的实现 |
| 加载/错误/空 | 订单主面板、客户搜索、客户趋势均有 loading；requestId 阻止旧结果覆盖。主请求错误 reset 清空结果/候选/选中客户并提供重试；Dashboard 请求开始即清旧数据、错误显示权限映射文案。客户 selectedError 分支虽存在，但 loadSelected catch 实际 reset 并赋值外层 error（`OrderVolumeAnalysis.vue:74`、`:148`），所以当前不会在弹窗内显示其局部重试，而会关闭弹窗并清整块结果 |
| 会话与授权 | HTTP 拒绝旧会话响应；App RouterView 以 sessionEpoch 为 key 整体重挂载（`frontend/src/App.vue:6`）；订单组件监听 onSessionReset 清数据（`OrderVolumeAnalysis.vue:112`）。岗位路由实时刷新可用角色（`router/index.ts:154`）。页面展示不是最终授权控制，真实跨用户/跨部门数据隔离仍必须由服务端验收 |
| 数据源 | Dashboard/订单图展示 source=mock 标记；没有前端失败后自动造数 fallback。FOP 未配置/未绑定/无权/服务不可用/绑定变化有明确错误映射（`frontend/src/api/fop-access.ts:16`） |
| 导出 | **仅 G01** 配置 `toolbox.saveAsImage.type=svg`；其余图与分析表无 CSV/XLSX/PDF/PNG/SVG 导出入口，不能借用其他业务的 ExportDialog 认定已支持。SVG 真实下载与中文字体待验证 |
| 无障碍 | 包装器 role=img/aria-label，各 option aria.enabled；弹窗有标题/描述关联，表格链接提供替代下钻；图形本身没有自建键盘漫游/筛选功能。屏幕阅读器实际输出未验证 |

### 6. 本地测试证据与盲区

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

### 7. 可证实问题（未修改实现）

#### FE-01 · P2 · 注册趋势可能标上未查询过的日期范围

**触发条件：**Dashboard 请求未完成时用户编辑注册日期；不需越权、不需畸形 API 响应。日期输入在 busy 期间仍可编辑，查询按钮被禁用。

**证据：**`frontend/src/views/autoflow/FopDashboardView.vue:112` 用调用时 from/to 发请求；`:117` 在 await 后重新读当前 from/to 作为 appliedRange；`:216`、`:217` 输入未绑定 disabled；`:221` 展示 appliedRange 与旧请求结果。

**复现：**延迟 dashboard 响应 → 请求原范围 A → 请求在途把开始日期改成 B（例如 2020-01-01）→ 返回 A 的合法统计（例如 23）→ 页面总量仍为23，旁边范围却显示 B—原结束日，而网络只请求过 A 一次。临时 Vitest 已断言：`getFopDashboard` 调用次数=1、请求 from≠B、标题范围包含B、总量=23。

**影响：**用户可能把 A 的统计读成 B 的统计；截图/导出旁边的数据说明也可能错误。金额图本身不受此日期标注问题影响。

**建议验收：**将请求快照作为 appliedRange 来源，或请求中锁日期；无论选择哪种实现，慢请求期间修改输入后，已显示统计范围必须等于对应实际请求范围。此次未修复。

#### FE-02 · P3 · Dashboard 首次进入重复发起两组订单聚合请求

**触发条件：**正常首次挂载 `/dashboard`，不需要手动刷新。

**证据：**两个 OrderVolumeAnalysis 以 revision=0 挂载，`frontend/src/components/order-volume/OrderVolumeAnalysis.vue:80` 的 immediate watch 已调用 load；父组件 `frontend/src/views/autoflow/FopDashboardView.vue:124` 的 onMounted(refresh) 又在 `:106` 增加 revision，`:261`、`:262` 触发两子组件相同 query 再请求。

**复现：**mock 网络 pending 并挂载完整 Dashboard（不 stub OrderVolumeAnalysis）→ 记录 getOrderVolume 调用 → organization 两次、customer 两次，分别字段完全相同。临时 Vitest 已验证 4 次调用及两组参数相等。

**影响：**初次进入为这两个面板发送4次而非2次聚合请求；requestId 会丢弃旧响应，因此未证实重复展示或错误合计。额外后端成本与耗时要以生产测量为准，不能仅凭重复请求推断服务超载。

**建议验收：**区分首次加载与用户全局刷新；首次每面板只请求1次，全局刷新仍各请求1次。此次未修复。

### 8. 未实现与生产待验证清单

下列为明确功能边界或验收事项，不作为本次新发现的生产故障计数。

1. **未实现：**注册/回款点下钻；除注册图外的图表导出、分析数据 CSV/XLSX 导出；分析筛选/图例/滑窗返回恢复；跨图图例联动；任意窗口缩放；弹窗局部错误重试实际路径；图形键盘漫游。是否新增应按业务优先级决定。
2. **生产数据：**对授权账号样本逐一核对每一图、表格、API、明细订单；核对注册 count 定义、回款金额源字段、支付/退款/取消状态、USD 过滤、非 USD 排除笔数、订单去重与金额精度。前端展示代码不能证明这些外部事实。
3. **时间边界：**跨年12月基线、北京时间午夜/月末与浏览器本地日期差异、当月截至目前、未来日期 null、历史全年与周跨年、日期跨度大时性能。Dashboard 默认日期按浏览器本地，订单分析默认日期按UTC+8，这是实际实现差异，应结合接口的业务时区确认。
4. **权限边界：**系统管理员无业务权限、部门及子部门、员工本人、禁用/解绑/绑定变化、跨租户、生产权限接口不可用；保证聚合、options、搜索、明细使用相同有效授权，且不能靠编辑 URL 扩大范围。
5. **数量与金额对账：**总计=明细集合但不重复累计总计行；Top10+other(+unassigned)覆盖全量；分仓数组与总体一致；数量Top10和金额同集合；全部筛选结果 totals 独立于分页；other 点击必须严格回到同一剩余集合。
6. **真实图形验收：**亮/暗色、中/英文、窄屏、超长名称、同名业务员/客户、大金额、正负环比、零值/稀疏值、图例滚动、滑块拖动/触屏、多图联动、弹窗测量与关闭清理、SVG下载内容与字体。现有测试未覆盖这些完整视觉行为。
7. **可用性/性能：**长日期范围最多多年每日数组、分仓及客户金额双图的实际 SVG节点数/帧率、低端设备、窗口反复 resize、反复打开弹窗、网络超时/权限失败重试。前端未实现请求 AbortController，只阻止晚结果写回；不应把“丢弃旧响应”当作“请求已取消”。

### 附录 A：两项问题的可运行诊断片段

以下是本次实际运行的诊断主体，供复核。将代码临时保存为 `frontend/src/tests/echarts-audit-diagnostic.test.ts`，从 `work-app/` 执行 `npm run test --workspace=frontend -- src/tests/echarts-audit-diagnostic.test.ts`。它们断言**错误行为存在**；当前版本应得到 2 个通过，修复后应改写为正确行为断言。此片段不应作为长期回归测试原样提交。本次运行后已删除临时文件，保留此文档中的可复核代码。

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


## 11. 后端契约诊断与生产接入差距


审计日期：2026-10-22。依据当前工作区源码、DTO、序列化器、前端API类型与测试；本次不修改业务代码，也未连接或验证真实FOP生产服务。

机器可读交付：[hyperzone-analytics.openapi.json](../openapi/hyperzone-analytics.openapi.json)，OpenAPI **3.1.1**，**15条路径、15个操作、64个数据模型、8组通用错误响应**。仅列当前已实现的AutoFlow HTTP接口；未实现的FOP上游签名、同步、分页和收款流水接口没有被写成已实现路径。格式依据[OpenAPI 3.1.1官方规范](https://spec.openapis.org/oas/v3.1.1.html)。

### 1. 当前交付判断

图表所需的前后端聚合、查询、权限交集、明细钻取与分页汇总已经存在；**生产FOP数据接入尚未完成**。`UsersModule`只选择`DemoFopDataProvider`或`UnconfiguredFopDataProvider`，没有真实FOP数据适配器。演示仅在`FOP_DATA_MODE=demo`且`NODE_ENV`为`development/test/local`生效。没有演示开关时保持未配置状态，不会把fixture当真实业务数据展示。

客户统计的新增`series.amounts`已经贯穿后端聚合、前端类型和本规范，包含USD总金额、逐期金额、三仓金额及排除订单数。界面称作“收款/回款”的Dashboard数据，实际来自已支付订单的`amount`，**不是独立金融收款台账**；分次付款、部分退款、退款冲销和订单金额与实付金额差异尚未建模。

### 2. 传输与错误边界

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

### 3. 已实现Endpoint清单

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

### 4. 字段、聚合口径与源码追踪

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

#### 仓库、物流、部门与金额对账

仓库只按`warehouseCode`映射HZ/SZ/UNASSIGNED；物流只按`carrierCode`映射YT/4PX/WB/YW/JS/OTHER，顺序固定；展示名称不作为稳定键。报表部门必须由可信适配器把实际组织树归一化为sales1..sales4，不能用前端传参代替权限。

每个数量series应满足`total=sum(非null values)`；每期三仓和等于values。客户金额与同一授权订单、时间桶、仓库映射对应，但非USD订单仍计入订单数，金额会排除并增加excludedOrderCount。明细`amountsByCurrency`保留所有币种，因此不能将其混币总和直接与客户USD金额比较。整数分币解决常见0.1+0.2误差，不等于已完成所有金额异常/溢出校验。

### 5. FOP/provider现状与接入缺口

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

### 6. 接入验收要求（尚待真实FOP环境执行）

1. 获得实际FOP文档与脱敏响应样本，逐字段确认订单ID/客户ID/员工ID/部门祖先/报表部门/仓库/物流/支付状态/原币种/金额/时间戳语义；本规范描述AutoFlow外部契约，不替代尚未获证的FOP上游协议。
2. 对每个本地账户验证绑定唯一性、租户边界、订单白名单、部门后代范围、员工归属及撤权即时生效；无权限时不能退回演示数据。
3. 对图表、同筛选明细、分页总计三方对账，包含空授权、重复ID、未知仓库/物流、非USD、缺客户ID、未来日、跨月UTC+8、TopN/other、无注册台账等边界。
4. 明确收款口径后再对财务系统对账；付款状态不能替代收款交易流水。金额计算统一分币规则、币种策略与异常订单隔离规则。
5. 定义上游超时、限流、失败重试、缓存权限键、数据新鲜度和一致性要求；进行真实规模吞吐/内存测试。当前前端axios超时30秒，不代表上游SLA已完成。

### 7. 实际验证记录与边界

| 验证 | 本次真实结果 | 范围/限制 |
|---|---|---|
| 定向后台单测 | `npm test -- --runInBand --testPathPatterns='src/modules/fop-data/.*spec.ts'`：4 suites、40 tests通过 | 覆盖订单量/客户金额、分币汇总、注册聚合、演示provider；不连接FOP |
| 定向API E2E | `npm run test:e2e -- --testPathPatterns='(fop-data-access\|workbench-access).e2e-spec.ts'`：2 suites、46 tests通过 | 覆盖JWT/权限/状态/DTO/明细/汇总；使用测试替身，不是上游联调 |
| JSON Schema模型/样例 | 64个schema用项目已装Ajv2020编译；31个顶层schema/操作/错误实例通过 | JSON Schema2020-12及formats；含客户amounts与null。主流程另用openapi-spec-validator及递归实例验证 |
| 完整OpenAPI结构 | 最终文件已用`openapi-spec-validator`验证通过，并校验159处模型/请求/响应示例 | 支持3.1.1/JSON Schema2020-12；另有12组本地HTTP响应通过schema校验，不等于真实FOP联调或某个API平台导入已测试 |
| 源码路由审计 | 15个操作均有controller/service证据，源码文件记录在各operation的x-source-files | 不生成未实现FOP操作或伪造上游响应 |
| 生产接入 | 未验证 | 没有真实provider、正式凭据、上游样本、生产数据量或跨系统财务对账 |

机器规范的成功与错误样例均为脱敏契约样例，不是截取生产数据。上述定向测试与主流程全量测试存在重叠，不能将数量相加当作独立测试总数。本交付记录现状、风险和接入需求，没有把测试通过等同于生产FOP接入已完成。


## 12. 本次验证记录与限制


日期：2026-10-22。环境：macOS、Node.js 22.23.3、npm 10.9.9；本地隔离 PostgreSQL 16 集群。执行时间不等同于生产环境验收时间。

### 已完成检查

| 检查 | 实际结果 | 范围/限制 |
| --- | --- | --- |
| 全量前端单测 | 37 文件，134 用例通过 | 包含图表配置、分仓、金额、环比、权限、路由和会话；部分图表使用 stub |
| 全量后端单测 | 36 套，209 用例通过 | 聚合、授权、工作流、报价及基础服务 |
| 全量后端 E2E | 4 套，78 用例通过 | 包含独立 `autoflow_test` 持久化库；不触碰 `autoflow_local_demo` 业务表；部分授权测试使用仓储 stub |
| ESLint | 前后端均通过 | `npm run lint` |
| 后端编译 | 通过 | `tsc -p backend/tsconfig.json --outDir <ignored temporary directory> --incremental false`；避免清空正在运行的 Nest watch 输出 |
| 前端生产构建 | 通过 | `npm run build --workspace=frontend`；存在大于500kB的 chunk 提示，未作为构建失败 |
| 静态资源打包 | 通过 | `npm run package:frontend` |
| 隔离生产冒烟 | 通过 | 临时目录运行新编译后端，端口3198，检查数据库健康、前端HTML、CSP、nosniff，随后停止进程 |
| 浏览器图表冒烟 | 已实测 | 两个回款环比独立切换、取消后明细保持展开、两表列宽与位置完全一致；业务订单分仓真实显示杭州145/深圳72，共217；不代表所有组合已验收 |
| 前端问题复现 | 2 项证实 | 文档中可运行的诊断用例，2/2断言现有错误行为成立；不代表修复 |
| OpenAPI结构和示例 | 通过 | OpenAPI 3.1.1；JSON Schema 2020-12校验159处模型/请求/响应示例（含复用错误示例） |
| 实际HTTP响应契约 | 12组响应通过 | 当前本地登录会话请求Dashboard、客户/组织订单、搜索、明细、履约、权限、账户与组织等接口并校验JSON Schema；仍是本地演示数据，不是真实FOP |
| 待提交敏感文件筛查 | 无匹配凭据字面量/运行库文件 | 检查文件清单与常见真实密钥格式；不构成全面安全审计 |

基线共 **421 个既有测试用例通过**（134＋209＋78）。独立诊断重复运行的测试不再次计入总数。

### 测试环境纠正记录

第一次全量 E2E 因检查进程误设 `FOP_DATA_MODE=demo`，使“默认未配置提供器”用例收到不同错误码，出现8个失败。按照该测试的契约将环境恢复为 `FOP_DATA_MODE=disabled` 后，78/78通过；未修改业务逻辑或放宽测试断言。生产冒烟最初把健康响应断言成恰好两个字段，但实际还含队列状态及时间戳，改为校验必需字段后通过。

### 未覆盖与已知限制

- 未接入金蝶云苍穹真实账户、真实授权和生产数据，未执行生产网络压力或财务流水对账。
- 本轮除上述浏览器冒烟外，未将全部历史浏览器截图当作重新运行的验收；此前客户分仓、金额和下钻的截图可作界面参考，不能证明所有日期/角色组合。
- 测试通过不消除本轮诊断出的日期标注竞态、重复请求、UTC+8月边界、异常金额策略等问题；具体证据和待接入要求见两份审计附录。
- 未在本轮执行 `npm run audit:prod`，不宣称整个 `ci:local` 链已经原样运行。上述 lint、测试、构建和冒烟分别执行且结果可核验。
- 真实浏览器中的全部图例、SVG导出、触屏、极小视口、性能和屏幕阅读器仍需专项验收。

### 文档与 Git 校验

- 最终 OpenAPI 文件包含15个接口操作、64个模型；结构验证和159处示例验证均通过。12组本地已登录接口响应通过对应 JSON Schema 校验。
- Markdown 与 HTML 从同一契约生成。HTML 离线解析确认95张表格，其中52张对象模型字段表、15张接口响应表；13个正文章节、14个页内跳转均有效，未发现未渲染的字段表文本。
- HTML 内嵌共享 CSS 和2处透明 SVG Logo，无外部脚本、字体或图片运行依赖；包含移动适配和打印样式。生成器新增字段表/响应表数量检查，避免表格排版退化。
- 浏览器工具的文件 URL 安全策略拒绝打开本地 HTML，因此本轮只完成离线结构校验，未完成该文档的浏览器视觉、窄屏或打印预览。Dashboard 的浏览器冒烟与文档预览是两项不同检查。
- Git 提交范围包含此前累计的业务功能及本次文档。已获取远程新增部署提交，远程文件在本地均存在；采用保留远程历史、最终文件树以本地为准的合并方式。具体提交与推送结果以 Git 记录及交付消息为准。


## 13. 规范来源与文档再生成

OpenAPI 结构参考 [OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html)。产品事实来自本仓库源码和本次诊断，不来自通用规范。HTML 使用项目共享 HyperZone 样式、内嵌 CSS 和透明 SVG Logo，可离线打开及打印。

```sh
python3 -m venv .runtime/local-demo/docs-venv
.runtime/local-demo/docs-venv/bin/pip install -r scripts/docs/requirements.txt
.runtime/local-demo/docs-venv/bin/python scripts/docs/build-analytics-docs.py \
  --style-root /Library/VSCode/.hyperzone/html-style
```

`REQUIREMENTS_OVERVIEW.md` 是业务需求源，接口及字段表从 OpenAPI JSON 生成；修改后执行上述脚本同步两种交付格式。不同机器需提供同版本 HyperZone 共享样式目录；生成后的 HTML 本身无此路径依赖。
