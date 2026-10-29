# FOP 测试环境首次联调

## 环境及实测状态

2026-10-29，测试站点 `https://hyperzone.test.kdgalaxy.com`，用户提供租户 `ierp`、部署版本 `R202606.001`，尚未通过已鉴权接口复核。

首次无凭证探测返回HTTP519/errorCode2501，仅带应用身份时返回HTTP200/errorCode401。随后用户提供另一前端项目的完整凭据，已核对其数据中心和应用编码与本测试应用一致。

**最新结果：增强型Token获取已成功，提供的Token也已用于订单接口并进入参数校验。** 本次从应用凭据实际调用 `/kapi/oauth2/getToken` 成功，未输出或落盘新Token。业务请求使用 `access_token` 和 `x-acgw-identity`。当前仍未查询到测试订单、未绑定Wendy、未切换工作台真实数据。

| 接口（均带/kapi前缀） | 实测结果 | 下一步 |
| --- | --- | --- |
| POST /oauth2/getToken | 获取Token成功 | 凭据已可用 |
| POST /v2/hzkj/hzkj_ordercenter/order/queryOrder | HTTP200，errorCode400，customerId/type不能为空 | 提供测试订单客户内码及单据类型编码 |
| POST /v2/base/bos_adminorg/getList | HTTP519，2505，应用未订阅此API | 为当前应用授权 |
| POST /v2/xkbase/bos_user/getListByUserName | HTTP519，2505 | 为当前应用授权 |
| POST /v2/kdxk/base/bos_user/getUserListByName | HTTP519，2505 | 为当前应用授权 |
| GET /v2/base/bos_user/getList | HTTP519，2505 | 为当前应用授权 |
| POST /v2/hzkj/hzkj_logistics/hzkj_deliver_bill/queryDispatch | HTTP519，2505 | 为当前应用授权 |
| POST /v2/hzkj/hzkj_einkauf/hzkj_purorderbill/queryPurchase | HTTP519，2505 | 为当前应用授权 |
| POST /v2/hzkj/hzkj_ordercenter/hzkj_alloc_bill/queryAllocation | HTTP404，2530，路由未找到 | 核对测试环境实际发布路径/部署状态，再授权 |

上述业务接口使用最小参数作鉴权/路由诊断，未查询或修改业务明细。组织/用户用空参数探测网关，单据查询保留分页但未提供未知的单据编号；不把诊断请求当作已确认业务契约。HTTP200不等于业务成功。截图“启用代理用户控制”已开启，不能将当前代理用户授权当作Wendy授权。

## 资料核对

- `openApi_swagger_v2 (4).json` 包含采购、配货、发运3个接口，`openApi_swagger_v2 (5).json` 包含订单查询；完整路径均带 `/kapi/v2/…` 前缀。
- Swagger写 `accessToken` 请求头；实测用户指定的 `access_token` 已通过订单接口鉴权，无需切换其他拼写。
- FOP源码 `code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/OrderController.java` 的 `queryOrder` 按客户ID与单据类型过滤，`str` 是模糊查询词。需提供 `SO261028000002` 的真实 `customerId` 和 `hzkj_billtype.number`，不能将员工ID当客户ID。源码分页 `pageIndex` 从0起；云端部署是否一致须实测。
- 订单源码返回 `data.array` 和 `data.total`，本次Swagger没有描述data内部结构。采购/配货/发运请求为 `{ data: { billno }, pageNo: 1, pageSize: 10 }`，返回 `data.rows`；billno是对应单据编号，不能都填履约单号。
- 采购/配货/发运Swagger只列ID、编号、状态及3个时间字段，缺少工作台所需的关联订单、商品、归属、付款、齐套、出库等完整事实。这3个查询实现未在当前本地Java源码中定位到，可能由平台API配置发布，需后台确认。
- 两份Swagger未包含组织、用户、权限接口，也未证明查询按Wendy的数据权限过滤。组织/用户参数契约仍须补充，当前只探测了网关授权；正式查询使用经后台确认的请求JSON。
- 用户已确认 `ID-000015` 是Wendy的FOP用户编号，仍需接口解析其真实内码。本机Wendy账号 `wendy@hzdrop.com` 的平台编号是 `000019`，两套编号独立，FOP绑定尚为空。

## 私有配置

模板为 `backend/.env.fop.local.example`，本机填写 `backend/.env.fop.local`（Git忽略、权限0600）。该文件仅供联调工具使用，不改变应用演示模式。

本机已补齐5项认证配置，数据中心ID已由私有资料确认。为了避免固定Token过期后阻塞，本机可选 `FOP_OPENAPI_ACCESS_TOKEN` 已留空，默认每次CLI调用先获取Token；用户提供的Token原文只保留在用户自己的私有资料中。

| 配置 | 后台需提供 |
| --- | --- |
| FOP_OPENAPI_CLIENT_ID | 第三方应用系统编码 |
| FOP_OPENAPI_CLIENT_SECRET | 测试应用增强型Token认证密钥 |
| FOP_OPENAPI_USERNAME | 应用允许的代理用户名，确认是否为Wendy |
| FOP_OPENAPI_ACCOUNT_ID | 真实数据中心accountId，不直接假定为ierp |
| FOP_OPENAPI_IDENTITY | 应用启用后颁发的x-acgw-identity原值 |
| FOP_TEST_CUSTOMER_ID / FOP_TEST_ORDER_TYPE | 测试订单客户内码及单据类型编码 |

也可暂时填写 `FOP_OPENAPI_ACCESS_TOKEN` 加 `FOP_OPENAPI_IDENTITY`，跳过获取Token。工具不会从历史Swagger示例提取密钥。

按[金蝶官方认证文档](https://developer.kingdee.com/knowledge/218694224487485696)，Token路径为 `POST /kapi/oauth2/getToken`，请求使用 `client_id/client_secret/username/accountId/language`、随机nonce及UTC时间戳，从 `data.access_token` 取令牌。HTTP 200仍须检查业务成功标志。Token仅存于进程内，未实现生产令牌缓存/刷新机制。

## 执行

在工程根目录运行：

```sh
# 无凭证探测；预期网关拒绝也以非零退出，不算业务接通
npm run fop:test-api -- --probe

# 配置完成后获取Token并查询指定订单
npm run fop:test-api

# 先只验证应用凭证（无需订单客户ID/类型，不输出Token）
npm run fop:test-api -- --auth-only

# 需要保留原始业务响应时，存入Git忽略目录、权限0600
npm run fop:test-api -- --save-response

# 配置对应单据编号后分别执行
npm run fop:test-api -- --operation dispatch
npm run fop:test-api -- --operation allocation
npm run fop:test-api -- --operation purchase

# 组织/用户请求结构必须先由后台确认；GET时JSON转为查询参数
npm run fop:test-api -- --operation user-by-username --request /private/confirmed-user-query.json
npm run fop:test-api -- --operation departments --request /private/confirmed-department-query.json

# 离线回归，不访问云端
node --test scripts/fop-openapi-smoke.test.mjs
```

报告保存在 `.runtime/fop-test/`，只输出状态、错误码、数据结构键及条数，不输出凭证或业务明细。`success=true`表示接口响应成功，订单是否命中另看 `matchedOrder`；null表示响应结构未识别。原始响应按原文保存，避免64位ID被JavaScript数字精度截断。所有操作均为查询，不修改FOP单据。

## 接入工作台前还需完成

1. 第三方应用认证已验证；补齐上述6项API订阅、修复配货路由。确认代理用户权限，将Wendy编号 `ID-000015` 解析为FOP用户ID，并确认员工masterid及部门内码。
2. 查到测试订单，核实客户、业务员和部门归属，取得关联发运/配货/采购单及完整字段。
3. 补齐组织、用户、岗位/资源权限契约，验证Wendy可见和不可见样本。现有 `FOP_EMPLOYEE_API_URL` 使用委托身份及资源白名单契约，不能直接填苍穹域名，也不能把第三方应用Token当作所有员工权限。
4. 在本地BFF完成字段转换及权限适配后，再以Wendy接入工作台。demo权限验证不等于真实FOP权限验证。
