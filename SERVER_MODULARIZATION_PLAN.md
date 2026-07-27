# server/index.js 拆分方案

制定时间：2026-07-26
适用版本：`server/index.js` 8897 行，355 个顶层函数、91 个模块级常量、8 个模块级可变状态、44 条路由。

本方案基于对当前文件的实际依赖分析，不是通用建议。分析脚本的结论直接写在下面，可复算。

## 1. 为什么值得做，以及为什么必须小步做

单文件 8897 行目前还能工作，真正的代价不在"看起来乱"，而在三件具体的事：

任何一次改动都要在近 9000 行里定位上下文，改 TTS 时会顺手读到 OCR 的代码，注意力成本每次都付。第二，没有编译器帮忙约束边界——播客模块直接调用数据库写入、路由直接调用 AI 生成，这类越层调用现在没有任何东西会拦住，越往后越难拆。第三，测试只能整体做端到端，改一行 PDF 分段逻辑也要跑完整 `npm run e2e`，反馈慢到会让人跳过验证。

反过来说，拆分本身对用户没有任何可见收益，而风险是把一个正在线上跑、有真实学习数据的系统改坏。所以本方案的核心不是模块划分（那部分并不难），而是**每一步都能独立验证、独立提交、独立回滚**。任何一个阶段做完如果你不想继续，系统都应处在完全可用的状态。

如果只想拿一半收益、只付一成风险：做阶段 0 到 2 就停，那三步已经把最容易出错的底座（配置、存储、鉴权）隔离出来了。

## 2. 依赖分析结果

对文件做了顶层符号引用分析，按下面的边界预分组后，跨模块引用情况是：

被依赖最重的是配置常量（131 次入向引用）、AI 配置层（51 次）、文本工具（48 次）。这三个是天然的叶子层，应最先抽出，且抽出后不会再变。

**发现 6 处双向依赖（会形成循环导入）**，全部由少数几个放错位置的纯函数造成，都可以靠移动函数解决，不需要引入依赖注入或事件总线：

| 循环 | 成因 | 处理 |
| --- | --- | --- |
| `pdf ↔ units-plan` | `groupPdfPages` 被放在单元规划里，但只服务 PDF | 移入 `pdf` |
| `ocr ↔ pdf` | `cleanPdfPages` 在 pdf，OCR 也要用 | 抽出 `pdf-text.js`（纯行/页清洗），两者共同依赖 |
| `epub ↔ units-plan` | `looksLikeTableOfContents` 在单元规划里 | 移入 `epub` |
| `auth-user ↔ quality` | `readingLevels`/`listeningLevels`/`normalizeLevel` 混在质量模块 | 抽出 `levels.js`，两者共同依赖 |
| `admin ↔ jobs` | 用量与错误日志的写入原语放在 admin | 抽出 `telemetry.js`（写入），admin 只保留聚合读取 |
| `admin ↔ jobs-diag` | 同上 | 同上 |

这六处是整个拆分里唯一需要动逻辑位置的地方，其余全是纯搬运。**建议把这六个函数的移动单独做成阶段 1**，在任何模块拆分之前完成，且这一步不新建文件（除三个小文件外），改动小到可以逐行审阅。

## 3. 目标结构

分层约束：**下层不得引用上层**。允许的方向是自上而下单向的。

```
server/
  index.js            启动、CLI 分支、优雅关闭（目标 < 120 行）
  app.js              createApp：中间件装配 + 路由挂载（目标 < 150 行）

  routes/             HTTP 边界层，只做参数校验、鉴权、调用领域函数、拼响应
    auth.js           登录、登出、密码、/api/app、设置          ~165 行
    books.js          上传、详情、改名、删除、重规划、批量预生成  ~434 行
    units.js          生成、修复、版本回滚、进度、完成、音频      ~291 行
    podcasts.js       生成、重试、进度、下载、删除                ~101 行
    micro.js          每日轻练                                    ~199 行
    jobs.js           任务查询与控制                              ~144 行
    vocabulary.js     生词与释义                                  ~131 行
    admin.js          AI 服务配置、服务测试、安全与后台状态        ~131 行
    health.js         /api/health、/api/ready                     ~20 行

  domain/             业务逻辑，不认识 req/res
    units.js          单元规划、切分、重规划                      ~392 行
    content.js        分级内容生成与本地兜底                      ~393 行
    quality.js        忠实度审稿、来源映射、质量评估              ~496 行
    repair.js         低质量段落修复                              ~175 行
    progress.js       学习进度与单元公开视图                      ~192 行
    stats.js          首页、数据仪表盘、趋势                      ~325 行
    micro.js          轻练构建与生词沉淀                          ~619 行
    podcast.js        选题规划、脚本、术语表                      ~311 行
    levels.js         阅读/听力难度等级（循环破除点）             ~30 行

  parsing/
    epub.js           EPUB 解析与目录                             ~233 行
    pdf.js            PDF 解析与分段                              ~211 行
    pdf-text.js       页面/行清洗（循环破除点）                   ~120 行
    ocr.js            视觉 OCR 与 Tesseract 兜底                  ~227 行

  ai/
    config.js         已存在，六类能力配置与端点方言适配
    text.js           callTextAi 及各调用点封装
    tts.js            听力 TTS + 播客三来源与分块合成             ~634 行
    services.js       服务状态面板与连通性测试                    ~363 行

  jobs/
    queue.js          入队、恢复、串行执行                        ~500 行
    generation.js     单元生成任务处理
    podcast.js        播客任务处理
    ocr.js            OCR 任务处理
    diagnosis.js      失败分级、重试策略、下一步建议              ~340 行

  infra/
    config.js         全部环境变量常量（叶子，零依赖）           ~137 行
    storage.js        SQLite/JSON 快照读写、备份健康              ~264 行
    http.js           带超时的 fetch 封装、单位换算              ~79 行
    session.js        会话签发校验、Cookie、限流                 ~117 行
    users.js          密码哈希、鉴权中间件、用户设置              ~231 行
    telemetry.js      AI 用量与错误日志写入（循环破除点）        ~150 行
    admin-report.js   用量聚合、备份状态、存储占用、后台面板      ~250 行
```

`infra/config.js` 有个必须注意的细节：现在几个常量在定义时就调用了 `parseBoolean` 和 `bytesFromMegabytes`（靠函数提升才成立）。拆分时这两个函数必须跟常量放进同一个文件，或者先抽一个 `infra/primitives.js`。这是最容易在拆分第一步就踩到的坑。

## 4. 分阶段执行

每个阶段结束都必须：`npm run check` → `npm run test:ai` → `npm run e2e` → 独立 git 提交。任何一步没过就地修复，不要带着红灯进入下一阶段。

**阶段 0：先补测试网**
在动任何结构之前，给拆分风险最高的部分补上快速单元测试：EPUB/PDF 解析（喂真实固件，断言章节数与分段词数）、单元规划 `planUnits`、忠实度本地审稿 `localFidelityAudit`、任务失败分级 `diagnoseJobError`。这些都是纯函数，测试写起来快，而且正是搬运时最容易出错的地方——搬错一个 helper，`npm run e2e` 未必能发现，但这些测试会。目标是 `npm run test:unit` 在 10 秒内跑完。

这一阶段不改任何生产代码，价值是把后面每一阶段的验证从"跑 5 分钟 e2e"变成"跑 10 秒单测 + 最后再跑 e2e"。

**阶段 1：破除 6 处循环**
只在 `server/index.js` 内部移动函数位置，加上新建 `levels.js`、`pdf-text.js`、`telemetry.js` 三个小文件。改完重跑分析脚本确认循环数为 0。这一步做完，后面的拆分就纯粹是搬运。

**阶段 2：抽出叶子层**
`infra/config.js`、`infra/http.js`、`infra/storage.js`。这三个零依赖或近零依赖，被引用最多，抽出后收益立刻可见（`index.js` 少 480 行），风险最低。注意上面说的 `parseBoolean` 提升问题。

**阶段 3：鉴权与会话**
`infra/session.js`、`infra/users.js`。这一层碰安全，单独一步、单独提交，改动集中便于审阅。跑完 e2e 后建议额外手工验证一次真实登录与跨设备会话。

**阶段 4：解析层**
`parsing/` 四个文件。有阶段 0 的解析单测护航，这一步的信心最足。做完后建议用你那两本真实的 Tamerlane 和 Ottoman PDF 各跑一次上传，确认单元数与词数和现在完全一致。

**阶段 5：AI 与 TTS**
`ai/text.js`、`ai/tts.js`、`ai/services.js`。`ai/config.js` 已经在位，这一步是把它的同层伙伴补齐。`tts.js` 是单个最大模块（634 行），可以再按听力/播客拆成两个。

**阶段 6：领域逻辑**
`domain/` 九个文件。这是行数最多的一批（约 2900 行），但依赖方向清晰，且不碰 I/O。可以按文件逐个提交，不必一次做完。

**阶段 7：任务队列**
`jobs/`。这一层有唯一的模块级可变状态 `jobQueueActive` 和恢复逻辑，改动后必须验证：中断恢复、暂停/继续/取消、自动重试计时。e2e 覆盖了这些，但建议再手工造一次失败任务确认诊断信息正常。

**阶段 8：路由与装配**
`routes/` 九个文件 + `app.js`，`index.js` 收敛到启动逻辑。这一步改动面广但每处都很浅，风险主要是漏挂路由——建议加一条断言：启动时收集已注册路由清单，与一份期望清单比对，数量或路径不符就拒绝启动。这条断言本身值得长期保留。

## 5. 明确不做的事

不要在拆分过程中顺手改行为。任何"既然都改到这里了不如把这个也优化一下"的念头都应该记下来另开提交——拆分提交里混入行为变更，出问题时二分定位会失效。

不要引入依赖注入容器、事件总线或插件机制。分析显示所有循环都能靠移动 6 个函数解决，不需要架构层面的间接。

不要现在改 `readDb()` 返回整库快照的模式。交接文档里"逐步改为行级仓储 API"是对的方向，但那是行为变更，必须在拆分完成、`storage.js` 边界稳定之后单独做。两件事混在一起会同时放大两者的风险。

不要在这轮里改数据库结构或 `.env` 语义。

## 6. 风险与兜底

最大的风险是搬运时漏掉或重复某个函数。缓解办法有三层：拆分前后用脚本比对顶层符号清单，数量和名字必须完全一致；`npm run check` 会抓到未定义引用；阶段 0 的单测会抓到行为漂移。

第二个风险是模块初始化顺序。当前代码大量依赖函数提升，改成 ESM 后，模块顶层的立即执行代码（比如 `const x = parseBoolean(...)`）对导入顺序敏感。规避方式是让所有模块顶层只做纯计算和常量定义，不做副作用；需要副作用的（比如 `refreshAiServiceConfig`）保持由 `createApp` 显式调用。

第三个风险是部署。拆分会新增大量文件，`Dockerfile` 里是 `COPY server ./server`，整目录复制，新文件会自动包含——这点不用改。但每次部署前仍要按现有流程先备份，并核对容器内哈希。

## 7. 建议的验证节奏

阶段 0 之后，每阶段：`npm run check` + `npm run test:unit` + `npm run test:ai`（约 30 秒）；每阶段结束再补 `npm run e2e`（完整回归）。阶段 4、7、8 额外加 `npm run visual`。全部完成后跑 `npm audit --audit-level=moderate` 和 `npm run predeploy`，然后按现有部署流程上线。

不建议中途部署到生产。拆分期间生产保持在阶段 0 之前的提交上，全部阶段做完、完整验证通过后一次性部署，这样出问题时回滚目标明确。

---

## 执行结果（2026-07-26 完成）

方案已全部实施。`server/index.js` 从 8897 行降到 36 行（只保留启动分支与优雅关闭），拆成 34 个模块，最大的 `jobs.js` 826 行。

与原方案的偏差有三处，都是实施中发现方案本身不够准确：

第一，模块顺序必须严格自底向上，而不是按方案里的阶段编号。`telemetry.js` 原计划在阶段 1 抽出，实际尝试时发现它依赖尚未抽出的 `storage` 和 AI 配置层，只能回退，改到阶段 7 才做。教训是：破循环这件事本身不需要提前做，因为循环只在文件真正分开后才成立。

第二，方案里的 6 处循环最后只需处理 4 处。`groupPdfPages` 与 `looksLikeTableOfContents` 在按依赖顺序抽取时自然落到了正确模块，不需要单独移动。

第三，新增了两个方案里没有的模块：`quota.js`（AI 额度判定，从 index.js 里散落的三个 `shouldRateLimit*` 收拢）和 `bootstrap.js`（初始管理员播种，从 users.js 剥离以免鉴权层依赖用户设置）。

### 实施中真正抓到的问题

拆分过程中出现 8 次运行时破坏，全部由验证工具在提交前拦下，没有一次进入交付：

- `pdf-text.js` 漏了 `normalizeText`（回归测试抓到）
- `audio.js` 的 `estimateTtsInputTokens` 未回引（回归测试抓到）
- `ai-services.js` 漏了 `shouldUseVisionOcr`（回归测试抓到）
- `job-diagnosis.js` 漏了 `formatServiceNumber`、`formatBytes`（藏在模板字符串里，工具改进后抓到）
- `admin-report.js`、`jobs.js` 漏了多个配置常量（取值引用，工具改进后抓到）
- `routes/books.js` 漏了 `auth` 中间件、`path`/`fs`、`summarizeBook`（三种不同盲区，工具改进后抓到）

每一次都推动 `check-server-imports.mjs` 覆盖一类新的引用形态：调用点 → 模板字符串内的调用 → 取值引用 → Node 内置模块 → 展开运算符后的引用 → 中间件位置的引用。这个工具最终成为拆分中最有价值的产物，它把「拆错了要跑五分钟测试才知道」变成「一秒钟静态报错」。

### 验证工具

```bash
npm run verify          # 下面五项全跑，约 40 秒
npm run check           # tsc
npm run check:symbols   # 510 个顶层符号与基线比对，防止搬丢或重复
npm run check:imports   # 每个调用/取值目标都已导入
npm run check:routes    # 44 条路由齐全，且证明没有互相遮蔽
npm run test:ai         # 83 项自定义 API 测试
npm run test:server     # 65 项 API 回归
npm run analyze:server  # 依赖图与循环检测（针对 index.js，拆完后已无意义）
```

`server/app.js` 里的 `assertRoutesRegistered` 会在启动时核对 API 路由数量，漏挂任何一个路由模块都会拒绝启动而不是静默少一个接口。这条断言经过实测：临时注释掉一个路由模块后，启动报「期望 44 条，实际 41 条」。

### 仍未做的事

方案第 5 节列的三件事保持不做：没有混入任何行为变更，没有引入依赖注入或事件总线，没有动 `readDb()` 的整库快照模式。行级仓储 API 现在可以作为独立工作项开始，`storage.js` 的边界已经稳定。

前端构建与 `npm run e2e`、`npm run visual` 需要在 Windows 本机运行——云端沙盒的 npm 安全策略拦截了 Linux 原生构建依赖。
