# AutoFlow 新环境安装、构建与数据库部署指南

## 1. 文档信息

- 适用项目：AutoFlow
- 适用版本：2026-07-31 部署基线
- 前端：Vue 3 + Vite
- 后端：NestJS + TypeORM
- 数据库：PostgreSQL 16
- 已验证工具：Node.js 24.14、npm 11.9、Docker 29.2

## 2. 部署结论

AutoFlow 使用 PostgreSQL 和 TypeORM 版本化迁移管理数据库结构。生产部署必须遵守以下规则：

1. `DB_SYNCHRONIZE` 始终保持 `false`。
2. 推荐在应用启动前显式执行迁移，不让多个应用实例同时迁移数据库。
3. 全新环境使用空数据库加迁移脚本建表。
4. 保留旧数据时，先使用 `pg_dump/pg_restore` 恢复完整数据库，再执行待处理迁移。
5. 不直接复制 Docker PostgreSQL 数据目录到另一台机器。
6. 数据库和 `backend/uploads` 必须分别备份。
7. 真实 `.env`、API Key、数据库密码不得进入 Git 或部署 ZIP。

## 3. 交付文件

源代码仓库内：

```text
docs/AUTOFLOW_NEW_ENVIRONMENT_DEPLOYMENT_GUIDE_ZH-CN.md
deployment/.env.production.example
deployment/postgres.env.example
deployment/docker-compose.postgres.yml
scripts/deployment/install-build.ps1
scripts/deployment/install-runtime.ps1
scripts/deployment/migrate-database.ps1
scripts/deployment/migrate-compiled.mjs
scripts/deployment/backup-database.ps1
scripts/deployment/restore-database.ps1
scripts/deployment/start-production.ps1
scripts/deployment/verify-runtime.ps1
scripts/deployment/verify-runtime.mjs
scripts/deployment/build-deployment-package.ps1
```

生产部署 ZIP 包含：

```text
backend/dist/                         已编译后端、迁移和前端静态资源
backend/package.json
backend/.env.example
backend/uploads/README.md
frontend/package.json                 用于 npm workspace 锁文件校验
deployment/                           PostgreSQL 与生产配置模板
scripts/deployment/                   安装、迁移、备份、恢复、启动脚本
package.json
package-lock.json
README-DEPLOY-ZH-CN.md
```

## 4. 新服务器前置条件

生产服务器需要：

- 64 位 Windows Server 或 Linux。
- Node.js 24 LTS，或与构建验证兼容的 Node.js 版本。
- npm。
- PostgreSQL 16，或者 Docker。
- 至少 2 GB 可用内存；建议 4 GB 以上。
- 持久化磁盘用于 PostgreSQL 和 `backend/uploads`。
- 后端可访问智谱、PipiAds、1688及FOP接口所需的外部网络。

数据库端口 `5432` 不应暴露到公网。

## 5. 从源代码安装和构建

在项目根目录执行：

```powershell
PowerShell -ExecutionPolicy Bypass `
  -File .\scripts\deployment\install-build.ps1
```

如需同时运行完整质量检查：

```powershell
PowerShell -ExecutionPolicy Bypass `
  -File .\scripts\deployment\install-build.ps1 `
  -RunChecks
```

`-RunChecks` 需要可用的 PostgreSQL 测试数据库。

手工等价命令：

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
```

根构建命令会：

1. 编译 Vue 前端。
2. 编译 NestJS 后端和所有迁移。
3. 将前端静态资源复制到 `backend/dist/public`。

## 6. 生成部署包

```powershell
PowerShell -ExecutionPolicy Bypass `
  -File .\scripts\deployment\build-deployment-package.ps1 `
  -Version 20260731
```

输出：

```text
artifacts/AutoFlow-Deployment-20260731/
artifacts/AutoFlow-Deployment-20260731.zip
artifacts/AutoFlow-Deployment-20260731.zip.sha256
```

已经完成构建时可加 `-SkipBuild`，但正式发布建议重新构建。

## 7. 全新 Docker PostgreSQL

解压部署包后进入 `deployment`：

```powershell
Copy-Item .\postgres.env.example .\postgres.env
```

编辑 `postgres.env`：

```env
POSTGRES_DB=autoflow
POSTGRES_USER=autoflow
POSTGRES_PASSWORD=<数据库强密码>
```

启动 PostgreSQL：

```powershell
docker compose `
  -f .\docker-compose.postgres.yml `
  up -d
```

确认健康状态：

```powershell
docker ps --filter "name=hyperzone"
docker exec hyperzone pg_isready -U autoflow -d autoflow
```

默认仅绑定 `127.0.0.1:5432`。不要为了方便直接改为公网监听。

## 8. 生产环境变量

从部署包根目录执行：

```powershell
Copy-Item `
  .\deployment\.env.production.example `
  .\backend\.env
```

至少修改：

```env
NODE_ENV=production

DB_HOST=127.0.0.1
DB_PORT=5432
DB_USERNAME=autoflow
DB_PASSWORD=<与postgres.env一致>
DB_DATABASE=autoflow
DB_SSL=false
DB_SSL_REJECT_UNAUTHORIZED=true
DB_SYNCHRONIZE=false
DB_MIGRATIONS_RUN=false

JWT_SECRET=<至少32位随机字符串>

SMTP_HOST=<SMTP服务器>
SMTP_USER=<SMTP账号>
SMTP_PASS=<SMTP密码>
```

如果后端运行在 Docker 且与 PostgreSQL 位于同一网络：

```env
DB_HOST=hyperzone
```

使用要求 TLS 的云数据库：

```env
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true
```

云数据库使用私有 CA 时，应通过 Node.js `NODE_EXTRA_CA_CERTS` 指向 CA 文件。只有经过风险确认的临时联调环境才允许将 `DB_SSL_REJECT_UNAUTHORIZED` 设置为 `false`。

## 9. 安装生产运行依赖

在部署包根目录执行：

```powershell
PowerShell -ExecutionPolicy Bypass `
  -File .\scripts\deployment\install-runtime.ps1
```

脚本执行：

```powershell
npm.cmd ci --omit=dev
```

部署包已经包含编译产物，目标机不需要 TypeScript、Vite 或 Nest CLI。

## 10. 全新数据库迁移

先检查：

```powershell
PowerShell -ExecutionPolicy Bypass `
  -File .\scripts\deployment\migrate-database.ps1 `
  -Action show
```

执行迁移：

```powershell
PowerShell -ExecutionPolicy Bypass `
  -File .\scripts\deployment\migrate-database.ps1 `
  -Action run
```

再次检查：

```powershell
PowerShell -ExecutionPolicy Bypass `
  -File .\scripts\deployment\migrate-database.ps1 `
  -Action show
```

预期结果：

```text
Database connection: ok
Registered migrations: 23
Applied migrations: 23
Pending migrations: no
```

迁移状态保存在 `typeorm_migrations` 表中，不得手工修改。

## 11. 初始化管理员

仅全新数据库需要执行。

临时修改 `backend/.env`：

```env
ENABLE_ADMIN_BOOTSTRAP=true
ADMIN_BOOTSTRAP_EMAIL=admin@your-domain.com
ADMIN_BOOTSTRAP_USERNAME=Admin
ADMIN_BOOTSTRAP_PASSWORD=<至少12位强密码>
```

启动一次应用。系统创建：

```text
管理员名称：Admin
管理员ID：000001
```

创建后立即改回：

```env
ENABLE_ADMIN_BOOTSTRAP=false
```

然后重启应用。生产环境禁止执行开发种子命令 `npm run seed`。

## 12. 启动生产服务

```powershell
PowerShell -ExecutionPolicy Bypass `
  -File .\scripts\deployment\start-production.ps1
```

也可以直接执行：

```powershell
npm.cmd start
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

预期：

```json
{
  "status": "ok",
  "database": "up"
}
```

浏览器访问：

```text
http://127.0.0.1:3000
```

部署后可执行自动运行态验证：

```powershell
PowerShell -ExecutionPolicy Bypass `
  -File .\scripts\deployment\verify-runtime.ps1 `
  -Port 3199
```

脚本临时启动生产进程，检查数据库健康状态、前端入口、CSP和安全响应头，然后自动关闭验证进程。

生产环境建议由 Nginx、Caddy 或云负载均衡器负责 HTTPS 和域名反向代理。

## 13. 现有数据库备份

Docker 数据库可以执行：

```powershell
PowerShell -ExecutionPolicy Bypass `
  -File .\scripts\deployment\backup-database.ps1 `
  -Container hyperzone `
  -Database autoflow `
  -Username autoflow `
  -OutputDirectory .\backups
```

输出：

```text
backups/autoflow-YYYYMMDD-HHMMSS.dump
backups/autoflow-YYYYMMDD-HHMMSS.dump.sha256
```

云数据库使用平台快照，或者直接运行：

```powershell
pg_dump `
  -h <旧数据库地址> `
  -p 5432 `
  -U <数据库用户> `
  -d autoflow `
  -Fc `
  -f autoflow.dump
```

## 14. 恢复现有数据库

恢复脚本会删除并重新创建目标数据库，必须明确传入 `-ConfirmRestore`：

```powershell
PowerShell -ExecutionPolicy Bypass `
  -File .\scripts\deployment\restore-database.ps1 `
  -BackupPath .\backups\autoflow-20260731-120000.dump `
  -Container hyperzone `
  -Database autoflow `
  -Username autoflow `
  -ConfirmRestore
```

脚本完成以下操作：

1. 校验备份文件。
2. 将备份复制进 PostgreSQL 容器。
3. 删除并重新创建目标数据库。
4. 使用 `pg_restore` 恢复结构与数据。
5. 自动执行尚未应用的数据库迁移。

恢复前必须停止旧环境写入并创建二次备份。

## 15. 上传文件迁移

数据库备份不包含产品截图和工作流图片。

必须单独迁移：

```text
backend/uploads/
```

建议部署时将其挂载到持久化磁盘。多实例环境建议后续改为阿里云 OSS、AWS S3 或 MinIO。

## 16. 上线验证清单

### 数据库

- `migrate-database.ps1 -Action show` 显示无待处理迁移。
- `/api/health` 返回 `database: up`。
- `typeorm_migrations` 行数与当前迁移数量一致。
- 用户、工作流、线索、AI模板、报价数量与源环境一致。
- 管理员 ID 和各用户工作流短 ID 正常。

### 应用

- 登录成功。
- 工作流列表可读取。
- 线索池显示归属工作流名称和短 ID。
- 工作流图片可以访问。
- AI、PipiAds和1688密钥在后端生效且不进入前端。
- 报价 Excel 可以导出。

### 安全

- `backend/.env` 未进入 ZIP 之外的共享渠道。
- PostgreSQL 未监听公网。
- JWT Secret 长度不少于32位。
- 管理员初始化开关已经关闭。
- 云数据库启用 TLS 证书校验。

## 17. 回滚策略

生产迁移前必须创建数据库快照。

代码回滚不等于数据库回滚。推荐顺序：

1. 停止新版本写入。
2. 恢复部署前数据库快照。
3. 恢复对应版本的应用部署包。
4. 检查健康状态和关键业务数据。

仅在最新迁移已经验证可逆时使用：

```powershell
PowerShell -ExecutionPolicy Bypass `
  -File .\scripts\deployment\migrate-database.ps1 `
  -Action revert `
  -ConfirmRevert
```

不要在没有备份的情况下回退迁移。

## 18. 建议备份策略

- 每次发布前：完整数据库备份。
- 每天：至少一次 `pg_dump -Fc`。
- 每周：离机或对象存储备份。
- 保留周期：每日7至14份、每周4至8份、每月6份以上。
- 每月至少执行一次恢复演练。
- 数据库备份和 `backend/uploads` 使用同一业务时间点归档。
