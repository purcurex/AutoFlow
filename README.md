# HyperZone 智能办公平台

HyperZone 是面向公司领导、销售、采购、订单、发运、仓库及 IT 人员的内部办公平台。以 Dashboard、分岗位工作台、用户级业务数据隔离和组织管理为基础，连接客户开发、履约协同与经营分析。AutoFlow 保留为工程名称及客户开发模块名称。

> 当前基线：2026-10-22。Dashboard 和履约分析已具备服务端 Mock 数据、前后端契约及权限校验；金蝶云苍穹（FOP）真实用户授权、业务数据和组织同步适配器仍待接入。不要将演示数据视为真实经营结果。

## 当前功能

| 模块 | 已实现能力 |
| --- | --- |
| Dashboard | 注册会员统计、部门月度回款、业务员月度回款、业务订单量、客户订单分析；履约卡片、异常与任务链接到工作台 |
| 注册会员 | 日期范围、营销中心汇总、四个业务部门及部门内业务员；汇总与个人明细并列 |
| 月度回款 | 营销中心汇总、部门/业务员金额；独立“上月环比”开关，差额与比例；固定明细列宽、金额合计、月份倒序、默认查看最新月份 |
| 业务订单量 | 物流服务商、组织、业务员类别；年/月/周/日维度；杭州仓、深圳仓对比；图表与工作台订单明细联动 |
| 客户订单分析 | 日期范围、部门、仓库筛选；按客户名称/编码搜索；前十客户＋其他；每客户订单量和订单金额两行、两项合计；分仓对比、趋势弹窗、仓库明细跳转 |
| 图表交互 | 图例、提示框、统一汇总色、美元 `$` 展示；滚轮滚动页面，滑块拖动查看历史；暗色主题与容器自适应；注册会员图支持 SVG 图片导出 |
| 分岗位工作台 | 销售、采购、配货、发运、仓库五种视图；按业务状态查看相应清单，展示订单号、Shopify 单号、客户、商品/SKU、支付及履约字段 |
| 工作日历 | US（纽约）、EUR（柏林）、AUD（悉尼）代表时区；当地时间、工作状态、UTC+8 对照，自动处理夏令时；不含公共假日 |
| 组织与账户 | HyperZone 组织树、二三级及自定义部门、员工目录、账户/FOP 用户绑定、岗位角色、管理与业务权限分别设置 |
| 客户开发 | 产品关键词/图片工作流、Shopify 店铺识别、广告发现、线索整理评分、联系人证据、AI 沟通草稿、报价与跟进移交 |
| 其他 | 简体中文/英文、明暗主题、业务记录、AI 话术模板、图片上传、报价导出及操作审计基础能力 |

订单分析按 **订单支付日期、北京时间（UTC+8）** 统计，排除未支付、已取消及全额退款订单。回款旧聚合在月边界、日期校验与币种处理上仍有待对齐项，详见诊断文档；普通日期和演示数据验证通过不代表这些边界问题已解决。

## 权限模型

系统管理权限、业务数据权限、岗位工作台权限分别配置：

| 权限 | 配置/范围 |
| --- | --- |
| 系统管理 | `role=admin/user`；系统管理员可维护组织架构、账户和角色；管理身份本身不自动授予业务数据权限 |
| 业务数据 | `businessRole=none/admin/department_manager/salesperson`；分别对应无业务数据、授权租户/公司全部、所属部门及子部门、本人 |
| 岗位工作台 | `sales/procurement/allocation/dispatch/warehouse`；业务管理员可使用全部五类，`none` 无工作台业务访问 |
| FOP 绑定 | `fopTenantId + fopUserId`；由服务端读取绑定和授权上下文，禁止客户端自行扩大数据范围 |

业务范围覆盖 Dashboard、履约清单，以及客户开发、线索、报价、沟通和移交等本地业务模块。账号权限变更、登出和切换账号会清理相关前端状态；服务端仍独立校验每次请求。组织管理位于侧栏最下方，仅系统管理员可见。

真实 FOP 未配置、绑定缺失或授权失效时，接口明确返回状态/错误，前端不会静默回退到全量 Mock。Mock 模式仅供本地开发/测试，真实授权需由 FOP 服务端适配器提供。

## ECharts 诊断与 API 对接文档

本轮交付以源码、接口 DTO、聚合逻辑及测试为依据，区分“当前实现”“已发现问题”“FOP 接入要求”。

- [完整需求与字段字典 · Markdown](docs/analytics/HYPERZONE_ECHARTS_API_REQUIREMENTS.md)
- [完整需求与字段字典 · 自包含 HTML](docs/analytics/HYPERZONE_ECHARTS_API_REQUIREMENTS.html)
- [OpenAPI 3.1.1 JSON · 可导入接口工具](docs/openapi/hyperzone-analytics.openapi.json)
- [前端图表功能诊断](docs/analytics/ECHARTS_FRONTEND_AUDIT.md)
- [后端契约与 FOP 对接诊断](docs/analytics/ECHARTS_BACKEND_CONTRACT_AUDIT.md)
- [本次验证记录](docs/analytics/VERIFICATION.md)

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

正式 FOP 联调需提供用户授权、组织/部门/员工、客户、订单/SKU、注册和支付记录的真实接口与字段映射，并完成同一授权快照下的统计、合计与明细对账。金蝶实体标识、操作编码、分页与授权刷新规则在获得后台资料前保留为待确认，不应直接照搬 Mock 的内部编码。
