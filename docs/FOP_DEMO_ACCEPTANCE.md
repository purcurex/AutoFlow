# HyperZone Demo 验收与接口约定

## 启动和模式

本地恢复脚本 `scripts/deployment/start-local-demo-backend-macos.sh` 显式设置 `FOP_DATA_MODE=demo`。仅在 `NODE_ENV=development`、`test` 或 `local` 时生效。生产环境或未配置 Demo 模式，仍使用默认未接入的 FOP 适配器，不会因上游失败切换到模拟数据。

页面显示 `MOCK`，后端响应为 `source: 'mock'`。Mock 与 FOP 使用相同 HTTP 路径、查询参数和返回结构，不需要前端切换另一套实现。Demo 不修改真实账号的 FOP 绑定或系统管理员权限；以会话账号派生独立模拟身份。

## 验收入口

- `/dashboard`：履约卡片、异常订单、今日任务、注册趋势 ECharts、业务一至四部月度回款 ECharts、按部门筛选的业务员月度回款 ECharts；卡片和任务跳转对应工作台。
- `/workbench/procurement`：待采购27单。
- `/workbench/allocation`：待配货36单。
- `/workbench/dispatch`：待发运24单。
- `/workbench/warehouse`：待发货42单。
- `/workbench/sales?queue=review`：待审核18单。
- `/workbench/sales?queue=exceptions`：异常13单。
- `/organization`：HyperZone组织树和员工目录，可自定义结构。

上述数量为初始演示集、账号持有全部岗位时的结果。各岗位仍受真实登录账号的岗位授权约束。Dashboard 异常区预览5条并链接全部清单；接口与数量徽标保留完整异常集合。

模拟数据包含160笔待办订单、三个年份的历史已付款订单、8种配有SVG示意图的SKU产品、海外客户与Shopify店铺、支付状态、仓库、物流商、跟踪号和创建／支付时间。历史付款订单用于部门回款统计，不混入待办队列。注册日期范围可查询，使用营销中心／业务一至四部单一统计范围筛选，回款年份可切换；履约待办计数不受注册日期影响。

回款金额由当前账号授权订单中已支付、未取消、币种USD且有对应支付日期的订单汇总而来。演示汇率只是展示参考值，不用于伪造跨币种结算。数据随日历推进生成；同一天刷新、搜索与分页保持稳定。

## 组织与员工

初始31个组织节点（含根组织）和23名演示员工。根为HyperZone，包含总经办、营销中心、运营中心、供应链中心、信息管理部、财务行政部和合作伙伴。营销中心有业务一至四部及欧洲／北美／亚太销售组、大客户组；供应链覆盖商品、采购、订单、物流、售后和杭州／深圳仓，并提供下级作业组。

每个登录账号拥有独立、持久化的设计空间。模拟员工不是实际登录账号，不会创建密码或提升权限。可：

1. 选择节点，新增子部门。
2. 修改名称、上级部门和同级排序；不能移动到自身或其后代。
3. 为模拟员工重新选择所属部门。
4. 删除空部门；根节点、含子部门或直属成员的部门不能删除。
5. 刷新页面验证保存。组织名称、部门和成员调动会在后续订单／图表刷新时同步。

这是本地账号范围内的可编辑模拟组织。正式公司的共享组织及金蝶组织同步，后续需按实际租户和组织管理授权接入；不会把个人演示设计自动写入FOP。

## 相同 API 契约

### 订单与面板

- `GET /api/autoflow/integrations/fop/fulfillment-orders?queue=allocation&page=1&pageSize=10`
- `GET /api/autoflow/integrations/fop/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&year=YYYY`
- `GET /api/autoflow/integrations/fop/data-access`

订单保持现有 `FopOrderPage`，额外提供可选归属字段供Mock和将来的FOP共用：

```ts
organization?: { id: string; name: string }
department?: { id: string; name: string }
owner?: { id: string; name: string }
salesDepartmentCode?: 'sales1' | 'sales2' | 'sales3' | 'sales4'
// items[]新增可选 productId，原sku/name/imageUrl/variant/quantity保持不变。
```

面板维持 `queues/rates/registrations/exceptions/tasks/receipts` 结构。`receipts.departments[]` 固定按业务一至四部排序，`id` 为 `sales1` 至 `sales4` 的报表编码，`name` 为对应业务部名称。每个部门返回 `amounts: number[]` 及 `salespeople: {id,name,amounts:number[]}[]`，两种金额数组均与 `receipts.months` 对齐，以 USD 元表示、保留两位小数。无回款的部门为零数组；未授予 receipts 权限时，月份、部门和业务员数据均为空。员工以稳定 ID 分组，不按姓名合并；有部门编码却缺失负责人时归入 `__unassigned__`（未分配业务员）以确保两图合计一致。

Mock 适配器沿员工所属部门向上查找业务一至四部（包括其二三级子部门），写入订单 `salesDepartmentCode`；运营、采购、仓库等其他部门订单不计入这四部回款。正式 FOP 适配器应按后台组织 ID 映射该标准编码，不应依赖前端推断。演示组织中若改名或移出这些业务部，下一次刷新按新树归属计算；正式历史归属需由 FOP 提供订单上的业务部和负责人快照。

业务员图一次仅显示表头选中的部门，切换部门不重新请求权限或扩展数据范围；年份与上方部门图共用。两张图都由服务器对同一授权订单集以整数分累计，逐部门逐月可核对。明细按订单分页，多商品显示在同一行。统计、列表均在用户权限过滤后计算，生产和Mock不会使用不同计数逻辑。

`data-access` 在Demo模式返回 `source:'mock', mode:'demo'` 和模拟身份；真实绑定不变。正式接口可返回 `source:'fop', mode:'live'`。UI明确区分两种来源。

服务端 `FopPermissionGrant` 现在可提供 `analyticsScopes: ['rates','registrations','receipts']`。上游适配器必须分别授予需要的统计资源权限；缺少的范围返回空数据。注册／汇率提供方的返回主体需与当前绑定一致；回款仍由授权订单计算。成本、物流和CRM移交端口不因启用此Demo而获得真实FOP权限。

### 组织管理

组织结构调整需要系统管理角色（`users.role=admin`）；仅拥有全部业务数据范围不授予编辑权限。系统管理员将业务数据范围设为 `none` 后仍可进行组织设计、账号授权与角色设置。

| API | 请求 | 返回 |
| --- | --- | --- |
| `GET /api/organization` | 无身份参数 | 完整组织空间 |
| `POST /api/organization/nodes` | `{parentId,name,sortOrder}` | 更新后的组织空间 |
| `PUT /api/organization/nodes/:id` | `{name?,parentId?,sortOrder?}` | 更新后的组织空间 |
| `DELETE /api/organization/nodes/:id` | 无 | 更新后的组织空间 |
| `PUT /api/organization/employees/:id` | `{departmentId}` | 更新后的组织空间 |

空间结构：`{source,nodes,employees,canEdit}`。节点为 `{id,parentId,name,kind,sortOrder}`；员工为 `{id,name,code,email,departmentId,workbenchRoles}`。后端从会话取得所有者，客户端不可指定其他账号。变更事务使用每账号锁，数据库复合外键禁止跨账号父节点和成员归属。

迁移：`1784730000000-AddOrganizationSandbox.ts`。账号首次读取组织时建立初始树，之后读取保留其自定义修改。

## 验证要点

后端测试覆盖默认关闭／生产关闭、跨账号数据隔离、同一接口形状、队列与统计一致、真实组织ID关联、日期年份筛选、权限撤销、异常解析关闭、组织保存／循环／非空删除及并发移动。前端覆盖树层级与父级选项、创建保存、失败不伪造成功、成员调动、删除确认、四部门汇总、业务员筛选及金额核对、列表状态和搜索分页。

## 注册维度与营销中心汇总（2026-10-21）

`GET /api/autoflow/integrations/fop/dashboard` 仍只接受日期范围与年份，不接受客户端提交的用户身份或授权范围。

- `registrations: {date,count}[]`：筛选范围内的逐日总数。
- `registrationDepartments: {id,name,counts:number[],salespeople:{id,name,counts:number[]}[]}[]`：固定业务一至四部，所有 counts 数组与 registrations 的日期顺序对齐；业务员按稳定 ID 区分。同一天的业务员合计等于部门合计，四部合计等于总数。
- `receipts.marketingCenter: {id:'marketing',name:'营销中心',amounts:number[]} | null`：与 months 对齐，逐月等于四部 amounts 的和。前端图例、柱状系列和数据表将营销中心排在四部之前；页面总额仅计算一次，业务员回款下拉仍仅包含四个部门。

服务端 FOP 适配器可返回 `registrationEntries: {date,salesDepartmentCode,owner:{id,name},count}[]`。该明细必须先按请求主体的 FOP 用户权限过滤，且同一天、部门、业务员组合只能出现一次；后端校验日期、部门编码、员工标识、非负整数和重复项，再在所选范围内补齐零值并汇总三种视图。提供该字段时，以该明细为注册统计的唯一数据源；旧适配器未提供时仅保留原每日总数，部门／业务员维度显示无授权数据，不编造归属。

Mock 从当前账号独立组织目录取得业务员及业务部门（含下级子部门），按账号、员工和日期确定性生成注册数；组织调动会影响后续刷新归属。无 registrations 授权时返回空注册数据与空部门数组；无 receipts 授权时 marketingCenter 为 null。所有统计只代表当前账号可见范围，营销中心不扩大为全公司数据。

## 单一注册统计范围与参考人员名单（2026-10-21）

注册统计右上角仅保留一个下拉框：营销中心、业务一部、业务二部、业务三部、业务四部。营销中心显示“营销中心合计＋四部”五个平级系列；部门显示“本部合计＋本部业务员”平级系列，不使用堆叠。顶部数量只取合计系列；下方清单直接展开，按统计对象逐行列出区间合计和每日数量。

这次人员参考仅取附件中能同时确认部门、职位及英文名的15人：

| 部门 | 外贸业务员／伙伴 |
| --- | --- |
| 业务一部 | 曹可滢（Ruth）、陈会娟（Coco）、董梦强（Alex）、李文静（Betty）、杨美婷（Heidi） |
| 业务二部 | 马政莹（Maya）、辛安冉（Stella）、曾婷婷（Mia）、张映婷（Zoe） |
| 业务三部 | 陈宣竹（Joy）、林世龙（Jaylen）、刘朵朵（Iris）、杨莹（Kiki，营销伙伴）、叶力铭（Jennie） |
| 业务四部 | 梁东澜（Liora） |

不纳入负责人、部门经理，也不猜测群成员截图中没有确认部门／职位的人员。截图未提供注册人数或回款金额，数值仍为确定性生成的 Mock 数据。组织目录保留8名运营和供应链演示员工，以支持其他岗位工作台；只有销售岗位且归属于四个业务部的员工参与这些统计。中英文组合名称使用既有 `owner.name`／统计 `salespeople[].name` 契约，正式 FOP 适配器需按业务职位和用户权限筛选，并提供相同显示名称。

新空间使用更新后的 seed；已有本地测试账号通过 `backend/src/database/sync-demo-sales-roster.ts` 显式升级。脚本限定 localhost / autoflow_local_demo / FOP_DATA_MODE=demo，仅处理 test@autoflow.local 的演示员工；先备份目录，保留账号权限、真实FOP绑定、自定义组织和已有员工调动，旧默认四人仅改名，补充11名成员。重复运行不新增重复记录，不覆盖自定义姓名。若原子部门无法唯一匹配则事务回滚。
