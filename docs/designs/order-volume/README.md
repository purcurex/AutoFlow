# 业务订单量分析设计原型

交付文件：[HyperZone订单量分析设计.html](../HyperZone订单量分析设计.html)。

这是设计方案及独立可操作原型，不是生产业务模块；不读取真实用户、数据库或 FOP。单文件内嵌共享 HyperZone 样式、透明 Logo、现有依赖中的 ECharts 和确定性模拟数据，可离线打开。

- `body.html`：设计说明、页面结构及原型样式。
- `model.cjs`：基于 15,125 笔虚构订单的查询模型，固定截至 2026-10-21。
- `ui.js`：查询联动、趋势图、排名、汇总与下钻条件预览。
- `customer-ui.js`：独立客户名称／编码搜索；选定单一客户后显示月／周／日统计，清空或修改搜索即清除旧数据。
- `build.py`：从上述来源生成单文件交付物；使用仓库依赖及共享 HTML 标准。
- `verify.cjs`：模拟统计口径与时间边界校验。
- `preview.png`：浏览器实拍预览。
- `customer-preview.png`：独立客户查询的浏览器实拍预览。

从 work-app 根目录运行：

```sh
node docs/designs/order-volume/verify.cjs
node --check docs/designs/order-volume/ui.js
node --check docs/designs/order-volume/customer-ui.js
python3 docs/designs/order-volume/build.py
```

v1.2：客户模块恢复前十客户＋其他排名；搜索或点击客户后显示独立趋势，清空仅清除单客户趋势。综合查询保留组织、物流服务商、业务员。原型仍使用固定日期的离线数据；正式前端已在经营概览和岗位工作台接入授权 API。实际 HTTP 合同见 [FOP_ORDER_VOLUME_API.md](../../FOP_ORDER_VOLUME_API.md)。

排名按完整查询周期固定，同名客户按 ID／编码分开；其余客户仅合计，不冒充可选客户身份。原型覆盖九组时间／仓库排名守恒，原有综合查询与单客户边界校验保留。
