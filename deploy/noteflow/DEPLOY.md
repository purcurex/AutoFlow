# NoteFlow 部署指南

## 目录

- [环境要求](#环境要求)
- [文件说明](#文件说明)
- [快速部署（推荐）](#快速部署推荐)
- [手动部署](#手动部署)
- [常用命令](#常用命令)
- [故障排除](#故障排除)

---

## 环境要求

- **操作系统**: Ubuntu 20.04+ 或其他 Linux 发行版
- **Node.js**: 18+ (推荐 20+)
- **PostgreSQL**: 14+
- **内存**: 最低 512MB，推荐 1GB+
- **磁盘**: 最低 1GB

---

## 文件说明

```
noteflow/
├── dist/               # 后端编译代码（已编译好）
├── public/             # 前端静态文件（已构建好）
├── package.json        # 项目依赖配置
├── deploy.sh           # 一键部署脚本 ⭐
├── setup-nginx.sh      # Nginx 配置脚本 ⭐
├── DEPLOY.md           # 部署说明文档
└── .env                # 环境变量（需创建）
```

| 脚本文件 | 说明 | 执行顺序 |
|---------|------|---------|
| `deploy.sh` | 一键部署，安装所有依赖并启动服务 | 第一步 |
| `setup-nginx.sh` | 配置 Nginx 反向代理和 HTTPS | 第二步（可选） |

---

## 快速部署（推荐）

### 第一步：上传文件到服务器

**方式一：使用 scp**

```bash
# 在本地电脑执行
scp -r noteflow user@your-server-ip:/tmp/
```

**方式二：使用 SFTP 工具**

使用 FileZilla、WinSCP 等工具上传 `noteflow` 文件夹到服务器 `/tmp/` 目录。

### 第二步：运行部署脚本

```bash
# SSH 登录服务器
ssh user@your-server-ip

# 进入部署目录
cd /tmp/noteflow

# 执行部署脚本（需要 sudo 权限）
sudo bash deploy.sh
```

**脚本执行流程**：

```
[1/8] 更新系统包...
[2/8] 安装 Node.js...           → 自动安装 Node.js 20
[3/8] 安装 PostgreSQL...        → 自动安装并启动数据库
[4/8] 创建数据库...             → 自动创建 noteflow 数据库
[5/8] 创建应用目录...           → 创建 /var/www/noteflow
[6/8] 安装依赖...               → npm install --production
[7/8] 配置环境变量...           → 交互式输入配置
[8/8] 安装 PM2 并启动服务...    → 启动并设置开机自启
```

**交互式配置项**：

脚本会提示输入以下信息：

```
请输入数据库密码: [输入 PostgreSQL 密码]
请输入 JWT 密钥 (留空自动生成): [直接回车自动生成]
请输入 SerpAPI Key (可选，留空跳过): [输入 API Key 或回车跳过]
```

### 第三步：配置域名（可选）

如果需要使用域名访问：

```bash
# 执行 Nginx 配置脚本
sudo bash setup-nginx.sh your-domain.com
```

**脚本执行流程**：

```
1. 安装 Nginx
2. 创建反向代理配置
3. 提示是否配置 HTTPS (Let's Encrypt)
4. 自动申请并配置 SSL 证书
```

### 第四步：验证部署

```bash
# 查看服务状态
pm2 status

# 查看应用日志
pm2 logs noteflow

# 测试访问
curl http://localhost:3000
```

---

## 手动部署

如果需要自定义部署，可按以下步骤操作：

### 1. 安装 Node.js

```bash
# 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# 验证安装
node -v
npm -v
```

### 2. 安装 PostgreSQL

```bash
# 安装 PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# 启动服务
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 创建数据库
sudo -u postgres psql -c "CREATE DATABASE noteflow;"
```

### 3. 配置应用

```bash
# 创建应用目录
sudo mkdir -p /var/www/noteflow
sudo chown -R $USER:$USER /var/www/noteflow

# 复制文件
cp -r noteflow/* /var/www/noteflow/
cd /var/www/noteflow

# 安装依赖
npm install --production

# 创建环境变量文件
nano .env
```

### 4. 创建 .env 文件

```env
# 应用配置
NODE_ENV=production
PORT=3000

# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=noteflow

# JWT配置（建议使用随机字符串）
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d

# SerpAPI配置（Shopify搜索功能）
SERPAPI_KEY=your-serpapi-key

# 可选配置
ANTHROPIC_API_KEY=your-anthropic-api-key
GOOGLE_API_KEY=your-google-api-key
GOOGLE_SEARCH_CX=your-custom-search-engine-id
```

### 5. 启动服务

```bash
# 安装 PM2
sudo npm install -g pm2

# 启动应用
pm2 start dist/main.js --name noteflow

# 保存 PM2 配置
pm2 save

# 设置开机自启
pm2 startup
```

---

## 常用命令

### PM2 服务管理

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs noteflow

# 实时日志
pm2 logs noteflow --lines 100

# 重启服务
pm2 restart noteflow

# 停止服务
pm2 stop noteflow

# 删除服务
pm2 delete noteflow

# 监控面板
pm2 monit
```

### Nginx 管理

```bash
# 测试配置
sudo nginx -t

# 重载配置
sudo systemctl reload nginx

# 重启 Nginx
sudo systemctl restart nginx

# 查看状态
sudo systemctl status nginx
```

### 数据库管理

```bash
# 连接数据库
sudo -u postgres psql -d noteflow

# 备份数据库
sudo -u postgres pg_dump noteflow > backup.sql

# 恢复数据库
sudo -u postgres psql noteflow < backup.sql
```

---

## 故障排除

### 端口被占用

```bash
# 查看端口占用
sudo lsof -i :3000

# 杀死进程
sudo kill -9 <PID>
```

### 数据库连接失败

```bash
# 检查 PostgreSQL 状态
sudo systemctl status postgresql

# 重启 PostgreSQL
sudo systemctl restart postgresql

# 测试连接
psql -U postgres -d noteflow -h localhost
```

### PM2 服务异常

```bash
# 查看详细错误
pm2 logs noteflow --err

# 重启服务
pm2 restart noteflow

# 完全重置
pm2 delete noteflow
pm2 start dist/main.js --name noteflow
```

### Nginx 502 错误

```bash
# 检查应用是否运行
pm2 status

# 检查 Nginx 配置
sudo nginx -t

# 查看 Nginx 错误日志
sudo tail -f /var/log/nginx/error.log
```

---

## 更新应用

```bash
# 进入应用目录
cd /var/www/noteflow

# 备份旧文件
cp -r dist dist.bak

# 上传新文件后
npm install --production

# 重启服务
pm2 restart noteflow
```

---

## 安全建议

1. **修改默认端口**: 在 `.env` 中修改 `PORT`
2. **设置强密码**: 数据库密码和 JWT 密钥使用复杂字符串
3. **配置防火墙**:
   ```bash
   sudo ufw allow 22      # SSH
   sudo ufw allow 80      # HTTP
   sudo ufw allow 443     # HTTPS
   sudo ufw enable
   ```
4. **定期备份**: 设置数据库定时备份
5. **更新系统**: 定期执行 `apt update && apt upgrade`

---

## 联系支持

如有问题，请查看应用日志：

```bash
pm2 logs noteflow
```
