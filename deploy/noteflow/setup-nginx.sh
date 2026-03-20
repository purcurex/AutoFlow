#!/bin/bash

# NoteFlow Nginx 配置脚本
# 使用方法: sudo bash setup-nginx.sh your-domain.com

set -e

if [ -z "$1" ]; then
    echo "使用方法: sudo bash setup-nginx.sh your-domain.com"
    exit 1
fi

DOMAIN=$1

echo "=========================================="
echo "  配置 Nginx 和 HTTPS"
echo "=========================================="

# 安装 Nginx
if ! command -v nginx &> /dev/null; then
    echo "安装 Nginx..."
    apt install -y nginx
fi

# 创建 Nginx 配置
cat > /etc/nginx/sites-available/noteflow << EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # 文件上传大小限制
        client_max_body_size 10M;
    }
}
EOF

# 启用站点
ln -sf /etc/nginx/sites-available/noteflow /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 测试配置
nginx -t

# 重载 Nginx
systemctl reload nginx
systemctl enable nginx

echo ""
echo "Nginx 配置完成!"
echo ""

# 安装 Certbot 并配置 HTTPS
echo "是否配置 HTTPS? (y/n)"
read -r SETUP_HTTPS

if [ "$SETUP_HTTPS" = "y" ]; then
    echo "安装 Certbot..."
    apt install -y certbot python3-certbot-nginx

    echo "获取 SSL 证书..."
    certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email || {
        echo "证书获取失败，请确保域名已正确解析到服务器"
    }

    echo ""
    echo "HTTPS 配置完成!"
fi

echo ""
echo "访问地址: http://$DOMAIN"
if [ "$SETUP_HTTPS" = "y" ]; then
    echo "HTTPS 地址: https://$DOMAIN"
fi
