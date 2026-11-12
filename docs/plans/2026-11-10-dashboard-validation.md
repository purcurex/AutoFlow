# Dashboard 验证记录

前端全量：74 个文件、594 项通过。后端看板及权限定向：3 个套件、59 项通过；五卡与列表对账及经理下级范围定向回归通过。前后端构建通过，独立代码审查未发现本轮范围的 P0–P2 问题。

后端全量：95 个套件中 84 个通过、11 个失败；1281 项中 1220 项通过、61 项失败。本轮运行时共享工作区还存在其他未提交及并行修改，失败集中在付款时间、完成清单、备货及导出适配；不能将全量回归描述为通过。本次未扩大范围修复这些业务行为。以下保留失败用例名称供对应改动继续处理。

真实账号浏览器核查没有取得可对账的完整统计，先出现查询端点未发布提示，随后复验加载失败。采购／配货／出库上游能力尚未接通，本次未修改生产 FOP 应用。

## 后端全量失败索引

### src/modules/fop-data/fop-demo.spec.ts

- legacy paged order filter compatibility › rejects unsupported upstream filter {"shippingCountryCode":"US"} before querying pending orders
- isolated mock FOP dataset › filters completed review by customer payment before paging and Excel, preserving independent phase dates
- isolated mock FOP dataset › filters completed dispatch by customer payment before paging and Excel, preserving independent phase dates
- isolated mock FOP dataset › filters completed procurement by customer payment before paging and Excel, preserving independent phase dates
- isolated mock FOP dataset › filters completed allocation_review by customer payment before paging and Excel, preserving independent phase dates
- isolated mock FOP dataset › filters completed shipping by customer payment before paging and Excel, preserving independent phase dates

### src/modules/fop-data/procurement-groups.spec.ts

- sorts completed purchase groups by customer payment while keeping independent phase timestamps

### src/modules/fop-data/fop-order-export.spec.ts

- fulfillment Excel export › exports review completion dates and completed-state metadata consistently with the page
- fulfillment Excel export › exports dispatch completion dates and completed-state metadata consistently with the page
- fulfillment Excel export › exports procurement completion dates and completed-state metadata consistently with the page
- fulfillment Excel export › exports allocation_review completion dates and completed-state metadata consistently with the page
- fulfillment Excel export › exports shipping completion dates and completed-state metadata consistently with the page
- fulfillment Excel export › exports consumer payment completion time for unpaid instead of creation time
- fulfillment Excel export › exports consumer payment completion time for review instead of creation time
- fulfillment Excel export › exports consumer payment completion time for exceptions instead of creation time
- fulfillment Excel export › exports consumer payment completion time for dispatch instead of creation time
- fulfillment Excel export › exports consumer payment completion time for allocation instead of creation time

### src/modules/fop-data/fop-unpaid-orders.spec.ts

- 按角色读取待支付平台订单 › 管理员保留全部部门范围、上游合计和源单付款时间
- 按角色读取待支付平台订单 › 合计接口保留角色并携带相同时间和仓库条件

### src/modules/fop-data/fop-kingdee.stock.spec.ts

- reads independent stock grants and never calls fulfillment or Shopify routes
- maps both stock types and payment/audit stages without hiding received records
- exports selected real-adapter stock orders and preserves all SKU quantities
- totals fractional stock quantities without floating point tail errors
- retains historical header-only orders in lists, totals and Excel without inventing product rows
- keeps the 77th header-only order and surrounding products across full source pages, totals and exports
- requires the independent stock code mapping even when the original warehouse ID mapping is configured
- maps stock by warehouse number when the ID and name change, preserving the original ID mapping semantics elsewhere
- keeps leading zeros in warehouse numbers without depending on the original ID map
- maps multiple confirmed Shenzhen warehouse numbers to SZ and keeps inventory balances grouped by customer, SKU and business warehouse
- shows an unassigned historical owner only within existing scope {"role":"admin","employeeId":null,"departmentId":null}
- shows an unassigned historical owner only within existing scope {"role":"department_manager","employeeId":null,"departmentId":"400"}
- keeps inventory permission independent and merges duplicate dimensions with decimal arithmetic
- matches selected stock inventory through the query grant without using an empty ID allowlist as authorization
- collects every bounded page before local filtering, totals and pagination
- local stock employee scope › uses the independent stock capability and employee echo for orders without FOP department mapping
- local stock employee scope › returns no rows for an empty local range without sending an unrestricted stock query
- keeps raw procurement status 2 as in progress rather than asserting a paid supplier order
- local historical stock ownership compatibility › retains an unassigned historical stock order for a local admin with the current FOP full grant

### src/modules/fop-data/fop-kingdee.provider.spec.ts

- Kingdee server-paged review integration › 待审核保留源单付款时间2026-10-02T01:30:00Z，不回退创建或收款日期
- Kingdee server-paged review integration › 待审核页面服务允许源单付款时间排序，并保留金蝶总数与支付审核条件

### src/modules/fop-data/fop-kingdee.detail.spec.ts

- authorized fulfillment detail enrichment › adds the order recipient without replacing source totals, sorting times or unconfirmed progress

### src/modules/fop-data/fop-dispatch-orders.spec.ts

- 待履约真实分页接口 › 完整返回四种状态：dispatch_missing
- 待履约真实分页接口 › 完整返回四种状态：dispatch_draft
- 待履约真实分页接口 › 完整返回四种状态：dispatch_submitted
- 待履约真实分页接口 › 完整返回四种状态：dispatch_approved

### src/modules/fop-data/fop-completed-dispatch-orders.spec.ts

- 已履约真实分页接口 › 透传完成模式、时间与权限内筛选，映射发运单审核时间
- 已履约真实分页接口 › BFF 已履约列表沿用上游完整合计
- 已履约真实分页接口 › 完成模式省略时间时明确使用默认近一周
- 已履约真实分页接口 › 已履约导出保留固定主键清单与完成条件，并再次核验

### src/modules/fop-data/customer-payment-time.spec.ts

- customer last payment completion from actual FOP receipt entries › accepts native JSON number actual amounts for positivity without returning money: 50
- customer last payment completion from actual FOP receipt entries › accepts native JSON number actual amounts for positivity without returning money: 29.995
- customer last payment completion from actual FOP receipt entries › accepts native JSON number actual amounts for positivity without returning money: 26.44
- customer last payment completion from actual FOP receipt entries › accepts native JSON number actual amounts for positivity without returning money: 0.00001
- customer last payment completion from actual FOP receipt entries › accepts native JSON number actual amounts for positivity without returning money: 9007199254740991
- customer last payment completion from actual FOP receipt entries › does not count zero or negative native JSON number amounts: 0
- customer last payment completion from actual FOP receipt entries › does not count zero or negative native JSON number amounts: -0
- customer last payment completion from actual FOP receipt entries › does not count zero or negative native JSON number amounts: -50
- customer last payment completion from actual FOP receipt entries › does not count zero or negative native JSON number amounts: -29.995
- customer last payment completion from actual FOP receipt entries › does not count zero or negative native JSON number amounts: -9007199254740991

### src/modules/fop-data/procurement-groups-export.spec.ts

- preserves long identifiers, literal text, consumer payment time, store and variants and records export filters
- exports customer-payment range and sort metadata while retaining purchase completion dates
