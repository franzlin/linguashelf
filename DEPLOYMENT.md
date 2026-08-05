# LinguaShelf 部署指南

生产环境采用“应用 Compose + 独立全局边缘网关”的结构。LinguaShelf 的
`docker-compose.yml` **只管理 `app`**；整台 VPS 的 Caddy、证书和其他站点路由由
`/opt/caddy` 独立管理。应用数据保存在 Docker volume 中。

禁止在 `/opt/linguashelf` 运行无服务名的 `docker compose up -d --build`。生产发布只能使用：

```bash
GIT_REVISION=<已提交的7至40位十六进制修订号> /opt/caddy/scripts/deploy-linguashelf-app.sh
```

该脚本和 Docker 镜像构建都会拒绝缺失或格式错误的 `GIT_REVISION`。脚本在发布前后
锁定全局 Caddy 与 CLIProxyAPI 的容器 ID、配置哈希和路由状态，只执行
`docker compose build app` 与 `docker compose up -d --no-deps app`。应用健康接口返回
后，脚本最多等待 60 秒直到 `/api/ready` 可访问；同一 revision 且全站验收通过后，才会原子更新
`/opt/linguashelf/.deployed-revision`。`docker compose ps/logs/exec` 等非构建运维命令
不需要设置 revision。

## 1. 准备服务器

服务器需要：

- Docker 和 Docker Compose
- 已由独立边缘网关接管的 `edge-gateway` external Docker 网络
- `/opt/caddy` 中已经验证并加固的全局 Caddy 配置

Docker 镜像会安装 PDF OCR 所需的 `poppler-utils` 和 `tesseract-ocr`。如果选择非 Docker 部署，需要在宿主机额外安装这两个组件。

## 2. 配置环境变量

复制 `.env.example` 为 `.env`，至少修改：

```bash
OPENAI_API_KEY=你的文本生成 key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.5
OPENAI_TTS_PROVIDER=mimo
OPENAI_TTS_MODEL=mimo-v2.5-tts
OPENAI_TTS_VOICES=Mia,Milo
OPENAI_TTS_BASE_URL=https://api.xiaomimimo.com/v1
OPENAI_TTS_API_KEY=你的语音 key
DASHSCOPE_TTS_BASE_URL=https://dashscope.aliyuncs.com/api/v1
DASHSCOPE_TTS_API_KEY=你的 DashScope key
DASHSCOPE_TTS_MODEL=qwen-audio-3.0-tts-plus
DASHSCOPE_TTS_VOICE=longanlingxin
DASHSCOPE_TTS_LANGUAGE=en
DASHSCOPE_TTS_INSTRUCTION=Warm, calm educational podcast voice; natural pace, clear articulation, brief pauses; read exactly as written.
GEMINI_TTS_OFFICIAL_BASE_URL=https://yunwu.ai
GEMINI_TTS_OFFICIAL_API_KEY=你的 Gemini 3.1 主来源 key，多个 key 用英文逗号分隔
GEMINI_TTS_OFFICIAL_MODEL=gemini-3.1-flash-tts-preview
GEMINI_TTS_INPUT_TOKEN_LIMIT=8192
GEMINI_TTS_OUTPUT_TOKEN_LIMIT=16384
GEMINI_TTS_BASE_URL=https://api.futureppo.top
GEMINI_TTS_API_KEY=你的 Gemini TTS 兜底渠道 key
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
GEMINI_TTS_VOICE=Kore
GEMINI_TTS_31_INSTRUCTIONS=
GEMINI_TTS_FALLBACK_INSTRUCTIONS=
ALLOW_SIGNUP=false
SIGNUP_INVITE_CODE=可选的邀请码
INITIAL_ADMIN_EMAIL=你的邮箱
INITIAL_ADMIN_PASSWORD=初始密码
PASSWORD_MIN_LENGTH=8
PASSWORD_PBKDF2_ITERATIONS=600000
MAX_AUTO_FAILURE_RETRIES=2
AUTO_FAILURE_RETRY_BASE_SECONDS=180
BACKUP_ENCRYPTION_KEY=建议填一段足够长的随机口令
BACKUP_ENCRYPTION_REQUIRED=true
```

播客 TTS 默认顺序为 DashScope Qwen、Gemini 3.1、Gemini 2.5。管理员可以在网页“AI 服务”页随时调整三个来源的全局优先级，之后开始合成的任务会按保存顺序尝试；“用备用源重试”会跳过 Qwen，但仍遵循两个 Gemini 来源的当前排序。`GEMINI_TTS_OFFICIAL_*` 是历史兼容变量名，可继续指向 Yunwu 这类 Gemini 兼容源；无需配置 Google 官方 key。

生产环境建议保持：

```bash
NODE_ENV=production
STORAGE_DRIVER=sqlite
DATA_DIR=/app/data
TRUST_PROXY=true
SESSION_DAYS=30
LOGIN_WINDOW_MINUTES=10
LOGIN_MAX_FAILURES=8
PASSWORD_MIN_LENGTH=8
PASSWORD_PBKDF2_ITERATIONS=600000
MAX_UPLOAD_MB=50
MAX_ACTIVE_UPLOAD_PARSES=1
MAX_EPUB_UPLOAD_MB=50
MAX_PDF_UPLOAD_MB=50
PDF_OCR_ENABLED=true
PDF_OCR_PROVIDER=hunyuan-first
PDF_OCR_VISION_MODEL=hunyuan-ocr
PDF_OCR_VISION_BASE_URL=
PDF_OCR_VISION_API_KEY=
PDF_OCR_VISION_DPI=110
PDF_OCR_VISION_MIN_WORDS=40
PDF_OCR_LANGUAGE=eng
PDF_OCR_DPI=220
PDF_OCR_MAX_PAGES=120
PDF_OCR_COMMAND_TIMEOUT_MS=120000
OCR_HTTP_REQUEST_TIMEOUT_MS=120000
AI_TEXT_REQUEST_TIMEOUT_MS=120000
TTS_REQUEST_TIMEOUT_MS=180000
MAX_ACTIVE_OCR_TASKS=1
PDF_SECTION_TARGET_WORDS=3400
MAX_EPUB_EXPANDED_MB=200
MAX_EPUB_ENTRIES=2000
MAX_BATCH_GENERATE_UNITS=5
MAX_AUTO_REGEN_ATTEMPTS=1
RATE_LIMIT_WINDOW_MINUTES=60
RATE_LIMIT_UPLOAD_MAX=8
RATE_LIMIT_GENERATE_UNITS_MAX=20
RATE_LIMIT_DEFINITIONS_MAX=120
RATE_LIMIT_AUDIO_MAX=30
RATE_LIMIT_MICRO_PRACTICE_MAX=40
RATE_LIMIT_SERVICE_TEST_MAX=12
PODCAST_LEXILE_DEFAULT=900
PODCAST_SOURCE_WORDS_PER_EPISODE=2200
MAX_PODCAST_EPISODES=12
PODCAST_TTS_CHUNK_TOKENS=5500
PODCAST_TTS_CHUNK_CHARS=2800
PODCAST_TTS_CONCURRENCY=2
PODCAST_AUDIO_FORMAT=mp3
PODCAST_MP3_KBPS=64
PODCAST_SCRIPT_SOURCE_CHUNK_WORDS=2600
MAX_ACTIVE_PODCAST_JOBS=2
RATE_LIMIT_PODCAST_EPISODES_MAX=12
QUALITY_AUDIT_MODE=auto
BACKUP_ENCRYPTION_REQUIRED=true
```

## 3. 生产发布

```bash
GIT_REVISION=<已提交的7至40位十六进制修订号> /opt/caddy/scripts/deploy-linguashelf-app.sh
```

发布前应把已提交代码同步到 `/opt/linguashelf`。`GIT_REVISION` 必须与该批代码的提交号
一致；缺失、含非十六进制字符或长度不在 7 至 40 位之间时，脚本和镜像构建都会拒绝发布。
该值会注入镜像并由 `/api/health` 的 `revision` 字段返回。脚本只在应用健康、revision
一致且所有生产站点验收通过后更新 `/opt/linguashelf/.deployed-revision`。

生产 LinguaShelf Compose 必须满足：

- `docker compose config --services` 只输出 `app`
- `app` 只加入 external `edge-gateway` 网络，并保留网络别名 `app`
- 不声明 Caddy，不发布 80/443，不拥有证书卷或全局路由文件

全局入口的配置、校验与恢复流程位于 `/opt/caddy`，不属于 LinguaShelf 应用发布范围。

查看状态：

```bash
docker compose ps
docker compose logs -f app
```

健康检查：

```bash
curl https://你的域名/api/health
curl https://你的域名/api/ready
```

## 4. 部署前总验收

在本地或服务器项目目录执行：

```bash
npm ci
npm run check
npm run build
npm audit --omit=dev --audit-level=moderate
npm run predeploy
```

服务启动后执行：

```bash
BASE_URL=https://你的域名 npm run predeploy
```

`predeploy` 会检查部署文件、环境变量样例、构建产物、`.dockerignore`、疑似密钥泄漏、健康接口、PWA manifest/service worker 和 CSP header。

如果需要浏览器级冒烟测试，先确保服务可访问，再执行：

```bash
BASE_URL=https://你的域名 npm run smoke
```

部署了忠实度审稿规则变更后，可以先只读预览现有生成单元，再决定是否更新质量数据：

```bash
docker compose exec app npm run quality:reassess
```

确认本轮生产备份已经完成后，显式应用重新审稿结果：

```bash
docker compose exec app npm run quality:reassess:apply
```

该命令只规范化已有内容并重新计算审稿、质量状态和来源映射，不重新生成文章，不修改学习进度、报告、播客或历史版本。

## 5. 备份

上线后建议立刻做一次备份，并设置每日自动备份。备份包含 `data/` 目录，也就是 SQLite 数据库、上传文件和音频缓存；`.env` 不会自动打进备份，避免 API key 被误传。

容器内备份：

```bash
docker compose exec app npm run backup
```

如果 `.env` 里配置了 `BACKUP_ENCRYPTION_KEY`，备份会自动写成 `*.zip.enc`。把备份文件复制到服务器当前目录：

```bash
docker compose cp app:/app/backups/最新备份文件名 ./最新备份文件名
```

建议保持 `BACKUP_ENCRYPTION_REQUIRED=true`，再把加密后的备份文件同步到云盘、对象存储，或下载到自己的电脑。

服务器每日自动备份。脚本默认会在备份完成后做一次非破坏性恢复演练：把刚生成的备份恢复到临时 `DATA_DIR`，并写出 `*.drill.json` 报告，不会覆盖生产数据。

```bash
mkdir -p /opt/linguashelf-backups
APP_DIR=/opt/linguashelf HOST_BACKUP_DIR=/opt/linguashelf-backups RETENTION_DAYS=14 RUN_RESTORE_DRILL=1 BACKUP_ENCRYPTION_KEY='同 .env 里的口令' bash /opt/linguashelf/deploy/backup-daily.sh
```

确认手动执行成功后，加入 `cron`：

```bash
crontab -e
```

追加一行，每天凌晨 3:20 备份，并默认保留 14 天：

```cron
20 3 * * * APP_DIR=/opt/linguashelf HOST_BACKUP_DIR=/opt/linguashelf-backups RETENTION_DAYS=14 RUN_RESTORE_DRILL=1 BACKUP_ENCRYPTION_KEY='同 .env 里的口令' bash /opt/linguashelf/deploy/backup-daily.sh >> /var/log/linguashelf-backup.log 2>&1
```

如果只想备份、不做恢复演练，把 `RUN_RESTORE_DRILL=1` 改成 `RUN_RESTORE_DRILL=0`。

从服务器下载最近的备份到本机：

```bash
scp root@你的服务器IP:/opt/linguashelf-backups/linguashelf-*.zip* .
```

## 6. 恢复

先停止应用：

```bash
docker compose stop app
```

把备份复制进容器并恢复：

```bash
docker compose cp ./linguashelf-xxxx.zip.enc app:/app/backups/linguashelf-xxxx.zip.enc
docker compose run --rm app npm run restore -- /app/backups/linguashelf-xxxx.zip.enc
docker compose up -d --no-deps app
```

恢复脚本会先把备份解压到同级暂存目录，校验 SQLite 完整性或 JSON 结构后，再原子切换正式数据目录并保留旧目录。解压或校验失败不会移动当前生产数据；加密备份需要容器环境里存在同一个 `BACKUP_ENCRYPTION_KEY`。

只验证某个备份是否可恢复，不覆盖生产数据：

```bash
docker compose cp ./linguashelf-xxxx.zip.enc app:/app/backups/drill.zip.enc
docker compose exec -T -e DATA_DIR=/tmp/linguashelf-restore-drill app sh -lc "rm -rf /tmp/linguashelf-restore-drill* && npm run backup:drill -- /app/backups/drill.zip.enc /app/backups/manual-drill.json"
docker compose cp app:/app/backups/manual-drill.json ./manual-drill.json
```

## 7. 非 Docker 部署

在服务器上安装 Node.js 22，然后：

```bash
npm ci
npm run build
npm start
```

可参考 `deploy/systemd/linguashelf.service` 创建 systemd 服务。反向代理可用 Nginx 或 Caddy，把外部 HTTPS 流量转发到 `127.0.0.1:5173`。

## 8. 数据位置

默认数据目录：

- Docker：`/app/data`
- 本地：项目目录下的 `data`

目录中包含：

- `app.sqlite`：账号、书籍、学习单元、报告、生词、任务记录
- `uploads/`：按设置保留的原始 EPUB/PDF
- `audio/`：TTS 音频缓存

## 9. 上线后检查

首次上线后建议按顺序检查：

- 用电脑登录并确认初始管理员账号可用
- 用 Android Chrome 登录并添加到主屏幕
- 上传一本小型 EPUB、文字版 PDF 或清晰英文扫描版 PDF
- 在书籍详情页重命名一次书籍，确认书库和详情页同步显示新书名
- 生成 1 个单元并确认分级阅读、单词释义、听力预热可用
- 分别生成“读前导入”和“全书分集讲解”各 1 集 AI 播客，确认“生成下一集”不会一次排满所有分集，并确认 MP3 或 WAV 音频可播放、可下载、可记录播放进度
- 完成一个学习单元并确认学习报告生成
- 在手机和电脑之间确认进度同步
- 立刻执行一次备份并把备份文件复制到服务器外
