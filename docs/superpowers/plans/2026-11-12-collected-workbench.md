# 已采集业务数据入库与展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. User explicitly requests direct execution.

**Goal:** 执行一次真实旧 API 初始化，已知字段落 PostgreSQL 并在现有工作台展示，缺失留空。
**Architecture:** 独立 collected 批次与订单表，事务发布；本地读取服务复用现有账号/组织范围，保留采集时点和缺失字段。正式 replica 不伪造授权证明；自动 FOP 调用保持暂停。
**Tech Stack:** Nest/TypeORM/PostgreSQL、Vue/TypeScript、现有 FOP Kingdee 鉴权。
**Spec:** 用户本轮指令、agent.md 现行配货确认、扩展需求 V1.3 的 B09；本轮授权覆盖单次 API 同步与旧凭据复用。

## Global Constraints
- 保留当前工作区已有修改，不重置、不提交无关文件；不修改 dtr5b 后台。
- 只有显式单轮初始化进程可访问 FOP，持久自动调用开关保持关闭。
- 不以零代未知，不以产品金额代总额，不以本位币代结算币种。
- 旧采集是历史只读数据；审核等实时操作不因部分展示而解除门禁。
- FOP 交付文档最终仅含 FOP 后台动作；本地工作和联调证据独立交付。

## Review Focus
- 大整数内码、空金额/数量/币种不丢精度或被补为零。
- 批次失败/重跑不重复、不发布半成品。
- 禁用/跨公司/未绑定业务账号不得扩大读取范围。
- 搜索、分页、筛选、统计与异常候选去重一致。
- 页面刷新与导航不发起远端 API。

### Task 1: 单轮采集与事务入库
- [ ] 新增迁移与 collected 映射，先测试空值、主键、状态和未知事实。
- [ ] 复用旧鉴权，验证租户/组织/目录，显式一次采集、逐页入暂存、完整批次发布。
- [ ] 使用本地数据库读回核对分页总数、唯一主键、商品行及来源摘要；保存脱敏报告。

### Task 2: 本地读取与范围
- [ ] 新增 CollectedWorkbenchService；LocalWorkbenchService 在显式 collected 模式路由本地查询。
- [ ] 复用账号/组织/员工绑定；支持已知销售队列、未判定异常、分页筛选、详情和导出一致性；未接入实体空列表附 unavailable 元数据。
- [ ] 测试权限、范围、缺字段、异常与查询，并接入本地状态查询。

### Task 3: 前端展示
- [ ] 适配 partial/null 字段与批次元数据；缺失显示空白/—，禁止金额零值兜底。
- [ ] 现有工作台显示可用订单；未接入数据/待核查原因可见；部分数据不开放审核。
- [ ] 相关前端测试、类型检查与构建；浏览器截图验证真实数据。

### Task 4: 文档与最终复核
- [ ] 字段表标注真实 collected 入库/读取及未接入状态，与代码同步。
- [ ] FOP 扩展需求仅保留其开发动作、字段、API及验收要求；本地成果另做联调报告。
- [ ] 定向及必要回归、独立审查，确认自动调用暂停，交付实际订单数与截图。
