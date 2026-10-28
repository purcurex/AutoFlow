# Sales stock workbench implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task, then request one fresh review.

**Goal:** 在销售待审核后增加备货清单，以及按客户查询全款/押金备货库存的弹窗。
**Architecture:** 备货采用独立类型、接口与资源白名单，不伪装成履约订单；复用工作台登录范围、只读刷新、分页和导出习惯。FOP 源码只读核实，真实网关留明确映射契约。
**Tech stack:** Vue 3 / TypeScript / NestJS / ExcelJS / Vitest / Jest。
**Spec:** 当前用户需求及已确认“全部有效备货订单，包含已完成采购”；本工程 agent.md。

## Global constraints
- 销售默认待审核不变；页签待支付、待审核、备货、异常；不改变 Dashboard 五张履约待办统计。
- 列：备货单号、商品信息、类型、订单金额、收款时间、客户、店铺、采购状态、收货仓库、业务员（部门第二行）。不带履约/Shopify单号、C端收件人、物流。
- 全部有效即排除取消；保留未付款和已入库，收款为空不伪造；默认收款升序，空值最后。
- 独立 allowedStockOrderIds / allowedStockInventoryIds；先登录权限后筛选/汇总/分页/导出；库存使用当前客户归属。
- 20/50/100 默认50；仓库全部/HZ/SZ，业务部门营销中心/一至四部；搜索清空自动恢复；30秒可见在线刷新及手动刷新；单号/SKU/客户复制。
- FOP hzkj_stock_order_new 类型1/2，hzkj_purchase_status 0/1/2/3/4，订单hzkj_orderstatus=0排除。采购与履约物流门槛无关。
- getStockInventoryQty 现有接口按SKU分页并返回仓库数量；hzkj_total_available_qty在代码锁定时减扣，不能再减锁定；弹窗分全款/押金可用、锁定，在库=可用+锁定。即时在库合计只指当前客户备货，不推断全仓公共库存。
- 不从备货订购量或收款金额推算真实库存。店铺来源在当前备货元数据未发现，真实适配允许null，列保留待IT确认。

## Review focus
- 系统管理员但非业务管理员、跨部门客户ID、缺失独立白名单均不能放大访问。
- 搜索/仓库/部门切换及登出时旧响应、库存与导出不得泄露。
- 未付款/已完成订单都保留；多商品金额只算一单，币种分开。
- 库存零值保留，非法/重复/跨租户记录不得合计；锁定不重复扣减。
- 待审核默认、履约队列/图表、其他岗位不因新增页签退化。

### Task 1: 备货接口与Demo
- [x] 新建 fop-stock.types.ts / dto / pure helpers / demo；扩展FopDataProvider与白名单。
- [x] 新增service查询、客户选项、库存查询、导出；控制器no-store，HTTP provider映射。
- [x] 写权限/筛选/排序/库存数量测试先失败后通过，验证空白名单、跨租户、业务范围、状态与搜索。

### Task 2: 清单和库存弹窗
- [x] 新建frontend fop-stock.ts、StockOrdersView.vue、StockInventoryDialog.vue；独立销售tab避免加入履约queue枚举。
- [x] 复用商品图片、复制、问号提示、主题；列表无横向滚动；库存弹窗客户搜索/选择、仓库/SKU查询、刷新及数量分组。
- [x] 页面测试覆盖默认tab、字段、搜索清空、过滤、过期响应与两种导出。

### Task 3: 对接交付与验证
- [x] 更新需求MD/HTML/OpenAPI与source mapping、交付待办；新增9.36。
- [x] 跑相关及完整测试、lint、build；浏览器检查宽/窄屏、搜索、筛选、库存及截图。
- [x] 一次独立最终review，修复重要问题；当前请求未要求Git，保留工作区更改。

执行结果：新功能、契约、Demo、权限/库存/导出测试完成；一次独立审查提出并修复承接业务员筛选问题。生产FOP对接保持明确待办，不修改FOP库，未执行Git提交（本次未要求）。
