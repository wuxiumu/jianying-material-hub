# 剪映素材库 · jianying-material-hub

为「AI 生成内容 → 剪映剪辑 → 多平台发布」的自媒体工作流打造的**本地素材库管理后台**。

素材（视频 / 图片 / 音频）统一入库、打标签、快速检索，一键复制文件路径拖进剪映。

## 功能（一期 MVP）

- 📥 **素材上传**：拖拽多文件上传，自动识别视频 / 图片 / 音频
- 🖼 **自动缩略图**：图片用 sips、视频用 ffmpeg 抽帧（macOS）
- 🏷 **分类与标签**：自定义分类、标签多选筛选、关键词搜索
- 🔍 **素材墙**：网格 / 列表切换，类型筛选，详情预览
- 📋 **一键复制路径**：素材绝对路径直接复制，方便导入剪映
- 💾 **SQLite 单文件数据库**：零部署，`data/` 目录即全部数据，直接拷贝即备份

## 技术栈

- 前端：React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- 后端：Express + node:sqlite（Node ≥22 内置，零原生依赖）+ multer
- 数据：SQLite（`data/app.db`）+ 本地文件（`data/media/`）

## 快速开始

```bash
npm install
npm run dev        # 同时启动 API(3001) 和前端(3000)，浏览器打开提示的地址
```

生产模式：

```bash
npm run build
npm start          # 单端口 3001，托管 API + 前端构建产物
```

## 目录结构

```
├── server/            Express 后端 + SQLite 数据层
├── src/               React 前端
├── scripts/dev.js     开发模式双进程启动脚本
├── data/              素材文件 + 数据库（git 已忽略，备份就拷这个目录）
├── PLAN.md            项目计划
└── TASKS.md           任务清单
```

## 路线图

- **一期（当前）**：素材库
- **二期**：剪映模板 / 口播脚本模板管理、AI 生成脚本、素材 AI 自动打标签

## MVP 原型预览

`prototype/` 是一个零依赖的单页原型，提前演示最终交付形态：
素材库选材 → AI 写脚本 → 套剪映模板 → 出分镜表 → AI 交互生产视频（含样片播放器）。

```bash
cd prototype && npm run dev   # 默认 http://localhost:7100
```
