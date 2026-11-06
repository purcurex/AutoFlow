# 客户报价实际物流渠道查询

客户报价直接搜索、勾选实际物流渠道，可多选并逐渠道设置毛利率。不再要求先选自定义渠道分类。候选项只来自后端渠道清单；筛选或翻页不清除已选项，不覆盖已设置毛利率。

## 预留 API

`GET /api/autoflow/integrations/fop/logistics/actual-channels`

| 参数 | 约定 |
| --- | --- |
| search | 可选，最长 120 字符；去除首尾空格，按服务商编码/名称、实际渠道编码/名称做不区分大小写的子串搜索；多词同时匹配，可跨字段 |
| page | 整数，至少 1，默认 1 |
| pageSize | 整数，1–100，默认 24 |

先授权和筛选，再完整排序、分页。不接受客户端传租户、用户或权限范围。重复/非法参数返回 400；未登录 401；没有独立渠道读权限 403；目录未接入/不可用 503。无匹配为 200、空 channels、total=0，不能以空成功掩盖上游失败。

```json
{
  "provider": "fop",
  "source": "fop",
  "sourceVersion": "<FOP目录版本>",
  "effectiveAt": "<带时区的目录时间戳>",
  "page": 1,
  "pageSize": 24,
  "total": 1,
  "channels": [{
    "customChannelCode": "<兼容现有报价的FOP分类编码>",
    "customChannelName": "<FOP分类名称>",
    "code": "<实际渠道编码>",
    "name": "<实际渠道名称>",
    "carrierCode": "<物流服务商编码>",
    "carrierName": "<物流服务商名称>",
    "enabled": true,
    "serviceLevel": "<可选>",
    "supportedCountries": ["US"]
  }],
  "warnings": []
}
```

返回有效、当前身份允许报价的实际渠道，列表跨原分类检索。身份与租户由服务端委托上下文确定；FOP 原始凭证不传前端。若存在多个分类关联，网关须明确返回可用于当前报价的关联，不能前端随意猜配。当前报价草稿与运费请求仍携带 customChannelCode + actualChannelCode；名称仅用于展示，后续正式报价必须由 FOP 重新校验有效渠道、归属及价格。

## FOP 字段核对与接入边界

- 来源：`hzkj_logistics_channel` 实际物流渠道档案；`number` / `name` 为编码和渠道名称，`hzkj_logistics_providers` 关联服务商。`hzkj_channel_code` 为另一渠道代码，不能未经确认替代 `number`。
- 核对依据：`dtr5b/.../logistics/plugin/form/LogisticsChannelBasePlugin.java:229–245`，对应 `hzkj_logistics_channel.dym` 服务商基础资料字段。`hzkj_state` 是国家/分区，不能作为启用标志；可报价有效性与权限字段需后台确认。
- 员工网关应查询已同步的完整渠道目录并落实独立资源读权限；不得只搜索旧接口某一分类或某一页，不得从待办订单上的渠道名称推导目录。
- 新增 `FopLogisticsCatalogPort.searchActualChannels` 适配点及查询 DTO。当前 live 适配器与独立渠道资源权限尚未实现：继续使用原 `requireResourcePermission` 拒绝未授权访问；本次不开放权限、不发布 FOP 原始接口、不切换真实数据源。
- Sandbox 仅用于契约测试，响应 `source=sandbox`，保留测试来源；不可当作正式 FOP 已同步清单。前端无本地候选渠道兜底。
- 原 custom-channels 及分类下 actual-channels 接口为旧调用保留，报价金额、阶梯、多国、版本和存储结构保持兼容。
