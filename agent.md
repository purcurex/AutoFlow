# HyperZone 项目事实与设计入口

- 本前端项目：HyperZone 智能办公平台，工程目录 `/Library/VSCode/AutoFlow/work-app`。
- FOP 后台不是通用第三方 ERP：它是基于金蝶云苍穹平台自研的 **HyperZone** 应用。
- FOP 后台代码库：`/Library/VSCode/dtr5b`。设计接口、统计口径、字段或业务规则前，先读取该库 `AGENTS.md`，核对实体元数据、枚举、校验和 Java 插件实现。
- 后台源码用于核实业务事实；源码存在不等于对应生产 HTTP 接口已经启用。本前端真实 FOP 网络适配器仍须按实际发布接口配置。
- 回款采用方案 2：已支付、已审核的履约订单收款，加已支付、已审核的全款备货收款，按支付当月计入；押金备货不计入。履约使用全款备货库存时不补回产品金额、不重复计算备货收款。
- 时间文案及统计口径统一 `UTC+8`；传输时间戳保留明确时区，日/月归属按 `+08:00` 换算。
- 已审核履约订单的仓库和物流渠道由 FOP 保证完整。全款备货在国内仓库备货，物流渠道不适用，不能归为“其他物流服务商”。
- 物流运费分析当前按已审核发运单的 `hzkj_actual_freight` / `hzkj_actual_freight_time` 统计已确认成本；确认时间不是银行付款日，不能据此承诺最终账单完整性。物流商原币在 `hzkj_textfield1`，必须显式换算 USD；首次正数快照后续调价/退款仍需对接确认。成本采用独立 `allowedFreightIds` 和 `freight` 授权，不能从订单权限推导。
- 已确认后台字段与证据见 `docs/analytics/HYPERZONE_FOP_SOURCE_MAPPING.md`；需求及 OpenAPI 见 `docs/analytics/`、`docs/openapi/`。

未经单独安排，不修改 `/Library/VSCode/dtr5b` 的生产应用实现；本工程内对接层、Mock 与契约同步维护。
