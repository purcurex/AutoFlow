# FOP 测试环境首次联调

## 环境及实测状态

2026-10-29，测试站点 `https://hyperzone.test.kdgalaxy.com`，用户提供租户 `ierp`、部署版本 `R202606.001`，尚未通过已鉴权接口复核。

HTTPS可达，首页返回登录页。对Swagger订单路径发起不带凭证的POST，收到HTTP **519**、`errorCode=2501`、`messagecn=不存在应用信息[网关]`。这是网关拒绝，既不证明业务路由已发布，也不代表订单不存在。当前未获取Token、未查询到测试订单、未绑定Wendy、未切换工作台真实数据。

后续已从用户私有资料读取应用身份、数据中心ID，并从第三方应用截图确认应用编码，写入Git忽略的本机配置。仅带应用身份再次查询，响应变为HTTP **200**、`errorCode=401`、`未经授权的访问。`，仍未通过Token鉴权，不能因HTTP 200宣称接通。截图未提供认证密钥，代理用户字段仅显示姓名；还需client_secret和实际登录username，或有效access_token。截图“启用代理用户控制”已开启，因此必须使用该应用允许的代理用户；不能将该用户的授权当作Wendy授权。

## 资料核对

- `openApi_swagger_v2 (4).json` 包含采购、配货、发运3个接口，`openApi_swagger_v2 (5).json` 包含订单查询；完整路径均带 `/kapi/v2/…` 前缀。
- Swagger写 `accessToken` 请求头；用户提供 `access_token`。工具默认按用户指定名称，可改为 `accessToken` 或 `accesstoken`，待凭证配置后验证。
- FOP源码 `code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/plugin/webapi/OrderController.java` 的 `queryOrder` 按客户ID与单据类型过滤，`str` 是模糊查询词。需提供 `SO261028000002` 的真实 `customerId` 和 `hzkj_billtype.number`，不能将员工ID当客户ID。源码分页 `pageIndex` 从0起；云端部署是否一致须实测。
- 订单源码返回 `data.array` 和 `data.total`，本次Swagger没有描述data内部结构。采购/配货/发运请求为 `{ data: { billno }, pageNo: 1, pageSize: 10 }`，返回 `data.rows`；billno是对应单据编号，不能都填履约单号。
- 采购/配货/发运Swagger只列ID、编号、状态及3个时间字段，缺少工作台所需的关联订单、商品、归属、付款、齐套、出库等完整事实。这3个查询实现未在当前本地Java源码中定位到，可能由平台API配置发布，需后台确认。
- 两份Swagger未包含组织、用户、权限接口，也未证明查询按Wendy的数据权限过滤。工具为用户给定的组织/用户路径补 `/kapi`，但只在提供经后台确认的请求JSON后调用。
- 用户已确认 `ID-000015` 是Wendy的FOP用户编号，仍需接口解析其真实内码。本机Wendy账号 `wendy@hzdrop.com` 的平台编号是 `000019`，两套编号独立，FOP绑定尚为空。

## 私有配置

模板为 `backend/.env.fop.local.example`，本机填写 `backend/.env.fop.local`（Git忽略、权限0600）。该文件仅供联调工具使用，不改变应用演示模式。

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

1. 验证第三方应用、接口授权与代理用户，将已确认的Wendy用户编号 `ID-000015` 解析为FOP用户ID，并确认员工masterid及部门内码。
2. 查到测试订单，核实客户、业务员和部门归属，取得关联发运/配货/采购单及完整字段。
3. 补齐组织、用户、岗位/资源权限契约，验证Wendy可见和不可见样本。现有 `FOP_EMPLOYEE_API_URL` 使用委托身份及资源白名单契约，不能直接填苍穹域名，也不能把第三方应用Token当作所有员工权限。
4. 在本地BFF完成字段转换及权限适配后，再以Wendy接入工作台。demo权限验证不等于真实FOP权限验证。
