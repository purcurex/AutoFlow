# HyperZone FOP 源码字段与分析适配依据

核查日期：2026-10-22。源码目录：`/Library/VSCode/dtr5b`，HEAD：`bd4c115c`（核查当前工作树，不代表生产部署版本）。仅阅读业务 Java、苍穹元数据与转换规则；未连接生产、未读取配置密钥、未修改后端。

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
