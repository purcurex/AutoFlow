# Review logistics channels

> Execute inline with superpowers:executing-plans; preserve existing edits; no commit requested.

**Goal:** 销售待审核清单在发货仓库后增加物流渠道，同一格显示实际渠道名称（编码），多渠道分行；同步接口、Demo和Excel。
**Architecture:** FopOrder新增可空logisticsChannels数组，各项name/code可空，BFF白名单输出并去重；只在review展示。可信网关从订单包裹实际渠道取值，不从物流商分类或自定义渠道推断。其他队列、权限、合计不变。
**Tech Stack:** Vue/TS、NestJS、ExcelJS、OpenAPI3.1。
**Spec / evidence:** 用户本轮要求；OrderController.java:3610–3612加载hzkj_logistics_info.hzkj_channel的id/name/number；OrderBatchModifyService.java:537–551单包裹优先分录，历史缺值回退hzkj_logistics_channel；实际基础资料实体hzkj_logistics_channel，区别hzkj_customer_channel自定义渠道及已审核发运回写字段hzkj_ship_channel。

## Constraints
- 多包裹保留所有不同实际渠道，不取任意第一条；同一名称编码去重，缺失不伪造，不以物流商名称/编码替代。
- 先订单授权再字段序列化；对象只输出name/code，忽略任何额外字段。
- 单包裹历史兼容可由网关回退订单表头实际渠道；多包裹未维护渠道不能被表头代填。
- 本库提供字段接收与展示，FOP生产源码不修改；真实网关映射仍需IT联调。
- 表头/窄屏标签/两种Excel一致；新增列计数和总计跨度一致；无横向滚动。

## Tasks
- [x] UI、API权限/旧适配器/非法值及Excel测试RED。
- [x] 类型、允许字段归一、Demo、列和导出实现，测试GREEN。
- [x] 更新源映射/OpenAPI/需求交接、生成MD/HTML、构建/视觉核对及一次独立审查。

## Verification
- 新UI/API/Excel测试已观察RED→GREEN；全前端350项、后端558项、HTTP161项通过；lint及生产build通过。
- OpenAPI430个示例与标准MD/HTML生成通过；实际1280px页面表格宽947/scrollWidth947。
- 最终独立审查无剩余问题；真实FOP网关映射明确保留为IT联调项，没有将Demo或源码查询误报为生产接通。
