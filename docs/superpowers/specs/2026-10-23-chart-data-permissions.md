# 图表授权与用户数据隔离设计（已获用户直接实施授权）

## 目标与全局规则
平台服务内部员工；不改变既有ECharts结构与业务金额口径。每张图表独立授权，数据先按服务端账号/FOP授权/本地范围求交再排名、合计、占比、分页。业务员本人，经理部门及下级成员（包含经理本人），业务管理员本租户FOP许可数据；系统管理角色不能扩大业务数据。客户Top10与其他必须在授权候选内生成，趋势/搜索/下钻/导出同源同范围。组织汇总是独立能力，不能以个人局部金额冒充完整部门总额，不能借汇总权限获得成员或单据。

## 共享接口约定
- ChartId：registrations、department_receipts、salesperson_receipts、order_volume、customer_orders、freight、sales_performance。
- ChartPermissionOverride：{ chartId, visibility: inherit|allow|deny, dataScope: inherit|self|department, summaryMode: inherit|none|selected|marketing, summaryDepartments: (sales1|sales2|sales3|sales4)[], details: inherit|allow|deny, export: inherit|allow|deny }。
- 用户保存 chartPermissions: ChartPermissionOverride[]，缺省[]，每个chartId唯一，未知项拒绝。summaryMode除inherit/none外仅用于registrations/department_receipts/order_volume（仅organization类别）。selected必须非空去重，其他模式数组为空。任何范围扩大不得越过账号业务范围；组织汇总经独立FOP汇总授权交集，可与记录范围不同。
- 账号管理 GET /users/workbench-accounts 返回chartPermissions；PUT /users/:id/chart-permissions {chartPermissions} 仅系统管理员。修改不改变业务角色/FOP绑定，持久化及二次权限核查。
- GET /autoflow/integrations/fop/chart-access 返回{source,businessScope,charts:EffectiveChartAccess[]}；dashboard同时返回chartAccess数组。
- EffectiveChartAccess：{chartId,visible,dataScope:none|self|department|all,scopeLabel,canViewDetails,canExport,summaryOnly,summaryDepartments:SalesDepartmentCode[]}。不返回员工/客户授权ID列表。
- backend users/chart-permissions.ts 提供CHART_IDS、ChartPermissionOverride、EffectiveChartAccess、resolveChartAccess(user)（本地权限，FOP最终求交在FopDataService完成）。返回数组，具体必要内部类型由后端任务同步。
- dashboard 原receipts只承载业务员视图数据；新增departmentReceipts承载纯组织汇总（同收款结构，salespeople空）；被拒图表数据为空，不能藏在JSON中；chartAccess控制显隐/操作。注册数据按当前图表范围，只有组织汇总权时不返回成员。
- 订单量非customer用order_volume，customer用customer_orders；物流用freight；个人业绩用sales_performance。每个端点校验图表权限，明细加details校验。公开查询不能自报userId/权限；内部接口需分辨收款下钻来自哪个chartId且每条分支验证，不允许伪装来源绕过限制。
-组织汇总provider新增独立只读契约；不能通过修改当前用户身份或扩大allowedOrderIds从详情推导。汇总返回只有部门/日期/指标/必要仓库，不含成员客户订单。FOP未实现该能力保持明确未配置状态，Mock同契约。

## 模板与范围
本地岗位模板由业务角色+工作台岗位解析，不按系统管理员角色。销售员工默认个人图表，部门汇总默认无；经理部门范围，管理员全部。账号override支持继承/允许/禁止；允许只开启功能不扩大记录范围。未知/新增图表缺省拒绝。导出权与明细权分离，现有没有导出的图不虚构导出功能；禁止导出应关闭ECharts图片下载及可见数据导出入口。
纯组织汇总图：经理默认管理部门，业务管理员授权营销中心；普通员工需显式summary授权。跨部门汇总展示不允许把域外成员数据附带返回。图表范围标签为独立提示，不重新添加“营销中心·授权范围”下拉选项。
个人销售工作台绑定员工后默认本人；经理无员工绑定不能悄悄默认其他成员，应提示绑定或主动选择授权人员。
客户当前分配与订单/收款历史业绩归属分开；保留冻结毛利归属。没有可信客户转移授权时不得因为当前客户归属覆盖历史授权；对接方案明确当前客户owner及历史访问/业绩字段，不伪造生产接入。

## 验收
双业务员不同客户(各>10)、同部门经理含本人、跨部门经理、业务管理员与纯系统管理员；逐图deny直接API拒绝且综合dashboard无金额泄漏；图表self缩小经理范围；组织汇总有数据但成员/订单/客户下钻拒绝；查询注入/跨账号/迟到响应/权限撤销；客户Top10+其他=授权合计；旧图表布局/环比/月份倒排/USD/UTC+8/鼠标行为保持。
