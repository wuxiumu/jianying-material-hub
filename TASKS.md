# 任务清单 — 一期（素材库 MVP）

> 项目：jianying-material-hub ｜ 决策已确认：GitHub 公开仓 / React+Express+SQLite / 只做素材库

## M1 仓库与分享 ✅
- [x] 计划确认（PLAN.md v0.1）
- [ ] 本地 git 仓库初始化（README / PLAN / TASKS / .gitignore）
- [ ] 推送 GitHub 公开仓库 `wuxiumu/jianying-material-hub`

## M2 数据库与后端
- [ ] SQLite 表结构：materials（素材）、categories（分类）、tags（标签）、material_tags（关联）
- [ ] Express 服务骨架 + 静态托管 data/media
- [ ] 素材上传 API（multer，视频/图片/音频，类型与大小校验）
- [ ] 缩略图生成（图片 sips / 视频 ffmpeg 抽帧 / 音频用图标占位）
- [ ] 素材 CRUD API：列表（分页+筛选+搜索）、详情、编辑（名称/分类/标签/备注）、删除
- [ ] 分类 CRUD + 标签自动补全 API
- [ ] 统计 API：素材总数、各类型数量、最近入库

## M3 前端界面
- [ ] 整体布局：侧边栏（素材库 / 分类管理 / 关于）+ 主区域
- [ ] 素材墙：网格卡片（缩略图、类型角标、名称、标签），支持列表/网格切换
- [ ] 上传：拖拽上传 + 多文件 + 上传进度，上传时可选分类
- [ ] 筛选搜索：类型 Tab（全部/视频/图片/音频）+ 分类下拉 + 标签多选 + 关键词搜索
- [ ] 素材详情弹窗：大图/视频预览、信息编辑、复制文件路径（方便拖进剪映）、删除
- [ ] 分类管理页：增删改分类

## M4 联调与交付
- [ ] npm run dev 单端口启动（Vite 代理 /api 与 /media）
- [ ] 真实上传视频/图片验证缩略图与筛选
- [ ] README 使用说明完善
- [ ] 推送最终代码到 GitHub
