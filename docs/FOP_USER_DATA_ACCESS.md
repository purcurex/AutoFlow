# FOP 用户级数据权限接入

> 本地已新增显式 Mock 验收模式，详见 [Demo验收与API约定](FOP_DEMO_ACCEPTANCE.md)。该模式使用独立模拟身份，保留本节的真实FOP默认拒绝边界；不会自动绑定真实后台用户。

## 已实现与未接入范围

本项目面向公司内部员工，采用三层独立授权：

1. **岗位权限**：控制销售、采购、配货、发运、仓库工作台及对应业务队列。
2. **业务数据角色**：可选无业务数据权限、所属公司全部业务数据、本部门及子部门、仅本人数据。
3. **FOP 用户数据权限**：通过当前登录账号绑定的 FOP 租户 ID／用户 ID，从服务端权限适配器解析该用户可访问的订单与收款分录范围。

三层都满足后才能读取履约数据。另有独立的系统管理角色 `users.role`（`admin` / `user`），只控制组织架构、账号与角色设置，不扩大业务数据范围。系统管理员可管理绑定和岗位，但不自动获得所有 FOP 数据。FOP 授权与本地角色范围取交集；业务员按绑定的稳定员工 ID 过滤，不按显示姓名判断。业务管理员可访问全部五类工作台，但不会因此获得系统账号管理权限。

已实现数据库约束、管理员绑定管理、查询授权边界、按权限过滤后的明细和汇总、会话缓存隔离及自动化验证。**真实 HyperZone FOP（金蝶云苍穹自研应用）权限、订单和收款网络 API 尚未接通**；默认适配器保持未配置，所有账号默认未绑定。当前本地验收账号继续保留五类岗位，未被赋予虚构 FOP 身份。

## 员工账号配置

管理员打开 `/admin/workbenches`（侧栏“账号与权限”）：

- 单独设置系统管理角色；再配置业务数据范围和工作台岗位。系统管理员也可选择“无业务数据权限”。
- 配置业务数据角色、所属部门 ID、绑定员工 ID；使用组织目录／FOP 的稳定 ID。部门经理必须填写部门，业务员必须填写员工。账号管理仍仅允许系统管理员操作。
- 填写 FOP **租户 ID** 和 **用户 ID**，使用后台稳定标识，不填写姓名、邮箱或 FOP 密码。
- 保存绑定。一个租户内的 FOP 用户只能绑定一个前端账号；不同租户可使用相同用户 ID。
- 解除绑定后，后续 FOP 查询拒绝访问。进行中的查询在返回前再次核验绑定和岗位，变化时丢弃结果。

绑定成功只保存身份映射，并不代表该用户已通过 FOP 授权校验。员工在工作台顶部可查看自身绑定状态。新员工账号仍沿用现有账号创建流程；此处不批量创建员工。

## AutoFlow HTTP 接口

以下路径是本项目后端接口，不是已确认的金蝶原生 API。所有接口使用现有登录会话；绑定管理额外要求数据库当前角色为管理员。

| 方法与路径（以 `/api` 为前缀） | 用途 |
| --- | --- |
| `GET /users/workbench-accounts?page=1&pageSize=20&search=...` | 管理员分页查询账号及 `fopBinding` |
| `PUT /users/:id/management-role` | 独立修改系统管理角色，正文 `{ "role": "admin" }` 或 `{ "role": "user" }`；不改变业务范围、岗位或 FOP 绑定 |
| `PUT /users/:id/business-scope` | 系统管理员配置业务角色、所属部门和员工 ID |
| `PUT /users/:id/fop-binding` | 管理员绑定、改绑或解除绑定，返回安全账号信息 |
| `GET /autoflow/integrations/fop/data-access` | 查询当前登录员工自身绑定和权限服务状态 |
| `GET /autoflow/integrations/fop/fulfillment-orders` | 用户授权范围内的履约明细 |
| `GET /autoflow/integrations/fop/dashboard` | 同一用户授权范围内的履约计数、异常订单、任务及独立授权的回款 |
| `GET /autoflow/integrations/fop/receipts` | 日期、部门、业务员、客户、仓库及来源过滤后的收款分录 |
| `GET /autoflow/integrations/fop/order-volume/receipts` | 客户图表同一 Top 10／other 集合的回款下钻 |

绑定请求：

```json
{"tenantId":"company-tenant-id","userId":"employee-fop-id"}
```

解绑请求：

```json
{"tenantId":null,"userId":null}
```

两个字段必须同时填写或同时为 null，字符串去除首尾空格后长度为 1–128。数据库同时强制配对和租户／用户唯一性，重复绑定返回 409。用户个人资料更新、注册资料或订单查询不能修改绑定。

当前账号权限状态示例：

```json
{"binding":null,"status":"unbound"}
```

`status` 可为 `unbound`、`not_configured`、`ready`、`unavailable`、`denied`。`ready` 表示权限解析成功，可能返回空授权范围；不代表订单服务一定在线。前端不会保存或接收授权订单 ID 清单。

履约接口参数：`queue`、`search?`、`orderNumber?`、`page`、`pageSize`。队列及字段定义见 [工作台接口文档](FOP_DASHBOARD_INTEGRATION.md)。Dashboard 参数为 `from`、`to`、`year`；from/to 用于注册、year 用于回款，日/月界线均为 UTC+8，不排除历史待办订单。没有资源权限的工作台队列计数为零，异常和任务不返回该岗位内容。

未知身份／范围参数被拒绝，后端不允许 `userId`、`tenantId`、授权范围或客户端用户对象覆盖登录身份。成功响应只包含经过授权过滤和业务条件过滤后的数据及计数，不泄露全部数据总数。

## 服务端适配器契约

位置：`backend/src/modules/fop-data/fop-data.types.ts`，注入标识 `FOP_DATA_PROVIDER`。

```ts
interface FopIdentity { tenantId: string; userId: string }
interface FopPermissionGrant {
  subject: FopIdentity
  allowedOrderIds: readonly string[]
  allowedReceiptIds?: readonly string[] // 缺失或空数组均不授予收款访问
  analyticsScopes?: readonly ('rates' | 'registrations' | 'receipts')[]
}
// FopOrderCandidate 在前端订单字段之外必须带 tenantId（只用于服务端校验）。
abstract class FopDataProvider {
  abstract isConfigured(): boolean
  abstract resolvePermissions(identity: Readonly<FopIdentity>): Promise<FopPermissionGrant>
  abstract listOrders(identity: Readonly<FopIdentity>, grant: Readonly<FopPermissionGrant>): Promise<FopOrderCandidate[]>
  // 基类默认抛出未配置错误；真实适配器须实现，禁止由订单金额合成收款。
  async listReceipts(_identity: Readonly<FopIdentity>, _grant: Readonly<FopPermissionGrant>): Promise<FopReceiptCandidate[]> {
    throw new Error('Receipt data provider is not configured')
  }
}
```

实际类型签名以源码为准。当前实现使用彼此独立的订单 ID 与收款分录 ID 授权清单；它是 AutoFlow 内部授权契约，**不是对金蝶权限 API 返回结构的假定**。后续适配器应将苍穹的组织、业务对象和数据规则转换成经过权限校验的订单及收款分录集合，或在需要大规模服务端分页时扩展此契约并保留同等边界验证。

每次请求的处理顺序：

1. 从会话取本地账号 ID，读取当前数据库岗位、业务角色、部门、员工映射和 FOP 绑定。
2. 校验岗位、业务范围必要映射、绑定及适配器配置。
3. 以服务端绑定调用 `resolvePermissions`；返回主体必须与绑定的租户／用户完全相同。
4. 订单、收款分录分别检查白名单；空订单白名单不读取订单，不能据此授予或否定独立收款授权。缺失／空收款白名单不读取收款；缺少 receipts scope 时客户响应省略 amounts、Dashboard 回款为空，收款明细端点返回 403。
5. 读取订单候选集合；取租户匹配、订单 ID 在白名单内且符合本地业务数据范围的交集并去重，再做状态、搜索、精确订单号筛选及稳定排序、分页。提供方附加元数据不会被序列化给前端。
6. 收款候选先取租户、allowedReceiptIds 与业务范围交集，再白名单序列化；重复或畸形获授权分录拒绝为 503，不重复计入。Dashboard 与客户金额共用此账本，订单数仍只来自已支付已审核履约订单。源单审核与收款单审核分别校验，押金备货、样品不计入。不会先统计全公司数据再只过滤明细。
7. 外部调用返回后再次读取数据库校验绑定／岗位，拒绝过期结果。

当前无长期权限缓存：后续请求重新解析 FOP 权限。前端刷新失败清除旧数据；退出、换号、跨标签页身份变化清空业务缓存，旧会话的迟到响应不能写入新账号页面。

产品成本、物流目录、报价中的外部成本／运费读取和 FOP CRM 移交属于不同资源／操作。订单授权不能替代这些权限；在其专属权限契约接通前禁止调用未限定用户的 FOP 端口。本地工作流、客户线索、跟进任务、跟进汇总、AI 客户沟通记录、采购搜源结果、报价及导出、移交记录读取统一使用三级业务范围。修改、删除、执行和对外发送仍保持原有操作权限，扩大可见范围不自动开放这些操作。注册／回款统计必须先应用本地角色过滤，非管理员不得读取无法按员工归属拆分的旧版全公司注册汇总。

## 错误处理

| 状态 | code | 前端处理 |
| --- | --- | --- |
| 401 | 会话无效 | 清空会话并重新登录 |
| 403 | `business_access_disabled` | 账号未分配业务数据权限，管理权限不受影响 |
| 403 | `business_scope_required` | 提示管理员配置部门或员工数据范围 |
| 403 | `fop_binding_required` | 提示联系管理员绑定 |
| 403 | `fop_permission_denied` | 提示核对后台授权 |
| 403 | `fop_binding_changed` | 丢弃结果并提示刷新 |
| 503 | `fop_not_configured` | 提示接口待接通，不返回演示数据 |
| 503 | `fop_unavailable` | 提示服务不可用，可重试 |
| 409 | 绑定冲突 | 原绑定保持不变，提示核对账号 |

权限范围与字段映射不明确、适配器异常、权限主体不匹配均不得默认放行。

## 数据库与验证

迁移 `1784729000000-AddFopUserBindings.ts` 新增 `users.fop_tenant_id`／`users.fop_user_id`，不修改已有岗位，不填充 FOP 身份。部署时先运行 `npm run db:migrate`。

测试使用独立测试数据库；不得将 e2e 测试配置到业务数据库。覆盖不同员工、明确共享订单、跨租户候选排除、精确搜索及计数不泄露、分页、空授权、未绑定、接口故障、普通用户不能绑定、重复绑定、绑定和岗位撤销以及异步期间改绑。前端覆盖权限失败不回退演示、刷新清除旧数据、绑定管理、跨账号／跨标签页缓存与迟到响应。

后续需要提供的接入信息：真实 FOP 环境和租户标识、后台用户稳定 ID、服务端认证方式、按用户校验数据权限的接口与返回样例、履约实体／字段及状态映射、相关非订单资源的独立授权规则。凭证仅配置在后端，不写入浏览器或本文档。

## 业务数据范围与目录约定

配置接口请求示例：

```json
{"role":"department_manager","departmentId":"stable-department-id","employeeId":null}
```

`role` 为 `none`、`admin`、`department_manager` 或 `salesperson`。`departmentId` 和 `employeeId` 未配置时必须显式传 `null`；普通用户不能通过个人资料、注册或查询参数修改这些字段。账号创建默认业务员；系统管理员不自动扩大业务范围。选择 `none` 将拒绝所有业务模块的读取、写入和导出（403 `business_access_disabled`），保留已分配的系统管理能力。业务管理员仍无法调用系统账号管理接口。

- **本地业务**：按记录的 `ownerUserId` 和服务端账号所属部门过滤。同部门包含由组织架构节点维护的下级部门。已绑定 FOP 的账号限定同一 `fopTenantId`；未绑定账号属于当前安装的本地公司范围，不与其他 FOP 租户混合。业务员可读取自己创建的本地数据；履约数据另需员工映射。
- **FOP / Mock 履约及收款**：每条订单／收款分录必须包含可信的 `owner.id`、`department.id`；下级部门归属通过服务端 `departmentPathIds` 传递，包含当前部门及全部祖先 ID。注册明细同样携带 `owner.id` 与 `departmentPathIds`。部门经理和业务员只汇总匹配记录；缺少归属信息的记录不向这些角色放行。
- **目录同步预留**：正式适配器需将 FOP 稳定部门／员工 ID 写入账号映射，并同步部门父子目录，或提供相同的可信祖先路径。外部部门未同步父子目录时，本地业务仅支持相同部门 ID 匹配，不能猜测下级关系。适配器必须将真实 FOP 用户授权映射到 `FopPermissionGrant`，不能因为本地角色为管理员而跳过后台授权。
- **组织管理**：组织架构和员工归属只能由系统管理员调整，避免部门经理通过移动成员扩大自己的数据范围。组织架构模块（包括目录读取）仅限系统管理员；普通员工无入口，直接访问页面或接口也会被拒绝。
- **权限变更**：查询重新读取账号授权；FOP 异步调用结束再次核对业务角色、部门、员工映射、岗位及绑定。

迁移 `1784731000000-AddBusinessDataScopes.ts` 新增三个用户级字段及数据库约束，并将未指定币种的采购报价默认值改为 `USD`。不批量覆盖已存原币种，不自动提升已有普通账号权限。

## 金额默认币种

金额显示统一使用 `frontend/src/utils/currency.ts`，缺省币种为美元 `USD`。履约订单、报价表单、报价请求和采购报价的显示缺省币种均一致；收款来源必须明确币种，不能继承显示层默认值。明确标注的原币种（例如 1688 的 CNY）保留，不把人民币数值直接改标成美元。USD 回款统计只汇总美元收款分录，源币种必须明确，不能把空币种默认为美元，其他原币种需要正式汇率转换契约后再并入。

## 收款业务约定

方案 2 已确认：履约及全款备货源单已支付、已审核，收款单也已收且已审核，按支付时刻转换 UTC+8 归入当月。实收来自分录 `hzkj_real_receive_amt`，不是订单 `amount` 或重复分摊的表头实收；订单金额 `hzkj_samount`、手续费 `hzkj_handle_fee` 分别保留。钱包授信消费仍可能生成有效结算收款，因此不命名为银行现金净流入。全款备货的海外物流不适用，`carrierCode=null`；履约使用预付库存不恢复产品金额。

已审核履约的仓库及物流渠道必须完整；缺失或未映射代码属于契约错误。真实存在、已完成映射的其他物流服务商可归 `OTHER`，不得以 `OTHER` 掩盖未知源记录。后台源码与字段证据见 [源码映射](analytics/HYPERZONE_FOP_SOURCE_MAPPING.md)，源码存在不表示生产 HTTP 接口已发布。


## 管理权限与业务数据权限分离（2026-10-22）

- 系统管理授权接口只更新 `users.role`；业务范围接口只更新业务角色及部门／员工映射；两者互不覆盖。
- `GET /workbench/access` 返回 `{ roles, isAdmin, businessRole }`。`businessRole=none` 时 `roles=[]`，管理入口仍由 `isAdmin` 决定。
- `JwtAuthGuard` 对每次认证请求重新读取数据库账号。业务访问默认受控；账号与权限、组织目录、个人资料及权限状态端点显式保留；其中组织目录读写仍要求系统管理员权限。管理接口继续核对当前系统角色，不能依赖旧 JWT 或前端隐藏菜单。
- 系统管理员可给自己关闭业务数据权限，并保留恢复权限的管理入口。不能撤销自己的系统管理角色（409）；需由另一位管理员操作。管理角色变更在数据库事务锁内重查操作者权限，避免并发撤权导致无人可管理。
- 普通账号即使有全部业务数据权限，也不能编辑组织或分配账号权限。系统管理员拥有部门／本人范围时，仍按对应范围过滤；旧版跨用户业务记录管理额外要求全部业务数据权限。
- 迁移 `1784732000000-SeparateManagementAndBusinessAccess.ts` 扩展数据库约束，并一次性显式保留既有系统管理员此前的全部业务数据范围。迁移后的新管理授权不再自动授予业务数据权限；存在 `none` 账号时拒绝回滚，以免旧实现重新扩大访问。
- 局域网开发测试：Vite 监听 `0.0.0.0:5173`，API 和头像走同源代理。账号凭据仅保存在本地忽略目录，不提交进仓库。
