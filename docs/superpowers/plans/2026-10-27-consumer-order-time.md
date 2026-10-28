# Sales unpaid consumer order time

> **For agentic workers:** Use superpowers:executing-plans inline; preserve existing unrelated edits; no commit requested.

**Goal:** 销售待支付清单将“创建时间”改为“C端下单时间”，取消费者在Shopify首次完成该订单付款的时刻。

**Architecture:** 新增独立可空 `consumerPaidAt`，可信FOP网关按店铺+源Shopify订单归集首次完成付款的业务事件时间。BFF只读取明确字段，校验带时区日期后输出UTC ISO；前端/Excel按UTC+8显示。其他队列继续createdAt，不改paidAt/金额/权限/队列或排序。

**Tech Stack:** Vue/TypeScript、NestJS、ExcelJS、OpenAPI。

**Spec / evidence:** FOP SyncShopifyOrdersTask.java:1195–1196 将created_at存入hzkj_bizdate，1227–1228把financial_status/processed_at存入hzkj_sourcepayststus/hzkj_datetimefield；2095–2101会更新后者。Shopify OrderCreateOrderInput文档定义processedAt是订单处理时间，可回填，不能直接保证支付完成。用户口径明确，故不拿旧字段冒充付款时间。

## Constraints / review focus
- 与B端履约收款paidAt、FOP创建createdAt严格区分；unpaid表示尚未向FOP付款，不代表C端未支付。
- 首次完成付款是首次付清事件，不是首笔押金、授权、最近同步、退款/补款时间；生产网关需持久化该事实。
- 非法/缺少时区/空/未核实时间返回null，不回退到其他时间；新字段只在已授权订单上返回。
- 待支付表头、窄屏字段标签和两种Excel一致，其他页签不变。
- 不修改FOP源码；当前FOP真实支付完成时间接入缺口必须明确交付IT，不能声称已生产接通。

## Tasks
- [x] 增加接口、UI、导出回归测试并确认旧代码失败。
- [x] 新字段、BFF规范化、Demo及待支付展示/导出落地。
- [x] 同步OpenAPI/映射/人工核对待办/MD/HTML，验证并独立审查。

## Verification
- 前端349项、后端557项、FOP HTTP160项通过；lint、构建和OpenAPI428例通过。
- 首轮HTTP旧排行榜测试socket hang up，未改代码重跑全套通过；没有以跳过测试规避失败。
- 实际1280px浏览器待支付列表宽947/scrollWidth947，新字段显示UTC+8时间；截图见`.runtime/workbench-follow-up/consumer-order-time.png`。
- 最终独立审查无Critical/Important/Minor问题；未改FOP生产源码，首次付款完成时间的真实网关映射明确列为IT联调待办。
