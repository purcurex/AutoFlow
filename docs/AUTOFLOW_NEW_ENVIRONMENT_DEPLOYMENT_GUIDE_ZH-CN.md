# HyperZone 生产部署入口

部署说明已统一到 [HyperZone生产部署指导手册](manuals/HyperZone生产部署指导手册.html)。旧版内存建议、事务模式与测试配置不再适用。

资源包构建：`npm run build`，然后 `node scripts/deployment/build-production-package.mjs VERSION`。资源包仅包含编译产物、生产模板和部署工具；在目标服务器运行 `npm ci --omit=dev`。源码工作目录未提交时需显式添加 `--allow-working-tree`，清单会如实标记。

生产参数与账号绑定分别填写 `deployment/production-inputs.csv`、`deployment/account-bindings.template.csv`。真实密码、绑定人员表与业务数据不得提交Git。

新库用 `node scripts/deployment/migrate-compiled.mjs run` 完整迁移；后续步骤以手册为准。生产固定值、权限、实际采集、容量及恢复验收尚未完成时，不能将工程交付认定为生产上线完成。
