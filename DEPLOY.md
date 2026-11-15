# 部署到 Linux 服务器

以 Ubuntu / Debian 为例（CentOS 把 `apt` 换成 `dnf`）。全程约 5 分钟。

## 1. 装依赖

```bash
# Node.js 24（必须 ≥ 22.5，项目用了内置 node:sqlite）
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs ffmpeg git

node -v    # 确认 v22.5 以上
ffmpeg -version
```

> 也可以用 nvm 装 Node：`nvm install 24`

## 2. 拉代码、构建、启动

```bash
git clone https://github.com/wuxiumu/jianying-material-hub.git
cd jianying-material-hub

npm ci          # 安装依赖
npm run build   # 构建前端到 dist/

npm start       # 启动：API + 前端静态托管，同端口
```

打开 `http://服务器IP:3001` 即可使用（云服务器记得在安全组/防火墙放行 3001 端口）。

换端口：`API_PORT=8080 npm start`

## 3. （可选）开启语音转写

转音频功能开箱即用（靠 ffmpeg）；**转文字 / 转时间文字稿**需要本机 whisper：

```bash
sudo apt install -y build-essential cmake
cd /opt
sudo git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
sudo cmake -B build && sudo cmake --build build -j$(nproc)
sudo bash ./models/download-ggml-model.sh small   # 下载 small 模型（约 460MB）
```

然后在项目根目录配置环境变量：

```bash
cd ~/jianying-material-hub   # 你的项目目录
cp .env.example .env
# 编辑 .env，确认两个路径与实际一致：
# WHISPER_CLI=/opt/whisper.cpp/build/bin/whisper-cli
# WHISPER_MODEL=/opt/whisper.cpp/models/ggml-small.bin
```

重启服务生效。**不配也能跑**，只是点「转文字/转时间文字稿」会提示模型不存在。

## 4. 开机自启（systemd，推荐）

```bash
sudo tee /etc/systemd/system/jianying-hub.service <<'EOF'
[Unit]
Description=Jianying Material Hub
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/jianying-material-hub
Environment=API_PORT=3001
# 如果装了 whisper，取消下面两行注释并改路径
# Environment=WHISPER_CLI=/opt/whisper.cpp/build/bin/whisper-cli
# Environment=WHISPER_MODEL=/opt/whisper.cpp/models/ggml-small.bin
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now jianying-hub
sudo systemctl status jianying-hub   # 查看状态
journalctl -u jianying-hub -f        # 查看日志
```

> 注意把 `WorkingDirectory` 和 `User` 改成你实际的 clone 路径和用户。

## 5. （可选）Nginx 反向代理 + 域名

```nginx
server {
    listen 80;
    server_name 你的域名;
    client_max_body_size 2g;    # 允许上传大视频

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 600s;   # whisper 长转写不超时
    }
}
```

## 6. 数据与备份

所有数据都在项目下的 `data/` 目录：

| 内容 | 位置 |
|---|---|
| 数据库（素材、标签、文稿） | `data/app.db` |
| 上传的原始视频/图片/音频 | `data/media/` |
| 缩略图 | `data/thumbs/` |
| 导出的剪映视频包 | `data/exports/` |

**备份 = 打包 `data/` 目录**。迁移服务器时把 `data/` 拷过去即可完整恢复。

## 常见问题

- **上传大视频失败**：Nginx 默认限制 1MB 请求体，按第 5 步设 `client_max_body_size 2g`。
- **转写卡住/超时**：大文件 whisper 转写较慢（CPU 约 1 分钟音频 ≈ 30-60 秒），属正常；反代超时按第 5 步加大。
- **图片没有缩略图**：macOS 用 sips，Linux 自动回退 ffmpeg，无需处理。
- **更新代码**：`git pull && npm ci && npm run build && sudo systemctl restart jianying-hub`
