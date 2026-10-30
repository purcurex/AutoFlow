# FOP 测试接口授权核对清单

核对日期：2026-10-29。测试域名：`https://hyperzone.test.kdgalaxy.com`。

调用应用 `client_id`：**`HuaZhiQD`**（华智前端系统）。本清单不含Token、密钥或应用身份凭证。请求使用服务端获取的增强型Token，以 `access_token` 和 `x-acgw-identity` 请求头传递。

## 已成功

`POST https://hyperzone.test.kdgalaxy.com/kapi/oauth2/getToken` 已成功获取Token。

`POST https://hyperzone.test.kdgalaxy.com/kapi/v2/hzkj/hzkj_ordercenter/order/queryOrder` 已用提供的客户内码及类型参数查到 `SO261028000002`：HTTP200、status=true、errorCode=0，total=1，2条商品明细。本次客户端没有额外发送openapisign，以上两个鉴权请求头已足够完成本次查询。

## 本阶段优先：组织和用户查询

以下4项在同一有效Token下均返回 **HTTP519 / errorCode2505 / 应用未订阅此API[网关]**。请按具体API为该应用补充授权，不扩大到无关接口。

| 用途 | 方法 | 完整请求地址 |
| --- | --- | --- |
| 行政组织/部门列表 | POST | https://hyperzone.test.kdgalaxy.com/kapi/v2/base/bos_adminorg/getList |
| 按用户名查询用户 | POST | https://hyperzone.test.kdgalaxy.com/kapi/v2/xkbase/bos_user/getListByUserName |
| 按姓名查询用户 | POST | https://hyperzone.test.kdgalaxy.com/kapi/v2/kdxk/base/bos_user/getUserListByName |
| 按ID查询用户 | GET | https://hyperzone.test.kdgalaxy.com/kapi/v2/base/bos_user/getList |

FOP后台入口：开放服务云 → OpenAPI → 安全策略 → 第三方应用 → 华智前端系统（HuaZhiQD）。由后台按接口归属确认使用“服务授权”还是“自建API授权”。接口路径不同的xkbase/kdxk/base前缀按原始清单保留，未自行替换。

授权后请提供这4项的Swagger或经确认的最小请求JSON，并确认Wendy的用户编号 `ID-000015` 对应的用户内码、员工masterid和部门内码。应用接口订阅与代理用户的数据权限分别核对；不能以当前代理用户的权限代替Wendy权限。

## 待办链路：发运、采购、配货

| 用途 | 方法 | 完整请求地址 | 最新结果 |
| --- | --- | --- | --- |
| 发运单查询 | POST | https://hyperzone.test.kdgalaxy.com/kapi/v2/hzkj/hzkj_logistics/hzkj_deliver_bill/queryDispatch | HTTP519 / 2505，未订阅 |
| 采购订单查询 | POST | https://hyperzone.test.kdgalaxy.com/kapi/v2/hzkj/hzkj_einkauf/hzkj_purorderbill/queryPurchase | HTTP519 / 2505，未订阅 |
| 配货单查询 | POST | https://hyperzone.test.kdgalaxy.com/kapi/v2/hzkj/hzkj_ordercenter/hzkj_alloc_bill/queryAllocation | HTTP404 / 2530，路由未找到 |

发运和采购需授权；配货先核对测试环境是否发布及实际路径，再授权。请同时提供测试订单关联的发运、配货、采购单编号；这些接口的billno是各自单据号，不能一律使用履约单号。

## 工作台数据范围尚未验收

已取得的订单响应含订单/客户/商品/金额等数据，但没有明确的业务员、业务部门、资源白名单及完整待办进度事实。它证明该代理用户可读此订单，不证明Wendy、部门经理或协同岗的最终权限范围。组织/用户查询、订单归属与资源授权契约补齐后，再联调本人/部门/公司范围的清单、合计、分页和导出。

本轮只进行了认证和查询，未修改FOP业务数据或授权配置，未把真实数据接入演示工作台。
