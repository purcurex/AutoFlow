# Project context

## 文档交付链接（2026-11-18）

　　用户反馈本地需求说明书文件链接无法直接打开。交付 HTML 时优先提供已验证可访问的浏览器链接；本地前端运行时，可使用 `http://localhost:5173/@fs/` 加绝对文件路径（中文路径进行 URL 编码），验证响应为目标 HTML 而非应用首页。章节锚点仅用于 HTTP 链接，不拼到本地文件或文件夹定位链接中。另需文件定位时，单独提供不带锚点的绝对路径链接。不得仅提供未经验证的文件链接，也不得为便于访问公开私有文档。接口缺口必须同时在对话中精简列出，不能只让用户查看文档。

Before designing or changing FOP integrations, read [agent.md](agent.md). It records the HyperZone backend identity, source repository, and agreed collections rules.

Standalone HTML deliverables follow `/Library/VSCode/.hyperzone/html-style/STANDARD.md`; read it before regenerating HTML. Keep its shared CSS and transparent HyperZone logo. Do not restyle application source merely to match standalone documents.

## 五工作台数据架构（强制）

销售、发运、采购、配货、仓库统一采用：集成账号获取 FOP 事实 → 后台同步本地数据库 → 本项目后端计算权限、阶段和查询结果。FOP 为业务事实及执行依据，本地为可重建查询副本；原生状态保留，派生状态由后端统一计算。列表、详情、计数和导出读取本地，审核及其他业务执行实时访问 FOP；即时库存与备货库存核验走独立实时接口。同步不得执行采购、配货、库存预占或逆向业务；禁止旧清单穿透回退。完整边界、缺失字段展示、授权续验及当前调度约定见 [agent.md：五工作台统一数据架构](agent.md#五工作台统一数据架构总规则2026-11-12-确认)。《项目开发需求说明书》以FOP扩展同步服务为核心；正文及引用的机器契约与代码双向同步，详细本地字段映射和运行证据保留为工程资料，不重新堆入交付正文。唯一需求文档：[HyperZone智能办公平台项目开发需求说明书](docs/requirements/HyperZone智能办公平台项目开发需求说明书.html)。交付前运行 `python3 scripts/build-unified-requirements.py` 和 `python3 scripts/validate-unified-requirements.py`。

普通查询授权分层：FOP只需授予统一集成账号目标公司必要实体的全量同步读取权限；入库后以来源业务员稳定ID和本地账号绑定、角色及部门范围过滤，不要求普通用户另取FOP逐单授权。接口成功零行不得标成已确认授权失败，未知归属保留待核查。

## 测试环境持续增量（2026-11-18）

　　用户已解除历史API暂停和仅单次采集限制，频次审阅通过后正常运行持续增量；沿用agent.md最新调度约定，保留锁、去重、超时、退避及权限保护。普通页面读本地库，不以刷新触发源端全量查询。
