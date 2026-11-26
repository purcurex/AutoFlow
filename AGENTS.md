## 文档表述规范（2026-11-18）

　　需求说明书、手册、方案、报告及资源包内文档统一使用客观、简洁、可执行的表述，说明适用范围、已完成事项、验证结果、待提供资料、待修复问题和后续操作。避免使用“不认可”“不认定”“不予认可”“未获批准”“未放行”“尚不具备上线资格”等主观认可、否定性认定或代替负责人审批的措辞，也不使用同义改写表达此类判断。涉及准备进度时，直接列明具体条件、当前事实、负责方和处理动作。

　　真实测试失败、接口缺失、数据范围、权限限制及安全告警如实保留，不因文案优化改写为已完成。业务审核／出库校验等系统规则按实际功能说明；文档用语调整不改变业务逻辑、数据事实或授权。同步修改文档源文件、生成文件和交付包副本，防止再次生成时恢复旧表述。

# Project context

## 文档交付链接（2026-11-18）

　　需求说明书、部署手册等交付优先提供不带章节锚点的本地绝对文件路径链接，便于直接打开或在访达中定位。需要浏览器预览时可另附已验证的HTTP链接；章节锚点仅用于文档内部导航，不拼到本地文件或文件夹定位链接中。不得为便于访问公开私有文档。接口缺口在对话中精简列出。

Before designing or changing FOP integrations, read [agent.md](agent.md). It records the HyperZone backend identity, source repository, and agreed collections rules.

Standalone HTML deliverables follow `/Library/VSCode/.hyperzone/html-style/STANDARD.md`; read it before regenerating HTML. Keep its shared CSS and transparent HyperZone logo. Do not restyle application source merely to match standalone documents.

## 五工作台数据架构（强制）

销售、发运、采购、配货、仓库统一采用：集成账号获取 FOP 事实 → 后台同步本地数据库 → 本项目后端计算权限、阶段和查询结果。FOP 为业务事实及执行依据，本地为可重建查询副本；原生状态保留，派生状态由后端统一计算。列表、详情、计数和导出读取本地，审核及其他业务执行实时访问 FOP；即时库存与备货库存核验走独立实时接口。同步不得执行采购、配货、库存预占或逆向业务；禁止旧清单穿透回退。完整边界、缺失字段展示、授权续验及当前调度约定见 [agent.md：五工作台统一数据架构](agent.md#五工作台统一数据架构总规则2026-11-12-确认)。《项目开发需求说明书》以FOP扩展同步服务为核心；正文及引用的机器契约与代码双向同步，详细本地字段映射和运行证据保留为工程资料，不重新堆入交付正文。唯一需求文档：[HyperZone智能办公平台项目开发需求说明书](docs/requirements/HyperZone智能办公平台项目开发需求说明书.html)。交付前运行 `python3 scripts/build-unified-requirements.py` 和 `python3 scripts/validate-unified-requirements.py`。

普通查询授权分层：FOP只需授予统一集成账号目标公司必要实体的全量同步读取权限；入库后以来源业务员稳定ID和本地账号绑定、角色及部门范围过滤，不要求普通用户另取FOP逐单授权。接口成功零行不得标成已确认授权失败，未知归属保留待核查。

## 测试环境持续增量（2026-11-18）

　　用户已解除历史API暂停和仅单次采集限制，频次审阅通过后正常运行持续增量；沿用agent.md最新调度约定，保留锁、去重、超时、退避及权限保护。普通页面读本地库，不以刷新触发源端全量查询。

## 八套视觉资产与后续 UI 开发

四色系（商务蓝、清新绿、典雅紫、活力橙）均支持深浅模式；新浏览器默认商务蓝深色。唯一色值源 `frontend/src/theme/palettes.json`，修改后运行 `python3 scripts/build-theme-assets.py`。共用组件规范为 `frontend/src/theme/components.css`；资产手册 `docs/design-system/index.html`。新功能必须使用语义变量和公共组件，不新增独立主操作色或按主题复制业务页面；保留 Logo、Dashboard 卡片和业务状态色。交付验证八种组合、按钮文字对比度、焦点、弹窗及表格；执行 theme-assets、theme-bootstrap 测试与前端构建。主题切换不触发业务取数。

## 截图确认默认规范（2026-11-18）

　　后续本项目界面截图、视觉确认及验收截图统一使用“典雅紫 · 浅色”主题，并默认使用宽屏视口。截图前确认主题色系为 purple、模式为 light；用户明确要求核查其他主题或深色适配时，按该次要求补充对应截图。此规范仅规定截图验收环境，应用首次使用默认主题为“商务蓝 · 深色”。
