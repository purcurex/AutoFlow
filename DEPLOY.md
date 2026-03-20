# NoteFlow 部署指南

## 环境要求

- Node.js 18+
- PostgreSQL 14+

## 部署步骤

### 1. 安装依赖

```bash
cd backend
npm install --production
```

### 2. 配置环境变量

创建 `.env` 文件：

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

# JWT配置
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d

# AI配置 (可选)
ANTHROPIC_API_KEY=your-anthropic-api-key

# SerpAPI配置 (Shopify搜索)
SERPAPI_KEY=your-serpapi-key

# Google搜索API配置 (可选)
GOOGLE_API_KEY=your-google-api-key
GOOGLE_SEARCH_CX=your-custom-search-engine-id
```

### 3. 创建数据库

```bash
createdb noteflow
```

### 4. 启动服务

```bash
npm run start:prod
```

或使用 PM2（推荐）：

```bash
npm install -g pm2
pm2 start dist/main.js --name noteflow
```

### 5. 访问应用

打开浏览器访问：http://localhost:3000

## 生产环境建议

1. **反向代理**：使用 Nginx 作为反向代理
2. **HTTPS**：配置 SSL 证书
3. **数据库**：使用连接池，定期备份
4. **日志**：配置日志收集
5. **监控**：使用 PM2 或其他监控工具

## Nginx 配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 文件结构

```
backend/
├── dist/           # 编译后的后端代码
├── public/         # 前端静态文件
├── uploads/        # 用户上传文件
└── .env            # 环境变量配置
```
