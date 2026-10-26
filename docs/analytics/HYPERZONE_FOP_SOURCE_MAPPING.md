# HyperZone FOP 源码字段与分析适配依据

更新日期：2026-10-23（UTC+8），保留2026-10-22原核查。源码目录：`/Library/VSCode/dtr5b`，原核查HEAD：`bd4c115c`（核查当前工作树，不代表生产部署版本）。仅阅读业务 Java、苍穹元数据与转换规则；未连接生产、未读取配置密钥、未修改FOP后端。

本文件区分源码事实、此次业务口径和仍待接口样本确认的映射。FOP 在本项目指金蝶苍穹上的 HyperZone 自定义应用。

## 1. 此次业务口径与已有报表的差异

此次用户明确：客户已支付且公司已审核的履约订单收款，以及**全款备货**订单收款计入月业绩；**押金备货**不计入。备货没有海外承运商；已审核履约订单的仓库、物流渠道由上游校验。履约使用已全款支付的备货后，产品款不会再次收取。

现有 `ReceiptPerformanceReportFormPlugin` 的事实基础很接近，但**不能直接把现有报表输出等同于此次需求**：

- 现有报表读收款单 `hzkj_receive_bill`，要求 `billstatus='C'`、`hzkj_receive_status='B'`，按 `hzkj_receive_time` 筛选。
- 它包含 `A=履约订单`、`B=样品订单`，另包含 `C=备货订单` 且源备货 `hzkj_stock_type='1'` 的分录。此次明确口径未包含样品，不应因旧报表包含 B 自动加入。
- 它明确使用分录 **`hzkj_samount` 订单金额**，并明确不使用实收金额。此次若采用“实收”口径，应独立映射实际金额字段。
- 它校验的是**收款单审核**；未额外查询履约源单 `billstatus`。不能据此认定源订单审核和收款单审核相同。

依据：[报表查询及状态](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/form/ReceiptPerformanceReportFormPlugin.java:178>)（178–310 行），[订单金额口径说明](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/form/ReceiptPerformanceReportFormPlugin.java:396>)（396–454 行）。

## 2. 已确认的实体、类型和状态

| 业务概念 | 原始实体/字段 | 已确认含义 |
| --- | --- | --- |
| 收款单 | `hzkj_receive_bill` | 单据头 `id`、`billno`；分录集合 `entryentity` |
| 履约/样品订单 | `hzkj_orders` | 履约单据类型 `hzkj_billtype.number='hzkj_orders_BT'` |
| 备货订单 | `hzkj_stock_order_new` | 单独实体，不能当履约订单计发货量 |
| 收款源单类型 | `hzkj_src_type` | A 履约、B 样品、C 备货、D 钱包充值、E 收款调整、F 售后 RMA |
| 收款分录源类型 | `entryentity.hzkj_entry_src_type` | 元数据规则随表头源类型赋值；不要假设任意历史数据已正确回填 |
| 收款分录源单 | `entryentity.hzkj_src_order` | 文本单号；转换规则从源单 `billno` 写入，不是源单主键 |
| 收款支付状态 | `hzkj_receive_status` | A 未收、B 已收、C 支付失败 |
| 审核状态 | `billstatus='C'` | 现有收款报表及备货下推校验明确使用 C 表示已审核 |
| 备货类型 | `hzkj_stock_type` | `1` 全款备货；`2` 押金备货 |
| 备货订单状态 | `hzkj_orderstatus` | `0` 已取消；`1` 待支付；`2` 已支付 |
| 履约收款状态 | `hzkj_orders.hzkj_receipt_status` | `0` 未收；`1` 已收 |
| 备货收款状态 | `hzkj_stock_order_new.hzkj_receipt_status` | 元数据 `0` 未收；`1` 部分；`2` 已收，与履约枚举不同 |
| 履约备货使用方式 | `hzkj_orders.hzkj_lock_store` | `0` 不使用；`1` 使用全款备货；`2` 使用押金备货 |

依据：

- [收款来源枚举](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_fund/metadata/hzkj_receive_bill.dym:1867>)（1867–1951 行）；[分录类型随表头](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_fund/metadata/hzkj_receive_bill.dym:1565>)（1565–1583 行）。
- [备货类型](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new.dym:3407>)（3407–3429 行）；[备货订单状态](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new.dym:3625>)（3625–3645 行）；[备货收款状态](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new.dym:2720>)（2720–2747 行）。
- [履约收款状态](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:6435>)（6435–6457 行）；[备货使用方式](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:7929>)（7929–7956 行）。
- [备货已支付且已审核校验](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/convertplugIn/StockOrderPushValidationPlugin.java:18>)（18–39、96–99 行）。这是下推采购/售后/调整单的校验，不是月业绩接口。

**状态适配注意：**PayPal 备货成功回调只在所读分支把 `hzkj_orderstatus` 改为 `2`，不能仅凭备货 `hzkj_receipt_status` 推定支付状态完整性。[回调证据](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/PaypalCallBackController.java:294>)（294–321 行）。

## 3. 金额应保留多个字段，不能混名

| 建议归一字段 | 原始字段 | 源码含义 |
| --- | --- | --- |
| `receiptHeaderAmount` | 收款头 `hzkj_rec_amount` | 实收金额 |
| `amountReceived` | 收款分录 `hzkj_real_receive_amt` | 分录实收金额；适合按源单、类型和权限拆分 |
| `amountReceivable` | 收款分录 `hzkj_samount` | 订单金额/应收金额；旧业绩报表使用此项 |
| `receiptOrderAmount` | 收款头 `hzkj_receive_amount` | 订单金额，不是实收金额 |
| `customerTotalPayable` | 收款头 `hzkj_total_payable` | 客户实付/应付总额；Stripe 计算为订单金额 + 手续费 |
| `handlingFee` | 分录 `hzkj_handle_fee` | 分录手续费；表头为 `hzkj_handling_fee` |
| `productAmount` | 分录 `hzkj_amountfield` | 产品金额 |
| `freightAmount` | 分录 `hzkj_freight` | 运费金额 |
| `fixedTaxFee` | 分录 `hzkj_fixed_tax_fee` | 固定税费 |
| `currency` | 收款头 `hzkj_receive_currency` | 实收币种；不能无条件把不同币种相加 |

依据：[收款头金额命名](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_fund/metadata/hzkj_receive_bill.dym:755>)（755–786 行）；[分录金额命名](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_fund/metadata/hzkj_receive_bill.dym:1067>)（1067–1116 行）；[币种与实收入账](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/fund/plugin/ReceiveBillOperationPlugIn.java:365>)。

在线支付成功时 `PayUtil.applyEntryRealReceiveAmount` 写入：

```text
分录实收金额 = hzkj_samount - hzkj_handle_fee
Stripe 客户应付 = 表头 hzkj_receive_amount + hzkj_handling_fee
```

依据：[手续费和客户应付](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/util/PayUtil.java:37>)（37–65 行）；[分录实收算法](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/util/PayUtil.java:81>)（81–113 行）。这些字段存在业务差异，不应把“客户支付”“订单业绩”“银行净到账”当作同一个金额。

收款审核校验要求支付状态 B、分录实收非零，并校验表头 `hzkj_receive_amount` 等于分录 `hzkj_samount` 合计；**这段校验没有证明表头 `hzkj_rec_amount` 等于分录实收合计**。适配时应对账，不要把表头实收重复复制到每一行。[审核校验](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/fund/plugin/ReceiveBillOperationPlugIn.java:270>)（270–315 行）。

钱包支付可以使用授信额度，仍会生成 B/C 状态的收款单并写入实收。因此此事实表表示订单业务结算；不宜命名为“新增银行现金流水”。钱包充值 D 应与消费时订单结算区分，避免双计。[钱包结算](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/OrderController.java:1417>)（1417–1445 行）。

## 4. 全款备货扣减已在源订单发生

`ReservedStockOrderUtil.waiveProductAmountForSalesOrder` 明确执行：

```text
hzkj_order_amount = 0
hzkj_total_amount = hzkj_fre_quo_amount + hzkj_fixed_tax_fee
```

即全款备货履约只保留运费和固定税费。普通履约恢复金额时，从商品父行 `hzkj_amount` 汇总产品额，再加运费、固定税费。[金额处理](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/util/ReservedStockOrderUtil.java:951>)（951–969 行）。

履约下推收款的转换规则将 `hzkj_total_amount` 写到收款分录 `hzkj_samount`，将 `hzkj_order_amount` 写到产品金额。故分析层**不得再次扣减预付产品款**。[履约转换](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders_hzkj_receive_bill_2361797348159399936.cr:319>)（319–343、377–393 行）。

备货转换规则将备货 `hzkj_order_amount` 写入收款分录 `hzkj_samount`，初始分录实收来自备货 `hzkj_vable_amount`（应收金额）；后续在线支付算法还会更新分录实收。[备货转换](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new_hzkj_receive_bill_2398055344975688704.cr:315>)（315–340 行）。不能只用备货订单总额代替实际收款事件。

## 5. 日期和归属维度

| 归一概念 | 确认字段/建议 | 证据与限制 |
| --- | --- | --- |
| 支付时间 `paidAt` | 收款 `hzkj_receive_time` | 现有业绩按此取时间；是 DateTime，有时区转换元数据 |
| 源订单收款日期 | 两类源订单 `hzkj_receipt_date` | 可作核对字段，不能替代多笔收款事件日期 |
| 审核时间 `approvedAt` | **待真实接口确认** | 当前证据足够确认 C 状态，尚未确认收款/订单继承审核时间字段的响应形式；不得自行把创建时间或支付时间当审核时间 |
| 收款客户 | `hzkj_pay_customer.id/name` | 收款事实上的付款客户 |
| 源订单客户 | `hzkj_customer.id/name` | 履约与备货订货客户，和付款客户保留区分 |
| 客户当前业务员 | `hzkj_pay_customer.hzkj_biz_user` | 旧业绩报表按客户当前业务员归属汇总 |
| 收款业务员 | `hzkj_bizperson` | 旧报表另显示最新收款单上的历史业务员 |
| 源订单业务员 | `hzkj_operator` | 履约和备货均有该字段；毛利权限服务按此归属 |
| 收款销售部门 | `hzkj_dpartment` | 注意原始拼写，不能改成 department |
| 源订单销售部门 | `hzkj_dept` | 履约和备货均有该字段 |
| 履约发货仓库 | `hzkj_dst_warehouse` | 商品行字段另为 `hzkj_orders_billentry.hzkj_warehourse`（原始拼写） |
| 备货收货仓库 | `hzkj_warehouse` | 元数据必填；海外承运商按此次业务规则为不适用 |

依据：[收款查询包含客户和两类业务员](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/form/ReceiptPerformanceReportFormPlugin.java:187>)（187–198、372–390、457–469 行）；[收款部门和业务员](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_fund/metadata/hzkj_receive_bill.dym:843>)（843–857 行）；[备货部门/业务员](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new.dym:1684>)（1684–1701 行）；[备货仓库](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_stock_order_new.dym:3431>)；[履约归属字段](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:4465>)（4465–4508 行）。

时间区间建议使用业务时区中的 `[月初, 下月初)`。已有客户图表明确使用 `Asia/Shanghai`；旧收款业绩插件用 `Calendar`，不能据此断言所有部署时区相同。[现有业务时区](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/OrderController.java:1067>)（1067–1086 行）。

## 6. 物流口径与上游审核

履约审核元数据要求 `hzkj_dst_warehouse != null`，并校验 `hzkj_channel` 实际物流渠道非空。[审核校验](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:5370>)（5370–5436 行）。分析层不应再增加“已审核订单是否已补仓库/承运商”的业务流程。

但源码存在不同阶段物流字段，适配时须明确选用：

- 物流决策：表头 `hzkj_logistics_channel`；渠道分录 `hzkj_channel`，其承运商引用 `hzkj_logistics_providers`。属性显示字段 `hzkj_basedatapropfield3/4` 只是 provider.name 显示。
- 实际发运：商品行 `hzkj_ship_provider` / `hzkj_ship_channel`；表头 `hzkj_ship_provider_name` / `hzkj_ship_channel_name` 是文本汇总。不能把汇总名称当唯一 ID，也不能把发运后字段缺失等同于审核失败。
- 发运事实报表使用独立 `hzkj_deliver_bill`：承运商 `hzkj_logistics_providers`、渠道 `hzkj_logistics_channel1`、仓库 `hzkj_basedatafield`、业务员 `hzkj_bizoperator`，且按发运单 ID 计数。

依据：[决策承运商引用](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:8019>)（8019–8024、8082–8086 行）；[发运字段](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:3610>)（3610–3624、9860–9876、9926–9956 行）；[发运报表事实与字段](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/DeliveredOrderVolumeReportService.java:28>)（28–55、137–164 行）。

## 7. 已有接口/查询能复用什么

下面是**已验证的 Java 注解路径片段**，不是可直接调用的完整 URL。网关前缀、服务地址、鉴权、部署版本未验证。

| 现有代码 | 可参考范围 | 不可直接替代本次需求的原因 |
| --- | --- | --- |
| `ReceiptPerformanceReportFormPlugin` | 收款头去重后加载分录、备货类型筛选、按客户汇总 | 原生苍穹表单插件；未发现对应收款分析 HTTP 导出；金额用订单额，含样品，最多 30 天 |
| `OrderController`，`@ApiController("crm")` + `@ApiMapping("/order")` + `/graphicStatistics` | 单个客户按日订单/付款图表 | 仅履约，付款用订单 `hzkj_curtotalamount`，未实现全款备货收款并集，也不证明公司审核门槛 |
| 同控制器 `/queryOrder` | 客户、订单类型、分页/排序参数 | 客户门户订单查询；不是已验证的组织级业绩账本 |
| 同控制器 `/orderCountStatistics`、`/orderStatistics` | 订单数量与状态分组 | 数量接口不等于收款事实 |
| `DeliveredOrderVolumeReportService` | 当前组织内已审核且已推送的发运单，维度计数 | 使用发运单审核时间 `auditdate` 作发运代理日期，不等于收款日或物流商真实揽收时间 |
| `ReceiveBillController`，`/fund/receiveBill/allocateStripeHandlingFee` | 证明存在收款维护 API | **写操作**，分摊手续费；不是只读分析接口，不应被分析前端调用 |

依据：[订单控制器声明](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/OrderController.java:99>)；[图表接口与付款字段](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/OrderController.java:1061>)（1061–1156 行）；[订单查询](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/OrderController.java:3510>)（3510–3543 行）；[收款维护接口](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/fund/controller/ReceiveBillController.java:14>)（14–46 行）。

权限可参考 `OrderGrossProfitReportPermissionService`：后端每次读取当前用户、当前组织，业务员强制本人；不是相信前端传来的 ownerId。[权限代码](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitReportPermissionService.java:40>)（40–78 行）。这只是已有模式，不代表新接口已接通该权限。

## 8. 适配建议与尚未解决的映射

采用独立、按分录归一的收款事实集合比直接相加两种订单总额更符合源数据：一张收款单可以关联多张订单；同一订单也不能在接口确认前假定只有一张收款单。

建议保留 `receiptId`、`receiptNumber`、`entryId`、`sourceEntity`、`sourceDocumentId`、`sourceDocumentNumber`、源类型/备货类型、支付与两级审核状态、支付时间、金额三个层次（应收/实收/客户支付）、币种和归属维度。源码只确认了 `hzkj_src_order` 文本关联；**分录稳定主键在真实响应中的名称、是否暴露转换关联 ID 均待接口验证**。如可取得分录 ID，用收款 ID + 分录 ID 形成事实唯一键，源单号不可单独作为收款唯一键。

适配顺序建议：

1. 由可信后端确定用户、组织和可访问收款范围；保留按收款 ID 的允许集合，不能把“能看源订单”自动当“能看全部相关收款”。
2. 读取收款头 ID 集合，再加载分录；现有报表采用此方式避免直接连接展开造成重复统计。
3. 按分录源类型和源单号解析来源。A 关联履约实体；C 关联备货且必须 type=1；type=2 永不进入本次业绩。
4. 保留源单与收款单审核状态，按照此次业务口径完成已付款、已审核筛选。现有报表的收款单审核条件不自动证明源单已审核。
5. 以分录实收计此次“实收”指标，并保留应收/手续费用于核对。不得用原平台订单金额、商品明细额重建已减免备货产品款；不得再扣一次备货。
6. 按已明确的业务时区和支付月份汇总。备货承运商标记为不适用；承运商统计采用履约/发运事实，仓库可关联备货收货仓库。

真实接入前仍需验证：

- 可调用的只读收款查询契约、完整网关路径、鉴权方式、分页、增量游标；本次未建立任何生产连接。
- 当前方案2实现已固定以分录实收计业绩、订单金额和手续费另列；真实接入需核对各支付渠道字段含义、退款及授信结算，不能混用三种金额。若财务制度与该基线不同，登记明确变更，见人工核对H07／H09／H12。
- 源订单审核与收款审核的业务关系及审核日期响应。月份已固定按UTC+8支付月；仍需说明迟审核如何回补历史、是否关账锁定，而非重新选择审核月，见H08。
- 收款客户、客户当前业务员、收款业务员、订单业务员之间的归属优先级；需要选择后固定，不能把不同角色姓名混合分组。
- 原始明细 ID、来源 ID 的稳定性，历史分录实收完整性及头行金额一致性。
- 订单决策渠道与实际发运承运商两种维度的选择；一个订单多包裹、多渠道时不能把一笔收款全额重复分配给多个承运商。
- 生产部署是否包含本工作树中的元数据及回调改动。

以上不阻碍前端使用明确标注的演示数据与归一接口边界；它们阻止的是把尚未验证的接口、状态或金额猜测包装成“真实 FOP 已接通”。

后续工作、建议负责人、具体资料与完成标准统一维护在 [后续待办与人工核对清单](FOLLOW_UP_CHECKLIST.md)，并收录到完整需求第7章。

## 9. 物流运费：已核实字段、结算边界与独立权限

本节是本次物流运费分析的只读源码核查结果。平台已有 `/api/autoflow/integrations/fop/freight` 与 `/freight/details` 契约及独立 Mock；**没有证据表明真实 FOP 已发布对应只读分析 HTTP 接口**。下列 Java 服务、任务或表单存在，不代表可以把其名称拼成生产 URL。

### 9.1 当前实际成本事实

| 平台字段／规则 | FOP 源事实 | 适配说明 |
| --- | --- | --- |
| id / documentNumber | `hzkj_deliver_bill.id/billno` | 每发运单一条当前快照；同一订单多次发运不按订单号去重；重复发运单 ID 拒收 |
| originalAmount | 表头 `hzkj_actual_freight` | 实际物流成本，不是客户收费、预估价格或订单金额 |
| originalCurrency | 表头 `hzkj_textfield1` | 必须从真实币种字段取得，不从 Java 变量的 Rmb 后缀推断 |
| confirmedAt | `hzkj_actual_freight_time` | 同步取得费用后写入苍穹的确认时刻；按 UTC+8 归日／月／周／年；不等于银行付款日或最终结账日 |
| reviewStatus / costStatus | `billstatus='C'`；实际成本为正且有确认时刻 | C映射approved；confirmed是适配器依据已核实金额/时间建立的归一状态，未证明源有同名状态枚举。未确认或零金额不纳入，正数缺时间拒收 |
| carrierCode/Name / channelName | `hzkj_logistics_providers` / `hzkj_logistics_channel1` | 采用发运单实际选择的服务商／渠道；真实编码显式映射YT/4PX/WB/YW/JS/OTHER，不能根据名字猜测，未知不能静默OTHER |
| warehouseCode / warehouse | `hzkj_basedatafield` | 映射真实杭州/深圳仓ID；归一HZ/SZ，不从订单归仓替代发运归仓 |
| customer / owner / organization | `hzkj_customer` / `hzkj_bizoperator` / `org` | 稳定ID及名称；部门/祖先路径需要可信目录或源字段补充，不能按文本推断权限 |
| orderNumber / trackingNumber | `hzkj_order_no` / `hzkj_logistics_orderno` | 源订单号及物流订单号；运输跟踪号另有字段，实际展示语义待真实样本核对，不把物流号作为唯一事实ID |
| fxRateToUsd/Date/Source / amount | 尚无已核实的统一历史USD折算字段 | 平台强制显式原币到USD汇率、取价日与来源，amount须等于精确十进制乘法HALF_UP折算后分币（1.50×0.15=0.23）；USD原币rate=1。Mock汇率仅样例，不能做生产历史汇率 |

源码证据：[实际运费及确认时间元数据](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_logistics/metadata/hzkj_deliver_bill.dym:4001>)；[实际运费币种](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_logistics/metadata/hzkj_deliver_bill.dym:3841>)；[已审核表头成本查询及正数缺时间错误](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/OrderLogisticsCostQueryService.java:37>)；[发运维度字段](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/DeliveredOrderVolumeReportService.java:48>)；[订单号与物流号读取](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/exception/FreightExceptionService.java:81>)。

### 9.2 原币与“最终结算”的限制

云途、4PX、万邦、燕文任务将供应商返回金额与币种直接写入表头，未在这些写入语句里统一折成人民币或美元。急速同步明确写 CNY。因此 `OrderLogisticsCostQueryService` 的 `actualFreightRmb` 变量名不能证明所有服务商金额均为人民币，不能直接把不同币种相加后标记USD。

证据：[云途金额及币种写入](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/task/SyncYunTuFreightTaskPlugin.java:68>)；[4PX](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/task/Sync4pxFreightTaskPlugin.java:76>)；[万邦](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/task/SyncWanbFreightTaskPlugin.java:68>)；[燕文](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/task/SyncYanWenFreightTaskPlugin.java:69>)；[急速CNY和确认时间](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/JsexpActualFreightSyncService.java:130>)。

`OrderLogisticsCostQueryService` 明确注明费用单据体已移除，`collectSubsequentFees` 调用被注释；保留 redispatch/refund 代码不等于已计入重派或退费。常规候选无独立完成时间字段时，仅选择 `hzkj_actual_freight IS NULL OR =0`，首次正值之后不会由该候选规则自动重新采集。燕文取返回数组第一条；急速解析 `timeIn` 并选择记录，这些读取策略本身不能证明取得最终账单。因此当前能力是“已确认实际成本快照”，不承诺完整物流结算账本、最终实付成本或后续退款净额。

证据：[停用后续费用采集](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/OrderLogisticsCostQueryService.java:83>)；[首次候选条件](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/FreightSyncCandidateService.java:183>)；[燕文第一条记录](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/task/SyncYanWenFreightTaskPlugin.java:69>)；[急速时间解析](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/JsexpActualFreightSyncService.java:190>)。

### 9.3 成本授权和真实查询接口

`DeliveredOrderVolumeReportService` 限当前组织；有 `hzkj_bizperson` 档案时限制本人，无档案时组织全员。这是该单量报表的规则，不能自动成为物流成本权限，更不能让没有业务员档案的本地账户因此查看组织所有成本。

可信权限模式可参考 `FreightExceptionService.currentOrg/requireRight`：检查当前登录组织、`hasViewPermission` 和单据 `checkOperationRule`。它是可借鉴的服务端权限实现，仍需正式定义运费金额是否有额外字段权限。平台当前同时要求 `freight` analytics scope、独立 `allowedFreightIds`，并与 tenant、本人／部门／业务管理员范围求交；系统管理身份和订单 allowlist 均不授予成本可见性。公开序列化剥离 `tenantId/departmentPathIds`。

证据：[单量报表当前组织和员工范围](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/DeliveredOrderVolumeReportService.java:137>)；[有无业务员档案的分支](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/DeliveredOrderVolumeReportService.java:180>)；[组织及单据权限校验](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/exception/FreightExceptionService.java:49>)。

`JsexpActualFreightController` 的 `/actualFreight` 是 POST同步并回写发运单的维护接口，不是只读分析接口，不应由分析页面调用。[控制器写入行为](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/controller/JsexpActualFreightController.java:23>)。真实只读URL、鉴权、分页完整性、授权刷新和脱敏响应须由FOP研发提供；最终结算、币种汇率、调价补收退款、成本权限和服务商映射分别见 H18–H22。

## 10. 销售个人净毛利：月结版本、预计贡献和真实缺口

核查日期：2026-10-23（UTC+8），后台只读。本节确认当前工作树实现，不确认生产发布状态。本工程契约见 `backend/src/modules/fop-data/sales-performance.types.ts`；新增两条平台GET及Mock不能证明FOP拥有可查询的历史利润账本。预计与已结算净毛利分别输出，收款仍独立按paidAt归期。

### 10.1 月结候选、草稿与已审核版本

| 环节／字段 | 已确认实现 | 对本次适配的约束 |
| --- | --- | --- |
| 候选 `OrderGrossProfitMonthlyCandidateService` | 已审核发运单正数 `hzkj_actual_freight`，按 `hzkj_actual_freight_time`；已审核 `hzkj_adjust_bill` 按 `createtime`；正常收款不触发 | 月结触发日不是付款日，也不是自动可拆分的日利润；直接复用候选会漏掉仍需预估运费的订单 |
| 草稿 `hzkj_gp_monthly_settle` | A暂存、B提交、C审核；仅A可重算；按组织／月／业务员生成 | 草稿金额不得标为已结算；存在草稿不等于已生成订单结算历史 |
| 月报维度 | `billstatus=C`、`hzkj_gp_dimension=salesperson`、`hzkj_gp_month`、`hzkj_gp_owner` | 完整月按结算月和冻结业务员取权威值，不按订单当前业务员或paidAt重分配历史业绩 |
| 月报金额 | 表头 `hzkj_gp_net_delta_total`；分录 `hzkj_gp_net_delta_rmb` | 这是本期净毛利差额，不是 `hzkj_gp_net_total/net_rmb` 整单累计值；跨期累计delta，不能累计各期累计快照 |
| 版本关联 | 月结分录 `hzkj_gp_order_no/prev_ver/version/settle_type`；订单 `hzkj_gp_settle_entry` | 保留稳定订单、月结单、版本及上版关联；同期间结算替换预计，跨期调整独立确认 |

证据：[候选与停用费用扫描，42–97行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitMonthlyCandidateService.java:42>)；[草稿字段与状态，36–94行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitMonthlyBillService.java:36>)；[仅暂存可重算](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitMonthlyBillService.java:244>)；[月报C筛选及delta汇总，58–108行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/SalespersonMonthlyGrossProfitReportService.java:58>)。

审核插件禁止反审核，审核时重新计算、比较草稿版本与金额，在当前审核事务内批量保存订单版本。`hzkj_gp_time`取审核处理时 `new Date()`；`hzkj_gp_cutoff_e`取下月首日；`hzkj_gp_month`独立保存结算月。版本冻结业务员 `hzkj_gp_owner_e` 和客户 `hzkj_gp_customer_e`，后续版本沿用前版本归属，不应以当前客户／业务员重新分组。订单头 `hzkj_gp_status=settled` 仅证明曾结算，不证明随后调整已全部结清。

证据：[审核事务与日期，49–143行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/operate/OrderGrossProfitMonthlyAuditOperationPlugin.java:49>)；[草稿金额／版本校验](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/operate/OrderGrossProfitMonthlyAuditOperationPlugin.java:181>)；[订单版本与冻结归属，166–242行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitSettlementRecordService.java:166>)。元数据也存在[结算月份／时间／cutoff](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:4103>)及[净毛利差额](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym:4384>)。

### 10.2 累计金额与本期贡献的映射

订单结算分录保存收入 `hzkj_gp_income_usd/rmb`、调整 `hzkj_gp_adjust_usd`、收入汇率 `hzkj_gp_rate`，商品成本 `hzkj_gp_pur_rmb`、国内物流 `hzkj_gp_dom_ship_rmb`、国际物流 `hzkj_gp_ship_rmb`、仓储 `hzkj_gp_wh_cost_rmb`、财务手续费 `hzkj_gp_fin_fee_rmb`，以及毛利 `hzkj_gp_total_rmb`、净毛利 `hzkj_gp_net_rmb`、前净毛利 `hzkj_gp_prev_net_rmb` 和净差额 `hzkj_gp_net_delta_rmb`。

FOP公式是：累计收入（含收款调整与全款备货使用转入）减商品／国内物流／国际物流／仓储成本得毛利，再减财务手续费得净毛利。本版净毛利减上版累计净毛利得本期delta。旧版本缺净毛利时，代码会以旧毛利值兜底，真实历史数据需专项核对，不能把兼容分支解释为历史已逐项补齐手续费。

证据：[快照公式，124–161行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitSnapshotService.java:124>)；[草稿delta和旧版兼容](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitMonthlyCalculationService.java:114>)；[历史净毛利回退](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitSettlementRecordService.java:318>)。

平台 `FopProfit.amount` 是USD期间贡献；成本分量通过 `previousRecognizedProfit` 抵减此前已确认部分，不能将累计值重复写为各期amount。`incomeAmount`与`adjustmentIncome`必须互不重复：FOP收入字段已经含调整，拆出调整时先从基础收入扣除。`otherCost`须明确覆盖未单列的国内物流、仓储、手续费，并与product/freight/refund/return各类别互斥。不能用未经确认的退款金额填两个成本项，也不能为了满足等式任意增加成本。`roundingAdjustment`另列可审计换汇尾差，绝对值最多0.10 USD；业务金额差异不能塞入尾差。

### 10.3 全款备货和调整的防重复规则

利润收款读取源类型A履约／B样品、收款C审核且B已收，按分录 `hzkj_samount` 与 `hzkj_handle_fee` 读取，不直接读取C类备货收款。它与本次收款业绩使用 `hzkj_real_receive_amt`、排除样品的方案2不是同一金额／候选口径，不能直接互换。[收款读取及校验，191–275行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitSnapshotService.java:191>)。

全款备货利润转入来自 `hzkj_stock_order_new.hzkj_stock_type=1`、使用表 `hzkj_sale_order_use.hzkj_sale_order_billno/hzkj_use_qty`；销售、商品成本、国内运费单价分别为 `hzkj_settled_price/hzkj_settled_cost_price/hzkj_settled_shipping_pri`。收入／成本按使用数量分摊给履约订单。备货回款已在付款月进入收款指标，不能在收款时再作为利润收入，更不能在库存使用时重复增加收款。[备货使用与单价，37–47、114–138行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/einkauf/service/ReservedStockProfitAllocationService.java:37>)。

调整严格通过 `hzkj_adjust_bill.hzkj_entryentity.hzkj_sales_order_number` 关联履约订单，取有符号 `hzkj_adjust_amount1`；原单号可能是RMA，不能回退混用。正负调整已纳入累计收入，展示调整分量不等于再次计入利润。[调整关联及金额，279–321行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitSnapshotService.java:279>)。

### 10.4 现有实时／cutoff服务不能直接满足预计日周

| 缺口 | 具体源码证据 | 必须补齐的能力 |
| --- | --- | --- |
| 无运费按0、无历史截止 | `calculateRealtime(order)`调用 `calculate(order,null,false)`，注释明确取查询时全部当前数据、未确认国际运费按0 | 新口径未结算始终用有版本的预估运费，缺失不可默认为0；不能直接调用此入口 |
| 候选日期不是利润日 | `findByCreatedTime`按订单 `createtime` 筛选，并要求当前订单已收 | 付款仅作收款归属／预计准入；利润归属独立；月结触发也不能补全未结算候选 |
| 采购未按cutoff | `OrderPurchaseCostQueryService.calculate(order)`仅按当前 `hzkj_pay_status=1` 取 `hzkj_settlement_amount` 与运费分摊 | 采购支付／成本修改发生时间、knownAt及历史版本；防止未来采购进入较早期间贡献 |
| 备货cutoff参数未使用 | `ReservedStockProfitAllocationService.calculate(order,cutoff)`未向下传入；所有正数使用量计入，注释明确不以状态／使用时间作条件 | 使用发生／获知／有效状态及撤销退回事件；单价和成本版本可追溯 |
| 仓储不按通知日期截断 | `WarehouseHandlingCostQueryService`明确后补通知不按日期截止，cutoff只确定杭州收费生效月份 | 可用于预计贡献的仓储事件日期及knownAt，避免后补数据伪装成先前已知 |
| 审核不是历史快照 | 收款按receive_time、调整按createtime截止，但均查询当前C状态 | 当前asOf资格须有可信审批时间；不能声称可复原过去任意时刻的审批状态 |

证据：[实时入口，68–79行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitSnapshotService.java:68>)；[创建时间候选，108–143行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitReportCandidateService.java:108>)；[采购无cutoff，26–90行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/einkauf/service/OrderPurchaseCostQueryService.java:26>)；[备货cutoff与使用条件，25–31、56–70、157–183行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/einkauf/service/ReservedStockProfitAllocationService.java:25>)；[仓储明确限制，48–51行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/service/WarehouseHandlingCostQueryService.java:48>)。

已确认发运预估字段为 `hzkj_deliver_bill.hzkj_estimate_freight`，按渠道／国家／重量计算写入；但该代码未建立历史预估版本或knownAt保证，不能将当前值推定为历史值。客户运费报价 `hzkj_fre_quo_amount` 也不能未经财务核对当作物流成本。[预估运费计算](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/util/LogisticUtils.java:28>)；[预估字段元数据](</Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_logistics/metadata/hzkj_deliver_bill.dym:3775>)。

需要建立稳定事件ID／版本、发生／known／approved时间和cutoff的事实账本或历史快照差分，提供预计期间delta；仅把现有 `calculate(order,cutoff)` 传入日期仍不能解决上述缺口。平台当前查询的asOf是查询时刻，不接受过去asOf回放；读取历史range可显示目前已审核月结，不能据此宣称历史预计贡献和审批状态可完整复现。

### 10.5 无日分配、币种与HTTP权限边界

月结只提供结算月、审核写入时间、cutoff；没有权威日利润分配。完整自然月可用 `recognitionDate=null` 月结值；周／天／部分月返回 `settledGrossProfit=null`、`unallocatedCount`及 `unallocatedSettlements` 月参考。审核日不是利润发生日，不能均摊月delta。预计也须按期间差额计，不累加每日存量快照。

FOP收入使用收款 `hzkj_exrate`；没有收款汇率时回退当前 `bd_exrate_tree.indirectexrate`，不是带日期的历史FX查询。[收款汇率](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitSnapshotService.java:120>)；[当前汇率树](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitExchangeRateService.java:24>)。物流成本查询未读原币而直接加到Rmb变量，后续重派／退款采集停用，详见第9节。已审CNY净毛利delta保留权威原额，再按明确日期／来源换USD并审计分量与舍入；不能用最新FX或最新原始成本改写冻结月结。

检索毛利服务调用发现的是原生表单插件，未发现对应毛利分析HTTP controller；真实地址、认证及分页仍待H23。实时权限按当前 `hzkj_operator`，业务员限本人，但非业务员默认可查当前组织全部；月报service允许空业务员，组织ID≤0时不加组织过滤。新个人工作台不能直接将这些宽松参数暴露为HTTP。

证据：[实时身份及范围，49–78、139–146行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderGrossProfitReportPermissionService.java:49>)；[月报筛选，52–68行](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/SalespersonMonthlyGrossProfitReportService.java:52>)；[月报表单调用](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/form/SalespersonMonthlyGrossProfitReportFormPlugin.java:103>)；[实时表单调用](</Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/form/OrderGrossProfitRealtimeReportFormPlugin.java:192>)。

真实适配必须以当前可信用户／组织建立独立 `sales_profit` scope 与 `allowedProfitIds`，与本地本人／部门权限求交；冻结业绩归属与当前访问权分开。资料与完成标准见T21–T26、H23–H28、D16–D22；未经真实联调不得标为FOP ready。

## 11. 图表与员工范围：当前客户及历史事实不可混同

本轮只读复核以下已有证据，不推断已发布HTTP能力：

- `ReceiptPerformanceReportFormPlugin.java:187–198`同时读取客户 `hzkj_pay_customer.hzkj_biz_user.name` 与收款 `hzkj_bizperson.name`；`:372–390`按客户主键聚合并单独显示当前客户owner。姓名字段只是展示，不是账号授权稳定ID，也不证明两种归属相同。
- `OrderGrossProfitReportPermissionService.java:48–78`每次读取当前用户/组织；识别为业务员时强制本人，其他人可选owner。该旧报表“非业务员全部”分支不能直接用作新平台经理/员工权限，更不能把没有任职信息当作全公司授权。
- 订单的 `hzkj_operator`、发运单的 `hzkj_bizoperator`、收款的 `hzkj_bizperson`与月结的冻结 `hzkj_gp_owner_e`仍按前述源映射使用。物流录入人不是销售业绩owner；客户当前转交不能重写已冻结毛利。

本地逐图策略只是功能入口与范围上限，真实数据继续与绑定FOP用户的资源许可取交集。完整组织汇总新增独立provider契约，必须由FOP提供纯部门聚合和独立汇总部门授权；本轮未发现足够证据确认一个现有通用HTTP接口已经满足此能力。没有独立汇总实现时保持未配置，不读取域外成员或把登录用户临时提升为管理员。

需要真实输入：H29账号图表矩阵、H30汇总授权及只读接口、H31客户转交/历史访问、H32多账号验收样本。既有FOP姓名查询不能替代这些稳定身份、数据权限和移交规则。


## 12. 五类履约待办的独立状态映射

源码根目录 `/Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/`，2026-10-23只读核查。以下是已确认的业务字段与映射建议，不代表已发布HTTP接口。

| 前端标准字段 | 已核实实体／字段和源码 | 映射要求 |
| --- | --- | --- |
| `paymentStatus/reviewStatus` | `member/common/service/ShopifyPaidFulfillmentService.java:111`：本地订单状态及成功收款凭据判付；`ordercenter/allocation/AllocationConstants.java:90`：C为已审核、订单2/3/4/5为已支付后续状态 | 已付款才进入待审核；不可只使用Shopify financial_status。五队列的付款门槛不改变回款的双审核口径 |
| `fulfillmentProgress.shopifySync` | `member/plugin/task/SyncShopifyOrdersTask.java:2066` 读取Shopify `fulfillment_status` 写入订单 `hzkj_fulfillment_status`；`hzkj_fulfillment_gid`独立同步。发运推单回写见 `logistics/plugin/op/DeliverBillCreateOrderOpPlugin.java:757` | 平台履约回执归一化pending/partial/synced；不能从调度、配货、仓库出库反推。已获取未履约与尚未取得平台事实要区分，后者unknown |
| `fulfillmentProgress.supplierShipment` | `ordercenter/plugin/util/OrderPurchaseStatusUtil.java:32`：`hzkj_purchase_status`、分录`hzkj_entrypurc_status`；0未采购、1部分采购、2采购中、3已入库、4供应商已发货；`setHeadPurchaseStatus`处理组合父件、虚拟SKU及备货使用 | 先取有效物理商品明细：供应商仍有未发货数量才pending/partial；全部发货/入库则shipped；全部无需采购则not_required。**不能将表头1直接等同“部分供应商发货”**，因为混合已入库/采购中也可能是1 |
| `fulfillmentProgress.stockReadiness` | `ordercenter/allocation/AllocationConstants.java:58`：pending/available/completed/error/voided；配货实体`hzkj_alloc_bill`及`hzkj_alloc_status` | 有效需求与实际可配库存决定incomplete/ready；completed代表已齐套。缺配货记录或error不能无证据推断齐套；需要需求／库存计算才能判incomplete，否则unknown |
| `fulfillmentProgress.allocationReview` | `ordercenter/allocation/AllocationReleaseGateService.java:191`：同时要求`hzkj_alloc_status=completed`与`billstatus=C`，并校验有效分录；重复已审核齐套包裹会报错 | 订单有效包裹全部配货审核完成才approved；齐套未审pending；作废、撤审、重复配货须按有效记录处理，不从履约订单审核状态推导 |
| `fulfillmentProgress.outbound` | `ordercenter/plugin/util/OrderOutboundStatusUtil.java:31`：`hzkj_orders`、`hzkj_orders_billentry.hzkj_outbound_qty/hzkj_outbound_status`、`hzkj_delivery_status`及出库时间；审核／反审核按来源分录回写 | 按审核出库数量相对有效应出数量归一化pending/partial/completed；不能用物流单号是否存在或Shopify同步状态代替；反审核须重新计算 |

订单级多包裹、组合商品、虚拟SKU、使用备货、部分取消/退款、撤审/反审核和历史无配货单的样本需要IT回填H33。当前平台按归一化事实过滤，不在浏览器直接解析金蝶枚举。生产适配器必须保证每个订单进度来源一致、同队列去重，不能把部分齐套包裹冒充整单配货完成。


### 12.1 采购下单与付款独立事实补充（2026-10-24只读核对）

| 标准字段 | 后台证据（相对上述Java根目录；元数据在datamodel） | 适配约束 |
| --- | --- | --- |
| `procurementProgress.purchaseOrder` | `ordercenter/plugin/util/OrderPurchaseStatusUtil.java` 的 `markPurchased` 在采购申请审核后把分录设为采购中；`einkauf/service/Purchase1688OrderService.java` 的 `writeBack` 才写外部 `hzkj_1688_order_n`／行 `hzkj_1688_order_no` | 订单表头“采购中”不证明已正式下达采购单；需查有效 `hzkj_purorderbill`，1688取成功下单事实，线下取审核/下达凭证（H34确认），按有效采购需求数量区分未下单/部分/全部 |
| `procurementProgress.supplierPayment` | `hzkj_einkauf/metadata/hzkj_purorderbill.dym`：`hzkj_pay_status` 名称为“1688订单状态”，0未支付、1已支付、2未支付已取消、3已退款；`Purchase1688OrderService.writeBack` 写0，`einkauf/webapi/Einkauf1688CallbackController.java` 支付回调写1；`PurchasePaidOrderSyncService` 禁止覆盖取消/退款态 | 这是采购方给供应商的款，不是客户履约支付；枚举仅直接证明1688链路，不能套用于所有线下采购。部分付款为跨有效采购单及实际付款分录聚合，不能伪造源枚举“部分支付” |
| 履约→采购关联 | `einkauf/service/OrderPurchaseCostQueryService.java` 按 `hzkj_billentry.hzkj_salbillnumber` 查采购单，并逐行匹配履约单号；付款条件 `hzkj_pay_status=1`，采购头去重 | 一单可有多采购单、一采购单可有多履约来源，按稳定来源行及数量归属，不把整张混单采购付款金额重复分摊。用户仅接收自己有权履约订单的归一进度，不暴露其他订单或供应商金额 |
| 供应商部分发货 | `einkauf/service/Purchase1688ShipmentReceiptService.java` 的 `filterReceiptEntries` 按物流包裹规格数量裁剪收货通知明细；`OrderPurchaseStatusUtil` 区分发货/入库/备货 | 一包裹回调不表示整单发完；对有效应采购数量核算，保持已有 `supplierShipment` 口径；不能从采购已付推导供应商已发货 |

上述为字段证据及建议，未修改FOP生产库。真实下达判定（特别是线下单）、订单分录稳定关联、取消重采覆盖、退款恢复、付款分摊与部分付款以及更新时间需T32/H34联调；未知返回unknown，不以当前前端Demo推断生产事实。


### 12.2 配货清单状态展示补充（2026-10-24）

再次核对`ordercenter/allocation/AllocationConstants.java`：pending待配货、available可配货、completed已齐套、error配货异常、voided作废；`AllocationReleaseGateService.requireReleased`同时验证`hzkj_alloc_status=completed`与`billstatus=C`并校验有效分录数量。前端沿用stockReadiness与allocationReview两个归一字段，在待配货清单将未完成齐套统一展示“未齐套，未配货”，完成齐套但未审核在独立“已齐套待审核”页签展示；两页同时显示dispatchDocuments发运单状态，不增加客户支付状态，不把库存可用或履约审核代替配货完成/审核事实。真实适配对多单/多包裹、异常/作废以及缺配货单仍按T31/H33核验，生产接口未在本次接入。


仓库工作台追加两组展示：`completed`且未审核的配货事实也进入仓库待办，但不代表已通过`requireReleased`、不允许在本平台执行出库。齐套已审核且出库未完成为第二组。两组继续按履约订单归一，已全部出库排除；FOP生产放行校验不作任何改动。


### 12.3 发运单状态展示补充（2026-10-24只读核对）

- 实体：`datamodel/hzkj_CRM/1.5/main/hzkj_logistics/metadata/hzkj_deliver_bill.dym`为发运单；不要误取发货通知单`hzkj_deliver_order`。
- 枚举依据：`ordercenter/allocation/AllocationConstants.java`定义BILL_STATUS_DRAFT=A、SUBMITTED=B、AUDITED=C；`logistics/plugin/op/DeliverBillShipmentSyncService.java`按`hzkj_deliver_bill.billstatus=C`检查发运审核后才允许同步。因此前端映射暂存/已提交/已审核，已审核并不证明Shopify已成功同步。真实部署及其他枚举由H35复核。
- 关联证据：`logistics/service/OrderLogisticsCostQueryService.java`按`hzkj_order_no`加载多张发运单；`DeliverBillShipmentSyncService`包含`org`、`hzkj_customer.id`、`hzkj_order_no`、`hzkj_src_package`和`hzkj_platform_orderid`，并按组织/客户确认唯一平台订单。适配应使用可信来源关系并校验组织、客户及资源权限，不能只按外部同号匹配。费用查询仅取已审核单的C过滤不可直接用于状态清单。
- 对应新增`FopOrder.dispatchDocuments[]`的id/number/status，缺失与确认无单分开；多包裹逐单展示，不选择最高审核状态冒充整单。未修改FOP生产源码；有效单据过滤、撤销重建、权限与更新时间继续T33/H35联调。


### 12.4 清单拆分与查询过滤（2026-10-24）

- `procurement_shipping`以12.1归一的有效全部下单与供应商付款完成事实入选，供应商仍pending/partial；`procurement`为相同发货门槛下的补集。`PurchasePaidOrderSyncService`对取消/退款态保护说明付款不可仅凭一次历史已支付回调永久锁定；需有效采购义务的当前事实。线下单和部分付款继续H34人工确认。
- `allocation_review`来自有效配货单已齐套且未审核、未全部出库事实；与待配货（incomplete）分开。`AllocationDeliveryNoticeService`审核前校验有效关联发运单已审核，解释了配货页需要并列显示发运审核状态；展示未审核记录不改变FOP审核放行条件。
- 仓库`warehouseStage`是BFF查询条件，不是新增FOP字段。两组仍由stockReadiness/allocationReview/outbound组合归一，多包裹各事实按有效需求核验，不能仅取某一张单最高审核状态。
- 本次不修改FOP生产实现；发布真实接口后验证付款/齐套/审核/出库跨阶段流转、回退、重复回调、更新时间与数据权限。具体契约见需求9.7和OpenAPI。


### 12.5 待支付来源确认（2026-10-24）

`datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym`的订单状态枚举：0取消、no未关联本地SKU、1待支付、2已支付、3处理中、4已发货；`ordercenter/plugin/billplugin/OrderBillPlugin.java`关联本地SKU后写状态1；`OrderController.java`支付前按客户及状态1读取待支付订单。`ShopifyPaidFulfillmentService.hasSuccessfulPayment`仅在有本地支付状态与成功收款凭据时认定支付，false还可能是缺数据/取消/异常，不能取反当作unpaid。

因此`queue=unpaid`消费明确归一的未支付事实；源状态1→paymentStatus=unpaid、paidAt=null。未知、取消、未关联SKU等来源不得混入。真实API仍待T31适配，H33需补充待支付→付款→审核、取消/退款及未关联SKU的脱敏样本；现有订单权限范围同样适用于未支付记录。


### 12.6 工作台状态排序适配（2026-10-25）

沿用12.2/12.3已核对的配货事实与发运单A暂存/B已提交/C已审核；新增的是查询顺序，不新增FOP字段。`dispatchDocumentStatus`和`allocationDocumentStatus`是sortBy参数，不是FopOrder旧粗粒度dispatchStatus/allocationStatus字段。多发运单只在服务端排序时取最早有效阶段，任何未知单据置后，前端仍逐单展示；null与[]不可混同。仓库先待配货审核，再待出库，再部分出库，已完成仍按队列规则排除。生产数据库分页必须先处理资源权限和有效单据范围，再归一/排序/分页；同状态按收款时间升序稳定排序。

### 12.7 采购旺旺催办映射（2026-10-25）

- **实际卖家账号**：`einkauf/service/Purchase1688OrderService.java:185`的`writeSellerInfo`从1688实际订单`baseInfo.getSellerLoginId()`写入采购单`hzkj_sellers_ww`；电话号码是独立`hzkj_sellers_phone`，不能作为旺旺账号。元数据`hzkj_einkauf/metadata/hzkj_purorderbill.dym:5690`/`:17778`定义“卖家旺旺”；采购转收货通知的转换规则也透传该字段。
- **关联而非SKU匹配**：`hzkj_ordercenter/metadata/hzkj_orders_hzkj_purorderbill_2362056279968503808.cr:1434`附近定义`hzkj_srcbillentity/hzkj_srcbillid/hzkj_srcbillnumber/hzkj_srcbillentryid/hzkj_srcbillentryseq`；同文件`:1266`附近还包含srcsystem字段。适配须核对直采和采购申请中转两种链路，沿有效源单关系回溯到原履约分录；不能直接把中间申请ID误认为履约ID。
- **客户端地址解析**：本地1688 SDK有`com.alibaba.account/AccountWangwangUrlGetParam.java`（`account.wangwangUrl.get`，输入`toOpenUid`）和`WangwangnickOpenuidDecryptResult.java`（旺旺昵称）。openUid不能当sellerLoginId；实际返回地址格式、采购所属1688买家账号授权及FOP现有点击插件/部署版本需H36确认。本次检索未定位可直接供该前端调用的已发布催办HTTP端点，不能把SDK参数类当作已有FOP API。
- **新适配契约**：provider方法`listSupplierFollowUps(identity, permission, orderId)`返回`{subject,orderId,items}`；候选必填tenantId/fulfillmentOrderId/purchaseOrderId/purchaseOrderNumber/platformOrderNumber(nullable)、supplier.id/name/wangwangAccount(nullable)、chatUrl(nullable)、paid/cancelled/shipmentStatus、lines。line含fulfillmentLineId/purchaseLineId/sku/name/pendingQuantity，必须按本订单源分录归属计算，不能返回整张合并采购单的其他客户数量。独立allowedPurchaseOrderIds权限由FOP当前用户计算，不能从allowedOrderIds扩大。
- **本地实现**：BFF只输出最小联系人字段，按采购权限、租户、订单、paid/cancelled及pending/partial过滤；去掉零待发数量；未知/非法关联失败关闭。重复采购单或重复来源行拒绝，防止重复催办/展示歧义。联系版本绑定订单、采购单、供应商、账号、待发明细及地址；打开时重新查验。当前只接受并规范化指定`aliim:sendmsg`协议，其他已部署协议须经收件人可核验的适配后明确加入，不能直接放开任意URL。

### 12.8 工作台审核委托入口

源码根`/Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/`。

- `allocation/AllocationConstants.java`：履约`hzkj_orders`，配货`hzkj_alloc_bill`，发运`hzkj_deliver_bill`，发货通知`hzkj_deliver_order`；B已提交/C已审核，配货completed为已齐套。
- `allocation/plugin/AllocationAuditOpPlugin.java:43`：`audit`执行前调用`AllocationService.validateForAudit(ids,false)`、`AllocationDeliveryNoticeService.validateDeliverBills(ids)`；后置发货通知异常仅提示，不能回滚已经提交的配货审核。
- `allocation/AllocationDeliveryNoticeService.java`：检查有效且已审核发运单；缺失、未审或重复发运均不能绕过校验；提交审核后复用BOTP创建通知单。
- `allocation/plugin/OrderAllocationAuditOpPlugin.java:34`：履约`audit`后置触发配货生成；异步构建失败不得当作主订单审核失败。
- `allocation/plugin/AllocationListPlugin.java`：审核主动作成功即清理旧选择，下游通知失败也不重新审核原单。
- `plugin/webapi/OrderController.java`已有订单业务API，但本轮未找到满足“员工委托权限+版本+逐单结果+持久幂等”的已部署审核端点。新增HTTP合同见9.11.1，由IT确认发布地址和鉴权。禁止把BFF路径直接充当苍穹原生API，禁止替代原生审核插件直接更新`billstatus`。

字段映射：`ApprovalTarget.id/number`←目标单内码/单号，`entity`固定上述实体；`orderId`←真实履约来源内码；`tenantId`←隔离域，`version`←实际最后修改时间/数据版本（需后台确认并参与并发比较）；`status`←billstatus；`eligible/reason`←委托用户操作权与实时审核前置条件。每个配货包裹分别返回，失败时禁止泄露无权其他来源单信息。`ApprovalOutcome`必须区分审核提交状态与后置副作用状态。
