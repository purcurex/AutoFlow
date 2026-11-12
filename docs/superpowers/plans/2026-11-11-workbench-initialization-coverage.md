# 工作台初始化、本地缺口与流程覆盖实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. 本轮用户明确要求直接执行；不再等待方案确认。

**Goal:** 按新方案推进真实初始化，完成可独立落地的本地配套，诊断并显式暴露未整体出库订单的待办覆盖缺口。

**Architecture:** 沿用稳定快照／变更／授权／核对后的本地副本及专用实时 API。业务事实未知不得编造。流程覆盖诊断同时区分业务待办、历史可见、权限／数据未就绪和已终止记录，不能以历史已审核列表代替后续业务待办。

**Tech Stack:** NestJS、TypeORM/PostgreSQL、Vue 3、Jest/Vitest、Python 本地数据分析。

**Spec:** docs/integrations/HyperZone智能办公平台项目FOP扩展开发需求.html；agent.md；本轮用户要求。

## Global Constraints

- 保持本地查询方案；不恢复旧 API 清单穿透，不导入 Mock 冒充测试环境业务。
- 本轮初始化获得授权，长期自动调用未获恢复授权；仅按需执行，有效数据证明不足不发布。
- FOP 源码只读；凭据和原始订单不进入公开报告。文档正文遵循全局缩进与 HyperZone 模板。
- 当前分支 codex/company-directory-access，保留已有未提交工作，不创建提交或重置文件。
- 修改字段／接口／口径时同步对照表和需求状态。缺 FOP 端点明确记录。

## Review Focus

- 未审核或未配货、已同步 Shopify 但未出库的订单不能被错误认为工作完成。
- 未知事实／未初始化／权限拒绝不能当作没有业务；诊断不能绕过权限展示原始客户数据。
- 自动计划关闭时导航和排队重试也不能继续自动访问上游。
- 批量审核未知结果不能重复写入；本地列表滞后要有明确状态。
- 业务原生采购状态 3／4 与供应商全发口径需保留已确认门槛并报告矛盾，不擅自改枚举。

### Task 1: 初始化核对与原始数据诊断

**Files:** scripts/workbench-preflight.cjs；新增 scripts/workbench-raw-coverage-audit.py；.runtime 内私有分析结果；最终脱敏统计。
**Interfaces:** 仅本地只读；输出数据集／源配置可用性，以及 44,855 条原始订单状态、缺失字段、是否足以判定待办。
- [ ] 核对配置仅输出是否配置，读取真实库数量与初始化阶段。
- [ ] 对全部原始文件核对摘要、唯一 ID、原生状态分布和缺失事实；不输出客户明文。
- [ ] 满足源契约才执行初始化，否则保留明确阻塞与可执行入口，不假发布。

### Task 2: 本地发运状态筛选

**Files:** backend/src/modules/workbench-replica/local-workbench-query.ts、local-workbench-logistics.ts、对应 spec／Postgres 回归。
**Interfaces:** 保持 buildLocalOrderQuery(scopes, query, stock) 返回形状；实现 dispatch_preparation、dispatch_complete、dispatch_incomplete 的关联有效发运逻辑。
- [ ] 编写并运行失败测试：无单、草稿／提交、未知、混合、全部审核、删除和跨范围关系。
- [ ] 复用当前有效发运源单判断，补查询条件与完整性检查，保持分页／计数／导出相同口径。
- [ ] 运行相关 Jest／Postgres 测试并提供差异与证据；不改其他代理负责的文件。

### Task 3: 调用开关与前端初始化

**Files:** replica-sync.service.ts、replica-readiness.ts、replica-bootstrap.service.ts／controller、environment.ts、WorkbenchReplicaControls.vue、frontend/src/api/workbench-replica.ts、对应测试。
**Interfaces:** 增加明确自动调用开关与可用性字段；管理员显式初始化／继续入口调用既有 configure／initialize／status。
- [ ] 测试自动关闭时导航、定时、背景重试均不启动；主动请求仍可执行（总暂停优先）。
- [ ] 测试初始化前／缺配置／非管理员／发布成功／失败／会话切换；使用同 requestKey 续传。
- [ ] 更新配置示例及当前私有自动关闭配置；保持总暂停直至实际有效调用需要。

### Task 4: 流程覆盖诊断与可发现性

**Files:** 新增 backend/src/modules/workbench-replica/workbench-coverage.ts、spec、只读诊断脚本及必要 UI／API。
**Interfaces:** 输出 actionable、uncovered、unknown、terminal、completed 等可解释分类及原因；业务待办与已完成历史分开统计。
- [ ] 测试未配货、配货审核后齐套异常、拦截、退款、未知及正常链路，证明原待办集合存在空洞。
- [ ] 基于真实源原生字段和当前队列逻辑枚举分析；明确不能从空 facts 推断关联状态。
- [ ] 落地受权限保护的流程待核查可发现性或诊断入口，不修改源业务事实，不编造来源记录。

### Task 5: 其余可实现配套

**Files:** 按源码确定 dedicated realtime provider、审批／供应商前端组件及接口测试。
- [ ] 接通能依据现行字段完成的接收端：审核回读状态／结果查证、供应商专用适配、库存客户截断处理；缺上游明确不可用。
- [ ] 不自造正式实物退货实体或异常源字段；将仍依赖 FOP 的事项保留并更新状态。
- [ ] 各改动运行针对性回归与独立审查。

### Task 6: 综合验证与交付

**Files:** docs/integrations 下诊断报告、字段表／扩展需求正文与生成器、agent.md。
- [ ] 运行后端／前端测试、必要 HTTP／Postgres 回归、lint 和构建；修复本轮回归。
- [ ] 用新构建启动本地测试服务，验证初始化状态与调用开关；未获得源数据证明不报初始化成功。
- [ ] 更新生成字段表与开发需求，输出真实数据结论、流程逻辑结论、修复与剩余依赖，分别标证据边界。
