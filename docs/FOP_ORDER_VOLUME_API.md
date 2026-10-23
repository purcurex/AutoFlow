# 订单量分析 API 与接入约定

2026-10-22 · 对应设计 v1.3。正式页面：Dashboard 底部「业务订单量分析」「客户订单分析」；各岗位工作台新增「订单分析」，订单原始明细只在岗位工作台显示。

## 业务展示

- 综合分析：物流服务商、组织、业务员。第一级类别，第二级部门／明细对象，第三级月／周／日；仓库独立筛选。
- 物流商固定顺序：云途YT、4PX、万邦WB、燕文YW、极速JS、其他。筛选项、图例、分布图及表格使用相同顺序，空类别保留0值；不按订单量重排。不提供“未分配服务商”；已审核履约订单必须有已映射仓库／物流渠道，缺失或未知代码是适配契约错误。真实存在的其他服务商由可信适配器明确映射为 OTHER。每个服务商独立固定配色，其他为灰色。
- 组织：营销中心包含 sales1—sales4；选部门则展示部门合计与成员。业务员模式为整个查询周期的 Top 5＋其他业务员，可按部门及单一业务员筛选。
- 客户：独立使用开始日期、结束日期筛选，默认本年 1 月 1 日至今天；页面不再提供年份、按月／周／日的时间轴选项。默认前十客户＋其他客户，剩余客户不逐个展示。客户按稳定 ID 区分，相同名字不合并，显示名称和编码。点击排名客户或搜索名称／编码后显示所选日期范围内的每日趋势；其余合计不作为一个客户身份。排名不被搜索框缩小，改变关键词清空旧的单客户趋势。
- 汇总统一浅紫蓝，明细柔和配色，其他灰色。分仓共用系列、刻度与缩放窗口；全部仓库为 HZ 与 SZ；UNASSIGNED 仅保留兼容查询／数组字段，正常已审核履约数据不得使用。
- 综合分析默认最新六个月、最近十四个已发生日期；周显示四组。客户趋势默认最近十四天，可向前滚动。完整区间排名、合计不随横向滚动改变。
- 统计与详情实时查询，图表显示 asOf，跨请求间有新增订单时可能变化；当前不提供历史快照或导出接口。

## 统一统计口径与权限

客户分析同时展示履约订单量和回款业绩。两个图表使用同一组按订单量排名的前十客户及其他客户，不按金额重新分组；每个客户在清单中有「订单量」「回款业绩」两行，分别计算占比、杭州仓、深圳仓及合计。勾选「分仓对比」后，两张图均展示仓库对比系列；选择单一仓库时停用对比。单客户趋势弹窗同样展示数量和金额两张图，沿用分仓设置及支付日期筛选，横向拖动同步日期窗口。每日清单按日期倒序并提供数量、金额和分仓合计。

所有接口均使用现有 JWT／会话认证，响应 `Cache-Control: private, no-store`。从数据库读取当前用户岗位及业务角色，再与绑定 FOP 租户、用户的订单／收款分录各自的白名单求交集，随后去重、过滤、搜索、聚合、排名或分页。管理员看获授权全部，经理看部门及子部门，业务员看本人；系统管理员与业务数据管理员沿用现有区分。浏览器不能提交 userId、tenantId、权限白名单等字段（400）。请求过程中绑定或范围变化拒绝返回（403）。明细额外检查 workbenchRole，未授权岗位拒绝。

统计单位为履约订单 ID，使用订单支付时间 paidAt，业务时区为 UTC+8。只纳入 paymentStatus=paid、reviewStatus=approved 且 paidAt 有效、已发生的履约订单；排除 cancelled、全额退款、未支付、缺少或无效支付时间及未来支付的订单，不回退使用 createdAt。图表分组、客户排名、分仓统计与明细查询使用同一支付日期口径；明细按支付时间倒序排列。SKU 数量、包裹数量及全款／押金备货不计为履约订单数。组织／业务员／客户统计归属四个业务部门，物流服务商统计涵盖当前用户获授权全部订单。无权／不存在的筛选 ID 返回零结果，不回退到全部数据。未关联稳定客户 ID 的有效订单归入其他客户，不按名字猜测身份。

月份：当年一月至当前月；历史年十二月。周：weekOf 所在周一至周日以及前三周。日：year/month 的全部日历天数，未来日期为 null，已经发生且无订单为 0。当前月／周仅统计截至服务器当前时刻；前端显示完整桶的边界与更新时间。

## HTTP 接口

基路径 `/api/autoflow/integrations/fop/order-volume`，GET 查询参数采用平铺字段。

### GET /order-volume

| 参数 | 值 / 含义 |
| --- | --- |
| category | carrier / organization / salesperson / customer，必填 |
| from / to | 客户日期范围，YYYY-MM-DD，两个字段必须同时提供；新客户页面必填 |
| grain | month / week / day，综合分析必填；不能与 from/to 同时传入 |
| year | 2020 至当前年，综合分析必填；不能与 from/to 同时传入 |
| month | 1—12，day 时必填 |
| weekOf | YYYY-MM-DD，week 默认本周，不能未来日期 |
| department | sales1 / sales2 / sales3 / sales4；省略为授权范围 |
| objectId | 服务商代码或业务员稳定 ID，只供 carrier / salesperson |
| customerId | 仅 customer 使用；省略为前十排名，提供则为指定客户趋势 |
| warehouse | ALL / HZ / SZ / UNASSIGNED，默认 ALL |

```json
{
  "source": "mock",
  "query": { "category": "customer", "from": "2026-10-01", "to": "2026-10-22", "warehouse": "ALL" },
  "timeZone": "UTC+8",
  "asOf": "2026-10-22T10:00:00.000Z",
  "total": 35,
  "customerCount": 12,
  "periods": [{ "id": "2026-10-01", "label": "2026-10-01", "from": "2026-10-01", "to": "2026-10-01", "future": false }],
  "series": [{ "id": "total", "label": "授权范围合计", "kind": "total", "total": 35, "values": [35], "warehouses": { "HZ": [20], "SZ": [15], "UNASSIGNED": [0] } }],
  "options": { "departments": [{ "id": "sales1", "label": "业务一部" }], "objects": [] }
}
```

示例为缩略结构，实际 periods 和各 values 长度严格相同。series 为 total 置顶、detail、可选 other/unassigned。明细字段可含 entityId、code。客户最多十个 detail 和一个 other（有剩余时），其他=总量减前十。服务商 options 为固定六类公共目录；其余 options 从本次账号授权订单生成，不通过选中其他部门来扩大权限。客户列表不放在 options，避免加载全部客户目录。

拥有 receipts scope 时，`category=customer` 的每个 `series`（含 total、detail、other）返回 `amounts`。金额来自独立授权的收款分录，与数量共用客户集合、日期和仓库筛选；没有收款 scope 时省略 amounts，前端显示未授权／不可用而非 0：

```json
{
  "currency": "USD",
  "total": 2360.50,
  "values": [2360.50],
  "warehouses": { "HZ": [1600.20], "SZ": [760.30], "UNASSIGNED": [0] },
  "excludedOrderCount": 0,
  "breakdown": { "fulfillment": 1600.20, "fullPaymentStock": 760.30 }
}
```

金额以收款分录 `amount`（`hzkj_real_receive_amt`）为准：源单已支付、已审核且收款单已审核的履约和全款备货分录，排除押金备货、样品、取消／退款／未来支付。支付月按 UTC+8 归属。使用全款备货库存时，源履约金额已免产品款，分析层不补回也不重复扣除。钱包授信也可能形成业务结算，不将本金额视为新增银行现金流。

逐笔转整数分后聚合；有效金额必须非负且分币安全，累计也验证安全精度。仅 USD 进入业绩，不隐式换汇。`excludedOrderCount` 为保留兼容字段名，现表示该系列因非 USD 被排除的收款分录数，不是履约订单数。`breakdown.fulfillment + breakdown.fullPaymentStock = total`；values 和各仓库数组与 periods 对齐。数量为 0 但有全款备货回款的客户仍可搜索、显示金额，进入完整总计／other；Top 10 成员仍由履约订单量决定。

客户支付日期范围按UTC+8解释，包含开始和结束当天，可跨月、跨年；最早 2020-01-01，结束日期不晚于UTC+8 今天。非法日历日期、缺失一端、起止颠倒、未来日期及混入 grain/year/month/weekOf 参数返回 400。范围内每日生成一个 period，无订单为 0。旧客户月／周／日链接仍可解析以兼容历史入口，但新客户页面只发送 from/to；综合分析仍使用原时间轴参数。两种模式共享权限校验、排名、分仓、合计和明细过滤。

### GET /order-volume/customers

`keyword` 必填、trim 后 1—100 字符，`department` 可选，`page` 默认 1，`pageSize` 默认 10、最大 50。返回：

```json
{ "source": "mock", "items": [{ "id": "customer-stable-id", "code": "C001", "name": "Olivia Martin", "departments": ["业务一部"] }], "total": 1, "page": 1, "pageSize": 10 }
```

仅返回当前账号有权的已审核有效订单（可含未支付）或有效收款分录关联的客户；收款客户须有独立收款授权。输入名称搜索分页选取；精确编码且唯一命中可直接选中。空关键词 400；不返回无权名称或数量。搜索不限制某一统计周期，选中客户在所选时间无单时呈现零数据。

### GET /order-volume/orders

继承统计参数，增加：

- `workbenchRole`：sales/procurement/allocation/dispatch/warehouse，必填且必须有岗位权限。
- `seriesId`：统计响应返回的行 ID，默认 total；other 使用相同完整区间 Top N 集合的剩余订单。
- `periodId`：响应 periods 的 ID；省略为整个周期。
- `detailWarehouse`：HZ/SZ/UNASSIGNED，可选。先确定完整查询范围的排名，再按分仓过滤，不能通过修改 warehouse 重新排名。
- `page` 默认 1；`pageSize` 默认 20、最大 100。

响应复用履约订单分页合同 `{ source, total, totals, page, pageSize, items: FopOrder[] }`。包含 orderNumber、shopifyOrderNumber、customerId/customerCode/customerName、items（图片/SKU/商品/规格/数量）、支付状态、金额/货币、组织/部门/owner、仓库、服务商、支付时间（paidAt）、创建时间（createdAt）等；不暴露租户元数据。

`totals` 是当前用户权限与全部查询条件过滤后、分页前的完整合计，Mock 和 FOP 模式合同一致：

```json
{
  "orderCount": 35,
  "itemQuantity": 78,
  "amountsByCurrency": [{ "currency": "USD", "amount": 2360.50 }]
}
```

订单按稳定 ID 去重计数；商品件数与订单数分开；一笔多 SKU 订单的金额只计一次。金额按显示精度两位小数逐笔转为分后累加，按源币种分别返回（未指定为 USD），不混币、不做隐式换汇。空结果为 `{ orderCount: 0, itemQuantity: 0, amountsByCurrency: [] }`。`GET /fulfillment-orders` 同样返回此字段，且适用 queue/search/orderNumber 等过滤。前端不以当前页推算全部金额，查询失败时不显示旧合计。

统计清单页尾使用响应中 `kind: total` 的序列作为合计，不将已有汇总序列、各部门、Top 10 与其他重复累加。各时间桶和仓库列分别对齐，未来时间桶仍为 `null`（页面显示“—”）。详见 [列表合计约定](./TABLE_TOTALS.md)。

### GET /order-volume/receipts

客户回款金额下钻专用，继承 `/order-volume/orders` 参数并要求 `category=customer`；需有效岗位及 `receipts` scope。同一完整日期、部门、仓库筛选先确定数量 Top 10 和 other 客户集合，再用 `periodId/detailWarehouse` 收窄分录，不在下钻时重新排名。仅有全款备货金额、数量为 0 的客户属于有效客户集合。金额明细不会再调用订单分页冒充收款。

### GET /receipts

完整路径 `/api/autoflow/integrations/fop/receipts`，供 Dashboard 部门／业务员月度回款下钻。

| 参数 | 含义 |
| --- | --- |
| from / to | 必填，UTC+8 支付日期，含首尾；2020-01-01 至今天；严格有效日期且 from≤to |
| department / ownerId / customerId | 可选，报表部门、稳定业务员 ID、稳定客户 ID，仅收窄授权范围 |
| warehouse | ALL / HZ / SZ，默认 ALL |
| sourceType | 可选 fulfillment / full_payment_stock |
| workbenchRole | 必填，当前账号拥有的工作台角色 |
| page / pageSize | 默认 1 / 20；page≤1000000，pageSize≤100 |

两收款端点响应相同：

```json
{
  "source": "mock",
  "timeZone": "UTC+8",
  "total": 0,
  "page": 1,
  "pageSize": 20,
  "totals": {
    "receiptCount": 0, "currency": "USD", "amount": 0,
    "fulfillmentAmount": 0, "fullPaymentStockAmount": 0,
    "orderAmount": 0, "handlingFee": 0
  },
  "items": []
}
```

`items: FopReceipt[]` 为有效 USD 分录，按 paidAt 倒序、id 稳定排序。每行有分录 `id`、`sourceType`、源单 `documentId/documentNumber`、客户、部门、owner、仓库、`carrierCode`、`amount/orderAmount/handlingFee/currency`、`paidAt`、源单 `reviewStatus`、`receiptReviewStatus`、`paymentStatus`、`cancelled` 与 `items`。全款备货 carrierCode 显式 null；公开序列化剥离 tenantId 和 departmentPathIds。`total` 与 `totals.receiptCount` 都是完整筛选后的收款分录数；所有合计在分页前计算，来源金额之和等于 amount。orderAmount、handlingFee 用于核对，不能替换实收业绩；不重复累加表头金额。

请求示例：`/api/autoflow/integrations/fop/receipts?from=2026-10-01&to=2026-10-22&department=sales1&warehouse=ALL&workbenchRole=sales&page=1&pageSize=20`。客户 other 示例：`/api/autoflow/integrations/fop/order-volume/receipts?category=customer&from=2026-10-01&to=2026-10-22&warehouse=ALL&seriesId=other&workbenchRole=sales&page=1&pageSize=20`。缺少收款 scope 返回 403；有 scope 但白名单为空返回合法空结果。未知身份／权限字段返回 400。

## FOP 接入点

后端 `fop-data.types.ts` 定义 FopDataProvider、FopOrder 与 FopReceipt。FOP 是金蝶云苍穹上的 HyperZone 自研应用，源码证据见 [字段映射](analytics/HYPERZONE_FOP_SOURCE_MAPPING.md)。实际适配器实现 resolvePermissions、listOrders、listReceipts，返回稳定身份、allowedOrderIds 及独立 allowedReceiptIds；不能接受浏览器传入的授权范围。缺失 allowedReceiptIds 默认无收款权限；订单授权不能推导收款授权。新增标准化字段：

| 字段 | 适配要求 |
| --- | --- |
| paidAt | 带时区的 ISO 8601 支付时间，归入 UTC+8 支付日期；缺失不参与订单量统计 |
| customerId / customerCode | 稳定客户主键／编码，不以名称充当身份 |
| salesDepartmentCode | sales1—sales4，由可信组织映射向上归属 |
| owner.id / departmentPathIds | 用户级、部门及子部门过滤依据 |
| warehouseCode | 已审核履约必须 HZ 或 SZ；缺失／未映射拒收，不能当普通未分配类别 |
| carrierCode | 已审核履约必须 YT / 4PX / WB / YW / JS / OTHER；缺失／未映射拒收。备货收款必须 null，表示物流不适用 |
| currency | 默认 USD，已有明确源币种保留 |

Demo 所有订单均带有六类之一的服务商，服务商分布独立于订单阶段与仓库；采用稳定加权数据，覆盖不同月份和杭州／深圳两仓。当前显式 demo provider 与 FOP 使用同一 HTTP／TypeScript 合同，无浏览器 mock fallback。真实 FOP 仍未连接。生产大数据量接入应将同一权限过滤和聚合口径下推至后台查询服务，保留此响应结构。

## 验证入口

后端 order-volume.spec.ts：Top 10＋其他、去重、取消／退款、仓库守恒、其他分仓下钻、跨年周、闰月、未来 null、UTC+8 日期、同名不同 ID、未知客户、部门合计。

fop-data-access.e2e-spec.ts：认证、防伪造身份、管理员／业务员／经理范围、搜索分页、岗位权限、请求中撤权。

前端 OrderVolumeAnalysis.test.ts、orderVolume.test.ts：默认排名、选中与清空、异步旧结果丢弃、明细入口、账号重置、错误清屏、最新时间窗口。
