# NoteFlow - 智能笔记应用

一款面向个人用户的免费Web端高级笔记应用，融合Markdown与富文本编辑，提供AI智能辅助功能。

## 技术栈

### 前端
- Vue 3 + TypeScript
- Vite
- Tailwind CSS
- TipTap (富文本编辑器)
- Pinia (状态管理)
- Vue Router

### 后端
- NestJS + TypeScript
- PostgreSQL
- TypeORM
- JWT认证
- Claude API (AI功能)

## 快速开始

### 环境要求
- Node.js 18+
- PostgreSQL 14+

### 安装依赖

```bash
cd note-app
npm install
```

### 配置环境变量

#### 后端配置 (backend/.env)
```env
# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=noteflow

# JWT配置
JWT_SECRET=your-jwt-secret-key
JWT_EXPIRES_IN=7d

# AI配置
ANTHROPIC_API_KEY=your-anthropic-api-key

# SerpAPI配置 (用于Shopify店铺搜索)
# 获取方式: https://serpapi.com/
SERPAPI_KEY=your-serpapi-key

# Google搜索API配置 (可选，用于增强搜索)
GOOGLE_API_KEY=your-google-api-key
GOOGLE_SEARCH_CX=your-custom-search-engine-id
```

#### 前端配置 (frontend/.env)
```env
VITE_API_URL=http://localhost:3000/api
```

### 创建数据库

```bash
createdb noteflow
```

### 启动开发服务器

```bash
# 同时启动前后端
npm run dev

# 或分别启动
npm run dev:backend  # 后端 http://localhost:3000
npm run dev:frontend # 前端 http://localhost:5173
```

## 项目结构

```
note-app/
├── frontend/                # 前端项目
│   ├── src/
│   │   ├── api/            # API接口
│   │   ├── components/     # 组件
│   │   │   ├── editor/     # 编辑器组件
│   │   │   └── layout/     # 布局组件
│   │   ├── router/         # 路由配置
│   │   ├── stores/         # 状态管理
│   │   ├── types/          # 类型定义
│   │   └── views/          # 页面视图
│   └── ...
│
├── backend/                 # 后端项目
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/            # 认证模块
│   │   │   ├── users/           # 用户模块
│   │   │   ├── notes/           # 笔记模块
│   │   │   ├── folders/         # 文件夹模块
│   │   │   ├── ai/              # AI模块
│   │   │   └── shopify-search/  # Shopify店铺搜索模块
│   │   └── common/         # 公共模块
│   └── ...
│
└── package.json            # 根配置
```

## 功能特性

### 编辑器
- ✅ Markdown模式（实时预览、代码高亮）
- ✅ 富文本模式（所见即所得）
- ✅ 双模式无缝切换

### 笔记管理
- ✅ 文件夹分类
- ✅ 标签系统
- ✅ 收藏功能
- ✅ 搜索功能
- ✅ 回收站
- ✅ 导出功能
  - 单笔记导出 - 支持导出为 PDF/Excel 格式
  - 批量导出 - 多选笔记后批量导出
  - PDF格式 - 保留笔记排版，适合打印和分享
  - Excel格式 - 表格形式，便于数据整理

### AI功能
- ✅ 智能续写
- ✅ 文字润色
- ✅ 内容摘要
- ✅ 多语言翻译
- ✅ 智能标签推荐

### Shopify店铺搜索
- ✅ 图片搜索 - 上传商品图片，通过 Google Lens 反向图片搜索找到销售该产品的 Shopify 店铺
- ✅ 图片URL搜索 - 输入图片URL地址进行搜索
- ✅ 关键词搜索 - 输入产品关键词搜索相关店铺
- ✅ 结果保存 - 一键将搜索结果（最多20个店铺链接）保存到笔记

## 许可证

MIT
