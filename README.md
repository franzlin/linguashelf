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
MAX_UPLOAD_MB=50
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
MAX_EPUB_EXPANDED_MB=200
MAX_EPUB_ENTRIES=2000
RATE_LIMIT_WINDOW_MINUTES=60
RATE_LIMIT_GENERATE_UNITS_MAX=20
RATE_LIMIT_DEFINITIONS_MAX=120
RATE_LIMIT_AUDIO_MAX=30
RATE_LIMIT_SERVICE_TEST_MAX=12
GEMINI_TTS_OFFICIAL_BASE_URL=https://yunwu.ai
GEMINI_TTS_OFFICIAL_API_KEY=
GEMINI_TTS_OFFICIAL_MODEL=gemini-3.1-flash-tts-preview
GEMINI_TTS_INPUT_TOKEN_LIMIT=8192
GEMINI_TTS_OUTPUT_TOKEN_LIMIT=16384
GEMINI_TTS_BASE_URL=https://api.futureppo.top
GEMINI_TTS_API_KEY=
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
GEMINI_TTS_VOICE=Kore
PODCAST_LEXILE_DEFAULT=900
PODCAST_SOURCE_WORDS_PER_EPISODE=2200
MAX_PODCAST_EPISODES=12
PODCAST_TTS_CHUNK_TOKENS=5500
PODCAST_TTS_CHUNK_CHARS=8000
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

书籍详情页支持生成四种单人英语播客：读前导入、读后复盘、全书专题、全书分集讲解。脚本使用文本模型生成，音频使用 Gemini TTS，默认输出 MP3 并缓存在 `data/audio`。播客 TTS 会优先使用 Gemini 3.1 主来源；如果主来源失败，会自动回退到兼容渠道的 2.5 Flash TTS。

```bash
GEMINI_TTS_OFFICIAL_BASE_URL=https://yunwu.ai
GEMINI_TTS_OFFICIAL_API_KEY=你的 Gemini 3.1 主来源 key，多个 key 用英文逗号分隔
GEMINI_TTS_OFFICIAL_MODEL=gemini-3.1-flash-tts-preview
GEMINI_TTS_INPUT_TOKEN_LIMIT=8192
GEMINI_TTS_OUTPUT_TOKEN_LIMIT=16384
GEMINI_TTS_BASE_URL=https://api.futureppo.top
GEMINI_TTS_API_KEY=你的 Gemini TTS 兜底渠道 key
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
GEMINI_TTS_VOICE=Kore
PODCAST_TTS_CHUNK_TOKENS=5500
PODCAST_TTS_CHUNK_CHARS=8000
```

设置页可以调整播客 Lexile 难度和音色。读前导入、读后复盘和全书分集讲解默认按约 2200 个源文本词分一集，最多 12 集；全书专题会从整本书抽代表性来源片段生成一集跨章节主题讲解。播客可以按顺序只生成下一集，也可以一次生成剩余全部。播客默认输出 MP3（64kbps），如果编码失败会自动退回 WAV。`GEMINI_TTS_OFFICIAL_*` 保留为兼容变量名，实际表示“播客 TTS 主来源”，可以指向 Yunwu 等 Gemini 兼容网关，不需要使用 Google 官方 key。Gemini 3.1 主来源的输入上限按 8192 token、输出上限按 16384 token 配置；实际分块默认控制在约 5500 估算 token 或 8000 字符以内，给朗读指令和估算误差留余量。主来源支持配置多个 key，系统会按音频分块轮流使用；某条 key 额度耗尽、限流或地区不可用时，只会临时冷却那一条。

导航里的“服务”页会展示文本生成、听力预热 TTS、播客 TTS 主来源/兜底、视觉 OCR、本地 OCR 的配置摘要和最近检查结果。服务页不会显示 API key；点击“测试”会发起一次轻量检查，默认由 `RATE_LIMIT_SERVICE_TEST_MAX` 限制每个用户每小时最多测试 12 次。

## 支持格式

- EPUB，建议 50MB 以内
- 文字版 PDF，建议 50MB 以内
- 清晰的英文扫描版 PDF，会在原生文字抽取失败时自动 OCR

OCR 会优先使用视觉模型 `hunyuan-ocr`，失败或识别正文太少时自动回退到本地 `tesseract-ocr`。如果未单独配置 `PDF_OCR_VISION_BASE_URL` / `PDF_OCR_VISION_API_KEY`，会复用 `GEMINI_TTS_BASE_URL` / `GEMINI_TTS_API_KEY`。本地兜底 OCR 依赖服务器里的 `poppler-utils` 和 `tesseract-ocr`。Docker 部署镜像已内置这些依赖；非 Docker 部署需要手动安装。默认最多 OCR 前 120 页，可通过 `PDF_OCR_MAX_PAGES` 调整。OCR 适合清晰、方向正确、主要为英文正文的 PDF；倾斜、模糊、双栏复杂排版或大量图片注释的 PDF 识别质量会下降。

解析器会尽量识别 EPUB 目录、NCX/nav 章节、正文标题和前后置内容；PDF 会优先抽取可复制文字，失败时使用 OCR，并自动清理重复页眉页脚、页码，再用章节标题启发式拆分。

书籍导入后可以在书籍详情页重命名，避免标题只跟随原始文件名或解析出的元数据。

## PWA 移动端

生产构建支持添加到主屏幕、应用图标、manifest 和离线应用壳缓存。开发模式不会注册 service worker，并会清理旧的本地开发缓存，避免调试时出现页面缓存和热更新混杂。

Android Chrome/PWA 已优先打磨：安装按钮会使用 Android 友好的文案，听力音频使用页面内 `<audio>` 元素播放，并接入 Media Session 的播放、暂停、停止、快退、快进和进度状态，方便锁屏和通知栏控制。实际后台播放仍取决于 Android 系统、省电策略和浏览器权限。

## 难度调整

设置页可以手动调整阅读和听力难度。开启“自动难度调整”后，系统会每 3 个完成单元检查一次理解题正确率和生词数量，并用保守的小步策略调整后续生成难度。

## 学习进度

系统会保存每个单元的上次阅读段落、听力完成状态和理解题草稿。首页会优先显示未完成单元，并显示每日目标、连续学习天数、最近 14 天学习日历和今日进度。

## 原书文件

默认会保存上传的 EPUB/PDF，便于以后重新处理。也可以在设置页关闭“原书文件保留”，关闭后新上传的原始文件不会写入 `data/uploads`；应用仍会保存生成学习单元所需的文本片段和学习记录。

## 生成任务

单元生成已经改成后台任务。点击“生成”或“重生成”后，前端会显示排队、生成中、失败或完成状态；服务重启时，未完成的生成任务会重新排队。旧的同步生成接口仍保留，方便调试。

书籍页支持批量预生成。默认一次最多排队 5 个单元，可通过 `MAX_BATCH_GENERATE_UNITS` 调整。

任务中心支持查看历史任务、暂停、恢复、取消和重试。生成完成前会做词数、段落数、题目数、来源引用和忠实度关键词覆盖检查；低质量结果默认会自动重试 1 次，可通过 `MAX_AUTO_REGEN_ATTEMPTS` 调整。

生成质量页会显示 AI/本地忠实度审稿、缺失关键词和逐段来源映射。强制重生成前会保存历史版本，学习页可以从“生成质量”里恢复旧版本。`QUALITY_AUDIT_MODE=off` 可关闭额外 AI 审稿调用。

逐段来源映射会在每个阅读段落下显示对应的原书段落、匹配置信度和可疑句子。忠实度偏低时，可以只修复低质量段落；系统会保留整单元历史版本，并只替换被标记的阅读段落。

管理后台集中显示任务统计、失败类型、备份状态、AI 服务状态、存储占用和最近错误日志。任务中心支持按任务类型和失败原因过滤。

生成、单词释义、TTS 音频和服务状态测试默认按用户限流，时间窗口由 `RATE_LIMIT_WINDOW_MINUTES` 控制，额度分别由 `RATE_LIMIT_GENERATE_UNITS_MAX`、`RATE_LIMIT_DEFINITIONS_MAX`、`RATE_LIMIT_AUDIO_MAX`、`RATE_LIMIT_SERVICE_TEST_MAX` 控制。设为 `0` 可关闭对应限制。

## 生词本

生词本支持按掌握度筛选、浏览例句、浏览器朗读发音，并可导出 CSV 或 Anki TSV。

## 安全设置

生产环境建议关闭开放注册：

```bash
ALLOW_SIGNUP=false
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

## 存储模式

默认 `STORAGE_DRIVER=sqlite`。如果要临时退回旧 JSON 存储，可设置：

```bash
STORAGE_DRIVER=json
```

## 常用命令

```bash
npm run check
npm run build
npm run predeploy
npm start
```

`npm start` 会以生产模式运行已构建的 `dist`。

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
