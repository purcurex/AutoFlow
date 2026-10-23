# 图表权限与统计范围 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 逐图授权与用户数据范围在后台统计前生效，并提供管理员配置及完整IT契约。
**Architecture:** 账号图表策略解析与FOP资源授权求交；普通记录统计与纯组织汇总隔离；前端使用有效能力，后台独立校验每个入口。
**Tech Stack:** NestJS / TypeORM / PostgreSQL / Vue / ECharts / OpenAPI3.1.1。
**Spec:** ../specs/2026-10-23-chart-data-permissions.md

## Global Constraints
不改变既有图表结构、金额口径、UTC+8、USD美元符号和滚动行为。当前checkout干净，沿用已授权工作区。用户已明确直接实施，不再次请求阶段批准。FOP源库只读。

## Review Focus
- 汇总权与明细权交叉导致信息泄漏：综合JSON和直接端点均测试。
- 用户/部门切换与缓存：所有迟到响应及会话状态清空。
- Top10先过滤后排名与其他集合：构造两个owner各超过10客户。
- 部门经理本人未绑定：不能静默选同事作为个人业绩。
- 同一收款/订单多入口：不能借query chartId或队列绕过图表/范围限制。

### Task 1: 账号图表策略
Files: users/chart-permissions.ts, entity/service/controller/dto, migration,对应单测及workbench E2E。
Produces: ChartPermissionOverride/EffectiveChartAccess/resolveChartAccess，持久化管理接口。
- [x] 写并观察失败：模板、override、非法scope、管理员检查、JSON唯一性。
- [x] 实现、定向测试、确认不提升系统/业务权限。

### Task 2: 统计端点与组织汇总
Files: fop-data/*.ts, users/workbench.controller.ts, fop-data-access.e2e-spec.ts。
Consumes: Task1策略。Produces: chart-access API、dashboard分离数据、独立FOP组织汇总契约。
- [x] 写并观察失败：deny直访、Top10范围、汇总无成员/明细、self限制与经理默认本人。
- [x] 实现并定向验证，原资源grant继续独立，验证权限中途变更。

### Task 3: 前端授权与账号配置
Files: frontend APIs、WorkbenchRoleAdminView、FopDashboardView、订单/费用/个人业绩/明细组件及测试。
Consumes: Task1/2共享接口。
- [x] 写并观察失败：不可见图不请求数据、按钮能力、账号保存、经理本人默认。
- [x] 保留图形布局，完善范围提示、汇总视图、各明细能力与会话重置。

### Task 4: 文档与完整验收
Files: README, agent.md, docs/analytics, docs/openapi,生成脚本。
- [x] 新增全局强制规则与IT待办，更新字段级OpenAPI及MD/HTML。
- [x] 独立审查、全套测试、lint/build、隔离数据库迁移、真实本地HTTP及浏览器。
- [x] 汇总验证结果，提交Git并同步已授权远程，生成最新交付包。

Pre-flight: Task1→Task2→Task3共享字段以上述Spec为准；允许并行不同文件，修改接口先通知所有任务。根代理负责OpenAPI/文档与集成。

Task 1: 实际PostgreSQL隔离schema完成up/down/re-up、8组非法JSON拒绝、非空限制回滚拒绝及身份字段保持验证；本地演示库已备份后迁移。
Task 2/3 Ruling: 注册业务员计数series为既有图内授权聚合，不是业务单据明细；canViewDetails=false不移除已授权series，summaryOnly时必须无成员。完整组织总额与部分授权成员同时存在时范围提示区分，不能声称完整成员名单。
Task 2 Ruling: 兼容旧provider缺currentCustomerOwner时，保留历史事实范围并显式返回customerOwnershipBasis=historical_attribution/mixed，前端提示；新FOP适配要求完整当前分配和移交许可，不能将兼容模式声称当前客户归属完整。
Final review Ruling: 经理“包含本人”指管理部门内自身业务，不按owner并集扩展至其他部门历史事实；自有数据仍受部门及FOP许可上限。超出部门的历史访问须显式业务授权，不靠个人工作台隐式放宽。

Final verification: 55后端套件484例＋46前端文件238例＋4E2E套件121例＝843例通过；lint、类型、生产构建、隔离生产启动与迁移均通过。实际HTTP33份响应schema校验、5组权限拒绝；浏览器配置和Dashboard检查通过，测试账号设置已恢复。OpenAPI23操作/111模型/269示例；HTML共享样式与Logo离线验证通过。独立审查无剩余关键或重要问题。Git及交付包具体版本由最终提交和包内清单记录。
