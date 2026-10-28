# Unpaid custom logistics channel

> Execute inline using superpowers:executing-plans; preserve other work; no commit requested.

**Goal:** 待支付清单显示自定义物流渠道名称，物流搜索改为自定义渠道名称；全部清单字段/筛选/导出统一发货仓库与业务部门。
**Architecture:** 新增可空customLogisticsChannelName，可信网关源自hzkj_orders.hzkj_customer_channel.name（现有OrderController响应hzkj_customer_channel_name），BFF去空白白名单输出。unpaid关键词搜索使用该名称替代carrier/carrierCode，其他公共搜索字段及其他队列不变。UI与两种Excel同步。
**Tech Stack:** Vue/TS、NestJS、ExcelJS、OpenAPI3.1。
**Spec:** 用户本轮要求；FOP OrderController.java:3602–3603查询自定义渠道name，3686–3689响应其id/number/name；区别实际包裹渠道及物流服务商。

## Constraints
- 名称缺失为null/—，不以实际渠道或物流商替代；只展示名称，不增自定义渠道编码列。
- 待支付搜索先授权，再与业务部门、发货仓库等条件取交集，之后合计分页/导出；不得只改占位提示。
- 其他队列仍支持物流服务商搜索；公共关键词（业务员/订单/客户/店铺/SKU）不变。
- 全部待办及订单/回款/运费明细清单统一字段标题，组织架构/权限管理不改；API warehouseCode/departmentId等名称和权限规则不改。
- 真实FOP网关映射需IT联调，本次不改FOP生产源码。

## Tasks
- [x] 编写并验证UI、接口搜索/权限/分页合计及Excel回归RED。
- [x] 实现新字段、Demo、按队列搜索和统一清单文案，验证GREEN。
- [x] 更新契约及交接文档，构建、视觉检查和最终独立审查。

## Review / verification
- 独立审查指出回款明细清单也应统一字段名称；按用户全部清单范围补齐，既有中英文可读标签测试的预期同步修改。
- 页面实测待支付29笔，查询“带电”返回9笔且均显示带电专线；表格宽947/scrollWidth947，无横向溢出。
- API162项、Excel7项通过，真实网关映射仍明确待IT联调。
- 最终前端351项、后端559项全量通过，lint和生产构建通过；无剩余审查项。
