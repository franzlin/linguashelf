# LinguaShelf

AI 英语分级阅读器，面向个人学习使用。支持登录、上传 EPUB/PDF、扫描版 PDF OCR、自动拆分主题单元、生成分级阅读、听力预热、点击式中文辅助、细粒度续学进度、生词本、学习报告、自动难度调整、任务中心和 PWA 移动端使用。

## 运行

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。

首次输入邮箱和密码会自动创建本地账号。开发版默认使用 SQLite，数据保存在 `data/app.sqlite`，上传文件保存在 `data/uploads`。如果旧版本已经有 `data/db.json`，首次启动会自动导入到 SQLite，原 JSON 文件会继续保留。

## AI 配置

默认没有配置 API key 时，系统会使用本地演示生成器，方便立刻体验完整流程。

如需调用第三方 AI，在项目根目录创建 `.env`：

```bash
OPENAI_API_KEY=你的_key
OPENAI_MODEL=gpt-5.5
```

可选：

```bash
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_REASONING_EFFORT=medium
OPENAI_VERBOSITY=medium
OPENAI_TTS_PROVIDER=openai-speech
OPENAI_TTS_API_KEY=
OPENAI_TTS_BASE_URL=https://api.openai.com/v1
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=marin
OPENAI_TTS_VOICES=
AI_PROVIDER=auto
MAX_UNITS_PER_BOOK=240
SOURCE_WORDS_PER_UNIT=1700
SOURCE_WORDS_MIN_PER_UNIT=1190
MAX_BATCH_GENERATE_UNITS=5
MAX_AUTO_REGEN_ATTEMPTS=1
STORAGE_DRIVER=sqlite
ALLOW_SIGNUP=false
SIGNUP_INVITE_CODE=
INITIAL_ADMIN_EMAIL=
INITIAL_ADMIN_PASSWORD=
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
PDF_SECTION_TARGET_WORDS=3400
MAX_EPUB_EXPANDED_MB=200
MAX_EPUB_ENTRIES=2000
RATE_LIMIT_WINDOW_MINUTES=60
RATE_LIMIT_GENERATE_UNITS_MAX=20
RATE_LIMIT_DEFINITIONS_MAX=120
RATE_LIMIT_AUDIO_MAX=30
RATE_LIMIT_MICRO_PRACTICE_MAX=40
RATE_LIMIT_SERVICE_TEST_MAX=12
DASHSCOPE_TTS_BASE_URL=https://dashscope.aliyuncs.com/api/v1
DASHSCOPE_TTS_API_KEY=
DASHSCOPE_TTS_MODEL=qwen-audio-3.0-tts-plus
DASHSCOPE_TTS_VOICE=longanlingxin
DASHSCOPE_TTS_LANGUAGE=en
DASHSCOPE_TTS_INSTRUCTION=Warm, calm educational podcast voice; natural pace, clear articulation, brief pauses; read exactly as written.
GEMINI_TTS_OFFICIAL_BASE_URL=https://yunwu.ai
GEMINI_TTS_OFFICIAL_API_KEY=
GEMINI_TTS_OFFICIAL_MODEL=gemini-3.1-flash-tts-preview
GEMINI_TTS_INPUT_TOKEN_LIMIT=8192
GEMINI_TTS_OUTPUT_TOKEN_LIMIT=16384
GEMINI_TTS_BASE_URL=https://api.futureppo.top
GEMINI_TTS_API_KEY=
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
GEMINI_TTS_VOICE=Kore
GEMINI_TTS_31_INSTRUCTIONS=
GEMINI_TTS_FALLBACK_INSTRUCTIONS=
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
```

听力预热会优先调用 TTS 生成音频并缓存；如果语音接口不可用，前端会退回浏览器内置朗读。

如果使用 MiMo TTS，把语音配置改成：

```bash
OPENAI_TTS_PROVIDER=mimo
OPENAI_TTS_MODEL=mimo-v2.5-tts
OPENAI_TTS_VOICES=Mia,Milo
OPENAI_TTS_BASE_URL=https://api.xiaomimimo.com/v1
OPENAI_TTS_API_KEY=你的语音网关 key
```

## AI 播客

书籍详情页支持生成四种单人英语播客：读前导入、读后复盘、全书专题、全书分集讲解。脚本使用文本模型生成，音频默认由 DashScope Qwen TTS 合成并缓存在 `data/audio`。主来源失败时会自动回退到 Gemini 3.1，再回退到兼容渠道的 2.5 Flash TTS。

```bash
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
GEMINI_TTS_31_INSTRUCTIONS=可选：覆盖 3.1 专属播客导演朗读指令
GEMINI_TTS_FALLBACK_INSTRUCTIONS=可选：覆盖 2.5 兜底清晰朗读指令
PODCAST_TTS_CHUNK_TOKENS=5500
PODCAST_TTS_CHUNK_CHARS=2800
```

设置页可以调整播客 Lexile 难度和 Qwen 音色（温暖知性的 `longanlingxin` 或明亮开朗的 `longanlufeng`）。读前导入、读后复盘和全书分集讲解默认按约 2200 个源文本词分一集，最多 12 集；全书专题会从整本书抽代表性来源片段生成一集跨章节主题讲解。播客可以按顺序只生成下一集，也可以一次生成剩余全部。Qwen 返回 24kHz 单声道 PCM，应用拼接后默认编码为 MP3（64kbps），编码失败会自动退回 WAV。脚本默认按不超过约 2800 字符分块。Gemini 兜底使用固定的 `GEMINI_TTS_VOICE`，不会把 Qwen 音色误传给 Gemini；任务中心的“用备用源重试”会跳过 Qwen。旧用户保存的 Kore/Puck/Charon/Aoede 会自动迁移到 Qwen 默认音色。

导航里的“服务”页会展示文本生成、听力预热 TTS、播客 TTS 主来源/兜底、视觉 OCR、本地 OCR 的配置摘要和最近检查结果。服务页不会显示 API key；点击“测试”会发起一次轻量检查，默认由 `RATE_LIMIT_SERVICE_TEST_MAX` 限制每个用户每小时最多测试 12 次。

## 支持格式

- EPUB，建议 50MB 以内
- 文字版 PDF，建议 50MB 以内
- 清晰的英文扫描版 PDF，会在原生文字抽取失败时自动 OCR

OCR 会优先使用视觉模型 `hunyuan-ocr`，失败或识别正文太少时自动回退到本地 `tesseract-ocr`。扫描 PDF 上传后会立即进入后台 OCR 任务，书库和任务中心会显示状态、页数进度、失败原因与重试入口，不需要让浏览器一直停留在上传页面。如果未单独配置 `PDF_OCR_VISION_BASE_URL` / `PDF_OCR_VISION_API_KEY`，会复用 `GEMINI_TTS_BASE_URL` / `GEMINI_TTS_API_KEY`。本地兜底 OCR 依赖服务器里的 `poppler-utils` 和 `tesseract-ocr`。Docker 部署镜像已内置这些依赖；非 Docker 部署需要手动安装。默认最多 OCR 前 120 页，可通过 `PDF_OCR_MAX_PAGES` 调整。OCR 适合清晰、方向正确、主要为英文正文的 PDF；倾斜、模糊、双栏复杂排版或大量图片注释的 PDF 识别质量会下降。

解析器会尽量识别 EPUB 目录、NCX/nav 章节、正文标题和前后置内容；PDF 会优先抽取可复制文字，失败时使用 OCR，并自动清理重复页眉页脚、页码。PDF 的页码只作为来源定位，不作为学习单元划分依据；系统会优先按章节标题拆分，识别不到章节时按连续正文区块和词数拆分，区块目标大小可通过 `PDF_SECTION_TARGET_WORDS` 调整。学习单元源文本目标大小由 `SOURCE_WORDS_PER_UNIT` 控制，默认 1700 词；PDF 如果被页眉或短小节切得太碎，会继续合并相邻短区块，直到接近 `SOURCE_WORDS_MIN_PER_UNIT`。

书籍导入后可以在书籍详情页重命名，避免标题只跟随原始文件名或解析出的元数据。对于解析器升级前导入、仍被拆成大量短单元的旧书，可以使用“重新规划单元”：系统会先显示旧/新单元数量及词数统计，确认后才应用。只有保留了原始文件，并且没有生成内容、学习进度、报告、播客或活动任务时才允许执行，避免破坏已有学习数据。

## PWA 移动端

生产构建支持添加到主屏幕、应用图标、manifest 和离线应用壳缓存。开发模式不会注册 service worker，并会清理旧的本地开发缓存，避免调试时出现页面缓存和热更新混杂。

Android Chrome/PWA 已优先打磨：安装按钮会使用 Android 友好的文案，听力音频使用页面内 `<audio>` 元素播放，并接入 Media Session 的播放、暂停、停止、快退、快进和进度状态，方便锁屏和通知栏控制。实际后台播放仍取决于 Android 系统、省电策略和浏览器权限。

## 前端结构

前端采用 React + TypeScript 的页面模块结构。`src/App.tsx` 只负责会话、数据刷新、页面编排和跨页面回调；首页、书库、书籍详情、学习、轻练、数据、报告、生词、任务、AI 服务、后台和设置分别位于 `src/pages`。共享领域模型位于 `src/types`，请求、格式化和状态展示规则位于 `src/lib`，应用外壳和基础控件位于 `src/components`。

样式使用明确的 CSS Cascade Layers：`style.css` 提供所有功能状态所需的基础规则，`rebuild.css` 提供品牌主题、应用布局和响应式组合。主题层固定高于基础层，避免依赖偶然的选择器优先级。

## 难度调整

设置页可以手动调整阅读和听力难度。开启“自动难度调整”后，系统会每 3 个完成单元检查一次理解题正确率和生词数量，并用保守的小步策略调整后续生成难度。

## 学习进度

系统会保存每个单元的上次阅读段落、听力完成状态和理解题草稿。阅读页会串行提交进度并显示“保存中 / 已同步 / 同步失败”，失败时可以直接重试。首页会优先显示未完成单元，并显示每日目标、连续学习天数、最近 14 天学习日历和今日进度。

## 每日轻练

“轻练”页可以按最近书籍、近期生词、历史、政治、经济、科技或自定义主题生成 2-3 分钟的短文阅读/听力练习。完成后会保存正确率、用时、关联生词和难度建议，并计入首页连续学习、学习数据仪表盘、今日目标和月目标。

## 原书文件

默认会保存上传的 EPUB/PDF，便于以后重新处理。也可以在设置页关闭“原书文件保留”，关闭后新上传的原始文件不会写入 `data/uploads`；应用仍会保存生成学习单元所需的文本片段和学习记录。

## 生成任务

单元生成和扫描 PDF OCR 都使用后台任务。点击“生成”或上传扫描 PDF 后，前端会显示排队、生成中、失败或完成状态；服务重启时，未完成任务会重新排队。旧的同步生成接口仍保留，方便调试。

书籍页支持批量预生成。默认一次最多排队 5 个单元，可通过 `MAX_BATCH_GENERATE_UNITS` 调整。

任务中心支持查看历史任务、暂停、恢复、取消和重试。失败任务会显示下一步建议、自动重试时间、原始错误和本次服务消耗摘要；播客 TTS 失败时可以一键用备用来源重试。生成完成前会做词数、段落数、题目数、来源引用和忠实度关键词覆盖检查；低质量结果默认会自动重试 1 次，可通过 `MAX_AUTO_REGEN_ATTEMPTS` 调整。上游临时错误或限流默认最多自动重试 2 次，可通过 `MAX_AUTO_FAILURE_RETRIES` 和 `AUTO_FAILURE_RETRY_BASE_SECONDS` 调整。

生成质量页会显示 AI/本地忠实度审稿、缺失关键词和逐段来源映射。强制重生成前会保存历史版本，学习页可以从“生成质量”里恢复旧版本。`QUALITY_AUDIT_MODE=off` 可关闭额外 AI 审稿调用。

逐段来源映射会在每个阅读段落下显示对应的原书段落、匹配置信度和可疑句子。忠实度偏低时，可以只修复低质量段落；系统会保留整单元历史版本，并只替换被标记的阅读段落。

管理后台集中显示任务统计、失败类型、备份状态、AI 服务状态、存储占用和最近错误日志。任务中心支持按任务类型和失败原因过滤。

上传、生成、每日轻练、单词释义、TTS 音频和服务状态测试默认按用户限流，时间窗口由 `RATE_LIMIT_WINDOW_MINUTES` 控制，额度分别由 `RATE_LIMIT_UPLOAD_MAX`、`RATE_LIMIT_GENERATE_UNITS_MAX`、`RATE_LIMIT_MICRO_PRACTICE_MAX`、`RATE_LIMIT_DEFINITIONS_MAX`、`RATE_LIMIT_AUDIO_MAX`、`RATE_LIMIT_SERVICE_TEST_MAX` 控制。设为 `0` 可关闭对应限制。服务状态和管理后台接口仅管理员可访问。

## 生词本

生词本支持按掌握度筛选、浏览例句、浏览器朗读发音，并可导出 CSV 或 Anki TSV。

## 安全设置

生产环境建议关闭开放注册：

```bash
ALLOW_SIGNUP=false
PASSWORD_MIN_LENGTH=8
PASSWORD_PBKDF2_ITERATIONS=600000
```

如需允许新账号注册，可以配置邀请码：

```bash
SIGNUP_INVITE_CODE=一段只有你知道的邀请码
```

首次部署也可以用环境变量创建初始管理员账号：

```bash
INITIAL_ADMIN_EMAIL=你的邮箱
INITIAL_ADMIN_PASSWORD=初始密码
```

登录保护：

```bash
SESSION_DAYS=30
LOGIN_WINDOW_MINUTES=10
LOGIN_MAX_FAILURES=8
```

浏览器会话使用 `HttpOnly`、`SameSite=Strict` Cookie，JavaScript 无法读取；服务器只保存会话 token 的 SHA-256 哈希。旧版本 `localStorage` token 会在首次成功鉴权时换成 Cookie 并自动清理，旧版明文数据库会话也会同步迁移。旧的 10 万次 PBKDF2 密码哈希会在下一次成功登录时自动升级。

上传和 OCR 保护：

```bash
MAX_UPLOAD_MB=50
MAX_EPUB_UPLOAD_MB=50
MAX_PDF_UPLOAD_MB=50
MAX_EPUB_EXPANDED_MB=200
MAX_EPUB_ENTRIES=2000
MAX_ACTIVE_OCR_TASKS=1
MAX_ACTIVE_UPLOAD_PARSES=1
RATE_LIMIT_UPLOAD_MAX=8
```

## 存储模式

默认 `STORAGE_DRIVER=sqlite`。如果要临时退回旧 JSON 存储，可设置：

```bash
STORAGE_DRIVER=json
```

## 常用命令

```bash
npm run check
npm run build
npm run e2e
npm run visual
npm run predeploy
npm start
```

`npm start` 会以生产模式运行已构建的 `dist`。

`npm run e2e` 会使用隔离数据目录和外部 Chromium 执行完整业务回归。`npm run visual` 会启动隔离测试服务器，生成桌面首页、桌面书库、Android 390px 书库和移动端更多导航截图，并检查横向溢出、移动导航可见性、触控高度和浏览器控制台错误。截图输出到 `work-screenshots/frontend-rebuild`。

如果服务已经启动，可以带上目标地址做 HTTP 验收：

```bash
BASE_URL=http://localhost:5173 npm run predeploy
npm run smoke
```

## 部署

部署到服务器时推荐使用 Docker Compose + Caddy，详见 [DEPLOYMENT.md](./DEPLOYMENT.md)。上线前验收记录见 [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md)。

备份和恢复：

```bash
npm run backup
npm run restore -- ./backups/linguashelf.zip
```

如果备份会同步到云盘或下载到其他设备，建议配置加密备份：

```bash
BACKUP_ENCRYPTION_KEY=一段足够长的随机口令
BACKUP_ENCRYPTION_REQUIRED=true
npm run backup
npm run restore -- ./backups/linguashelf-xxxx.zip.enc
```

恢复会先解压到暂存目录并校验 SQLite/JSON 数据库，全部通过后才原子切换正式数据目录；恢复失败不会覆盖当前数据。
