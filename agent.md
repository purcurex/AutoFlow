# HyperZone 项目事实与设计入口

- 2026-10-29 鉴权补充：用户确认ID-000015为Wendy的FOP用户编号，不是本地编号或已确认内码。私有资料已补应用身份、accountId及应用编码；仅带身份实测HTTP200但errorCode401“未经授权的访问”，尚缺client_secret/真实代理用户名或有效Token。截图开启代理用户控制，当前应用代理身份不能直接冒充Wendy。凭证仅存Git忽略的本机文件，未绑定账号或切换真实数据。

- 2026-10-29 FOP测试联调：用户提供hyperzone.test.kdgalaxy.com、ierp、R202606.001及4个查询Swagger，路径含/kapi。无凭证实测订单路径返回HTTP519/errorCode2501（不存在应用信息[网关]），仅证明网关可达。凭证、数据中心accountId、Wendy真实身份、测试订单客户ID/类型及组织用户权限契约待补。只读工具npm run fop:test-api，私有backend/.env.fop.local，说明docs/FOP_TEST_CONNECTION.md。未将原始苍穹API冒充员工授权网关，未切换demo或修改FOP源码。

- 2026-10-28 工作台授权补充：通讯录业务员（含伙伴）、部门经理、管理协同岗及管理员均开放销售/采购/配货/发运/仓库5个入口。记录继续按本人/部门/公司业务范围与FOP授权求交，筛选、合计、明细和导出一致；协同岗分析仅部门汇总限制不变，HR及商品管理仍无业务权限。存量通过CompanyDirectoryAllWorkbenches迁移更新入口并撤销受影响会话，不调整业务范围或FOP绑定。

- 2026-10-28 通讯录账号落地：本机保留36名员工＋唯一非员工管理员admin@hzdrop.com；旧演示账号与无关员工已按用户要求清理，笔记/文件夹转交测试管理员。Ethan/Robin/Nora/Mason/XinKe为员工管理员；Cici/Dolly/Wendy/Eileen为销售部门经理，其余销售/伙伴本人范围。HR与商品部门无业务权限，信息管理与订单/采购/物流/仓库同属协同查看：全部待办及订单读权，分析只开放各业务部门汇总，不开放客户/业务员分析、个人业绩或物流财务明细。通过chartPermissions.dataScope=none明确隔离汇总与记录，FOP独立资源授权仍是上限。新账号均未绑定真实FOP。通讯录来源资料仅管理员可读，兼任部门不自动扩权。初始化/协同开发/云端联调步骤见docs/COMPANY_DIRECTORY_SETUP.md；真实通讯录、口令和备份不入Git，迁移与启动不自动导入人员。重复导入保留密码、FOP绑定和外部业务员工/部门ID；目录归属使用主部门。非员工管理员通过服务端organizationWorkspaceOwnerId共享公司目录，不创建虚假员工。

- 本前端项目：HyperZone 智能办公平台，工程目录 `/Library/VSCode/AutoFlow/work-app`。
- FOP 后台不是通用第三方 ERP：它是基于金蝶云苍穹平台自研的 **HyperZone** 应用。
- FOP 后台代码库：`/Library/VSCode/dtr5b`。设计接口、统计口径、字段或业务规则前，先读取该库 `AGENTS.md`，核对实体元数据、枚举、校验和 Java 插件实现。
- 后台源码用于核实业务事实；源码存在不等于对应生产 HTTP 接口已经启用。本前端真实 FOP 网络适配器仍须按实际发布接口配置。
- 回款采用方案 2：已支付、已审核的履约订单收款，加已支付、已审核的全款备货收款，按支付当月计入；押金备货不计入。履约使用全款备货库存时不补回产品金额、不重复计算备货收款。
- 时间文案及统计口径统一 `UTC+8`；传输时间戳保留明确时区，日/月归属按 `+08:00` 换算。
- 最新需求9.35：九类待办业务员/业务部门合并为业务员列固定两行，接口owner/department独立保留；allocation_review显示allocationReadyAt（FOP hzkj_alloc_bill.hzkj_complete_time），仅有效配货单当前齐套时返回，释放/未齐套清空，不回退创建时间。allocation显示consumerPaidAt并支持排序，默认paidAt升序不变。搜索清空自动移除search并回第一页，保留权限及其他筛选；发货仓库默认项全部。Excel同列换行及时间字段同步；真实网关取值仍须IT联调。
- 最新需求9.34：仅已采购待发货procurement_shipping把创建时间改为采购付款时间procurementPaidAt。取真实采购付款，不取到期日hzkj_paydate、单据创建/审核/回调时间或客户收款；多笔有效且尚有待发货义务的已付采购取最早付款，已全发/取消/退款记录排除。已确认>24小时橙色、>48小时红色（不是487）；恰好24小时正常、恰好48小时橙色，缺失/非法/未来日期不误报；部分发货同理。页面每30秒及重获焦点更新时间，默认仍按客户收款时间升序。1688baseInfo.payTime源码可查询但本次未确认其FOP持久化字段，真实网关映射仍须IT联调。
- 最新需求9.33：所有待办清单已展示的履约单号、Shopify单号、配货单号、发运单号及每行商品SKU支持快捷复制原值，不包含标签、数量或跟踪类型。销售unpaid/review/exceptions及发运dispatch支持sortBy=consumerPaidAt；先授权筛选、完整排序再分页及导出。默认仍paidAt升序（最早收款在前）；C端时间同值按paidAt/id升序，缺失或非法时间双向均置后，不用其他日期填充。窄屏保留时间排序入口。
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

- 五类履约待办顺序：待审核(review)、待履约(dispatch)、待采购(procurement卡片)、待配货(allocation卡片)、待出库(shipping)。按2026-10-27需求9.13：已付有效订单中，review取未审核；dispatch须客户已支付、履约已审核，再取Shopify跟踪号待同步；成功完成上传及Shopify履约标记后退出；procurement合计未完成下单/采购付款与已采购待发货，不以履约审核作额外门槛。allocation/shipping仍须履约已审核且实际有效配货单allocationCreated=true；false/null不计入。各卡与同账号未临时筛选清单total同口径，按履约订单去重。

- 五类待办卡片、tasks、明细、搜索、分页与金额／数量合计统一先按服务端登录账号的业务范围和FOP白名单过滤。本人／部门／业务管理员分级不因系统管理员身份或全部岗位授权扩大；空白名单为零，未绑定或授权失败明确拒绝。专项验收D31，需求第9.1节。
- 协同岗位（销售总监、订单管理、采购、配货、发运、仓库）可独立配置“全部业务数据”（businessRole=admin），无需系统管理角色；FOP绑定用户仍需公司业务授权。五个工作台全部九类待办（含待支付、异常）支持departmentId＋ownerId筛选，先授权再部门/业务员筛选、合计和分页；默认按paidAt升序/id升序，表头可切换paidAtOrder=asc/desc，排序前置于分页、同时间id升序且缺失日期始终最后，不以createdAt替代。部门与业务员选择跨搜索/翻页/刷新/工作台待办保留；切换部门清空业务员并回第一页。salespeople选项仅来自当前可见订单、受部门限制，独立于队列/搜索/分页；ownerId按订单owner.id匹配，不能授予权限；两种Excel导出同筛选；search支持业务员展示姓名（owner.name优先，空缺才用salesperson）、中文/英文部分匹配且忽略英文大小写，与ownerId和部门取交集；Demo订单归属销售员工，协同人员不模拟为客户归属业务员。

- 待办工作台按最新需求9.14仅查看与跟进；履约审核、配货审核、人工配货及释放、采购/发运/出库均在FOP完成。移除工作台审核入口，已有审核接口保留兼容与独立鉴权，不因隐藏按钮放宽权限。清单选择只用于Excel导出，保留旺旺催办（不自动发送消息）。商品列第二、复制、50条默认分页、手动/可见在线30秒刷新不变；refreshedAt仅BFF查询完成时间，不能承诺FOP生产同步水位。

- 工作台导航：岗位顺序与Dashboard卡片一致：销售（待审核）→发运（待履约）→采购（待采购）→配货（待配货）→仓库（待出库）；只展示已授权岗位，授权返回顺序不影响显示。各岗位待办清单在分析页之前；销售页签顺序unpaid待支付、review待审核、exceptions异常，再个人业绩及分析，但默认首页明确为review，不按第一个页签推导；采购procurement、配货allocation_review（已齐套未审核）、发运dispatch、仓库shipping。显式queue链接保留原目标。

- 采购待办用procurementProgress独立下单/采购付款事实；客户已付不代表采购已付。not_ordered/partial或ordered+unpaid/partial/refunded进入procurement（供应商已发但采购未付也保留）；ordered+paid且supplierShipment=pending/partial进入procurement_shipping。明确alibabaOrder=not_pushed/partial的已建采购单也留procurement并从procurement_shipping排除（包括付款unknown/not_required/paid）；两个页签互斥，未知本身不推断为未付；有效退款和取消重采按实际剩余义务归一。T32/H34继续核对。

- 配货只看结果，未齐套（含未配/部分配货）与已齐套未审核（默认）；均履约已审、allocationCreated=true、allocationReview=pending且outbound!=completed。发运单状态仅提示，不是行可见性门槛。齐套后仍可在FOP人工释放/配货，未审核前不按自动/人工划分。FOP审核履约后自动建未审配货单，定时按库存计算齐套；本版不新增自动建单失败和付款单生成/审核异常队列。

- 发运工作台以dispatchDocuments逐张显示发运单状态（暂存/已提交/已审核），替换客户支付状态，保留独立Shopify履约状态。读取hzkj_deliver_bill而非发货通知单；A/B/C归一，订单/发运权限及组织客户来源同时校验；null/缺失是待确认，[]仅确认无有效单据；多张单据不重复计订单，不按最高审核状态冒充整单。真实适配见9.6/12.3、T33/H35/D33。

- 仓库仅待出库：客户已付、履约已审、allocationCreated=true、ready+approved+outbound pending/partial；不再含已齐套未审核（归配货岗）。不以WMS已建单额外过滤。保留配货单状态列，移除冗余状态筛选；旧warehouseStage=all/pending_outbound等价，pending_review返回空并提供前端重置入口。卡片、tasks、清单及导出同口径。

- 最新清单规则见9.14：采购和配货各两页互斥、卡片取去重并集；配货不区分自动/人工，人工释放可从齐套未审回到未齐套；审核后退出配货进入仓库。采购已付且供应商全发后退出采购，未到货/库存不足继续由配货未齐套跟进。物流条件只限制实际推1688，采购申请/采购单准备允许先行。

- 销售待支付清单queue=unpaid继承sales角色及订单数据权限，未取消且paymentStatus=unpaid；退款/未知不得当未付，FOP明确待支付状态为hzkj_orderstatus=1。收款日期为空显示—，金额为订单应付金额而非已收款，不计入Dashboard原五张已付待办或回款。付款后退出本页、未审核进入review，依赖只读刷新。

- 工作台状态排序（需求9.9）：sortBy=paidAt/dispatchDocumentStatus/stockReadiness/allocationReviewStatus/allocationDocumentStatus/outboundStatus，sortOrder=asc/desc；默认paidAt兼容paidAtOrder。先授权/筛选后全量排序再分页；多发运单取最早明确阶段，任一未知则该订单待确认置后，[]明确未生成最前；状态同值按paidAt升序/id升序，未知和空日期始终最后。配货两页按stockReadiness（未齐套→已齐套）和allocationReviewStatus（未审核→已审核）独立排序；allocationDocumentStatus保留仓库展示及旧链接兼容；outboundStatus仅保留旧查询兼容，无表头入口。单排序不改变逐张单据展示、权限、合计或Dashboard默认顺序。

- 采购旺旺催办（9.10）：仅procurement_shipping行入口，按履约源单/分录→有效采购单→实际卖家hzkj_sellers_ww关联，禁止SKU默认供应商猜测。独立allowedPurchaseOrderIds与订单/本人部门范围同时满足；单对象自动尝试，多采购单逐单选择。打开前查最新事实与contactVersion，变更/撤权停止；只打开聊天不自动发消息/改业务状态。Mock mode=demo,url=null。FOP现成HTTP端点与客户端协议尚需H36确认，真实provider接入T34、验收D37。

- 9.11为保留兼容的审核API：原生hzkj_orders/hzkj_alloc_bill audit、独立approvalActions、版本/幂等/逐单授权等安全约束不变；当前工作台不调用。T35/H37/D38为以后启用写操作时的专项，不是本次只读跟进上线前置。

- 全部待办每页20/50/100，前端默认50，纵向平铺；API省略默认20兼容。业务员及部门在筛选右侧，仓库不再提供配货单状态下拉。汇率USD/原币四位（CNY为USD/CNY），API保留原精度。

- 所有工作台待办Excel导出（9.12）：所选当前页最多100笔＋全部已应用筛选跨分页；POST fulfillment-orders/export。复用清单读权、FOP白名单和员工/部门范围，输出前复核会话与授权，不要求approvalActions。XLSX订单/商品/说明三表，订单金额只计一次、按币种合计、UTC+8、文本编号防公式；上限10000单/50000商品行，超限413、选择失效409、禁止静默截断。真实生产联调见T36/H38/D39。

- 采购进度9.14新增purchaseApplication、alibabaOrder、logisticsGate（均可选，缺失归一unknown）；purchaseOrder本版明确为有效FOP采购单覆盖需求，未审单也属于已创建，不能用1688外部订单有无替代。物流条件仅解释待推1688采购，不进入采购筛选谓词；alibabaOrder明确未推完是独立待办依据；satisfied不等于有操作权/可推送。
- 后台物流门槛核对Purchase1688PushValidationService：源行hzkj_salbillnumber→hzkj_deliver_bill.hzkj_order_no；只取单头hzkj_logistics_orderno，非Shopify同步或物流明细追踪号。采购申请/采购单可先准备，实际推送仍检查采购审核C和防重复等条件。合并采购必须核对全部源履约单且不可泄露无权来源；生产映射与脱敏样本T37/H39/D40。

- Shopify履约状态最新确认（需求9.15）：正常业务仅pending待同步、synced已同步，无部分同步场景；not_required/unknown只保留不适用/事实未知语义。待履约仅paid+approved+pending，取得物流订单号后异步同步成功前仍留待办；非法partial拒绝503，不做旧场景推断。

- 采购状态表头筛选（9.16）：procurementStage用于两个采购队列，服务端先权限及筛选后合计/分页，两种导出同条件，错误队列/非法值400。采购申请与履约一对一，下游合并由FOP负责；不存在采购单部分创建正常场景，旧partial仅兼容待建采购单，新Demo和适配器不再产生。采购付款先有1688订单；全款库存无需重复采购，押金库存正常采购申请、执行量由FOP扣减，前端不重复扣减。

- 最新清单展示以需求9.17为准：状态筛选移至顶部同级；每单最多一项差异状态，固定状态不重复列出。taskStatus服务端先授权再筛选/合计/分页/导出；旧procurementStage保留兼容。采购协同门槛只在采购准备完成、1688待推时显示；多发运单最早进度、任一未知待确认，详情折叠。

- 发运展示最新补充9.18：独立发运单编号列，状态直接显示未创建/暂存/已提交/已审核/已同步，不折叠显示编号。已同步由全部有效关联单审核C和Shopify成功事实共同派生，不改原始A/B/C审核枚举。最新9.26：待履约任何查询、看板与导出均排除已同步，dispatch_synced在发运队列拒绝400，旧前端链接清除；dispatch_approved仅显示已审核未同步，以柔和红色danger呈现，不保留单独已审核选项。配货发运状态同步该派生顺序，其队列定义不变。

- 9.19清单布局：状态筛选在搜索前最左侧；发运及配货两清单状态仅结果，发运编号独立列。所有清单商品第二列合并名称/SKU/规格。Customer列为订单收货国家国旗＋ISO alpha-2，API shippingCountryCode来自hzkj_orders.hzkj_country.twocountrycode；缺失/非法为null，不取客户资料国家。Excel国家码及商品分组同步，权限/队列谓词不变。

- 9.20覆盖清单布局：客户紧邻店铺前，金额紧邻Shopify单号后；SKU旁展示单品数量，取消独立数量列。取消业务员下拉，保留搜索框姓名搜索与可清除的旧ownerId筛选。新增warehouseCode=HZ/SZ用于全部队列及Excel，省略全部；search包含物流商名称/代码。授权后筛选再合计分页，Dashboard不变。清单禁止横向滚动：宽屏换行表格，窄屏所有字段分行显示。Demo客户名称不拼业务员名。

- 发运待履约状态筛选仅未创建/暂存/已提交/已审核未同步；配货协同保留未创建/暂存/已提交/已审核/已同步。两者均移除“待确认”。unknown仅用于原始数据异常防御，不是可筛选业务状态；相关队列taskStatus=unknown返回400。

- 2026-10-27：所有待办商品图片支持悬停放大，Customer 国旗下显示该履约订单收件人姓名并可打开联系方式/地址详情。`shippingRecipient` 按订单授权后返回八个允许字段；FOP 源为 `hzkj_customer_first_name/last_name`、`hzkj_phone/email/state/city/post_code/address1/address2`，不是客户或业务员信息。保持无横向滚动；收件人信息不加到 URL/日志/默认 Excel；切换账号、订单不可见时清空详情。

- 2026-10-27最新展示：待采购字段/筛选/Excel列名统一“采购进度”；删除物流条件待确认、部分采购付款选项。旧supplierPayment=partial兼容为待支付采购款，物流事实未知但明确未推1688仍显示待推1688采购，不等于允许推送。图片改悬停静态完整大图，无放大镜/局部动态；全局查询框上限360px、Shopify列88px、长商品名单行省略且保留完整title。

- 2026-10-27：销售待支付/待审核/异常清单及发运待履约清单“创建时间”改“C端下单时间”，API独立consumerPaidAt表示消费者在Shopify首次完成订单付款时刻，按UTC+8展示/导出；采购、配货、仓库清单仍使用createdAt。与B端履约收款paidAt严格独立；无值显示—不回退。FOP现有hzkj_datetimefield来自Shopify processed_at，仅订单处理时间，不能未经核实当首次付清；真实来源/持久化由IT补齐，见需求9.23。

- 2026-10-27：销售review待审核清单在发货仓库后增加实际物流渠道，logisticsChannels数组同格显示名称（编码），多渠道分行。主取订单hzkj_logistics_info.hzkj_channel.name/number；仅单包裹历史空分录可回退表头hzkj_logistics_channel。禁止以自定义渠道、物流商或发运回写字段替代；先授权后输出name/code，缺失为null。真实网关映射待IT联调，见需求9.24。

- 2026-10-27需求9.25：unpaid在发货仓库后显示自定义物流渠道名称customLogisticsChannelName，取FOP自定义渠道已维护的英文名称，固定英文，不随界面语言切换。现有OrderController键hzkj_customer_channel_name是通用名称，具体英文字段/语言键需IT联调核实；缺英文返回null，不回退中文或翻译。unpaid搜索以此名称替代carrier/carrierCode，公共关键词保留；其他队列仍搜物流商。全部待办及订单/回款/运费明细字段名统一发货仓库、业务部门，接口warehouseCode/departmentId不改。两种Excel同范围与文案，真实网关映射待联调。

- 2026-10-27需求9.27：dispatch清单/Excel将物流商与跟踪号合为物流信息；logisticsInfo按发运单/包裹保留carrierName与trackingNumbers(type full/first_mile/last_mile, number)。同组服务商在上、类型：号码在下，不跨组配对；旧字段兼容但不猜类型。Helper确认全程hzkj_logistics_orderno、尾程hzkj_logistics_trackno，hzkj_upload_no是上传全程偏好；Sunyou内部syOrderNo排除。头程来源待IT确认。全局业务标题说明使用InfoTip，保留错误/操作提醒/业务数据直接可见；队列权限及计数不变。

- 2026-10-27需求9.28覆盖9.27：待履约只显示每组FOP按业务员报价配置选定上传Shopify的shopifyTracking(type,number)，TC头程/WC尾程/QC全程；raw trackingNumbers和legacy trackingNumber不作为选择回退。主物流号hzkj_logistics_orderno可为头程或全程，尾程独立；报价字段、类型判别及最终选择由IT人工联调，前端不猜、不改生产FOP。业务筛选仅营销中心直属业务一至四部，其他组织不入选项；授权和既有订单不因收敛选项被删除。标题提示改柔和细线问号，号码单行。

- 同名节点补充：营销中心→业务一部→业务一部的末级节点不能成为另一个业务部门选项。Demo按直属节点归一业务部门ID，完整员工祖先路径仍用于权限；真实网关需遵循同一规则。

- 最新需求9.29：采购筛选只提供待建采购订单、待制作发运单、待推1688采购、待支付采购款、采购退款待跟进。用户确认履约审核后自动创建采购申请；未建采购单直接purchase_order_pending。采购单已建且1688待推时，pending_dispatch/pending_logistics统一dispatch_preparation。删除申请待建/待确认筛选，已采购待发货保留独立页签，不新增采购筛选项。其他队列及Dashboard不变。
- 9.29覆盖此前销售清单只读约定：仅销售review恢复单笔/多笔审核，复用审批preview/submit、独立approvalActions、版本与幂等。配货等其他清单不恢复审核。T35/H37/D38重新成为销售审核生产上线前置；网关未配置不能假成功。审核弹窗期间暂停刷新/导航，关闭结果后刷新，旧登录会话禁止提交。
- 全局业务部门默认项文案“营销中心”，仍为空departmentId与原数据权限；物流跟踪号快捷复制仅number，保留前导零、不含TC/WC/QC或物流商。

- 最新需求9.30恢复配货allocation_review单笔/批量审核，覆盖9.29“配货审核不恢复”。按用户最新确认，一笔履约订单唯一对应一张配货单，无一对多或多对一。该页使用allocationDocument.id/number展示单一配货单号（例如AO261028000404），审核对象为该配货单hzkj_alloc_bill，不是履约订单；数据缺失为null/—不猜编号，审核前必须确认唯一关联。
- allocation_review发运单状态/筛选改dispatch_incomplete未完成、dispatch_complete已完成；非空有效关联发运单全部approved才完成，不依赖Shopify同步。未完成记录仍保留，队列与Dashboard不变；未齐套及待履约清单保留原细分状态。
- 配货审核沿用preview/submit queue=allocation_review与独立权限、版本、幂等、逐笔结果；BFF每次写前复核发运制作完成。FOP原生validateForAudit/validateDeliverBills负责对应包裹、有效性、重复发运单与齐套审核等原子校验。T35/H37/D38同时为销售/配货审核生产上线前置。

- 最新9.36：销售待审核后增加独立备货清单，全部有效单含已采购/已入库、未付款（paidAt=null）且排除取消；不混入履约queue/看板。独立allowedStockOrderIds/allowedStockInventoryIds与本地范围求交。库存以客户当前归属、客户+SKU+仓库聚合，全款/押金分别可用/锁定，在库=可用+锁定（FOP available已扣锁定）。备货店铺源未找到，待IT确认，允许null；员工网关待发布，见需求9.36。

- 最新9.37：采购工作台独立stock_procurement页签，stock-orders/export queue=procurement仅采购岗位+paid+approved+unpurchased/partial/purchased（9.43扩展）；all为销售全部有效。库存customerId可选、customerSearch+SKU模糊查询、多客户完整过滤分页，sales/procurement及独立库存授权共同生效。原FOP客户必填API需网关扩展，不得截前100。待采购履约列表reviewedAt为真实订单审核时间、可排序，默认paidAt不变；缺失不回退，真实字段映射待IT核对。详见需求9.37。

## 2026-10-28：待办摘要与配货即时库存

待办顶部使用固定高度已应用筛选条件摘要，保留清单标题一个刷新入口；不要显示Demo/Mock说明。未齐套即时库存用户确认口径为“公共库存＋对应客户专属库存”，选单由服务端解析SKU/客户/仓库，无选单必须SKU搜索。独立allocationInventoryScopes授权，完整快照才能补零，错误或无权不能补零。FOP AllocationInventoryPoolService读取实物库存，AllocationBalanceService读取占用，AllocationStockBudget另有全款保护；页面余量不等于可配量。现有InventoryController#getInventoryList为占位返回；真实网关/api取值/SLA需IT联调，详见需求9.38。

- 2026-10-28 最新界面约定覆盖旧版标题 InfoTip 规则：全局页面及区块标题移除问号和解释文案；仅工作台待办清单在标题下保留简短、自然换行的业务说明。已应用查询条件、字段含义、错误与操作反馈不作为标题说明删除。待办查询摘要与页签之间保留 24px 间距，摘要高度固定；订单编号（含备货单号）列单独居中、左右留白，完整编号与勾选/复制同一行，其他列不改对齐方式。

- 最新需求9.39：所有工作台页签固定保留76px摘要框和24px页签间距；待办展示已应用查询，分析页展示统计范围说明（不能冒用未实际传给图表的待办筛选）。刷新统一浅蓝，标题使用简短行文案。shipping显示wmsCreatedAt=WMS出库指令成功推送时刻，独立于createdAt；缺失null不回退、队列及收款排序不变、Excel同源。FOP 4PX成功回写hzkj_deliver_order.hzkj_bill_create_time；疾风成功分支仅写hzkj_is_push，本次未确认出库时间回写，须IT联调，JfService的入库时间不可混用。

- 最新需求9.40：十一类清单统一WorkbenchTaskHeading；查询（含库存弹窗）使用workbench-primary履约蓝，备货单号使用color-chart-link。所有岗位页签固定摘要，无标题问号。OpenAPI版本2026-10-28-workbench-delivery，41操作169模型；销售/配货审核已恢复，旧只读入口说明是历史。HTML精简交接入口docs/analytics/WORKBENCH_DELIVERY_BRIEF.html。

- 最新需求9.41：即时库存入口扩展至warehouse/shipping。原query接口可选queue=allocation|shipping，默认allocation兼容；服务端映射配货/仓库岗位并校验对应队列+订单读权+本地范围+独立allocationInventoryScopes。选单必须仍在对应队列，已出库或失权整体409；无选单非空SKU搜索，不自动全库。库存口径及生产网关待联调边界不变。未齐套说明“可按选中订单查询即时库存”，已齐套未审核追加“请及时处理未完成的发运单后审核配货单。”

- 最新需求9.42：销售备货清单增加备货订单状态orderStatus及筛选（unpaid/paid/approved；事实不足或矛盾null）；paid特指paymentStatus=paid且reviewStatus=pending，approved须两者已付+已审。查询/合计/分页/两种导出同条件，采购待备货不重复固定状态列。用户确认支付后才可审核、审核后备货在途权益可用；不等于物理库存可出库。源码目前确认下推已付已审校验及采购入库增量，审核即开放在途链路未完全核实，IT需样本验证；不修改FOP或库存算法。

- 最新需求9.43：“备货待采购清单”统一名称，放在履约“已采购待发货”后；queue=procurement备货纳入unpurchased/partial/purchased（客户已付、备货已审且有效），shipped/received退出。purchased展示“已采购待发货”，不代表采购已付款；FOP markPurchased采购数量形成即可置2。所有十一类待办导出交互按9.44：点击直接导出，有勾选selected、无勾选filtered，授权/全量筛选/输出前复核不变。

- 最新需求9.44：销售备货类型筛选在状态筛选前；两类备货库存查询在操作栏最左侧。导出Excel取消菜单，有勾选直接selected，否则filtered全部已应用筛选跨页，清空勾选恢复filtered。Dashboard仅保留刷新状态，同时刷新接入状态、卡片及业务图表，主数据请求中禁用重复刷新；原接口/权限不变。

- 最新需求9.45：两类备货支持sortBy=paidAt/orderStatus/purchaseStatus及sortOrder，默认paidAt升序。状态按业务阶段（采购已发货先于已入库）升降序，未知双向最后，同状态paidAt升序/id升序；授权筛选后完整排序再分页及Excel。标题说明“在途可用”；全待办摘要维度细竖线分隔两侧14px，76px固定高度。

- 标题说明最新展示约定：全部待办标题下说明固定单行，溢出省略号，悬停显示全文；覆盖此前自然换行规则。

- 个人收款与毛利：selectedOwner为空时使用选择业务员/无可用业务员状态，隐藏全零分期及无效明细入口。选定后按原期间及权限展示收款/毛利弹窗，范围信息可见；不得自动选择首个业务员或放宽访问范围。

- 最新9.46：备货状态/类型标签统一12px并适配深浅主题。个人业绩业务员下拉固定168px、仅姓名，明确选全部传ownerScope=all，与ownerId互斥；仅canSelectOwner账户可用，本人范围请求403。全部仍取账号/部门/逐图及FOP独立收款毛利白名单交集，不是公司完整汇总保证；query.ownerScope=all时selectedOwner=null可正常展示统计与明细，其余null保留选择提示。默认绑定本人、跨账号清理、独立逐账号业务数据配置均不变，不自动给管理/协同账号扩权。


### 待办样式及毛利结算号约定（2026-10-28）

履约/备货待办统一复用 WorkbenchListActions、WorkbenchExportButton、WorkbenchStatusBadge 和 workbench-list.css，勿在单页重新定义同类工具栏背景、按钮或状态字号。毛利明细仅展示 settlementNumber（FOP 订单结算分录 hzkj_gp_settle_bill），不以内部 settlementId、版本、截止时间代替；缺失或预计显示 —，核算原字段保留。


- 需求9.48：采购状态颜色按处理优先级统一，销售备货/采购备货共用StockProcurementStatus，未采购和部分采购均info柔和蓝色；SupplierShipmentStatus是履约/备货待发货唯一展示组件，正常success、真实采购付款>24h warning、>48h danger。stock purchased/shipped文案与履约一致，列表/筛选/摘要/Excel同步。StockOrder.procurementPaidAt可选且独立于客户paidAt，缺失/非法/未来不误报；不可捏造FOP实际付款时刻。备货类型全款用info浅蓝、押金用neutral灰色，分类标签不使用警示色。
