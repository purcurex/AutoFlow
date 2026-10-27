# HyperZone 项目事实与设计入口

- 本前端项目：HyperZone 智能办公平台，工程目录 `/Library/VSCode/AutoFlow/work-app`。
- FOP 后台不是通用第三方 ERP：它是基于金蝶云苍穹平台自研的 **HyperZone** 应用。
- FOP 后台代码库：`/Library/VSCode/dtr5b`。设计接口、统计口径、字段或业务规则前，先读取该库 `AGENTS.md`，核对实体元数据、枚举、校验和 Java 插件实现。
- 后台源码用于核实业务事实；源码存在不等于对应生产 HTTP 接口已经启用。本前端真实 FOP 网络适配器仍须按实际发布接口配置。
- 回款采用方案 2：已支付、已审核的履约订单收款，加已支付、已审核的全款备货收款，按支付当月计入；押金备货不计入。履约使用全款备货库存时不补回产品金额、不重复计算备货收款。
- 时间文案及统计口径统一 `UTC+8`；传输时间戳保留明确时区，日/月归属按 `+08:00` 换算。
- 已审核履约订单的仓库和物流渠道由 FOP 保证完整。全款备货在国内仓库备货，物流渠道不适用，不能归为“其他物流服务商”。
- 物流运费分析当前按已审核发运单的 `hzkj_actual_freight` / `hzkj_actual_freight_time` 统计已确认成本；确认时间不是银行付款日，不能据此承诺最终账单完整性。物流商原币在 `hzkj_textfield1`，必须显式换算 USD；首次正数快照后续调价/退款仍需对接确认。成本采用独立 `allowedFreightIds` 和 `freight` 授权，不能从订单权限推导。
- 销售个人毛利采用净毛利的期间贡献：C审核月结取 `hzkj_gp_net_delta_total`／分录delta及冻结业务员，不能重复累计整单快照。收款独立按paidAt，利润按recognitionMonth/date；同订单同月已结算替换预计，跨月调整保留原归属。预计与已结算分别汇总，不合成总利润。
- 未结算必须使用预估运费和截至本次查询asOf已知收入／成本。现有FOP实时毛利无运费按0、采购无cutoff、备货cutoff未使用、仓储不按通知日期截止，不能直接当历史预计日报。预计日周需事件台账／快照差分；新平台查询不提供历史asOf审批回放。
- 完整月可取无日归属的审核月结；周／天／部分月不能均摊，返回null／待拆分并保留月参考。全款备货回款不再次成为利润收入，利润按有效使用转入；收入已含调整时不可重复加算。冻结CNY通过明确历史FX换USD，保留原额／取价日／来源及尾差审计。
- 利润采用独立 `sales_profit` 和 `allowedProfitIds`，不从订单／收款／运费授权推导；冻结业绩归属与当前查看权限分开。本工程前端、BFF、Mock和契约不代表FOP生产ready；IT入口见 `docs/analytics/IT_HANDOFF.md`，生产剩余工作见T21–T26及H23–H28。
- 已确认后台字段与证据见 `docs/analytics/HYPERZONE_FOP_SOURCE_MAPPING.md`；需求及 OpenAPI 见 `docs/analytics/`、`docs/openapi/`。

- 管理员可手动新增员工、设置部门并开通前端账号，或为已有员工开通账号；新账号默认普通用户／本人业务范围。员工通过唯一可空 `account_id` 关联账号，创建支持FOP用户绑定但不创建FOP后台用户。后台 `UserBillPlugin` 邀请表单不是HTTP接口；`EmployeeUtil` 使用用户masterid，本地UUID不能当成FOP业务身份。操作、契约与待核对映射见 `docs/EMPLOYEE_ACCOUNTS.md`。

- 组织架构是员工及登录账号维护的唯一前端入口，权限分配在账号权限页独立进行；菜单组织在前、权限在后。成员导入仅建档，先预览再原子保存，每批1–100名。删除成员采用归档＋停用账号＋撤销旧会话，保留历史业务记录；账号密码重置同样撤销会话，不能通过员工资料编辑修改权限。

未经单独安排，不修改 `/Library/VSCode/dtr5b` 的生产应用实现；本工程内对接层、Mock 与契约同步维护。

- 全局P0：员工平台按登录用户先授权过滤再统计、Top10／其他／占比／环比／分页；图表、搜索、趋势、明细与导出同范围。逐图权限只是功能许可，不扩大FOP资源与本地本人／部门范围。部门经理包含本人及管理部门成员，个人工作台默认本人。
- 组织整体汇总独立授权，只返回可信部门聚合；不能以个人小计冒充完整部门合计，也不能借汇总许可获取成员／客户／单据。保留原ECharts结构及金额口径。客户当前归属、历史收款／订单归属与冻结毛利分开，移交不能自动转移历史业绩或放开历史访问。
- 员工业务页面使用自然业务文案；下拉选项只显示业务名称或简短选择提示（如“请选择业务员”），不附加绑定步骤、默认身份或授权机制说明。业务页面不展示“本租户授权数据”“获授权范围”等技术性权限描述或后台身份编号。各ECharts面板标题上方不再展示“当前统计范围”“我的业务”等范围提示，保留简洁标题及筛选；聚合用“统计部门合计”“当前成员合计”，不能将部分成员小计改称完整部门合计；必要的授权配置和身份字段保留在管理员设置页。

- 五类履约待办顺序：待审核(review)、待履约(dispatch)、待采购(procurement卡片)、待配货(allocation卡片)、待出库(shipping)。按2026-10-27需求9.13：已付有效订单中，review取未审核；dispatch须客户已支付、履约已审核，再取Shopify跟踪号待同步/部分同步；成功完成上传及Shopify履约标记后退出；procurement合计未完成下单/采购付款与已采购待发货，不以履约审核作额外门槛。allocation/shipping仍须履约已审核且实际有效配货单allocationCreated=true；false/null不计入。各卡与同账号未临时筛选清单total同口径，按履约订单去重。

- 五类待办卡片、tasks、明细、搜索、分页与金额／数量合计统一先按服务端登录账号的业务范围和FOP白名单过滤。本人／部门／业务管理员分级不因系统管理员身份或全部岗位授权扩大；空白名单为零，未绑定或授权失败明确拒绝。专项验收D31，需求第9.1节。
- 协同岗位（销售总监、订单管理、采购、配货、发运、仓库）可独立配置“全部业务数据”（businessRole=admin），无需系统管理角色；FOP绑定用户仍需公司业务授权。五个工作台全部九类待办（含待支付、异常）支持departmentId＋ownerId筛选，先授权再部门/业务员筛选、合计和分页；默认按paidAt升序/id升序，表头可切换paidAtOrder=asc/desc，排序前置于分页、同时间id升序且缺失日期始终最后，不以createdAt替代。部门与业务员选择跨搜索/翻页/刷新/工作台待办保留；切换部门清空业务员并回第一页。salespeople选项仅来自当前可见订单、受部门限制，独立于队列/搜索/分页；ownerId按订单owner.id匹配，不能授予权限；两种Excel导出同筛选；search支持业务员展示姓名（owner.name优先，空缺才用salesperson）、中文/英文部分匹配且忽略英文大小写，与ownerId和部门取交集；Demo订单归属销售员工，协同人员不模拟为客户归属业务员。

- 待办工作台默认只读；新增9.11例外：销售review与配货allocation_review支持勾选后委托FOP执行原生audit，独立操作授权/版本/幂等/逐单结果必须校验；其他采购/配货调整/发运/出库仍在FOP执行。商品列第二、订单号及客户名称可复制、一单多品合并展示。可见且联网每30秒刷新，返回页面或恢复网络立即刷新；refreshedAt只是BFF查询完成时间，生产同步延迟必须由FOP真实链路/水位验证，不可把Demo轮询宣称生产实时同步。

- 工作台导航：岗位顺序与Dashboard卡片一致：销售（待审核）→发运（待履约）→采购（待采购）→配货（待配货）→仓库（待出库）；只展示已授权岗位，授权返回顺序不影响显示。各岗位待办清单在分析页之前；销售页签顺序unpaid待支付、review待审核、exceptions异常，再个人业绩及分析，但默认首页明确为review，不按第一个页签推导；采购procurement、配货allocation_review（已齐套待审核）、发运dispatch、仓库shipping。显式queue链接保留原目标。

- 采购待办用procurementProgress独立下单/采购付款事实；客户已付不代表采购已付。not_ordered/partial或ordered+unpaid/partial/refunded进入procurement（供应商已发但采购未付也保留）；ordered+paid且supplierShipment=pending/partial进入procurement_shipping。两个页签互斥，unknown/cancelled/not_required不推断为未付；有效退款和取消重采按实际剩余义务归一。T32/H34继续核对。

- 配货工作台不显示客户支付状态。只统计履约已审、实际生成有效配货单且未审核、未全部出库的订单；allocationCreated=true为硬门槛，不从履约审核或库存事实推断。allocation=incomplete+pending；allocation_review=ready+pending。两页均显示发运单状态、配货状态、配货单状态；已审核或审核未知不计待配货。FOP异步建单延迟/失败/作废需读取实际结果，旧网关缺字段归一null。

- 发运工作台以dispatchDocuments逐张显示发运单状态（暂存/已提交/已审核），替换客户支付状态，保留独立Shopify履约状态。读取hzkj_deliver_bill而非发货通知单；A/B/C归一，订单/发运权限及组织客户来源同时校验；null/缺失是待确认，[]仅确认无有效单据；多张单据不重复计订单，不按最高审核状态冒充整单。真实适配见9.6/12.3、T33/H35/D33。

- 仓库待出库清单两组：已齐套未审核（ready+pending，排除completed）；已审核未出库（ready+approved+outbound pending/partial）。都需客户已付、履约已审、allocationCreated=true及查看权限。前端筛选名称“配货单状态”，最左，API仍warehouseStage；全部待出库/已齐套未审核/已审核未出库。只显示配货单状态列，保留底层outbound作判断；卡片和tasks始终两组合计。

- 清单拆分最新规则见需求9.13（覆盖9.7原门槛）：Dashboard采购/配货卡片及tasks分别按对应两页去重并集、时间取最早收款；齐套只跨配货页签，审核完成退出配货。采购已付且供应商全部发货才退出；仓库两组并集。全部计数先权限再筛选；临时搜索/部门/业务员/状态筛选只影响清单不修改Dashboard基数。

- 销售待支付清单queue=unpaid继承sales角色及订单数据权限，未取消且paymentStatus=unpaid；退款/未知不得当未付，FOP明确待支付状态为hzkj_orderstatus=1。收款日期为空显示—，金额为订单应付金额而非已收款，不计入Dashboard原五张已付待办或回款。付款后退出本页、未审核进入review，依赖只读刷新。

- 工作台状态排序（需求9.9）：sortBy=paidAt/dispatchDocumentStatus/stockReadiness/allocationReviewStatus/allocationDocumentStatus/outboundStatus，sortOrder=asc/desc；默认paidAt兼容paidAtOrder。先授权/筛选后全量排序再分页；多发运单取最早明确阶段，任一未知则该订单待确认置后，[]明确未生成最前；状态同值按paidAt升序/id升序，未知和空日期始终最后。配货两页按stockReadiness（未齐套→已齐套）和allocationReviewStatus（未审核→已审核）独立排序；allocationDocumentStatus保留仓库展示及旧链接兼容；outboundStatus仅保留旧查询兼容，无表头入口。单排序不改变逐张单据展示、权限、合计或Dashboard默认顺序。

- 采购旺旺催办（9.10）：仅procurement_shipping行入口，按履约源单/分录→有效采购单→实际卖家hzkj_sellers_ww关联，禁止SKU默认供应商猜测。独立allowedPurchaseOrderIds与订单/本人部门范围同时满足；单对象自动尝试，多采购单逐单选择。打开前查最新事实与contactVersion，变更/撤权停止；只打开聊天不自动发消息/改业务状态。Mock mode=demo,url=null。FOP现成HTTP端点与客户端协议尚需H36确认，真实provider接入T34、验收D37。

- 工作台审核9.11：hzkj_orders与hzkj_alloc_bill/audit，A不自动提交，B且有权可审，C跳过。配货要求齐套及有效已审发运；后置通知失败为已审核警告。approvalActions缺失拒绝，不由系统管理员/业务全量读权推导。当前HTTP网关合同待T35/H37/D38发布联调，Demo为进程内模拟状态，未修改FOP源库。

- 交付补充（2026-10-26）：全部待办每页20/50/100，前端默认显式50、切换回第一页，纵向平铺；接口兼容1–100且省略默认20。审核当前页最多100笔，超时/部分成功逐项处理。仓库筛选最左配货单状态、最右所属部门。汇率显示USD/原币四位（CNY为USD/CNY），取fxRateToUsd倒数；API和金额计算保留原精度，日期与来源保留。

- 所有工作台待办Excel导出（9.12）：所选当前页最多100笔＋全部已应用筛选跨分页；POST fulfillment-orders/export。复用清单读权、FOP白名单和员工/部门范围，输出前复核会话与授权，不要求approvalActions。XLSX订单/商品/说明三表，订单金额只计一次、按币种合计、UTC+8、文本编号防公式；上限10000单/50000商品行，超限413、选择失效409、禁止静默截断。真实生产联调见T36/H38/D39。
