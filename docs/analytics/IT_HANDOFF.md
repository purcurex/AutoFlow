# HyperZone 分析与销售工作台 IT 交付入口

Shopify状态补充（需求9.15，接口版本2026-10-27-procurement-filter）：仅待同步/已同步，无部分同步场景；待履约=paid+approved+pending。物流订单号不替代Shopify成功回执；前后端、Demo及导出已同步，生产适配须移除partial并提供异步待同步/成功/失败待重试样本。


更新日期：2026-10-28（UTC+8）。最新修订五类履约待办：待审核、待履约、待采购、待配货、待出库；完整需求第9节（含9.1登录用户数据范围）、源码映射第12节及T31/H33/D30–D31为新增对接入口。最新追加P0全局图表授权及员工数据隔离，完整需求第1.1–1.3节优先约束全部图表。本次在原有全量需求上追加销售个人收款／净毛利月、周、天统计；注册、部门／业务员回款、订单量、客户分析、物流运费、权限和全部历史待办保留。

采购状态补充（9.16）：GET清单与POST导出均新增可选procurementStage；先权限及条件取交集，再合计/分页。表头选择回第一页，搜索/翻页保留，切换清单清空。采购单部分创建只保留旧接口兼容，不是新FOP场景；真实关联与备货处理按9.16交付。

## 最新版本：2026-10-28 · 采购状态与业务员范围（9.46）

- **最新增量以需求9.46（采购状态可读性、业务员全部查询）、9.45（备货状态排序）、9.44（直接导出与Dashboard单一刷新）、9.43（备货待采购及统一导出）、9.42（销售备货订单状态及筛选）、9.41（仓库即时库存）及9.40（十一类清单视觉统一、接口基线核对）及9.39（全页签固定摘要与WMS创建时间）为准；9.38（筛选摘要与配货即时库存）继续有效；9.37–9.35继续有效，9.34采购付款提醒、9.33复制/排序及此前未被覆盖的规则继续有效。** 保留九队列、五卡和原ECharts结构；采购准备不限物流，物流条件只针对实际推1688；配货只看未齐套/已齐套未审核，已审核未出库归仓库。
- 新增ProcurementProgress.purchaseApplication/alibabaOrder/logisticsGate，缺失unknown；明确1688未推完仍保留待采购并排除待发货，物流条件不限制清单；purchaseOrder明确表示有效FOP采购单覆盖数量（含未审单），1688成功单据另看alibabaOrder。IT需按更新的字段级语义适配，不复用旧“申请已审=采购已下单”的粗状态。
- 销售review和配货allocation_review支持单选/多选审核，T35/H37/D38为两类审核生产上线前置；配货审核要求发运制作完成。独立操作授权、刷新、复制、查询、旺旺催办和两种Excel保留。
- 已齐套未审核不因发运未审核而隐藏；人工释放回未齐套；审核后到仓库，不以通知/WMS生成作为额外可见门槛。已出库而Shopify未履约仍留发运。
- 先完成T31–T33的真实事实与权限映射，再T37/H39/D40的新进度/正常状态覆盖与刷新延迟验收；旺旺T34、导出T36分别验证。后台自动建单失败、付款单生成/审核不新增工作台。
- 41项平台操作、169个模型；warehouseStage=all/pending_outbound取已审未出库，pending_review为空；本人/经理/全量权限与聚合方式不变。

## 2026-10-24 工作台协同补充

- 五个岗位工作台的九类待办共用部门及业务员筛选（departmentId/ownerId）；salespeople返回当前权限与所选部门内的订单业务员，ownerId精确匹配订单owner.id，search也支持展示业务员姓名部分匹配（owner.name优先，空缺取salesperson；先授权、去首尾空格/忽略英文大小写）；切换部门清空业务员，切换待办保留选择，列表/合计/两种Excel导出同范围，收款日期默认正序、表头可切换倒序；完整规则见需求第9.2节。
- `fulfillment-orders` 接受 `departmentId` 和 `paidAtOrder=asc/desc`（默认asc），响应为 `FulfillmentOrderPage`，增加 `departments[].id/name`。Mock 与正式预留接口同结构；部门选项从已授权订单生成。生产查询须先授权和筛选，再按 `paidAt ASC, id ASC` 分页，缺失日期最后；合计覆盖完整筛选集。
- 协同人员账号使用独立“全部业务数据”范围，无需系统管理员权限；业务员本人、经理部门规则保留。请核对具体协同账号名单及 FOP 权限，不按岗位名称自动批量扩大权限。
- 已核对销售部门 `hzkj_orders.hzkj_dept`、收款日期 `hzkj_receipt_date`；IT 需确认稳定部门ID、祖先路径和分次收款语义。真实FOP接口仍待接通，本地验证基于Mock和隔离测试。


## 阅读顺序

先阅读 [精简交接报告](WORKBENCH_DELIVERY_BRIEF.html)：核心风险、FOP可能改造和未完全确认事项。历史章节保留演进证据；现行审核规则以9.29–9.31为准，展示与时间列以9.40为准。

1. [完整需求HTML](HYPERZONE_ECHARTS_API_REQUIREMENTS.html) 或 [完整需求Markdown](HYPERZONE_ECHARTS_API_REQUIREMENTS.md)：业务、页面、字段、审计与验收的全量交付。源正文为 [REQUIREMENTS_OVERVIEW.md](REQUIREMENTS_OVERVIEW.md)，个人收款／净毛利在第8节。
2. [OpenAPI](../openapi/hyperzone-analytics.openapi.json)：41项平台HTTP操作、169个模型，servers为`/api`；不是FOP原生接口目录。包含逐图授权、员工创建／编辑／导入／归档／账号维护、内部FOP授权、客户当前归属和独立组织汇总字段契约。
3. [FOP源码映射](HYPERZONE_FOP_SOURCE_MAPPING.md)：实体／字段／Java行号证据。第9节是物流成本，第10节是月结毛利、预计贡献和当前数据缺口。
4. [后续待办与人工核对](FOLLOW_UP_CHECKLIST.md)：完整T01–T37、H01–H39、D01–D40；最新权限任务为T27–T30/H29–H32/D23–D29，按模板分配、回填和关闭。
5. [验证记录](VERIFICATION.md)：仅此处记录实际执行的测试、HTTP、浏览器、生成物检查与限制；文档或Mock存在不能替代验证。详细消费检查见 [前端审计](ECHARTS_FRONTEND_AUDIT.md) 和 [后台契约审计](ECHARTS_BACKEND_CONTRACT_AUDIT.md)。

6. [员工与登录账号管理](../EMPLOYEE_ACCOUNTS.md)：管理员新增员工、所属部门、普通账号、FOP绑定及身份映射待办；完整需求第1.4节及OpenAPI同步更新。

## 当前交付边界

| 层次 | 本次范围 | 不代表已经完成 |
| --- | --- | --- |
| 平台前端／BFF | 销售工作台、月周天、授权人员、独立收款／利润、图表统计、分页明细、来源与错误状态；源代码及契约同步 | 生产FOP已连接、正式员工授权已导入、真实数据已财务对账 |
| Mock | 演示审核月结delta、预计贡献、跨期调整、无日分配及权限边界 | 可从现有FOP实时服务直接取得同样完备事件，或历史预计毛利已经可复原 |
| 原FOP后台 | `/Library/VSCode/dtr5b`只读核查；确认月结、快照、业务字段和已知缺口 | 本次已修改／部署FOP生产实现，或Java服务名就是可调用HTTP URL |
| 验证 | 实际结果由VERIFICATION回填 | 未执行的测试通过、真实FOP联调或生产上线完成 |

真实provider、授权解析和正式组织同步仍是独立实施工作。未配置／上游故障保持403或503等明确状态，不得自动回退Mock或全量管理员数据。

## 必须保持的财务与时间规则

- 收款沿用方案2：已支付且两类审核合格的履约／全款备货实收，按 `paidAt` 的UTC+8日期归期；排除押金备货及样品。使用已全款备货库存不补回产品款、不重复收款。
- 利润采用净毛利的期间贡献，独立 `recognitionMonth/recognitionDate`；已审月结用冻结CNY净毛利delta，不累计多版整单毛利。相同订单同月结算替换预计，跨期调整保留各自月份。
- 未结算必须使用预估运费及本次查询asOf已知收入／成本；不能因为当前取得实际运费就改变未结算口径。缺关键事实不能默认为0。
- 已结算／预计分别汇总，不合并总利润。完整月可用无日归属月结；周／天／部分月返回null和待拆分，月结参考单列，不均摊。
- 新查询不接受历史asOf回放。历史range可展示截至当前查询已审核的历史月结，不能声称恢复历史审批状态。预计日周需要有发生／known／approved时间的事件台账或可靠快照差分，不能累计每日存量快照。
- 金额统一USD、明确原币及FX日期／来源；CNY已审原值不重写。收入调整和备货转入各计一次；成本分类互斥；`previousRecognizedProfit`与可审计 `roundingAdjustment`保证期间delta可核对，尾差绝对值不超过0.10 USD。
- 权限必须分别校验receipts与sales_profit scopes及对应IDs；系统管理员、订单可见、运费可见都不自动授予利润可见。冻结业绩归属与当前查看权限分开。

## FOP及平台后台剩余实施顺序

1. **协议和授权：T21/T25。** FOP提供只读发布接口、版本、分页及真实用户授权；IT提供账号—租户用户—业务员工—部门映射。先验最小权限，再读金额。
2. **权威月结：T23。** 读取C审核月结和订单版本，验证净毛利delta、冻结业务员、结算月、审批/cutoff；规范同月多版本；无日分配保持null。
3. **预计贡献：T22。** 补事件台账／快照差分。现有实时入口运费缺失按0、采购无cutoff、备货未使用cutoff、仓储不按通知日截止，不能直接复用为预计日报。
4. **金额及FX：T24。** 核对调整、退款、退货、采购调价、物流补退费和库存使用；审计冻结CNY至USD及分量尾差，不以Rmb变量名猜原币。
5. **真实对账：T26。** 按D16–D22和AT-18–AT-24验证收款、月结、预计、权限与页面，并回归既有图表。完成后再按T15安排生产切换和回滚，不预设上线时间。

## 需要交接的输入清单

| 输入 | 回填编号 | 最小产物 |
| --- | --- | --- |
| 正式只读接口与部署版本 | H01、H23 | URL/方法/字段/认证交接位置、分页和错误码、完整脱敏样本；不在文档填写凭证 |
| 利润权限与人员归属 | H03、H04、H28 | 稳定员工和组织ID、独立利润授权、经理后代范围、转岗／离职及两名不同权限用户预期 |
| 月结版本与日分配 | H23、H25 | 首结／重算／零差额／草稿／跨期负调整、C审核和时间、冻结归属、是否存在权威日分配 |
| 预计事件和预估运费 | H24 | 发生／known／approved时间、cutoff、预估字段币种与版本、采购／使用／仓储历史来源 |
| 收入成本和备货调整 | H26 | 调整／退款／退货／调价／重派／使用退回的ID、关联、方向、状态、时间及对账等式 |
| 冻结CNY与USD汇率 | H27 | 原额、各分量、历史取价日／来源、汇率和尾差规则，以及正／负／零真实样本 |

每项资料标注答复人、环境、版本、日期及差异处置。资料已提供、接口可调用、Mock已演示和真实财务验收是不同阶段；仅在对应证据齐全后关闭清单。

## 同仓库最新客户开发功能

交付代码已普通合并远程`8172a96`的1688寻源功能，保留远程实现与历史。客户开发／寻源专项设计与执行记录位于 `docs/superpowers/specs/` 和 `docs/superpowers/plans/` 的2026-08-03至2026-08-05文档；其外部供应商接口不在当前FOP分析及权限HTTP契约内。最新权限集成验证843项及本地数据库迁移记录见VERIFICATION.md。IT应按package-lock安装依赖，并应用随工程附带的数据库迁移。

## 图表权限本轮交接

采用岗位模板＋账号例外；普通员工本人、经理部门成员，个人工作台默认本人。图表可见、业务记录、组织汇总、明细／导出分别校验。原有ECharts结构保留。IT先核对员工/FOP身份与客户归属，再接独立组织汇总许可，最后执行跨账号排名、趋势与明细对账；不能因个人看不到其他成员而将部门完整合计替换为个人小计。新增待办T27–T30、人工核对H29–H32、验收D23–D29见FOLLOW_UP_CHECKLIST。当前Mock及本工程权限实现不表示正式FOP汇总接口已发布。

新FOP适配器继承 `FopDataProvider.customerOwnershipMode=current_required`，订单／收款候选必须携带 `currentCustomerOwner`；缺少时明确失败。仅显式选择 `legacy_historical` 的旧适配器可使用历史归属兼容，并返回归属来源提示。组织汇总必须实现 `getOrganizationSummary` 并取得 `organizationSummaries` 独立许可，不能用当前员工的订单明细拼成部门完整业绩。

部署前先备份账户库，再应用 `1784733000000-AddChartPermissions`；默认空数组继承模板。非空逐图配置存在时，迁移拒绝回滚，避免静默丢失限制。配置入口：系统管理员侧栏“账号与权限”→“配置图表权限”；不需要给普通员工系统管理权限。部署后按D23–D29验证直接接口访问、跨账号缓存、客户移交及经理本人默认。


## 只读待办与同步验收补充（2026-10-24）

需求第9.3节规定全部待办只读、商品第二列、订单号复制和2–3商品Demo。`FulfillmentOrderPage`新增必填`refreshedAt`，仅代表BFF完成取数，不是FOP状态提交/同步水位。每个工作台手动刷新、可见且联网30秒轮询，返回页面或恢复网络即刷新。FOP适配仍需发布真实只读HTTP查询，检查权限后读取已提交进度；如采用缓存必须提供可验证的同步水位及滞后监控。联调须实际在FOP完成各环节后核对待办进出、筛选合计、末页回退与撤权，不以静态Demo验证替代生产时效验收。


## 采购进程交接补充（2026-10-24）

待采购清单已改为采购订单状态＋供应商发货状态。新增`procurementProgress.purchaseOrder/supplierPayment`，展示下单与采购付款独立事实，客户付款不作为供应商付款依据。完整需求9.4、源码映射12.1、OpenAPI `ProcurementProgress`、后续T32/H34/D32为本次入口。未接真实FOP，线下采购下达证据、部分付款/混单/取消重采及退款归一化仍需样本确认；旧provider缺字段显示待确认，不能作为生产接入已完成。

配货清单补充见需求9.5／源码映射12.2：拆分“未齐套清单”和“已齐套未审核”两个页签，默认已齐套未审核；均分列显示发运单状态、配货状态（未齐套/已齐套）与配货单状态（未审核/已审核），未知仍待确认，隐藏客户支付状态。沿用stockReadiness/allocationReview，FOP available可配货不得冒充completed已齐套；真实归一继续T31/H33联调。


发运清单补充见需求9.6／源码映射12.3／OpenAPI `DispatchDocument`：发运单状态（暂存/已提交/已审核）替换支付状态，多张发运单逐单展示；保留独立Shopify履约状态。BFF与Mock已支持`dispatchDocuments`，真实FOP状态/来源/权限及同步延迟按T33/H35/D33继续验证。

仓库最新规则见9.14：仅已审核未出库（含部分出库）；未审核配货归配货工作台，移除冗余仓库状态下拉，保留配货单状态列与旧查询兼容。Dashboard、tasks、清单、导出同范围。

工作台拆分见9.7及9.14：采购两页与配货两页分别互斥、卡片取两页并集；仓库仅已审核未出库。采购付款后转已采购待发货，供应商全发才退出；齐套后转已齐套未审核，审核后进仓库，人工释放可回未齐套。物流门槛不影响采购准备清单。

销售待支付入口见需求9.8/源码映射12.5：queue=unpaid复用sales岗位，页签第一但默认仍review；FOP需明确状态1，不能把未查到付款凭据直接归为未付。前端/BFF/Mock及OpenAPI已提供，真实状态/支付转换见D35。配货两页字段名统一为发运单状态。

状态排序追加（2026-10-25）：需求9.9/OpenAPI提供sortBy与sortOrder，兼容paidAtOrder；发运单依dispatchDocuments最早阶段归一，含未知则置后。配货新增stockReadiness及allocationReviewStatus独立排序，allocationDocumentStatus保留仓库和旧链接兼容；旧出库状态排序仅保留API兼容，不再提供页面表头，状态同值收款日期升序。已落地BFF全量排序后分页；真实FOP数据库分页需同等规则，联调D36。

采购旺旺催办追加（2026-10-25）：需求9.10/源码映射12.7及OpenAPI新增两条GET接口（查询联系人、校验后取唤醒地址）。BFF/前端/Mock已实现，真实FOP适配仍需T34；采购资源独立授权、多供应商关联及桌面旺旺实机验证见H36/D37。Mock只显示演示联系结果，不唤醒虚构账号，不自动发送消息。

审核兼容能力（原2026-10-25实现）：API与独立操作鉴权保留，但最新只读定位下工作台不再挂载审核按钮/弹窗。业务审核在FOP完成；T35/H37/D38留待未来恢复写入口时专项联调。

## 待办清单批量 Excel 导出（2026-10-26）

新增需求9.12：五工作台全部九队列支持所选（当前页最多100笔）与全部筛选结果（跨分页）导出。平台POST `/api/autoflow/integrations/fop/fulfillment-orders/export` 返回真实XLSX，含订单清单、商品明细和导出说明；查看权限交集、会话复核、状态变化409、超限413已落地。单次10,000单/50,000商品行；按币种合计且订单金额不重复。无需新增FOP上游写接口，继续由员工网关完整返回授权订单。生产跨员工/部门、下载过程中撤权、多币种、一单多品、上限并发及Excel/WPS验收见T36/H38/D39。接口清单现为36个操作、145个模型。


2026-10-27最新口径见需求9.14：五卡与九清单同一服务端谓词，实际配货单、Shopify回执、权限归一不变；采购准备不限物流，仓库仅已审核未出库。新增采购申请/1688/物流条件字段，未知不猜测。业务操作在FOP，本次未改FOP生产源码。

### 清单状态精简更新（9.17）
新前端使用taskStatus；状态、业务员、部门在顶部同级。采购阶段兼容参数procurementStage仍有效。请依最新OpenAPI校验队列和值组合，不在分页后过滤；同权限结果用于合计及两种导出。前后端workbench-status.ts为可执行归一参考，非FOP实体枚举。生产剩余工作沿用T37/H39并增加多单状态完整性和部分出库样本核对。
### 发运单编号与串行状态更新（9.18）

发运单编号直接读取dispatchDocuments[].number，独立列显示；发运单状态用原始审核事实与shopifySync派生未创建、暂存、已提交、已审核、已同步。按最新9.26，待履约始终排除完成记录，移除已同步查询；dispatch_approved在该清单显示已审核未同步，仅匹配全部发运单已审且shopifySync=pending。dispatch_synced在发运API/导出拒绝400，配货协同仍可使用。生产适配需确认同步成功与本地回写异常口径，不能用审核成功代替同步成功；API、Excel、分页与合计不得在分页后做状态筛选。

### 清单布局与收货国家更新（9.19）

国家字段新增 `shippingCountryCode`：读取履约订单 `hzkj_country.twocountrycode`，不得使用客户档案国家。对外规范为ISO alpha-2大写码或null，兼容旧适配器缺省。所有清单的Customer列显示国旗＋码，Excel输出码；SKU/规格合并到各商品名称下方，商品明细sheet仍保留独立字段。发运与配货清单编号独立、状态只显示结果；顶部状态筛选在搜索之前。请用US/GB/AU、缺省国家、多商品多单据和权限隔离样本联调。

### 工作台筛选与屏内展示更新（9.20）

清单/导出新增warehouseCode（HZ杭州、SZ深圳，省略全部），按订单发货仓库筛选；search增加物流商名称及标准代码匹配，保留业务员姓名查询。前端取消业务员下拉，旧ownerId筛选兼容并可清除。各字段顺序及SKU旁数量见9.20；Excel商品明细保留数值数量。所有字段不折叠、不横向滚动，按内容区域宽度分行展示。FOP适配需保证订单发货仓库和物流服务商映射准确，筛选在服务端授权后、分页前执行，联调两种导出与清单合计一致性。

### 2026-10-27 补充：图片放大与收件人详情

所有待办共用图片悬停放大及 Customer 收件人弹窗。请在履约订单适配器返回 `shippingRecipient` 八个可空字段，映射以 `HYPERZONE_FOP_SOURCE_MAPPING.md` 最新节及 OpenAPI `ShippingRecipient` 为准。只使用该履约订单地址，不查客户主档补齐；保持 FOP 白名单与业务权限交集。需要联调：多商品图片清晰度、老适配器缺字段、邮编前导零、电话国际区号、Unicode/长地址、刷新与账号切换后清理详情。当前交付含前端/BFF/Demo/接口契约，真实 FOP HTTP 接入仍由 IT 完成。

### 2026-10-27：采购进度选项修订

字段/筛选/Excel统一“采购进度”。接口移除taskStatus物流条件待确认/部分采购付款及旧procurementStage部分付款；非法旧值400。旧原始partial付款仍兼容归为待付，避免遗漏。物流未知但明确待推1688采购时只显示已知待推事实，FOP物流校验不放宽。新适配及Demo不产生正常部分付款场景。静态图片、紧凑查询及单号/名称样式见需求9.22。

### 2026-10-27：销售及待履约清单 C端下单时间

前端、BFF、Demo及Excel已支持`consumerPaidAt`，替换销售unpaid/review/exceptions及发运dispatch清单的创建时间展示；接口原createdAt/paidAt继续保留。**生产取数待办：** 当前FOP `hzkj_datetimefield`来自Shopify订单processed_at，不得直接当支付完成时间。请IT新增/确认首次付清事实存储，并通过既有可信`POST /fulfillment-orders`网关响应映射consumerPaidAt；未知返回null。先核对单次即时支付、延迟capture、多笔付清、付款失败、历史缺失、退款/补款、跨店同显示号及Webhook重放，再与UI/Excel按UTC+8逐笔对账。细节见需求9.23与源码映射最新节。

### 2026-10-27：销售待审核物流渠道

新增可空`FopOrder.logisticsChannels`，review清单与Excel在仓库后显示名称（编码）；Demo包含一单多渠道。IT需从履约订单包裹实际渠道name/number映射可信网关响应，单包裹历史回退表头规则按源码实现，不能使用自定义渠道或物流服务商字段。已核实OrderController查询字段但尚无该数组响应；请完成真实网关映射、权限与多包裹样本联调。详见需求9.24、OpenAPI LogisticsChannel及源码映射最新节。

### 2026-10-27：待支付自定义物流渠道与清单文案

请在可信履约订单网关把FOP自定义渠道已维护的英文名称映射为customLogisticsChannelName（string/null），固定使用英文，与界面语言无关。既有hzkj_customer_channel_name为通用名称，源码未显式选择英文；IT需核对实际英文字段或多语言键，不可直接取中文或误用国家英文名。英文缺失返回null，不自动翻译。待支付显示、搜索与两种Excel均使用该英文名称；其他队列仍按物流服务商查询。此搜索在本项目服务端实际实现，合计/分页/两种Excel同口径，按原数据权限限制；不是仅修改占位提示。所有清单字段统一发货仓库、业务部门，API warehouseCode/departmentId不改名。见需求9.25。

### 2026-10-27：物流信息与标题提示（需求9.27）

前端/BFF/Demo/Excel已实现待履约物流信息合并。IT需在可信履约网关返回可空logisticsInfo数组，按同一发运单/包裹关联carrierName及typed trackingNumbers。全程、尾程源码映射见最新源码映射节；头程独立来源待确认，未确认不输出first_mile。保留多组、前导零及同组不同类型号码，排除Sunyou内部ID。旧网关仍兼容无类型显示。待履约条件、授权、合计、分页与仓库列结构不变。

全局标题说明采用InfoTip：悬停、聚焦或点击读取，Escape/外部点击/滚动关闭；错误及操作提醒仍可见。验收需覆盖深浅主题、小视口、弹窗内提示、物流组缺值及两种导出。当前验证为本项目及Demo，生产FOP映射须单独联调。

### 2026-10-27：选定号码与四个业务部门（需求9.28）

最新物流契约以shopifyTracking对象替代全部候选号码展示。每组只有FOP按业务员报价配置最终选择的号码与类型，TC头程/WC尾程/QC全程；不可把主物流字段固定解释为全程。前端/BFF/Excel只读明确选择；旧候选数组或trackingNumber不会自动补成选择。请后续人工联调确认报价配置字段、主号类型、尾程及回退规则，最终与真实Shopify上传一致。取得号码与同步成功仍是独立事实。

业务部门选项仅营销中心直属业务一至四部且受数据权限限制；其他组织仍可在管理页维护。真实网关保证salesDepartmentCode、部门ID/名称及直属关系一致。更新后需联调四部查询、跨页合计与两种导出，确认未因隐藏选项遗漏原有待办。

- 同名节点补充：营销中心→业务一部→业务一部的末级节点不能成为另一个业务部门选项。Demo按直属节点归一业务部门ID，完整员工祖先路径仍用于权限；真实网关需遵循同一规则。

### 2026-10-27：采购筛选与销售审核（需求9.29）

采购taskStatus仅purchase_order_pending、dispatch_preparation、alibaba_pending、payment_pending、refund_pending。新的dispatch_preparation合并缺发运单与缺物流号；已采购待发货继续独立页签。全部业务部门默认文案改营销中心，权限与请求参数语义不变。

销售review恢复单选/多选审核；9.11既有审核合同现在成为销售审核生产上线依赖，原“前端不调用/暂非上线前置”对销售review不再适用。请按T35/H37/D38联调员工委托权限、原生audit、版本、持久幂等及逐笔结果。配货审核不恢复。UI/Mock和隔离HTTP验证不代表生产FOP审核已接通。选定跟踪号复制只含number。

### 2026-10-27：配货已齐套未审核（需求9.30）

allocation_review使用allocationDocument.id/number与单一配货单号列；按有效hzkj_alloc_bill的源履约关系取数，履约订单与配货单严格一对一，不按SKU或包裹拆成多单。示例AO261028000404。批量选择N笔订单最多审核N张配货单；调用hzkj_alloc_bill原生audit，不重复审核履约订单。

该页发运单状态/筛选改为dispatch_incomplete和dispatch_complete，后者要求非空关联有效发运单全部审核，不依赖Shopify同步。既有细分状态仅在该队列取消；列表/合计/排序/两种Excel一致，未完成记录不会隐藏，Dashboard口径不变。

配货审核恢复，T35/H37/D38也成为配货审核生产上线前置。真实审核必须使用AllocationAuditOpPlugin及包裹级对应发运校验，不直接改billstatus；需测齐套释放、发运撤审、混合可审/不可审、重复单、撤权、版本变化及后置通知失败。

9.31为最新字段修订：原未上线的allocationDocuments数组替换为allocationDocument可空对象；targets每个履约订单必须返回唯一配货单，且与清单ID/单号一致。审核前再次查询确认关联；生产需保证不存在跨订单共用配货单。一单多商品仍只有一张配货单。Demo与测试不代表真实员工审核网关已接通。

最新9.33：列表GET及Excel POST新增sortBy=consumerPaidAt，仅unpaid/review/exceptions/dispatch；缺省主排序仍paidAt升序，C端同值按paidAt/id，缺失双向最后。UI单号及SKU复制原值，无新增FOP端点。联调需核对跨页顺序、同时间稳定性、筛选导出一致及缺失值置后，不得只对当前页排序。

最新增量9.34：为procurement_shipping提供procurementPaidAt，真实1688付款事件来源baseInfo.payTime；需核实FOP持久化与网关，不能使用到期日hzkj_paydate。多有效未发货采购取最早实际付款，排除已发/取消/退款记录并按源履约分录和权限归集。用户确认>24h橙、>48h红；缺失不回退，不影响默认收款排序。


## 需求9.35交付补充：待办布局与配货时间

前端已统一业务员/部门两行、号码宽度、清空已提交关键词自动查询和仓库“全部”。两种Excel同样合并姓名/部门，不改变API独立字段和权限。allocation未齐套队列新增consumerPaidAt排序许可，服务端分页前排序；其他队列许可不扩展。

IT须在可信订单网关新增allocationReadyAt（可空ISO date-time），取已授权履约订单唯一关联hzkj_alloc_bill.hzkj_complete_time；仅当前齐套且有有效配货单时返回。核对苍穹DateTimeField时区后转换明确偏移，不能擅自把本地时间附加Z。没有值返回null；不回退创建/审核时间。FOP当前实现齐套写入、释放/未齐套清空，重配后以当前字段值为准。对外GET与所选/全筛选Excel一致；此前消费者首次付款完成时间映射工作同样覆盖allocation。验收释放后退出已齐套清单、未齐套显示C端时间、重配后新齐套时间、历史缺值—、权限隔离及默认收款排序。


## 最新增量9.36：销售备货与客户库存

销售待审核后新增备货清单，默认全部有效单（含完成采购、未收款）；独立库存弹窗分全款/押金可用、锁定、在库。前端、BFF、Demo及两种Excel已实现；接口入口为stock-orders/stock-customers/stock-inventory/stock-orders/export，同员工FOP前缀。上游待IT发布POST /stock-orders和/stock-inventory并补独立allowedStockOrderIds/allowedStockInventoryIds。详细字段见最新版OpenAPI和需求9.36。

交付前必须核实：备货店铺来源（允许null）；组合SKU分录；采购状态枚举；客户移交后的当前库存范围；库存锁定/释放及在库=可用+锁定；原接口按SKU分页到本项目按SKU+仓库分页的转换；真实仓库编码；上游无静默截断；数据时效。当前仅Demo完整可演示，生产接入未完成。


## 最新增量9.37：采购待备货与直接库存搜索

1. stock-orders及stock-orders/export新增queue=procurement（采购岗位），强制已支付+备货已审核+未采购/部分采购，原all仍为销售岗位全部有效单。新增paymentStatus/reviewStatus，兼容缺失归unknown且不得进入采购待备货；同独立备货授权、数据范围与Excel复核。
2. fulfillment-orders的procurement新增reviewedAt和sortBy=reviewedAt。前端列名订单审核时间，默认paidAt升序；审核时间不回退，空值两向最后。IT确认真实履约审核字段，不拿采购申请审核时间或其他单据auditdate替代。
3. stock-inventory客户ID改可选，新增customerSearch，可与search（SKU/商品）、warehouseCode组合。sales/procurement均可使用，按客户当前归属及独立库存资源过滤。响应customerId允许null；每行必须有客户信息。原stock-customers仅兼容，新UI不再选客户。
4. 多客户原生FOP接口尚不具备；网关需批量或完整遍历授权客户与全部内部分页，再按客户+SKU+仓库统一分页。不得受前100客户限制，也不能把无权限当无筛选。
5. 联调分别验收全款/押金、部分采购排除完成、权限转移、模糊多客户、SKU交集、仓库切换、分页总数、零库存、审核日期与撤审重审。运行端仍可Demo，生产接入状态未改变。完整合同见OpenAPI版本2026-10-28-stock-procurement-fuzzy-inventory与需求9.37。

## 最新增量9.38：筛选摘要与配货即时库存

接口版本 `2026-10-28-workbench-summary-allocation-inventory`。全部待办上方为固定高度查询条件摘要，清单单一刷新入口，不展示Demo/Mock说明。未齐套清单新增即时库存弹窗，支持选单与必填SKU搜索。

新增平台POST `/autoflow/integrations/fop/allocation-inventory/query`（实际URL带/api）；上游POST `/allocation-inventory`待IT实现。新增独立 `allocationInventoryScopes` 授权；不可复用订单白名单。公共与对应客户专属实物池分列，在库/配货占用/实物余量；只有完整成功快照允许缺失池补0。真实可配量受全款权益保护，仍由FOP决定。

研发交付：按完整需求9.38和OpenAPI AllocationInventory系列实现网关；勿使用InventoryController中占位getInventoryList。人工核对项见9.38末尾，前端与BFF已落地并不代表真实库存服务已联通。

- WMS时间交付：按需求9.39为履约清单提供wmsCreatedAt，列表/两种Excel同源，缺失为null。4PX候选hzkj_deliver_order.hzkj_bill_create_time；疾风出库时间原始事件尚需补齐/确认，不能用入库、订单创建或重试时刻代替。默认收款排序与待出库范围不变。


## 最新增量9.41：仓库即时库存

接口版本`2026-10-28-warehouse-inventory`；复用POST `/autoflow/integrations/fop/allocation-inventory/query`，新增可选queue=allocation/shipping（省略allocation）。shipping要求仓库岗位，选单必须仍为获权待出库记录；SKU搜索同样要求该岗位和独立库存池授权。请为仓库账号配置allocationInventoryScopes，并联调已出库409、无权403、零库存完整快照。上游库存合同未增加字段，实际余量不代替可配/可出库量。文案见需求9.41。


## 最新增量9.42：销售备货订单状态

接口版本`2026-10-28-stock-order-status`。BFF从paymentStatus/reviewStatus派生orderStatus=unpaid/paid/approved/null；paid仅已付未审。stock-orders查询及export同步接受状态筛选，销售清单/导出增加状态列，采购待备货不重复展示固定已审状态。顶部摘要、页码及选择同步，权限/队列不变。

业务确认审核后可使用备货在途权益；仍需IT定位审核开放权益、扣减占用、反审核/取消的完整实现与样本。不要将此权益当成已入库实物库存；本次不修改FOP或库存数量算法。详细边界见需求9.42。


## 最新增量9.43：备货待采购与统一导出

接口版本`2026-10-28-stock-procurement-export`；名称统一“备货待采购清单”，置于履约已采购待发货页签之后。stock-orders/export queue=procurement纳入purchaseStatus=purchased，仍要求客户paid+备货approved；shipped/received排除。purchased显示已采购待发货，不能据此推定采购已付款。导出交互以9.44为准：有勾选直接selected，无勾选直接filtered，两模式及授权不变。按需求9.43联调真实采购明细聚合与发货回写，核对筛选/导出同范围。


## 最新增量9.44：直接导出与单一刷新

接口版本`2026-10-28-workbench-actions`。导出按钮按点击时的选择生成selected/filtered请求，无下拉；无勾选导出全部筛选跨页。备货类型在状态前，库存查询入口在操作栏最左。Dashboard仅保留刷新状态，同时刷新状态与业务数据；不新增HTTP接口或FOP改造项。


## 最新增量9.45：备货状态排序与筛选摘要

接口版本`2026-10-28-stock-status-sorting`；stock-orders及export增加sortBy=paidAt/orderStatus/purchaseStatus（默认paidAt），状态按业务阶段排序、未知最后，同状态仍最早收款优先。分页和Excel同序，原权限和队列不变。摘要用竖线与留白隔开，说明“含在途量”改“在途可用”。不新增FOP接口；生产在途权益开放仍需按9.42核实。


### 9.46 账号范围与全部业务员查询

个人业绩汇总/明细新增ownerScope=all，与ownerId互斥；本人范围拒绝，管理范围仅汇总已经授权的记录。前端选项仅姓名且固定宽度；每账号继续独立保存本人/部门/全部/无权限以及图表权限。真实FOP联调重点仍是登录账号与业务员工masterid映射、独立收款/毛利白名单、撤权后响应取消，不新增生产业务写接口。


### 结算单号字段补充（需求9.47）

毛利明细展示 `settlementNumber`，请从订单结算分录 `hzkj_gp_settle_bill` 输出月结业务单号（来源为审核月结单 `billno`）。内部 `settlementId` 不变，不能替代展示单号；预计或历史缺失单号返回 null。工作台样式统一只影响展示，不改变权限、筛选、审核或导出规则。


### 备货待发货时长（需求9.48）

请在StockOrder返回可选procurementPaidAt：有效已付采购中仍有待发货义务的最早真实付款时间。来源和持久化按9.34/9.48人工联调，不能用客户paidAt替代；缺失返回null。采购purchased/shipped展示名称统一“供应商待发货/供应商已发货”，枚举值与队列归属不变。
