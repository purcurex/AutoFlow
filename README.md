# HyperZone 智能办公平台

最新交付：需求9.40，五岗位十一类清单统一标题说明、查询/单号蓝色与浅蓝刷新；所有页签固定摘要，WMS等业务时间独立取值。销售履约审核与配货审核保留。接口基线为41操作、169模型，生产FOP员工网关仍需联调。先看[精简交接报告](docs/analytics/WORKBENCH_DELIVERY_BRIEF.html)，完整需求及OpenAPI入口见下文。


HyperZone 是面向公司领导、销售、采购、订单、发运、仓库及 IT 人员的内部办公平台。以 Dashboard、分岗位工作台、用户级业务数据隔离和组织管理为基础，连接客户开发、履约协同与经营分析。AutoFlow 保留为工程名称及客户开发模块名称。

> 当前基线：2026-10-27（UTC+8）。Dashboard 和履约分析已具备服务端 Mock 数据、前后端契约及权限校验；FOP 是基于金蝶云苍穹平台自研的 HyperZone 应用，后台源码位于 `/Library/VSCode/dtr5b`。真实用户授权、业务数据和组织同步网络适配器仍待接入。不要将演示数据视为真实经营结果。

## 当前功能

| 模块 | 已实现能力 |
| --- | --- |
| Dashboard | 注册会员统计、部门月度回款、业务员月度回款、业务订单量、客户订单分析；履约卡片、异常与任务链接到工作台 |
| 注册会员 | 日期范围、营销中心汇总、四个业务部门及部门内业务员；汇总与个人明细并列 |
| 月度回款 | 履约收款＋全款备货收款；营销中心、部门及业务员金额与来源拆分；工作台收款明细；独立“上月环比”开关、金额合计、月份倒序 |
| 业务订单量 | 物流服务商、组织、业务员类别；年/月/周/日维度；杭州仓、深圳仓对比；图表与工作台订单明细联动 |
| 客户订单分析 | 日期范围、部门、仓库筛选；按客户名称/编码搜索；前十客户＋其他；每客户履约订单量和回款业绩两行、两项合计；分仓对比、趋势弹窗、数量与收款分别下钻 |
| 物流运费分析 | 独立实际运费Mock和成本权限；月/周/年、仓库筛选；合计与六类服务商并列柱状、完整上期环比、倒序统计表；服务商趋势弹窗、工作台发运单明细及分页前合计；保留原币和明确USD折算汇率，界面USD/CNY等USD基准汇率固定4位小数 |
| 图表交互 | 图例、提示框、统一汇总色、美元 `$` 展示；滚轮滚动页面，滑块拖动查看历史；暗色主题与容器自适应；注册会员图支持 SVG 图片导出 |
| 个人收款与毛利 | 销售工作台按月/周/天查询授权业务员；订单收款、全款备货收款、结算毛利及预估毛利独立展示；固定列宽倒序统计表、居中明细弹窗、全量合计；月结缺日分配时明确待补充，不均摊 |
| 履约协同工作台 | 九类待办，默认收款日期顺排、每页50条（20/50/100）、部门/业务员筛选、复制、一单多品、所选及全部筛选Excel；采购准备不受物流限制，仅实际推1688校验物流，显示申请/采购单/1688/付款进度；配货为未齐套与已齐套未审核（默认），不区分自动或人工；仓库仅已审核未出库。五卡与清单同权限同口径；工作台跟进、业务操作在FOP，保留刷新与供应商旺旺催办 |
| 工作日历 | US（纽约）、EUR（柏林）、AUD（悉尼）代表时区；当地时间、工作状态、UTC+8 对照，自动处理夏令时；不含公共假日 |
| 组织与账户 | HyperZone 组织树、自定义部门、管理员新增员工／开通登录账号／设置所属部门、账户/FOP 用户绑定、岗位角色、管理与业务权限分别设置 |
| 客户开发 | 产品关键词/图片工作流、Shopify 店铺识别、广告发现、线索整理评分、联系人证据、AI 沟通草稿、报价与跟进移交 |
| 其他 | 简体中文/英文、明暗主题、业务记录、AI 话术模板、图片上传、报价导出及操作审计基础能力 |

订单量仅计入 **已支付且已审核的履约订单**，按支付日期 **UTC+8** 统计；备货不计订单量。回款采用方案 2：独立授权的已支付、源单已审核且收款单已审核的履约／全款备货收款分录，按支付月计入客户、业务员及部门业绩，排除押金备货和样品。实收取 `hzkj_real_receive_amt`，订单金额和手续费分别保留；使用已全款备货库存的履约不补回产品款。该事实包含钱包授信结算，不代表新增银行现金流水。只有备货回款、订单数为 0 的客户仍可查询。

## 权限模型

物流运费采用已审核发运单的实际成本快照，按确认时间 UTC+8 归期；确认时间并非银行付款时间，也不保证最终结算。每条成本必须提供原币、原额、汇率日期／来源和准确的 USD 折算。真实 FOP 运费查询、最终结算定义、后续调价／补收退款和成本授权仍待接入核对，详见[源码映射](docs/analytics/HYPERZONE_FOP_SOURCE_MAPPING.md)与[人工核对 H18–H22](docs/analytics/FOLLOW_UP_CHECKLIST.md)。

销售工作台毛利采用净毛利口径：已审核月结取冻结期间差额，不重复相加整单累计毛利；未结算采用预估物流成本及截至查询快照已知的收入、退款退货与其他成本。全款备货收款只计收款业绩，利润按有效库存使用关系结转，避免重复计入。现有 FOP 实时服务缺少严格历史截止及预估运费逻辑，周/天利润需要新事件账本；这部分为后端待实现方案，当前运行结果为服务端 Mock。

系统管理权限、业务数据权限、岗位工作台权限分别配置：

| 权限 | 配置/范围 |
| --- | --- |
| 系统管理 | `role=admin/user`；系统管理员可维护组织架构、账户和角色；管理身份本身不自动授予业务数据权限 |
| 业务数据 | `businessRole=none/admin/department_manager/salesperson`；分别对应无业务数据、授权租户/公司全部、所属部门及子部门、本人 |
| 岗位工作台 | `sales/procurement/allocation/dispatch/warehouse`；业务管理员可使用全部五类，`none` 无工作台业务访问 |
| FOP 绑定 | `fopTenantId + fopUserId`；由服务端读取绑定和授权上下文，禁止客户端自行扩大数据范围 |

业务范围覆盖 Dashboard、履约清单，以及客户开发、线索、报价、沟通和移交等本地业务模块。账号权限变更、登出和切换账号会清理相关前端状态；服务端仍独立校验每次请求。组织管理位于侧栏最下方，仅系统管理员可见。销售人员默认直接归属业务一至四部；管理员可新增自定义子部门，也可在部门标题旁确认删除无成员、无下级部门的空部门。

管理员统一在「组织架构 → 部门成员」添加、Excel／CSV导入、编辑或删除成员，并开通／编辑登录账号和FOP绑定；右上保留部门资料。删除成员将归档并停用账号，保留历史业务记录。左侧菜单组织架构在前、账号权限在后；「账号与权限」默认列出在用账号，只负责独立分配权限。新账号默认仅本人业务范围。操作、迁移和待接入项见 [员工与登录账号管理](docs/EMPLOYEE_ACCOUNTS.md)。

真实 FOP 未配置、绑定缺失或授权失效时，接口明确返回状态/错误，前端不会静默回退到全量 Mock。Mock 模式仅供本地开发/测试，真实授权需由 FOP 服务端适配器提供。

物流成本另需 `freight` analytics scope 和独立 `allowedFreightIds`；缺 scope 返回403，缺失／空白名单返回空范围。订单、收款或系统管理权限均不能推导运费权限；本人、部门、业务管理员范围仍与FOP成本授权和租户求交。运费明细还校验所选岗位工作台权限。

图表权限采用岗位模板＋账号例外，分别配置图表可见、记录范围、组织汇总、明细及导出；禁止项不能被查询参数绕过。客户Top10、其他、合计与占比先限定登录用户范围。业务员仅本人，经理部门及下级成员，销售个人工作台默认本人。部门整体汇总采用独立授权，不向仅汇总账号返回客户、业务员或订单明细；不改变原有图表结构。详见完整需求第1.1–1.3节。

## ECharts 诊断与 API 对接文档

本轮交付以源码、接口 DTO、聚合逻辑及测试为依据，区分“当前实现”“已发现问题”“FOP 接入要求”。

- [IT 交付导航与实施顺序](docs/analytics/IT_HANDOFF.md)
- [完整需求与字段字典 · Markdown](docs/analytics/HYPERZONE_ECHARTS_API_REQUIREMENTS.md)
- [完整需求与字段字典 · 自包含 HTML](docs/analytics/HYPERZONE_ECHARTS_API_REQUIREMENTS.html)
- [OpenAPI 3.1.1 JSON · 可导入接口工具](docs/openapi/hyperzone-analytics.openapi.json)
- [前端图表功能诊断](docs/analytics/ECHARTS_FRONTEND_AUDIT.md)
- [后端契约与 FOP 对接诊断](docs/analytics/ECHARTS_BACKEND_CONTRACT_AUDIT.md)
- [本次验证记录](docs/analytics/VERIFICATION.md)
- [HyperZone FOP 源码字段与适配证据](docs/analytics/HYPERZONE_FOP_SOURCE_MAPPING.md)
- [后续待办与人工核对清单 · 优先级、责任、资料和验收](docs/analytics/FOLLOW_UP_CHECKLIST.md)

既有细分约定：[Dashboard](docs/FOP_DASHBOARD_INTEGRATION.md)、[订单统计](docs/FOP_ORDER_VOLUME_API.md)、[用户数据权限](docs/FOP_USER_DATA_ACCESS.md)、[全局合计](docs/TABLE_TOTALS.md)、[控件交互](docs/UI_CONTROLS.md)。最新综合诊断优先说明当前行为及已知差距；历史方案不等同于生产实现。

## 技术栈与目录

- 前端：Vue 3、TypeScript、Vite、Pinia、Vue Router、Tailwind CSS、ECharts 6。
- 后端：NestJS、TypeORM、PostgreSQL；JWT 会话（HttpOnly Cookie，亦支持 Bearer）。
- 验证：Vitest / Vue Test Utils、Jest / Supertest、PostgreSQL E2E。
- 推荐开发环境：Node.js 22（本次使用 22.23.3）、npm 10、PostgreSQL 16。

```text
backend/src/
  modules/fop-data/          Dashboard、订单聚合、Mock/真实适配边界
  modules/users/             岗位、管理权限、FOP 绑定与业务数据范围
  modules/organization/      组织树与员工目录
  modules/autoflow/          客户开发、线索、工作流
  modules/fop-integration/   报价/移交对接边界
  database/migrations/      版本化数据库迁移
frontend/src/
  components/charts/        ECharts 生命周期、滚轮与拖动控制
  components/order-volume/  业务/客户订单图表、明细、趋势弹窗
  views/autoflow/            Dashboard、工作台及客户业务页面
  api/                      前端接口与类型
  tests/                    交互与数据契约测试
scripts/deployment/         安装、构建、迁移、备份、恢复与本地启动
docs/analytics/             本轮诊断与字段级需求文档
docs/openapi/               机器可读 API 契约
```

## 本地开发

在仓库根目录执行（PowerShell 可使用 `npm.cmd`）：

```sh
npm ci
cp backend/.env.example backend/.env
```

配置 `backend/.env` 中的数据库连接及 `JWT_SECRET`，确保数据库已经创建，然后执行：

```sh
npm run db:migration:show
npm run db:migrate
npm run dev
```

- 前端：<http://localhost:5173>；后端：<http://localhost:3000/api>。
- 健康检查：`GET /api/health`。
- Vite 已监听 `0.0.0.0:5173`，局域网使用本机 IP 加端口访问；API 和上传资源通过 Vite 代理到后端。
- `npm run dev:frontend` / `npm run dev:backend` 可分别启动。
- `DB_SYNCHRONIZE=false`；通过迁移更新结构，不依赖运行时自动同步。

### macOS 隔离演示环境

```sh
bash scripts/deployment/start-local-demo-macos.sh
```

脚本安装所需运行时并建立 `.runtime/local-demo` 下的独立 PostgreSQL 集群，使用 `127.0.0.1:55432`、数据库 `autoflow_local_demo`，初始化本地演示账号并启动服务。请阅读脚本和终端输出；它不会把演示账号设置同步到其他环境。

已初始化环境仅恢复数据库/后端：

```sh
bash scripts/deployment/start-local-demo-backend-macos.sh
npm run dev:frontend
```

恢复脚本显式设置 `FOP_DATA_MODE=demo`。首次启动脚本未设置该开关，需要时使用 `FOP_DATA_MODE=demo bash scripts/deployment/start-local-demo-macos.sh`；默认未配置的真实数据提供器会拒绝业务读取。

### FOP 与外部服务配置

| 配置 | 用途 |
| --- | --- |
| `FOP_DATA_MODE=demo` | 仅在 `development/local/test` 中启用履约、Dashboard 和组织演示数据；其他环境默认不返回演示业务数据 |
| `FOP_INTEGRATION_MODE` | 既有报价/移交适配边界，与 Dashboard 的数据提供器不是同一个开关 |
| `FOP_BASE_URL/FOP_TENANT_ID/FOP_APP_ID/FOP_APP_SECRET` | 既有对接配置；填写这些值不会自动完成真实 Dashboard/权限适配 |
| `ZHIPU_* / PIPIADS_* / SERPAPI_KEY` | 客户发现与 AI 功能；敏感值仅置于后端忽略文件 |
| `ALIBABA_1688_*` | 可选商品搜索；按需启用 |

真实密钥放在 `backend/.env.providers.local`、`backend/.env.alibaba1688.local` 或部署密钥存储中。配置键以对应 `.example` 文件为准；不要提交真实 `.env`、数据库备份、上传业务文件或本地账号密码。

## 初始化管理员

仅在新环境显式设置 `ENABLE_ADMIN_BOOTSTRAP=true`，配置 `ADMIN_BOOTSTRAP_EMAIL`、`ADMIN_BOOTSTRAP_USERNAME` 和不少于 12 位的 `ADMIN_BOOTSTRAP_PASSWORD`。首次创建后关闭该开关。业务数据权限与岗位权限仍需要独立核对/分配。

现有本机验收账号、FOP 演示绑定和自定义组织数据保存在本机数据库，不会随 Git 推送复制到新环境。生产环境禁止运行开发种子脚本。

## 验证与构建

```sh
npm run lint
npm run test
npm run test:e2e
npm run build
npm run test:prod-smoke
```

`test:e2e` 的持久化测试使用专用 `autoflow_test` 数据库，并会清空测试业务表；必须配置隔离测试数据库，不能指向业务库。`npm run ci:local` 还包含生产依赖审计。各命令的本轮实际执行结果见 [验证记录](docs/analytics/VERIFICATION.md)。

`npm run build` 编译前后端并复制前端资源至 `backend/dist/public`；`npm start` 启动编译后的后端及前端静态页。生产环境须配置数据库、至少 32 位 JWT Secret、SMTP，保持 `DB_SYNCHRONIZE=false`，并通过 HTTPS 部署。

启动中的 Nest watch 使用 `backend/dist`；并行诊断时可用 `npx tsc --noEmit -p backend/tsconfig.json` 做类型检查，避免另一个构建清空其运行目录。

## 部署与后续接入

- [新环境安装、数据库备份与恢复](docs/AUTOFLOW_NEW_ENVIRONMENT_DEPLOYMENT_GUIDE_ZH-CN.md)
- [FOP 既有对接边界](docs/AUTOFLOW_FOP_INTEGRATION_SPEC.md)
- [客户开发功能说明（历史基线）](docs/AUTOFLOW_USER_MANUAL_ZH-CN.md)

正式 FOP 联调需提供用户授权、组织/部门/员工、客户、订单/SKU、注册、收款分录和物流成本的真实接口，并完成同一授权范围下的统计、合计与明细对账。已确认实体与字段见源码映射文档；实际发布 URL、鉴权、分页、授权刷新及响应样本仍须按后台部署核实，不直接照搬 Mock 的内部编码。订单、收款、运费和毛利分别使用 allowlist；销售个人统计还需 `receipts`、`sales_profit` scopes 及 `sales` 岗位，`allowedProfitIds` 不从其他资源权限推导。毛利冻结业务员与当前账号绑定须经后台授权映射，不能由浏览器指定身份。

采购待发货清单支持逐订单旺旺催办：单供应商尝试直达，多采购单选择对应供应商，支持复制旺旺/采购单号。后台按有效采购关联与独立权限重新核验联系人；演示模式仅预览，不联系虚构供应商。生产FOP接入事项见需求9.10和交付清单T34/H36/D37。

销售待审核与配货已齐套未审核清单支持单笔/批量审核，入口位于查询框左侧；履约订单与配货单一对一，配货清单新增单一配货单号（如AO261028000404），审核目标为配货单，发运制作按未完成/已完成筛选，已完成方可审核。复用FOP审核预览、独立操作权限、版本及幂等校验，逐笔展示结果。生产审核网关须由IT联调，Demo成功不代表生产接通，详见需求9.11和9.30。

工作台 Excel 导出：五类工作台全部待办清单支持“导出所选”与“导出筛选结果”（跨分页）。导出服从当前筛选、排序及登录用户业务范围；包含订单清单、商品明细和导出说明，按币种合计，一单多品不重复累计金额。单次最多10,000笔订单/50,000行商品。接口及生产验收见[需求9.12](docs/analytics/REQUIREMENTS_OVERVIEW.md#912-所有工作台待办清单批量导出-excel2026-10-26)。


2026-10-27最新口径见需求9.14：五卡与九清单同一服务端谓词，实际配货单、Shopify回执、权限归一不变；Shopify按9.15仅待同步/已同步，无部分同步，待履约只取paid+approved+pending；采购准备不限物流，仓库仅已审核未出库。新增采购申请/1688/物流条件字段，未知不猜测。业务操作在FOP，本次未改FOP生产源码。

## 2026-10-27 最新工作台规则

销售待支付、待审核、异常及发运待履约清单统一展示“C端下单时间”，读取Shopify消费者首次完成付款的consumerPaidAt，按UTC+8显示并同步Excel，缺失不回退创建/收款时间。采购进度统一“待推1688采购”“待支付采购款”，接口枚举不变；生产取数与联调说明见需求9.23/9.32。

所有待办清单的单号和各商品SKU支持快捷复制原值；C端下单时间支持升降序，默认仍按收款日期升序（最早在前）。排序覆盖完整筛选结果及两种Excel导出，缺失时间始终置后，见需求9.33。

已采购待发货清单展示实际“采购付款时间”，供应商尚未全部发货时超过24小时显示橙色、超过48小时显示红色；缺失时间不以订单创建或客户收款替代。Excel与接口契约同步，FOP真实支付事件映射及多采购单归集见需求9.34。

基础队列以[需求9.14](docs/analytics/REQUIREMENTS_OVERVIEW.md#914-最新岗位跟进方案与1688物流条件2026-10-27)为准，最新调整见需求9.31及[IT交付入口](docs/analytics/IT_HANDOFF.md)。物流条件只限制FOP实际推1688，采购准备、等待物流或发运审核的配货任务不会因此被隐藏。已齐套未审核归配货岗，配货审核后未出库归仓库岗；平台支持查询、跟进、刷新及导出，另提供销售订单与齐套配货单审核入口，由FOP原生审核执行。新增接口字段与兼容说明已进入[OpenAPI](docs/openapi/hyperzone-analytics.openapi.json)，生产数据映射与审核网关仍须IT联调。

采购清单支持“采购订单状态”表头筛选（需求9.16），查询、合计、跨页与所选Excel同范围；切换状态回第一页，切换清单清空。接口参数procurementStage，字段合同见最新OpenAPI。

清单状态展示更新（2026-10-27）：状态筛选与业务员、部门同级；每单一项关键进度，固定状态隐藏，多发运单详情折叠；筛选、合计、分页和 Excel 导出同口径。接口及交接见需求9.17和 OpenAPI `taskStatus`。

待办清单最新调整（需求9.35）：业务员姓名与业务部门在同列固定两行；齐套待审显示实际齐套时间，未齐套显示C端下单时间并支持排序；清空已提交关键词自动恢复当前筛选结果。单号单行及复制保留，Excel、API和IT交付文档同步。

### 销售备货与客户库存（需求9.36）

销售工作台在待审核后新增“备货清单”，保留全部有效全款/押金备货订单，支持搜索、仓库/业务部门/类型/采购状态筛选、收款排序、刷新、20/50/100分页与两种Excel导出。“查询备货库存”按客户与SKU/仓库展示全款、押金可用/锁定/在库数量。

Demo、前端与BFF已实现；真实FOP员工网关及独立备货/库存资源授权待IT发布。店铺来源和库存锁定口径须按[需求9.36](docs/analytics/HYPERZONE_ECHARTS_API_REQUIREMENTS.md)及[源码映射](docs/analytics/HYPERZONE_FOP_SOURCE_MAPPING.md)联调，完整字段见[OpenAPI](docs/openapi/hyperzone-analytics.openapi.json)。


### 采购待备货与库存直接搜索（需求9.37）

采购工作台增加“待采购待备货清单”，展示已支付、备货单已审核且采购未完成的全款/押金备货单。履约待采购将创建时间改为可排序的订单审核时间；默认仍按收款时间顺排。库存弹窗直接组合模糊查询客户/商品，支持多客户结果与仓库下拉，继承权限范围和全款/押金库存口径。

前端、BFF、Mock与两种Excel已接入；生产员工网关、跨客户库存聚合及履约审核字段映射仍需IT联调。详见[最新需求9.37](docs/analytics/HYPERZONE_ECHARTS_API_REQUIREMENTS.md)及[字段级OpenAPI](docs/openapi/hyperzone-analytics.openapi.json)。

### 待办筛选与配货库存（2026-10-28）

全部待办顶部显示固定高度查询条件摘要，保留单一刷新入口。配货未齐套清单支持按选中订单或SKU模糊查询即时库存，公共池与对应客户专属池分别展示。新增独立库存授权及完整快照补零规则；真实员工网关仍待IT接入，见[最新需求9.38](docs/analytics/HYPERZONE_ECHARTS_API_REQUIREMENTS.md)和[OpenAPI](docs/openapi/hyperzone-analytics.openapi.json)。

最新界面与字段增量见需求 **9.39**：所有工作台页签固定摘要、浅蓝刷新、待办标题简短说明；待出库使用独立 `wmsCreatedAt`，列表与Excel按UTC+8展示，真实FOP映射（尤其疾风成功时间）按IT交付清单联调。
