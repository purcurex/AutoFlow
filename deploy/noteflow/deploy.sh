#!/bin/bash

# NoteFlow 部署脚本 (Ubuntu)
# 使用方法: sudo bash deploy.sh

set -e

echo "=========================================="
echo "  NoteFlow 部署脚本"
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否为 root 用户
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}请使用 sudo 运行此脚本${NC}"
    exit 1
fi

# 配置变量
APP_DIR="/var/www/noteflow"
APP_USER="www-data"
APP_PORT=3000
DB_NAME="noteflow"
DB_USER="postgres"

echo -e "${YELLOW}[1/8] 更新系统包...${NC}"
apt update

echo -e "${YELLOW}[2/8] 安装 Node.js...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
echo "Node.js 版本: $(node -v)"
echo "NPM 版本: $(npm -v)"

echo -e "${YELLOW}[3/8] 安装 PostgreSQL...${NC}"
if ! command -v psql &> /dev/null; then
    apt install -y postgresql postgresql-contrib
    systemctl start postgresql
    systemctl enable postgresql
fi

echo -e "${YELLOW}[4/8] 创建数据库...${NC}"
sudo -u postgres psql -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || {
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME;"
    echo -e "${GREEN}数据库 $DB_NAME 创建成功${NC}"
}

echo -e "${YELLOW}[5/8] 创建应用目录...${NC}"
mkdir -p $APP_DIR
mkdir -p $APP_DIR/uploads

# 复制当前目录文件到应用目录
cp -r ./* $APP_DIR/ 2>/dev/null || true
cd $APP_DIR

echo -e "${YELLOW}[6/8] 安装依赖...${NC}"
npm install --production

echo -e "${YELLOW}[7/8] 配置环境变量...${NC}"
if [ ! -f .env ]; then
    echo -e "${YELLOW}请输入数据库密码:${NC}"
    read -s DB_PASSWORD

    echo -e "${YELLOW}请输入 JWT 密钥 (留空自动生成):${NC}"
    read JWT_SECRET
    if [ -z "$JWT_SECRET" ]; then
        JWT_SECRET=$(openssl rand -hex 32)
    fi

    echo -e "${YELLOW}请输入 SerpAPI Key (可选，留空跳过):${NC}"
    read SERPAPI_KEY

    cat > .env << EOF
# 应用配置
NODE_ENV=production
PORT=$APP_PORT

# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=$DB_PASSWORD
DB_DATABASE=$DB_NAME

# JWT配置
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=7d

# SerpAPI配置
SERPAPI_KEY=$SERPAPI_KEY
EOF

    echo -e "${GREEN}.env 文件创建成功${NC}"
fi

echo -e "${YELLOW}[8/8] 安装 PM2 并启动服务...${NC}"
npm install -g pm2

# 创建 PM2 配置文件
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'noteflow',
    script: 'dist/main.js',
    instances: 'max',
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: $APP_PORT
    }
  }]
}
EOF

# 启动应用
pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -1 | bash

# 设置目录权限
chown -R $APP_USER:$APP_USER $APP_DIR
chmod -R 755 $APP_DIR
chmod -R 777 $APP_DIR/uploads

echo ""
echo -e "${GREEN}=========================================="
echo "  部署完成!"
echo "==========================================${NC}"
echo ""
echo "应用已启动在: http://localhost:$APP_PORT"
echo ""
echo "常用命令:"
echo "  查看状态: pm2 status"
echo "  查看日志: pm2 logs noteflow"
echo "  重启服务: pm2 restart noteflow"
echo "  停止服务: pm2 stop noteflow"
echo ""
echo "如需配置域名和 HTTPS，请安装 Nginx:"
echo "  apt install nginx"
echo ""
