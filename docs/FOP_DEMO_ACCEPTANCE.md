# HyperZone Demo 验收与接口约定

更新：2026-10-22，方案2实收分录合同。FOP 为金蝶云苍穹上的 HyperZone 自研后台，源码只读核查见 [字段映射](analytics/HYPERZONE_FOP_SOURCE_MAPPING.md)；本 Demo 不证明生产网络已接通。

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

上述数量是原始160笔待办演示集的参考基线；新增预付库存验收单及账号／组织范围可能改变实时清单计数，应以同请求筛选合计为准。各岗位仍受真实登录账号的岗位授权约束。Dashboard 异常区预览5条并链接全部清单；接口与数量徽标保留完整异常集合。

模拟数据包含160笔待办订单、三个年份的历史已付款订单、8种配有SVG示意图的SKU产品、海外客户与Shopify店铺、支付状态、仓库、物流商、跟踪号和创建／支付时间。历史已支付已审核订单用于履约数量统计，并生成独立模拟收款分录；新增全款备货与押金备货分录供纳入／排除验证。注册日期范围可查询，使用营销中心／业务一至四部单一统计范围筛选，回款年份可切换；履约待办计数不受注册日期影响。

回款由当前账号独立授权的有效 USD 收款分录实收汇总：源单已支付、已审核且收款单已审核，来源履约＋全款备货；押金备货和样品不计。普通模拟履约分录保留订单金额、2%手续费及扣手续费后的实收；全款备货有独立行 ID 且不计履约订单数。支付日／月统一 UTC+8。API 可返回演示汇率参考值，当前 Dashboard 未展示汇率，也不用于跨币种结算。数据随日历推进生成；同一天刷新、搜索与分页保持稳定。

## 组织与员工

初始27个组织节点（含根组织）和23名演示员工。根为HyperZone，包含总经办、营销中心、运营中心、供应链中心、信息管理部、财务行政部和合作伙伴。营销中心下设业务一至四部，销售人员直接归属业务部门（依次5／4／5／1人），不预设区域销售组或大客户组；供应链覆盖商品、采购、订单、物流、售后和杭州／深圳仓，并提供下级作业组。

历史未关联账号保留独立、持久化的设计空间；管理员为员工开通的账号关联该员工所属目录。初始模拟员工不自动开通登录账号，新增操作详见 [员工与登录账号管理](EMPLOYEE_ACCOUNTS.md)。可：

1. 选择节点，新增子部门。
2. 修改名称、上级部门和同级排序；不能移动到自身或其后代。
3. 为模拟员工重新选择所属部门。
4. 系统管理员在部门标题右侧点击“删除部门”，确认后删除空部门，也可取消。根节点不可删除；含下级部门或直属成员的部门显示具体数量及处理提示，服务端再次校验。删除失败保留原节点，不显示成功。
5. 刷新页面验证保存。组织名称、部门和成员调动会在后续订单／图表刷新时同步。
6. 在选中部门下方的成员区添加员工，设置编号、邮箱、职务、手机、部门和岗位；可同时开通普通登录账号，也可之后开通。新账号默认本人业务范围，FOP绑定可以稍后完成。
7. 成员区支持搜索、编辑信息／账号、单个或批量删除。删除归档员工并停用关联账号，旧会话立即失效；本人及系统管理员成员不可删除。历史业务记录保留，含历史归档成员的部门暂不能物理删除。
8. 下载模板并批量导入.xlsx或UTF-8 CSV，每次最多100人、2MB；预览检查字段、重复身份及原始行号，确认时再次校验并整批保存。导入只创建员工档案，随后开通账号。
9. 账号与权限页面默认查询未停用账号，独立分配系统管理、业务数据、工作台和图表权限。新增员工、账号资料及FOP关联统一在组织架构维护，导航顺序为组织架构在前、账号与权限在后。

这是本地账号范围内的可编辑模拟组织。正式公司的共享组织及金蝶组织同步，后续需按实际租户和组织管理授权接入；不会把个人演示设计自动写入FOP。

## 相同 API 契约

### 订单与面板

- `GET /api/autoflow/integrations/fop/fulfillment-orders?queue=allocation&page=1&pageSize=10`
- `GET /api/autoflow/integrations/fop/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&year=YYYY`
- `GET /api/autoflow/integrations/fop/data-access`
- `GET /api/autoflow/integrations/fop/receipts?from=YYYY-MM-DD&to=YYYY-MM-DD&warehouse=ALL&workbenchRole=sales&page=1&pageSize=20`
- `GET /api/autoflow/integrations/fop/order-volume/receipts?category=customer&from=YYYY-MM-DD&to=YYYY-MM-DD&warehouse=ALL&seriesId=other&workbenchRole=sales&page=1&pageSize=20`

订单保持现有 `FopOrderPage`，额外提供可选归属字段供Mock和将来的FOP共用：

```ts
organization?: { id: string; name: string }
department?: { id: string; name: string }
owner?: { id: string; name: string }
salesDepartmentCode?: 'sales1' | 'sales2' | 'sales3' | 'sales4'
// items[]新增可选 productId，原sku/name/imageUrl/variant/quantity保持不变。
```

面板维持 queues/rates/registrations/exceptions/tasks/receipts 结构；receipts 必有 basis=actual_received、timeZone=UTC+8。部门固定 sales1 至 sales4。营销中心／部门／业务员系列均有 amounts、previousAmount、breakdown（fulfillment 与 fullPaymentStock 逐月数组）、previousBreakdown（上年12月两来源金额）。金额与 months 对齐，以 USD 主单位表示；无回款部门为零数组。无 receipts scope 时 months/departments 为空、marketingCenter=null；字段缺失不当作合法零额。

每条收款必须有稳定 owner、department 与报表部门，缺失归属是契约错误，不再生成 __unassigned__ 业绩。已审核履约仓库及物流必须明确映射；全款备货物流为 null，页面显示“不适用”。

Mock 适配器沿员工所属部门向上查找业务一至四部（包括其二三级子部门），写入订单及收款的 salesDepartmentCode；其他部门不纳入四部业绩资源。正式 FOP 适配器应按后台组织 ID 映射该标准编码，不应依赖前端推断。演示组织中若改名或移出这些业务部，下一次刷新按新树归属计算；正式归属需由可信 FOP 适配器明确收款／源单业务部及负责人映射。

业务员图一次仅显示表头选中的部门，切换部门不重新请求权限或扩展数据范围；年份与上方部门图共用。两张回款图都由服务器对同一独立授权收款分录集以安全整数分累计，逐部门逐月可核对。数量明细按履约订单分页；金额明细按收款分录分页，多商品显示在同一行，totals 是分页前完整合计。统计、列表均在用户权限过滤后计算，生产和Mock不会使用不同计数逻辑。

`data-access` 在Demo模式返回 `source:'mock', mode:'demo'` 和模拟身份；真实绑定不变。正式接口可返回 `source:'fop', mode:'live'`。UI明确区分两种来源。

服务端 `FopPermissionGrant` 现在可提供 `analyticsScopes: ['rates','registrations','receipts']`。上游适配器必须分别授予需要的统计资源权限；缺少的范围返回空数据。注册／汇率提供方的返回主体需与当前绑定一致；回款额外要求独立 allowedReceiptIds，缺失或空清单不授予收款权限；订单授权不能推导收款授权。客户统计无 receipts scope 时省略 amounts，收款端点返回403。成本、物流和CRM移交端口不因启用此Demo而获得真实FOP权限。

### 组织管理

组织结构调整需要系统管理角色（`users.role=admin`）；仅拥有全部业务数据范围不授予编辑权限。系统管理员将业务数据范围设为 `none` 后仍可进行组织设计、账号授权与角色设置。

| API | 请求 | 返回 |
| --- | --- | --- |
| `GET /api/organization` | 无身份参数 | 完整组织空间 |
| `POST /api/organization/nodes` | `{parentId,name,sortOrder}` | 更新后的组织空间 |
| `PUT /api/organization/nodes/:id` | `{name?,parentId?,sortOrder?}` | 更新后的组织空间 |
| `DELETE /api/organization/nodes/:id` | 无 | 更新后的组织空间 |
| `PUT /api/organization/employees/:id` | `{departmentId}` | 更新后的组织空间 |
| `POST /api/organization/employees` | `{name,code,email,departmentId,workbenchRoles,account?}` | 201 更新后的组织空间 |
| `POST /api/organization/employees/:id/account` | `{username,password,fopBinding?}` | 201 更新后的组织空间 |
| `PUT /api/organization/employees/:id/details` | `{name,code,email,jobTitle?,phone?,departmentId,workbenchRoles}` | 200 更新后的组织空间 |
| `POST /api/organization/employees/import-preview` | multipart：`departmentId,file` | 201 `{employees,rowNumbers,errors}`，不落库 |
| `POST /api/organization/employees/import` | `{departmentId,employees}`，1–100行 | 201 更新后的组织空间，原子保存 |
| `POST /api/organization/employees/remove` | `{ids}`，1–100个唯一UUID | 201 更新后的组织空间，归档并停用关联账号 |
| `GET /api/organization/accounts/:id` | 无 | 200 `{id,username,email,fopBinding}` |
| `PUT /api/organization/accounts/:id` | `{username,email,password?,fopBinding?}` | 200 安全账号资料；重置密码撤销旧会话 |

空间结构：`{source,nodes,employees,canEdit}`。节点为 `{id,parentId,name,kind,sortOrder,archivedEmployeeCount?}`；员工为 `{id,name,code,email,jobTitle?,phone?,departmentId,workbenchRoles,accountId,archivedAt?}`。管理清单只返回未归档员工。后端从会话与员工关联取得目录所有者，客户端不可指定其他账号。变更事务使用管理角色锁和目录锁，数据库复合外键禁止跨空间父节点和成员归属。新员工及可选账号原子创建，密码不返回。

迁移：`1784730000000-AddOrganizationSandbox.ts`、`1784734000000-LinkEmployeeAccounts.ts`、`1784735000000-ManageOrganizationMembers.ts`。目录首次读取时建立初始树，之后保留其自定义修改；员工账号关联为空表示尚未开通。成员维护迁移增加职务、手机、归档及账号停用／会话版本字段，存在归档或会话撤销记录时拒绝直接回滚。

### 销售部门结构调整（2026-10-23）

新空间不再创建欧洲销售组、北美销售组、亚太销售组、大客户组。保留其他中心的二三级结构及管理员自定义子部门能力。

已有本地 Demo 使用 `backend/src/database/sync-demo-sales-departments.ts` 显式升级：仅允许 `FOP_DATA_MODE=demo`、`NODE_ENV=local/development`、localhost 的 `autoflow_local_demo` 数据库；遍历已有演示目录，每个空间在事务和组织锁下先备份到 `.runtime/local-demo/sales-departments-backup-*.json`，再将四个默认组的直属员工调入所属业务部门，删除空组。保留员工 ID、姓名、代码、岗位、账号权限和 FOP 绑定；不在读取组织时反复重建节点。重复运行不再迁移。

只匹配 HyperZone／营销中心／业务一至四部的默认路径；含自定义下级、同名歧义或已被账号数据权限引用的组跳过并输出原因，不自动扩大部门经理范围。其他自定义组织不改动。本次本机升级已对照迁移前后员工 ID、待办计数及部门／业务员回款确认一致。

## 验证要点

方案2验收场景（日期随 Demo 日历生成，以下以 2026-10-22 验收为例）：

1. 在客户分析搜索编码 `PRE001`（Prepaid Demo Customer），查询9月至10月；该客户9月全款备货实收 `$1,000`，10月使用该库存履约只追加 `$60`。两月回款合计 `$1,060`，履约订单数只有1；10月不能补回产品款成为 `$1,060`，也不能再次扣除预付款。
2. 点击9月金额进入收款明细，核对 `ST-PREPAID-1000`、来源全款备货、实收1000、手续费0、物流“不适用”；点击10月金额核对 `AF-PREPAID-0060` 履约实收60；点击数量仍是订单明细。月初运行时按实际 paidAt 的 UTC+8 月份验收，不硬编码自然当前月。
3. 搜索 `STC001`／`STC002`／`STC003` 中有当前授权记录的仅备货客户，选择覆盖其收款的日期；订单量0但回款大于0时仍显示趋势、来源和明细。它们不占数量 Top10 名额，默认归入 other；other 金额下钻不能重新排名。
4. Dashboard 部门与业务员回款来源拆分、客户金额、同条件收款明细及分页前 totals 应分别对账。押金备货不出现在有效收款页、不增加业绩或订单量；原始生成数据中的待审核／未来支付分录也不进入统计。
5. 在测试替身中分别撤销 receipts scope、清空／省略 allowedReceiptIds、撤销岗位／改绑；验证无权金额不显示为0、明细403或合法空白名单结果、在途请求不返回旧授权数据。重复收款行ID、坏金额、未知已审核仓库／物流均应拒收为503。

后端测试覆盖默认关闭／生产关闭、跨账号数据隔离、同一接口形状、队列与统计一致、真实组织ID关联、日期年份筛选、权限撤销、异常解析关闭、组织保存／循环／非空删除及并发移动。前端覆盖树层级与父级选项、创建保存、失败不伪造成功、成员调动、删除确认、四部门汇总、业务员筛选及金额核对、列表状态和搜索分页。

## 注册维度与营销中心汇总（2026-10-21）

`GET /api/autoflow/integrations/fop/dashboard` 仍只接受日期范围与年份，不接受客户端提交的用户身份或授权范围。

- `registrations: {date,count}[]`：筛选范围内的逐日总数。
- `registrationDepartments: {id,name,counts:number[],salespeople:{id,name,counts:number[]}[]}[]`：固定业务一至四部，所有 counts 数组与 registrations 的日期顺序对齐；业务员按稳定 ID 区分。同一天的业务员合计等于部门合计，四部合计等于总数。
- `receipts.marketingCenter`（含 id/name/amounts/previousAmount/breakdown/previousBreakdown）或 null：与 months 对齐，逐月等于四部 amounts 的和。前端图例、柱状系列和数据表将营销中心排在四部之前；页面总额仅计算一次，业务员回款下拉仍仅包含四个部门。

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
