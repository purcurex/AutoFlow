# 销售 RMA 售后清单接入

## 展示范围

销售工作台新增queue=rma，只读跟进仅退款、退货退款及补发货，订单取消、订单拦截、拦截取消作为订单编号下标签展示。与采购退货、供应商退款独立，不从supplierPayment=refunded推定客户售后。

销售页签位于备货之后、异常订单之前。列表首列统一“订单编号”，选择框、居中订单号及多商品汇总沿用待审核清单样式；Shopify单号独立列，演示订单沿用同一履约来源的TO＋日期＋流水号，不另外生成售后履约单号。按履约单一行，退款及退货以整笔履约订单为单位，展示全部原商品，不增加SKU级售后拆分。退款支持部分金额；申请退款金额与订单金额独立显示，不用订单金额覆盖申请金额，也不据此推定实退金额或退款已完成。合并同单多个匹配的授权售后事项；默认进行中，可筛选已结束/全部，按售后最近更新时间降序，默认50条。RMA单列按每张售后单展示“售后类型＋售后单号”，同类型多张单据分别保留，不按类型合并丢失单号；单号支持复制，缺失显示—且不补造。售后类型筛选保留仅退款、退货退款、补发货；原售后事项区域改为售后原因纯文本列，Shopify单号独立列参考待支付；退款金额单列显示。支持类型、关键词、业务部门、发货仓库，继承当前业务员范围；关键词检索订单/售后单号、商品、客户、业务员、原因和当前节点。缺更新时间显示—，不以订单创建时间替代。

售后是独立维度：取消申请不等于订单已取消；cancelled=true、订单未支付、已发货不阻止授权售后记录展示。RMA不修改原待办及完成清单的状态口径。isOpen必须来自售后实际流程，不能从单个订单状态、退款标志或拦截标签猜测。

## API 与权限

- GET /api/autoflow/integrations/fop/rma-orders
- POST /api/autoflow/integrations/fop/rma-orders/export

GET：type可选refund|return_refund|reshipment；flowStatus=active|closed|all默认active；search≤200字符；departmentId/ownerId≤128；warehouseCode=HZ|SZ；page默认1，pageSize=20|50|100默认50。

POST：同筛选，mode=filtered|selected；filtered不接受orderIds，selected要求1–100个唯一orderIds。最多10000笔履约单，商品与售后事项合计最多50000行。默认导出全部查询结果，选中后仅导出所选订单当前匹配事项；失效选择或范围变化409。

独立授权allowedRmaCaseIds与allowedOrderIds、当前本人/部门/公司范围求交。管理员也受独立白名单限制。查询先取售后快照，之后重新读取授权履约单当前归属，再取得最新授权过滤；搜索、选项、合计、分页、导出不包含未授权事项。同单多事项金额只按订单计一次，按币种分别合计；售后申请金额不等于实际退款，不从订单金额中扣减。

## 员工网关契约

HttpFopDataProvider预留POST /rma-cases（相对FOP_EMPLOYEE_API_URL），用现有服务端Bearer凭证，body.subject={tenantId,userId}来自登录身份，不允许客户端指定。

返回RmaSnapshot：subject必须完全匹配，cases数组。每项包含：
- id、tenantId、orderId：真实售后资源、租户和履约单关联；ID唯一，不接受规范化后冲突。
- type：业务类型refund仅退款、return_refund退货退款、reshipment补发货；兼容的流程事件interception订单拦截、cancellation订单取消及interception_release拦截取消不作为售后类型值，而在订单编号下形成标签；仅处于这些流程的订单仍保留在默认/流程状态查询中，以继续跟进，RMA单列为—，相关原因、更新时间及事项计数保留。不能作为type查询值。旧前端事件类型书签移除该类型并回第一页，API旧值返回400。
- isOpen：明确boolean，表示实际流程是否仍未结束；缺失/非法导致失败，不能当已结束或进行中。
- number、stage、reason：可空售后单号、当前流程节点原文、原因原文。拦截/取消无独立业务单号时允许number=null，不拼造单号。
- createdAt、updatedAt：可空、明确时区；无效时间归null。
- refundAmount、refundCurrency：可空独立FOP售后退款金额及币种；不以requestedAmount或订单金额补造，零保留为零，负数/非法值失败。它是售后单退款金额，不据此推断财务到账。当前授权、筛选匹配的退款/退货退款事项按币种精确合计，某币种任一金额缺失则该币种合计显示—；未知币种单独显示—；补发货不形成退款。
- requestedAmount、currency：可空独立申请金额/申请币种，不用订单币种替代未知币种，不代表财务实际退款。

完整类型见backend/src/modules/fop-data/rma-orders.ts。未接入网关明确503；缺失独立资源授权返回零记录，不以演示结果代替真实读取。

订单标签优先使用授权履约单明确的cancelled及shipmentInterceptStatus；另可读取独立授权的取消/拦截流程事件，未结束取消申请只表示取消流程，以cancellation_requested标签key、黄色“订单取消”及“取消申请处理中”提示区分实际cancelled的红色“订单取消”，Excel记录订单取消（申请中）；不推定取消已执行。拦截取消需要released或明确interception_release事件，不从isOpen=false或节点中文推定。标签可来自当前订单关联的已授权事项，类型及流程状态筛选只裁剪售后原因/退款与类型明细，不导致当前订单标签丢失。关键词（含SKU）按整单匹配，命中后保留该单当前类型/流程筛选下全部商品和事项；不按关键词继续裁剪事项或退款金额。退款金额、类型、原因、标签及Shopify单号同步Excel；售后明细保留申请金额与退款金额的独立数值列。

## FOP 源码核对

已核对dtr5b的hzkj_return_apply_order / hzkj_return_order退货申请与退货单元数据，存在订单关联hzkj_order_billno、申请日期hzkj_bizdate、业务员hzkj_bizoperator及订单状态字段。OrderRefundMaintenanceController/OrderRefundBackfillService为退款维护/历史补算能力，不能直接作为客户售后流程只读清单。Shopify取消回调与物流取消、仓库拦截也不是同一业务事实。

正式接入仍需FOP提供售后资源ID、精确履约关联、客户退款/退货分类、isOpen与节点、拦截/取消申请及终态的明确映射。不能仅用订单号文本模糊关联或依据cancelled/shipmentInterceptStatus合成售后申请。当前仅完成BFF、UI、演示与网关契约，未修改FOP源码、凭据、订阅或真实应用权限。

本轮补充核对：hzkj_after_sale_orders.dym中hzkj_sales_type枚举A=退货退款、B=仅退款、C=补发货，hzkj_refund_amount为退款金额，hzkj_resason1为售后原因；AllocationConstants.AFTER_SALE_TYPE_REISSUE=C与AfterSaleAllocationBuildService相符。源码字段存在不代表员工网关已发布；正式字段币种、退款金额与实际到账关系仍需接口联调确认。

## 售后类型互斥

同一授权履约订单，refund仅退款不得与return_refund退货退款或reshipment补发货并存；取消/拦截标签及同类型的部分退款记录不受此限制。检查在业务类型、流程状态、关键词筛选前执行，不能通过筛选掩盖已授权数据冲突；上游冲突明确失败，不自行选择优先级或删除一类事实。前端拒绝冲突响应，Excel生成再次校验，列表与导出保持一致。Demo每笔履约只生成一种业务售后类型，可叠加独立订单事件；历史网关也须遵守此口径。
