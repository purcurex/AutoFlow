# 订单量分析 API 与接入约定

2026-10-22 · 对应设计 v1.3。正式页面：Dashboard 底部「业务订单量分析」「客户订单分析」；各岗位工作台新增「订单分析」，订单原始明细只在岗位工作台显示。

## 业务展示

- 综合分析：物流服务商、组织、业务员。第一级类别，第二级部门／明细对象，第三级月／周／日；仓库独立筛选。
- 物流商固定顺序：云途YT、4PX、万邦WB、燕文YW、极速JS、其他。筛选项、图例、分布图及表格使用相同顺序，空类别保留0值；不按订单量重排。不提供“未分配服务商”，缺失、未知及旧 UNASSIGNED 代码归入 OTHER，合计和明细下钻使用同一映射。每个服务商独立固定配色，其他为灰色。
- 组织：营销中心包含 sales1—sales4；选部门则展示部门合计与成员。业务员模式为整个查询周期的 Top 5＋其他业务员，可按部门及单一业务员筛选。
- 客户：独立使用开始日期、结束日期筛选，默认本年 1 月 1 日至今天；页面不再提供年份、按月／周／日的时间轴选项。默认前十客户＋其他客户，剩余客户不逐个展示。客户按稳定 ID 区分，相同名字不合并，显示名称和编码。点击排名客户或搜索名称／编码后显示所选日期范围内的每日趋势；其余合计不作为一个客户身份。排名不被搜索框缩小，改变关键词清空旧的单客户趋势。
- 汇总统一浅紫蓝，明细柔和配色，其他灰色。分仓共用系列、刻度与缩放窗口；全部仓库含未分配仓库，存在未分配数据时单列。
- 综合分析默认最新六个月、最近十四个已发生日期；周显示四组。客户趋势默认最近十四天，可向前滚动。完整区间排名、合计不随横向滚动改变。
- 统计与详情实时查询，图表显示 asOf，跨请求间有新增订单时可能变化；当前不提供历史快照或导出接口。

## 统一统计口径与权限

客户分析同时展示订单量和订单金额。两个图表使用同一组按订单量排名的前十客户及其他客户，不按金额重新分组；每个客户在清单中有「订单量」「订单金额」两行，分别计算占比、杭州仓、深圳仓及合计。勾选「分仓对比」后，两张图均展示仓库对比系列；选择单一仓库时停用对比。单客户趋势弹窗同样展示数量和金额两张图，沿用分仓设置及支付日期筛选，横向拖动同步日期窗口。每日清单按日期倒序并提供数量、金额和分仓合计。

所有接口均使用现有 JWT／会话认证，响应 `Cache-Control: private, no-store`。从数据库读取当前用户岗位及业务角色，再与绑定 FOP 租户、用户的订单白名单求交集，随后去重、过滤、搜索、聚合、排名或分页。管理员看获授权全部，经理看部门及子部门，业务员看本人；系统管理员与业务数据管理员沿用现有区分。浏览器不能提交 userId、tenantId、权限白名单等字段（400）。请求过程中绑定或范围变化拒绝返回（403）。明细额外检查 workbenchRole，未授权岗位拒绝。

统计单位为订单 ID，使用订单支付时间 paidAt，业务时区为北京时间（UTC+8 / Asia/Shanghai）。只纳入 paymentStatus=paid 且 paidAt 有效、已发生的订单；排除 cancelled、全额退款、未支付、缺少或无效支付时间及未来支付的订单，不回退使用 createdAt。图表分组、客户排名、分仓统计与明细查询使用同一支付日期口径；明细按支付时间倒序排列。SKU 数量、包裹数量不计为订单数。组织／业务员／客户统计归属四个业务部门，物流服务商统计涵盖当前用户获授权全部订单。无权／不存在的筛选 ID 返回零结果，不回退到全部数据。未关联稳定客户 ID 的有效订单归入其他客户，不按名字猜测身份。

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
  "timeZone": "Asia/Shanghai",
  "asOf": "2026-10-22T10:00:00.000Z",
  "total": 35,
  "customerCount": 12,
  "periods": [{ "id": "2026-10-01", "label": "2026-10-01", "from": "2026-10-01", "to": "2026-10-01", "future": false }],
  "series": [{ "id": "total", "label": "授权范围合计", "kind": "total", "total": 35, "values": [35], "warehouses": { "HZ": [20], "SZ": [15], "UNASSIGNED": [0] } }],
  "options": { "departments": [{ "id": "sales1", "label": "业务一部" }], "objects": [] }
}
```

示例为缩略结构，实际 periods 和各 values 长度严格相同。series 为 total 置顶、detail、可选 other/unassigned。明细字段可含 entityId、code。客户最多十个 detail 和一个 other（有剩余时），其他=总量减前十。服务商 options 为固定六类公共目录；其余 options 从本次账号授权订单生成，不通过选中其他部门来扩大权限。客户列表不放在 options，避免加载全部客户目录。

`category=customer` 的每个 `series`（含 total、detail、other）新增 `amounts`，与订单量使用完全相同的授权、去重、支付日期、客户和仓库过滤：

```json
{
  "currency": "USD",
  "total": 2360.50,
  "values": [2360.50],
  "warehouses": { "HZ": [1600.20], "SZ": [760.30], "UNASSIGNED": [0] },
  "excludedOrderCount": 0
}
```

金额以每笔订单 `amount` 为准，不按 SKU 行重复计算；先逐笔四舍五入到分，再聚合。`values` 和各仓库数组与 `periods` 一一对应，未来日期为 null，无订单为 0。USD 为默认币种；明确为其他币种或金额缺失的订单保留订单量，但不隐式换汇或并入美元金额，数量通过 `excludedOrderCount` 返回并在界面提示。Demo 订单均为 USD。缺失 `amounts` 的旧响应显示「—」，不伪造为 0；Mock 与后续 FOP 适配器使用同一合同。真实非美元数据如需统一美元业绩，应在可信适配层提供已按约定汇率转换的金额后再聚合。

客户支付日期范围按北京时间（UTC+8）解释，包含开始和结束当天，可跨月、跨年；最早 2020-01-01，结束日期不晚于北京时间今天。非法日历日期、缺失一端、起止颠倒、未来日期及混入 grain/year/month/weekOf 参数返回 400。范围内每日生成一个 period，无订单为 0。旧客户月／周／日链接仍可解析以兼容历史入口，但新客户页面只发送 from/to；综合分析仍使用原时间轴参数。两种模式共享权限校验、排名、分仓、合计和明细过滤。

### GET /order-volume/customers

`keyword` 必填、trim 后 1—100 字符，`department` 可选，`page` 默认 1，`pageSize` 默认 10、最大 50。返回：

```json
{ "source": "mock", "items": [{ "id": "customer-stable-id", "code": "C001", "name": "Olivia Martin", "departments": ["业务一部"] }], "total": 1, "page": 1, "pageSize": 10 }
```

仅返回当前账号有权订单关联的客户。输入名称搜索分页选取；精确编码且唯一命中可直接选中。空关键词 400；不返回无权名称或数量。搜索不限制某一统计周期，选中客户在所选时间无单时呈现零数据。

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

## FOP 接入点

后端 `fop-data.types.ts` 定义 FopDataProvider 与 FopOrder。实际适配器实现 resolvePermissions、listOrders，返回稳定身份及允许的订单 ID；不能接受浏览器传入的授权范围。新增标准化字段：

| 字段 | 适配要求 |
| --- | --- |
| paidAt | 带时区的 ISO 8601 支付时间，归入 UTC+8 支付日期；缺失不参与订单量统计 |
| customerId / customerCode | 稳定客户主键／编码，不以名称充当身份 |
| salesDepartmentCode | sales1—sales4，由可信组织映射向上归属 |
| owner.id / departmentPathIds | 用户级、部门及子部门过滤依据 |
| warehouseCode | HZ、SZ；缺失或未映射归 UNASSIGNED，不丢单 |
| carrierCode | YT / 4PX / WB / YW / JS / OTHER；缺失、未知及旧 UNASSIGNED 归入 OTHER |
| currency | 默认 USD，已有明确源币种保留 |

Demo 所有订单均带有六类之一的服务商，服务商分布独立于订单阶段与仓库；采用稳定加权数据，覆盖不同月份和杭州／深圳两仓。当前显式 demo provider 与 FOP 使用同一 HTTP／TypeScript 合同，无浏览器 mock fallback。真实 FOP 仍未连接。生产大数据量接入应将同一权限过滤和聚合口径下推至后台查询服务，保留此响应结构。

## 验证入口

后端 order-volume.spec.ts：Top 10＋其他、去重、取消／退款、仓库守恒、其他分仓下钻、跨年周、闰月、未来 null、上海日期、同名不同 ID、未知客户、部门合计。

fop-data-access.e2e-spec.ts：认证、防伪造身份、管理员／业务员／经理范围、搜索分页、岗位权限、请求中撤权。

前端 OrderVolumeAnalysis.test.ts、orderVolume.test.ts：默认排名、选中与清空、异步旧结果丢弃、明细入口、账号重置、错误清屏、最新时间窗口。
