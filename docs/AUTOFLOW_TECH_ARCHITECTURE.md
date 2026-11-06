# HyperZone 技术架构

核对日期：2026-11-05。范围：AutoFlow / work-app 当前工作区代码，包含尚未提交的修改；不代表远程仓库或生产环境已部署状态。

## 01 架构总览

本项目是 HyperZone 智能办公平台，采用 **Vue 单页应用 + NestJS 模块化单体 + PostgreSQL**。前后端在代码与开发服务上分离，生产构建支持由同一个 NestJS 服务提供页面、API 和上传文件。

平台包含两条业务主线：**业务运营**覆盖销售、发运、采购、配货、仓库五个工作台及统计分析；**客户开发**覆盖客户发现、线索、AI 触达、1688 寻源、客户报价与跟进。

**FOP 是基于金蝶云苍穹自研的 HyperZone 业务后台**，负责正式业务单据与流程事实；本平台承担查询、协同、数据展示及已实现的受控操作入口。两个系统通过服务端适配层连接，不直接共享数据库。

```text
员工浏览器
  Vue 3 SPA：五个工作台 / 数据看板 / 客户开发 / 报价 / 系统管理
                         │ 同源 /api，Cookie 会话
                         ▼
NestJS 应用：认证授权 → 业务服务 → 数据与外部系统适配层
  ├─ 工作台 / 分析 / 组织账号 / 报价 / 线索与触达
  ├─ 同进程 Worker：工作流、1688 寻源任务
  ├─ TypeORM ── PostgreSQL：平台业务数据、配置、任务、审计
  ├─ 文件服务 ── uploads：头像、图片等本地文件
  ├─ FOP 适配层 ── 员工数据网关 / 成本、渠道、运费、CRM 端口
  │                              └─ FOP / 金蝶云苍穹
  └─ 外部服务适配 ── PipiAds、智谱 GLM、1688 等
```

当前不是微服务架构。任务队列基于 PostgreSQL 实现，未引入 Redis、BullMQ 或独立消息中间件。

## 02 技术栈

版本依据项目依赖声明与部署配置，具体安装版本由 package-lock.json 锁定。

| 层级 | 主要技术 | 用途 |
| --- | --- | --- |
| 前端 | Vue 3.5、TypeScript 5.9、Vite 8 | 页面、组件、类型检查、构建与开发代理 |
| 状态与路由 | Pinia 3、Vue Router 4、Axios | 登录与业务状态、页面导航、API 调用 |
| 展示 | Tailwind CSS 3.4、共享工作台 CSS、Lucide、vue-i18n 11 | 统一清单、深浅主题、图标及中英文 |
| 图表与编辑 | ECharts 6、Tiptap 3、CodeMirror 6 | 数据分析、触达内容与保留的笔记编辑功能 |
| 后端 | Node.js、NestJS 11、Express 适配器、TypeScript | REST API、模块组织、业务服务与后台任务 |
| 数据库 | PostgreSQL 16、TypeORM 0.3 | 关系数据、事务、版本化迁移、任务领取与租约 |
| 认证与校验 | Passport/JWT、bcrypt、ValidationPipe、Helmet、Throttler | 会话、密码摘要、参数验证、安全响应头及限流 |
| 业务工具 | Decimal.js、ExcelJS、Sharp、Nodemailer | 金额计算、Excel 导出、图片处理、邮件 |
| 工程质量 | Vitest / Vue Test Utils、Jest、Supertest、ESLint、GitHub Actions | 前后端测试、接口测试、静态检查及 CI |

仓库使用 **npm workspaces** 管理 frontend、backend。当前未采用 Nuxt/SSR、GraphQL 或容器编排集群；现有 Docker Compose 主要用于 PostgreSQL。

## 03 模块划分

| 模块 | 主要职责 | 实现位置 |
| --- | --- | --- |
| 页面与共享交互 | 路由、五工作台、查询摘要、筛选、状态、导出与主题 | frontend/src/views、components、composables |
| 账号与组织 | 登录、用户、组织员工、工作台入口、业务范围和图表权限 | backend/src/modules/auth、users、organization |
| 工作台数据服务 | 履约与备货清单、采购分组、库存、阶段完成记录、异常、统计及导出 | backend/src/modules/fop-data |
| 客户开发 | 工作流、线索、联系人、评分、触达任务及跟进活动 | backend/src/modules/autoflow、discovery |
| AI 与寻源 | AI 文案、会话与提示模板；1688 供应商及商品证据 | backend/src/modules/ai、sourcing |
| 报价与 FOP 端口 | 报价版本；成本、物流目录、运费、CRM 交接适配 | backend/src/modules/quotation、fop-integration |
| 运维与保留功能 | 健康检查、请求关联与审计；笔记、文件夹、独立搜索 | backend/src/modules/health、observability、notes 等 |

后端按 Controller → Service → Repository / Provider 分层。Controller 处理 API 与 DTO；Service 处理业务和权限；Repository 访问本地数据库，Provider / Port 隔离外部系统。

前端采用页面组件、共享组件、composable 和 API 客户端组合。Pinia 维护共享状态，工作台查询也直接通过 API 与 composable 驱动，不要求所有数据先写入全局 Store。

## 04 数据与权限

### 数据归属

| 数据 | 当前存储与权威边界 |
| --- | --- |
| 平台账号、密码摘要、角色与授权 | 本地 PostgreSQL；保存 FOP 身份绑定，不等同于 FOP 登录账号体系 |
| 组织及员工 | 本地 PostgreSQL；当前支持通讯录初始化，正式组织同步仍须明确 FOP 接口与映射规则 |
| 线索、触达、报价及版本、交接记录 | 本地 PostgreSQL；正式 CRM 交接通过 FOP 端口处理 |
| 工作流、步骤、任务与寻源结果 | 本地 PostgreSQL；记录运行状态、租约、重试和采集证据 |
| 履约、备货、采购、发运、配货、库存及业务统计 | 通过 FOP Provider 获取并形成展示模型；当前没有将整套 ERP 单据复制为本地订单主库 |
| 头像与图片 | 当前应用运行目录 uploads；需与数据库分别备份 |
| 请求与操作审计 | 结构化日志、audit-event 实体；常规审计记录元数据，不复制完整业务请求正文 |

### 授权模型

**系统管理员权限、工作台入口、业务数据范围、图表汇总权限分别控制。** 业务角色统一为管理员、部门经理、外贸业务员、协同管理岗；无业务授权账号不因可以登录而获得业务数据。

记录可见范围由 **本地本人 / 部门 / 公司业务范围，与 FOP 当前身份的独立资源授权取交集**。管理员不绕过 FOP 资源授权；前端不能自行传入租户或用户身份扩大范围。

五个工作台入口可共同开放，但展示结果按登录账号隔离。协同岗可获得跨业务部门汇总，客户、业务员明细和个人分析仍按独立规则限制。组织架构、账号与权限管理仅管理员可见并受服务端校验。

清单筛选、详情、采购分组、合计、分页与 Excel 导出在服务端执行同一授权口径。库存、回款、毛利、运费、采购关联及目录等使用各自授权，不能从订单访问权推导全部资源访问权。

受保护请求验证 HttpOnly 会话 Cookie 中的 JWT，并重新读取账号启停、sessionVersion 与最新权限。生产 Cookie 使用 Secure、SameSite=Lax；前端丢弃旧登录会话返回的迟到响应。

## 05 核心数据流

### 工作台查询与导出

1. 浏览器进入相应工作台，获取入口权限及可选业务部门。
2. 后端验证当前账号，解析本地业务范围与绑定的 FOP 租户、员工身份。
3. FOP Provider 取得授权和候选业务数据，校验返回身份与资源范围。
4. 服务端生成待办或阶段完成记录，执行搜索、专属筛选、排序、汇总和分页；异常是独立维度，不替代主流程进度。
5. 前端用共享组件展示结果；Excel 默认导出当前查询全部结果，也可限定选中记录，仍重新校验权限。

目前 HttpFopDataProvider 的基础订单读取采用候选集合返回后处理，不是上游数据库分页。数据量扩大时，需与 FOP 约定分页、聚合与快照语义，不能把当前查询方式视为无限数据量方案。

### 业务操作与状态回流

查询与协同后，员工在 FOP 跟进采购、发运等正式业务操作；前端已有部分审核入口及员工网关操作契约。真实审核需网关落实员工权限、业务校验、审计及持久幂等，不能以界面按钮已完成认定生产写入已接通。刷新后由 FOP 最新事实更新状态。

采购单与履约单按多对多关联展示，同一采购单一个供应商；分组统计只包含当前权限和查询范围内的数据。完成清单按各阶段完成时间筛选，业务时间展示与日月归属采用 UTC+8。

### 客户开发、报价与后台任务

客户发现将广告和店铺证据转成线索，经 AI 辅助触达、跟进后形成报价。报价版本保存在本平台；产品成本、实际物流渠道和运费通过 FOP 端口取得，正式交接通过 CRM 端口完成。相关端口当前仍有未接通项。

工作流与 1688 寻源任务持久化到 PostgreSQL，由 NestJS 同进程 Worker 轮询执行。任务通过事务及 FOR UPDATE SKIP LOCKED 领取，配合租约、心跳、过期回收与有限重试。当前没有独立 Worker 服务部署。

## 06 FOP 接入边界

FOP 源码位于 /Library/VSCode/dtr5b。源码可用于核对字段、枚举、单据插件与业务规则；代码中存在某能力不代表对应 HTTP 接口已发布。

| 接入层 | 当前实现 | 尚需完成 |
| --- | --- | --- |
| 五工作台数据 | FopDataService + Demo / HTTP / 未配置 Provider；本地展示、授权处理和导出已实现 | 发布并验证员工网关；补齐真实员工、资源授权、字段与各项能力 |
| 员工数据网关 | HTTP 适配器按 subject 传递服务端身份；使用服务端 Bearer 凭证和 HTTPS | 对照每项方法实现覆盖，不把已配置 URL 等同于所有业务能力可用 |
| 原始苍穹 OpenAPI | 历史联调记录已验证增强型 Token 及指定单笔履约订单查询 | 组织、用户等接口授权与发布；员工代理、数据范围与工作台事实映射 |
| 成本 / 物流渠道 / 运费 / CRM | 已定义 Port，提供开发 Sandbox 与 Unavailable 适配器 | Live 适配器未实现；配置模式为 live 也不自动获得真实能力 |
| 报价实际物流渠道 | 已预留实际渠道搜索 API，支持服务商、编码及名称检索 | FOP 完整渠道目录读取、有效性判定及独立目录权限 |

工作台员工网关使用 FOP_EMPLOYEE_API_URL / FOP_EMPLOYEE_API_TOKEN；报价等端口使用 FOP_INTEGRATION_MODE。两套开关职责不同，不能相互替代。Demo 仅允许本地、开发或测试，Sandbox 禁止用于生产。

原始苍穹 OpenAPI 的 access_token、x-acgw-identity 与应用密钥只在服务端使用。原始接口与员工授权网关是不同契约，不能仅用应用级 Token 冒充任意员工的业务权限。

当前状态：**工作台交互和本地数据权限机制已落地；FOP 正式业务数据链路尚未全部完成。** 未配置或未授权时应返回明确失败，不以演示数据伪装真实查询成功。

## 07 部署与协同

### 开发环境

```text
开发电脑 A：Vite :5173 → /api、/uploads 代理 → NestJS :3000 → 本地 PostgreSQL
开发电脑 B：Vite :5173 → /api、/uploads 代理 → NestJS :3000 → 本地 PostgreSQL
                                           └─ 各自服务端 → 共享 FOP 云测试租户
Git：同步代码、锁文件、数据库迁移及脱敏配置模板
```

Git 不同步数据库记录、上传文件与本机私有配置。新电脑先安装依赖并执行 TypeORM 迁移，再按授权导入必要组织与账号，或恢复经过批准的脱敏数据库备份。迁移不等同于同步员工数据；普通启动不自动导入真实通讯录。

多人可连接同一 FOP 测试租户联调，但本地数据库相互独立；应约定测试员工、单据和操作分工，避免同时修改同一单据。FOP 更新不会自动写入另一人的本地组织表，需专门的同步或导入流程。

### 生产部署

```text
员工浏览器 → HTTPS 入口 → NestJS :3000
                         ├─ 前端静态资源 backend/dist/public
                         ├─ /api 与 /uploads
                         ├─ PostgreSQL 16 + 持久化数据卷
                         └─ FOP / AI / 广告与寻源服务
```

现有构建脚本将 Vite 产物打包到后端，由单个 Node 应用提供页面和 API；HTTPS 入口需按部署环境配置。仓库未将 Nginx、PM2、Kubernetes 作为必需组件。

当前上传文件为本地磁盘，验证码等部分状态也在进程内；任务领取具备多实例协调能力，不代表整个平台已完成无状态多实例部署。扩容前需要统一文件存储、相关临时状态及运行配置。

## 08 工程与运维

| 能力 | 当前实现 |
| --- | --- |
| 数据库变更 | TypeORM 版本化迁移；synchronize 和 migrationsRun 默认关闭，按发布流程执行迁移 |
| 测试与构建 | 前端 Vitest、后端 Jest、Supertest E2E；统一 lint、测试、构建和生产冒烟脚本 |
| CI | GitHub Actions 对 master 推送及 PR 执行 ci:local，包含生产依赖审计 |
| 健康检查 | /api/health 检查数据库及工作流队列状态；不等同于所有外部服务健康 |
| 可观测性 | correlation ID、请求耗时与结果日志；写请求审计元数据落库 |
| 配置 | 环境变量校验；密钥只存服务端私有配置，不进入前端包、Git 或交付文档 |
| 备份恢复 | PostgreSQL 备份与 uploads 文件备份分开执行，保留匹配的应用版本与配置 |

当前 CI 使用 Node.js 22，部署指南验证基线为 Node.js 24。环境版本尚需统一；现有架构说明不把二者写成已经一致的运行基线。本次为代码与配置核对，不代表重新执行全量测试、生产部署或 FOP 联调。

## 09 代码索引

| 架构依据 | 关键文件 / 目录 |
| --- | --- |
| 工程与依赖 | package.json、frontend/package.json、backend/package.json、package-lock.json |
| 前端入口与通信 | frontend/src/main.ts、router/index.ts、api/index.ts、vite.config.ts |
| 后端启动与装配 | backend/src/main.ts、app.module.ts |
| 认证与授权 | backend/src/modules/auth、users/business-scope.ts、users/workbench-access.service.ts、users/chart-permissions.ts |
| FOP 工作台网关 | backend/src/modules/fop-data、users/users.module.ts、users/workbench.controller.ts |
| 报价与 FOP 端口 | backend/src/modules/quotation、fop-integration；docs/FOP_QUOTE_LOGISTICS_CHANNELS_API.md |
| 后台任务 | backend/src/modules/discovery/workflow-job-worker.service.ts、sourcing/sourcing-worker.service.ts |
| 数据库与部署 | backend/src/database、deployment、scripts/package-frontend.mjs、.github/workflows/ci.yml |
| 业务约定与联调记录 | agent.md；docs/FOP_TEST_CONNECTION.md、FOP_API_AUTHORIZATION_HANDOFF.md、FOP_PURCHASE_GROUPS_HANDOFF.md |
| FOP 源码 | /Library/VSCode/dtr5b/code；字段、枚举与插件需以实际后台版本核对 |
