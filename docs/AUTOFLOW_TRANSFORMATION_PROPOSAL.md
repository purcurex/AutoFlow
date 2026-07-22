# AutoFlow Transformation Proposal

## 1. 改造结论

AutoFlow 不应继续作为 NoteFlow 智能笔记应用的改名版本，而应重构定位为：

**面向 Dropshipping 外贸业务员的客户开发自动化工作台。**

核心目标是把业务员每天分散在 Google、Facebook Ads Library、Shopify 店铺、WhatsApp、表格、CRM、FOP 中的开发动作串成一条可追踪、可复盘、可沉淀的工作流。

建议主流程：

```text
搜品 / 产品图
→ 广告与竞品店铺发现
→ Shopify 店铺识别
→ 客户信息补全
→ 线索评分
→ AI 生成建联话术
→ WhatsApp / Email 半自动触达
→ 报价测算
→ CRM 跟进
→ 注册 / 绑店 / 下单 / FOP 履约复盘
```

原项目的笔记、富文本、文件夹、导出能力可以保留，但需要从主产品定位中降级，改造为客户开发过程中的资料沉淀、跟进记录、报价备注和素材归档能力。

## 2. 产品定位

AutoFlow = **Dropshipping Sales Workflow Copilot**

目标用户：

- 外贸业务员：搜客户、建联、报价、跟进。
- 销售经理：线索分配、客户归属、报价审批、业绩复盘。
- 订单助理：后续承接 FOP 履约异常。
- 售后 / 财务：后续处理售后、回款、毛利与赔付。

第一阶段建议不要替代 CRM/FOP，而是聚焦销售前端提效：

```text
AutoFlow 负责销售前端提效
CRM 负责正式客户跟进沉淀
FOP 负责订单、履约、物流、售后、财务主账
```

## 3. 当前项目现状

### 3.1 已具备能力

- Vue 3 + Vite 前端。
- NestJS + PostgreSQL 后端。
- JWT 登录注册。
- 管理员角色。
- 原笔记、文件夹、富文本、导出能力。
- Shopify 搜索模块。
- Facebook Ads 搜索模块。
- AI 生成模块。
- AutoFlow 初版页面：Dashboard、Workflows、Leads、Lead Detail、Outreach、CRM。
- AutoFlow 初版后端接口：workflow、lead、outreach、crm funnel。
- 已补充前端 Vitest 自动化测试基础脚本。

### 3.2 主要问题

- 项目中仍残留大量 `NoteFlow`、`noteflow`、`智能笔记`、`笔记应用` 语义。
- `autoflow` 后端当前是内存假数据，没有持久化。
- Shopify / Facebook / AI 能力尚未真正并入 AutoFlow 工作流。
- 缺少报价、物流、客户归属、客户等级、跟进记录等 Dropshipping 核心对象。
- 前端 AutoFlow 类型存在重复定义，后续容易漂移。
- AI 模块仍是写作助手定位，不是销售开发助手。
- 旧笔记功能仍占据较多产品语义，需要重新定位。
- 部分中文文案存在编码损坏，需要逐步清理。

## 4. 业务理解

HyperZone / HzDrop 业务面向经营 Shopify 独立站的小 B 卖家，提供 Dropshipping 一件代发供应链服务。

核心业务闭环：

```text
获客来源
→ 客户归属
→ 销售跟进
→ 找品报价
→ 注册绑店
→ Shopify 订单同步
→ FOP 付款 / 锁价
→ 履约采购 / WMS / 发货
→ Tracking 写回
→ 售后 / RMA
→ 回款毛利 / 复盘
```

系统边界建议：

| 系统 | 主职责 |
|---|---|
| AutoFlow | 销售开发、线索发现、建联、报价、跟进提效 |
| CRM | 线索、商机、跟进、日报、周报、客户开发过程 |
| AppStore | 客户注册、绑店、订单展示、付款确认 |
| Shopify | 源单事实、订单、支付、退款、取消、履约对象 |
| FOP | 客户、归属、履约、物流、售后、财务、回款、毛利主账 |

## 5. 核心模块建议

### 5.1 工作流中心

- 输入产品关键词或产品图片。
- 创建客户开发任务。
- 跟踪阶段：搜品、广告抓取、店铺识别、清洗评分、话术生成、建联、跟进。
- 展示每个 workflow 的进度、产出线索数、下一步动作。

### 5.2 搜品与竞品发现

- 保留现有 Shopify Search 能力。
- 保留现有 Facebook Ads Search 能力。
- 输出对象从“保存为笔记”改为“生成线索 / 店铺 / 广告素材记录”。
- 支持关键词、图片 URL、产品链接等输入。

### 5.3 线索池

关键字段建议：

- 店铺名称。
- 域名。
- Shopify 识别置信度。
- 国家 / 市场。
- 类目。
- 广告活跃度。
- 联系方式。
- 客户等级：S/A/B/C/R。
- 当前状态：新线索、已建联、已回复、已报价、已注册、已绑店、已下单、无效。

### 5.4 客户信息补全与评分

评分维度建议：

- 店铺可信度。
- Shopify 识别置信度。
- 广告活跃度。
- 联系方式完整度。
- 类目适配度。
- 目标市场适配度。
- Dropshipping 服务适配度。
- 风险识别：疑似侵权、仿牌、灰色业务、只比价不成交等。

### 5.5 AI 销售助手

从写作助手改造成销售开发助手：

- WhatsApp 首轮建联话术。
- Email 开发信。
- 不同客户等级的话术。
- 报价解释话术。
- 跟进提醒话术。
- 沉默客户唤醒话术。
- 按客户国家、语言、类目、广告素材生成差异化切入角度。

### 5.6 报价工作台

建议支持：

- 产品成本。
- 包装费。
- 质检费。
- 服务费。
- 物流渠道。
- 目的国。
- 计费重量。
- 参考时效。
- 汇率。
- 目标毛利率。
- 最低 10% 毛利红线。
- 15% 毛利绩效警戒提示。
- 报价有效期。
- 报价版本。
- 报价审批状态。
- 报价单或报价消息输出。

### 5.7 Outreach 建联队列

- WhatsApp / Email / Instagram / Facebook 渠道。
- 半自动发送：AI 生成，人工确认，再复制或跳转。
- 状态：草稿、待发送、已发送、已回复、跳过。
- 下次跟进时间。
- 负责人。
- 跟进提醒。

### 5.8 CRM 跟进看板

- 线索阶段。
- 跟进记录。
- 下次动作。
- 业务员归属。
- 客户保护期。
- 沉默客户提醒。
- 客户归属争议留痕。

### 5.9 业务资料库

原笔记能力建议改造为：

- 客户资料。
- 跟进记录。
- 报价备注。
- 素材沉淀。
- 产品研究记录。

不再作为主导航中的“笔记应用”。

## 6. 架构改造建议

### 6.1 后端领域模型

建议新增或演进以下实体：

- `workflow_runs`
- `workflow_steps`
- `leads`
- `lead_contacts`
- `ad_creatives`
- `shopify_stores`
- `outreach_tasks`
- `crm_activities`
- `quotes`
- `quote_items`
- `logistics_quotes`
- `customer_ownerships`
- `audit_events`

### 6.2 后端服务拆分

建议从单一 `autoflow` 服务逐步拆成：

```text
autoflow
lead-discovery
store-detection
lead-scoring
outreach
quote
crm
integration
audit
```

### 6.3 前端目录建议

```text
src/views/autoflow/
  DashboardView.vue
  WorkflowsView.vue
  DiscoveryView.vue
  LeadsView.vue
  LeadDetailView.vue
  OutreachView.vue
  QuoteView.vue
  CrmView.vue

src/stores/
  autoflow.ts
  leads.ts
  outreach.ts
  quotes.ts

src/api/
  autoflow.ts
  leads.ts
  quotes.ts
  outreach.ts
```

### 6.4 旧模块处理建议

- `notes`：保留，但产品语义改为资料 / 记录。
- `folders`：保留，可作为资料分类。
- `HomeView`：不再作为首页。
- `/notes/:id`：短期可隐藏，后续改为 `/records/:id`。
- `NoteFlow` 全局替换为 `AutoFlow`。
- `noteflow` 数据库名短期可不强制迁移，避免数据风险；代码默认值后续改为 `autoflow`。

## 7. 子 Agent 分工建议

### Agent A：品牌与文案清理

负责范围：

- 全局替换 NoteFlow / 智能笔记 / 笔记应用语义。
- 登录、注册、README、DEPLOY、邮件、seed 文案统一 AutoFlow。
- 主导航和页面文案改成业务员视角。
- 清理明显中文乱码。

### Agent B：后端领域建模

负责范围：

- 将 `autoflow` 从内存数据改成 TypeORM 实体。
- 优先落库 workflow、lead、outreach task、crm activity。
- 加用户 / 团队归属。
- 接入 DTO 校验和状态流转校验。

### Agent C：前端业务工作台

负责范围：

- 调整导航结构。
- 新增 Discovery、Quote 入口。
- 优化 Dashboard、Lead Detail、Outreach、CRM 为中文业务场景。
- 弱化或隐藏旧笔记入口。

### Agent D：流程接入与测试

负责范围：

- 将 Shopify Search / Facebook Ads / AI 接入 workflow step。
- 补充 AutoFlow API 测试。
- 补充前端路由与页面冒烟测试。
- 补充报价计算和 outreach 状态测试。

## 8. 迭代路径

### P0：品牌与主路径修正

- 全局 NoteFlow → AutoFlow。
- 登录注册改为销售自动化定位。
- 主导航改中文业务场景。
- 保留笔记能力但降级为资料记录。
- 清理明显乱码文案。
- 确保测试和构建通过。

### P1：AutoFlow 数据落库

- workflow、lead、outreach、crm activity 落 PostgreSQL。
- 接入用户归属。
- 删除内存假数据。
- 加 DTO 校验和状态流转校验。

### P2：搜品 / 搜店铺工作流闭环

- 关键词 / 图片创建 workflow。
- 调 Facebook Ads / Shopify Search。
- 生成 lead。
- 自动评分。
- 进入线索池。

### P3：AI 建联与跟进

- AI 生成 WhatsApp / Email 话术。
- 建联队列。
- 人工确认发送。
- 跟进提醒。
- 沉默客户唤醒。

### P4：报价工作台

- 产品报价。
- 物流报价。
- 毛利测算。
- 报价审批提示。
- 报价记录沉淀到客户详情。

### P5：CRM / FOP 边界衔接

- 客户注册 / 绑店 / 下单状态字段。
- FOP 客户编号。
- 订单 / 回款 / 履约状态同步预留接口。
- 经理看板与销售复盘。

## 9. 第一版落地建议

第一版不要急着接太多外部系统。最优路线是先把业务员每天开发客户的动作做成一个能跑通的内部工作台：

```text
输入产品关键词
→ 找到广告和 Shopify 店铺
→ 生成线索
→ 自动评分
→ 生成建联话术
→ 加入跟进队列
→ 记录客户状态
→ 支持报价备注
```

这个闭环跑起来后，AutoFlow 才真正从 NoteFlow 转型为业务工具。后续再接 FOP、Shopify OAuth、物流试算、报价审批，会更稳。

