# 施工方案：AI 播客生成功能（Gemini TTS）

> 本文档面向具体施工的 AI/开发者。目标：在现有 LinguaShelf（分级阅读）应用中，新增"AI 播客"功能——用户上传一本书后，可以一键根据全书内容生成一集或多集"老师讲解"风格的播客音频，供英语学习者收听。
>
> 阅读顺序建议：先读「0. 背景与约束」和「1. 已验证的关键事实」，再按「4. 施工步骤」逐步实现。所有代码片段中的 API 调用格式均已实测跑通，请勿改动请求结构。

---

## 0. 背景与约束

### 0.1 现有项目结构（只列相关文件）

```
graded-reader/
├── server/index.js        # 后端全部逻辑，2746 行，单文件 Express 应用
├── src/App.tsx            # 前端全部逻辑，2284 行，单文件 React 应用
├── src/style.css          # 全部样式，1367 行
├── .env                   # 运行时配置（不进 git）
├── .env.example           # 配置模板
└── data/
    ├── app.sqlite         # sqlite 存储（STORAGE_DRIVER=sqlite）
    └── audio/             # 已有音频输出目录（听力音频复用此目录）
```

### 0.2 技术栈与关键约定（必须遵守）

- 后端是**单文件 ES Module**（`server/index.js`），用 `import`，Node 22。不要拆分文件，新增函数追加到合适位置即可。
- 存储层是**"读改写整库快照"模式**：`readDb()` 一次性读出所有集合成为一个大对象，`writeDb(db)` 把整个对象覆盖写回。**新增的 `podcasts` 集合必须走同一套机制**（见步骤 1）。
  - ⚠️ 已知隐患：这套机制在并发下有 lost-update 风险。本功能因此**必须限制并发**（见步骤 5），且写回前要 `readDb()` 拿最新快照，避免覆盖 job 队列的进度更新。参考现有 `processJobQueue`（server/index.js:1955）的写法：每次改动前重新 `readDb()`，找到对象、改、`writeDb()`。
- 前端是**单文件 React**（`src/App.tsx`），函数组件 + hooks，无状态管理库。类型定义集中在文件顶部（第 28-293 行）。
- **不引入任何新的 npm 依赖**，尤其不要用 ffmpeg。音频拼接用 Node 原生 Buffer 操作（见步骤 4）。
- 所有面向用户的文案用**简体中文**，与现有代码一致。

### 0.3 复用现有能力

| 能力 | 现有位置 | 说明 |
|---|---|---|
| 书籍解析 | `parseEpub` / `parsePdf` (server/index.js:512, 721) | 已把书拆成 chapters，并进一步 `planUnits` 拆成 units（每个约 1700 词原文，存 `unit.sourceText`）。**播客分集直接复用已入库的 units。** |
| OpenAI /responses 调用 | `generateWithOpenAI` (server/index.js:1114) | 播客脚本生成复用这套请求方式（`/responses` + json_schema）。 |
| Job 队列 | `processJobQueue` (server/index.js:1955) | 泛化以支持新 job 类型 `generate-podcast`。 |
| 鉴权中间件 | `auth` (server/index.js:282) | 所有新路由都要挂 `auth`。 |
| 音频目录 | `audioDir` = `data/audio/` (server/index.js:17) | 播客 WAV 输出到这里。 |
| WAV 头写入 | 见步骤 4（本文档提供） | Gemini 返回裸 PCM，需要自己加 WAV 头。 |

---

## 1. 已验证的关键事实（实测，勿推翻）

### 1.1 选用 Gemini 2.5 Flash TTS

用户已试听 MiMo 与 Gemini 两家样本，**选定 Gemini**（音质更好）。

### 1.2 Gemini TTS 调用格式（已跑通）

- 端点（第三方兼容代理）：`{baseUrl}/v1beta/models/{model}:generateContent`
- 模型：`gemini-2.5-flash-preview-tts`
- 返回：**裸 PCM 数据**，`audio/L16; codec=pcm; rate=24000`，即 **24kHz、16-bit、单声道**。需自行加 WAV 头。
- 鉴权：同时带 `x-goog-api-key` 和 `Authorization: Bearer`（代理两种都认）。

**实测可用的请求代码（原样使用，勿改结构）：**

```js
const response = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  }),
})
// 取音频：
const data = await response.json()
const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
const pcm = Buffer.from(part.inlineData.data, 'base64') // 裸 PCM16
```

> 说明：可以在 `text` 前面拼一段风格提示（如 "Read in a warm, encouraging teacher voice: ..."），Gemini TTS 支持自然语言风格控制。voiceName 用户选定 **`Kore`**（试听用的就是它）；可选值还有 Puck、Charon、Aoede 等，做成可配置。

### 1.3 时延特性（决定切块策略）

| 输入长度 | 单次合成耗时 | 结果 |
|---|---|---|
| 300 字符 | ~11.7 秒 | ✅ |
| 3000 字符 | ~43.8 秒 | ✅ |
| 5000 字符 | >44 秒 | 超时 |

**结论：合成耗时随文本长度增长，长文本无法一次生成。必须切块。**

切块参数定为：**每块目标 ~2500 字符**（留余量，避免逼近超时），按句子边界切，不要从单词中间断开。多块之间可**并发 2-3 个**以缩短总时长（但注意并发也会放大 API 成本，见步骤 5）。

### 1.4 PCM → WAV 拼接（无 ffmpeg）

多块返回的都是同格式裸 PCM（24kHz/16bit/mono），**直接按顺序 concat 所有 PCM 字节，最后加一个 WAV 头即可**。无需重采样、无需 ffmpeg。块间可选插入极短静音（见步骤 4）。

---

## 2. 功能行为规格

### 2.1 用户视角

1. 用户在「书籍详情页」（前端 `BookView`）看到一个「生成播客」按钮。
2. 点击后，后端根据全书篇幅自动决定**集数**（书越大集数越多），把每集作为一个 `generate-podcast` job 入队，前端轮询进度（复用现有 job 轮询 UI）。
3. 每集生成完成后，在书籍详情页出现一个**播客列表**，每集可播放（复用 HTML `<audio>`）、显示标题和时长。
4. 可选：展示该集的讲解脚本文字（transcript）。

### 2.2 分集规则

- 输入：该书已入库的 units（`db.units.filter(u => u.bookId === book.id)`），每个 unit 有 `sourceText`（约 1700 词原文）。
- 按顺序把 units 累加分组，**每组累计原文约 2200 词**为一集（与现有 `groupPdfPages` 的 2600 词阈值风格一致，可调）。
- 每集记录它包含哪些 `unitId`（字段 `sourceUnitIds`），以及合并后的原文 `sourceText`。
- 集数 = 分组数。举例：一本 ~11000 词的书 → 约 5 集。
- 设上限（如每本书最多 12 集），避免超大书爆量，读 `MAX_PODCAST_EPISODES` 环境变量，默认 12。

### 2.3 单集脚本生成规格

用户提供的核心 prompt（**必须忠实纳入**，这是产品灵魂）：

```
Listener Profile: English Language Learner, with a target vocabulary level of Lexile {LEXILE}L.
Instruction: Create a detailed, audio-ready podcast for English learners. Your goal is to
explain the entire source document in simple, clear language.

Core instructions:
1. Explain every key detail and concept from the source. Make everything easy to understand.
   Primarily use vocabulary appropriate for a Lexile {LEXILE}L level. Crucially, if the source
   uses any word or concept that might be unfamiliar or difficult—whether a complex word or a
   specialized idea—you must immediately explain it: first state the term clearly, then define
   it in very simple words. Example: if the source says "The findings were ambiguous," explain
   it like: "The book says the findings were 'ambiguous'. The word 'ambiguous' means that
   something is unclear or can be understood in more than one way. So, in this case, the results
   of the study were not easy to understand."
2. Focus on depth. It is more important to be thorough than brief. Explain each section completely.
3. Structure for learning. Start with a simple introduction. After a few main ideas, give a short
   "Micro-Recap" to help review.
4. Tone: a patient, encouraging, and clear teacher.
5. Your main goal is to EXPAND and EXPLAIN, not to summarize or shorten the original content.
```

**关键改造点（务必执行）：**
- **删除原 prompt 里 "Type CONTINUE to learn more" 那条交互指令。** 音频是预渲染文件，无法交互等待用户输入。改为：因为内容已经按集切分，每集自然对应一个 section；每集结尾用一句自然的引导语收尾（如 "That's the end of this part. Play the next episode to keep learning."）。
- `{LEXILE}` 用用户设置里的 `podcastLexile`（新增，见步骤 1），默认 **900**。
- 由于要"expand and explain"，输出脚本会**比原文长**。单集脚本可能几千字，这正是需要切块 TTS 的原因（步骤 4）。
- 脚本生成走 `/responses`，用 json_schema 约束输出结构：返回 `{ title, script }` 即可（script 是纯文本，供 TTS 用；title 供列表展示）。
- 若未配置 `OPENAI_API_KEY`，走 fallback：把该集原文做简单串接 + 固定引导语，标注 `generationMode: 'local-demo'`（参考现有 `makeFallbackContent` 的降级思路 server/index.js:961）。

---

## 3. 数据结构

### 3.1 新增集合 `podcasts`

在 `defaultDb`（server/index.js:36）里加 `podcasts: []`。每条 = 一集：

```js
{
  id,                    // nanoid
  userId,                // 归属用户
  bookId,                // 归属书籍
  index,                 // 第几集（从 0 或 1 开始，保持一致）
  title,                 // 集标题（脚本生成时产出）
  status,                // 'planned' | 'scripting' | 'synthesizing' | 'ready' | 'failed'
  sourceUnitIds: [],     // 本集覆盖的 unitId
  sourceWordCount,       // 本集原文词数
  lexile,                // 生成时用的 Lexile 值
  scriptText,            // 生成的讲解脚本全文（可为 null，未生成时）
  scriptMode,            // 'ai' | 'local-demo'
  audio: {               // 合成完成后填充
    file,                // 文件名（相对 audioDir），如 `${podcastId}.wav`
    format: 'wav',
    voice,               // 如 'Kore'
    durationSeconds,     // 由 PCM 字节数算出（见步骤 4）
    chunkCount,          // 切了几块
    generatedAt,
  } | null,
  jobId,                 // 关联的生成 job id
  createdAt,
  updatedAt,
}
```

### 3.2 `recordId` 需要认识新集合

`recordId`（server/index.js:163）用 `item.id` 作为主键即可（podcasts 每条都有 `id`，会自动命中第一行 `if (item?.id) return String(item.id)`）。无需改动，但确认一下。

### 3.3 用户设置新增字段

`userSettings`（server/index.js:310）的默认对象里加：

```js
podcastLexile: 900,
podcastVoice: 'Kore',
```

`PATCH /api/settings` 的 `allowed` 白名单（server/index.js:2185）里加入 `'podcastLexile'`、`'podcastVoice'`。

### 3.4 `.env.example` 新增配置

```
# --- Podcast (Gemini TTS) ---
GEMINI_TTS_BASE_URL=https://api.futureppo.top
GEMINI_TTS_API_KEY=
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
GEMINI_TTS_VOICE=Kore
PODCAST_LEXILE_DEFAULT=900
MAX_PODCAST_EPISODES=12
PODCAST_TTS_CHUNK_CHARS=2500
PODCAST_TTS_CONCURRENCY=2
MAX_ACTIVE_PODCAST_JOBS=2
```

> ⚠️ 实际 `.env` 里需要填入真实的 `GEMINI_TTS_API_KEY`。测试所用 key 是用户临时提供的第三方代理 key，**不要硬编码进源码**，一律从 env 读。

---

## 4. 核心实现代码（后端）

### 4.1 WAV 头 + PCM 拼接工具函数

追加到 server/index.js（音频相关函数附近，如 `generateSpeechAudio` 之后）：

```js
function pcmToWav(pcm, sampleRate = 24000, channels = 1, bits = 16) {
  const byteRate = (sampleRate * channels * bits) / 8
  const blockAlign = (channels * bits) / 8
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)          // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bits, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

// 由 PCM 字节数估算时长（秒）：bytes / (sampleRate * channels * bytesPerSample)
function pcmDurationSeconds(pcmLength, sampleRate = 24000, channels = 1, bits = 16) {
  return pcmLength / (sampleRate * channels * (bits / 8))
}

// 可选：生成一段静音 PCM（用于块间自然停顿），ms 毫秒
function silencePcm(ms, sampleRate = 24000, channels = 1, bits = 16) {
  const samples = Math.round((sampleRate * ms) / 1000)
  return Buffer.alloc(samples * channels * (bits / 8)) // 全 0 = 静音
}
```

### 4.2 按句子切块

```js
function chunkTextForTts(text, maxChars = Number(process.env.PODCAST_TTS_CHUNK_CHARS || 2500)) {
  const sentences = String(text || '')
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]+|\S+$/g) || []
  const chunks = []
  let current = ''
  for (const sentence of sentences) {
    const s = sentence.trim()
    if (!s) continue
    if (current && (current.length + 1 + s.length) > maxChars) {
      chunks.push(current)
      current = s
    } else {
      current = current ? `${current} ${s}` : s
    }
    // 单句就超长的极端情况：硬切
    while (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars))
      current = current.slice(maxChars)
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}
```

### 4.3 单块 Gemini TTS 调用

```js
async function geminiTtsChunk(text, voiceName) {
  const baseUrl = process.env.GEMINI_TTS_BASE_URL || 'https://api.futureppo.top'
  const apiKey = process.env.GEMINI_TTS_API_KEY
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'
  if (!apiKey) throw new Error('未配置 GEMINI_TTS_API_KEY')

  const response = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' } } },
      },
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Gemini TTS 失败：${response.status} ${body.slice(0, 200)}`)
  }
  const data = await response.json()
  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
  if (!part) throw new Error('Gemini TTS 未返回音频数据')
  return Buffer.from(part.inlineData.data, 'base64') // 裸 PCM16
}
```

### 4.4 整集合成（切块 + 有限并发 + 拼接 + 落盘）

```js
async function synthesizePodcastAudio(podcast, onProgress = () => {}) {
  const voice = podcast.audio?.voice || process.env.GEMINI_TTS_VOICE || 'Kore'
  const chunks = chunkTextForTts(podcast.scriptText)
  if (!chunks.length) throw new Error('脚本为空，无法合成')

  const concurrency = Math.max(1, Number(process.env.PODCAST_TTS_CONCURRENCY || 2))
  const pcmParts = new Array(chunks.length)
  let done = 0
  let cursor = 0

  async function worker() {
    while (cursor < chunks.length) {
      const i = cursor++
      pcmParts[i] = await geminiTtsChunk(chunks[i], voice)
      done++
      onProgress(Math.round((done / chunks.length) * 100))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker))

  // 拼接：块间插 120ms 静音让停顿更自然
  const gap = silencePcm(120)
  const merged = []
  pcmParts.forEach((p, i) => {
    if (i > 0) merged.push(gap)
    merged.push(p)
  })
  const pcm = Buffer.concat(merged)
  const wav = pcmToWav(pcm)

  const file = `${podcast.id}.wav`
  await fs.mkdir(audioDir, { recursive: true })
  await fs.writeFile(path.join(audioDir, file), wav)

  return {
    file,
    format: 'wav',
    voice,
    durationSeconds: Math.round(pcmDurationSeconds(pcm.length)),
    chunkCount: chunks.length,
    generatedAt: new Date().toISOString(),
  }
}
```

### 4.5 脚本生成（Gemini 之前的一步，用 OpenAI /responses）

```js
const podcastScriptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    script: { type: 'string' },
  },
  required: ['title', 'script'],
}

function buildPodcastPrompt(sourceText, lexile) {
  return `
Listener Profile: English Language Learner, target vocabulary level Lexile ${lexile}L.
Create a detailed, audio-ready podcast script for English learners. Explain the entire source
below in simple, clear language.

Rules:
1. Explain every key detail and concept. Primarily use vocabulary at Lexile ${lexile}L. If the
   source uses any difficult word or specialized idea, immediately explain it: state the term,
   then define it in very simple words (e.g. 'The book says X. The word X means ... So ...').
2. Focus on depth over brevity. Explain each section completely.
3. Start with a simple introduction. After a few main ideas, add a short "Micro-Recap".
4. Tone: a patient, encouraging, clear teacher.
5. EXPAND and EXPLAIN, do NOT summarize or shorten.
6. End the episode with one natural closing line inviting the listener to play the next episode.
   Do NOT ask the listener to type anything or wait for input (this is a pre-recorded audio).

Return JSON: { "title": short episode title, "script": the full spoken script as plain prose,
no markdown, no stage directions }.

Source:
${sourceText}
`
}

async function generatePodcastScript(sourceText, lexile) {
  const apiKey = process.env.OPENAI_API_KEY
  const provider = process.env.AI_PROVIDER || 'auto'
  if (provider === 'mock' || !apiKey) {
    // fallback：不做真正改写，串接原文 + 引导语
    return {
      title: 'Reading Podcast',
      script: `${takeWords(sourceText, 900)} That's the end of this part. Play the next episode to keep learning.`,
      mode: 'local-demo',
    }
  }
  const model = process.env.OPENAI_MODEL || 'gpt-5.5'
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || 'medium' },
      instructions: 'You write faithful, expanded graded-reading podcast scripts for English learners. Return only schema-valid JSON.',
      input: buildPodcastPrompt(takeWords(sourceText, 3000), lexile),
      text: {
        verbosity: 'high',
        format: { type: 'json_schema', name: 'podcast_script', strict: true, schema: podcastScriptSchema },
      },
    }),
  })
  if (!response.ok) throw new Error(`播客脚本生成失败：${response.status} ${(await response.text()).slice(0, 200)}`)
  const content = getResponsesOutputText(await response.json())
  if (!content) throw new Error('脚本生成未返回内容')
  const parsed = JSON.parse(content)
  return { title: parsed.title, script: parsed.script, mode: 'ai' }
}
```

> 注：`buildPodcastPrompt` 里 `takeWords(sourceText, 3000)` 是给 LLM 的输入上限保护。若单集原文超 3000 词，可考虑分段喂给 LLM 再合并——第一版先截断，标注在验收里作为已知限制。

---

## 5. 分集 + Job 队列 + API 路由

### 5.1 分集函数

```js
function planPodcastEpisodes(book, units) {
  const bookUnits = units
    .filter((u) => u.bookId === book.id)
    .slice() // 保持入库顺序
  const targetWords = 2200
  const maxEpisodes = Number(process.env.MAX_PODCAST_EPISODES || 12)
  const groups = []
  let current = { unitIds: [], text: '', words: 0 }
  for (const u of bookUnits) {
    current.unitIds.push(u.id)
    current.text = current.text ? `${current.text}\n\n${u.sourceText || ''}` : (u.sourceText || '')
    current.words += Number(u.sourceWordCount || wordCount(u.sourceText))
    if (current.words >= targetWords) {
      groups.push(current)
      current = { unitIds: [], text: '', words: 0 }
    }
  }
  if (current.unitIds.length) groups.push(current)
  return groups.slice(0, maxEpisodes)
}
```

### 5.2 扩展 Job 队列

现有 `processJobQueue`（server/index.js:1955）只处理 `type === 'generate-unit'`。改造为也处理 `generate-podcast`：

- 在 `while` 循环里，查找 queued job 时不要写死 type；取到 job 后按 `job.type` 分派。
- 新增 `generate-podcast` 分支逻辑：
  1. 读出对应 podcast 记录，`status = 'scripting'`，写回进度。
  2. 调 `generatePodcastScript(podcast.sourceText, podcast.lexile)` → 填 `scriptText`、`title`、`scriptMode`。
  3. `status = 'synthesizing'`，调 `synthesizePodcastAudio(podcast, onProgress)`，onProgress 里更新 job.progress（注意：更新进度要重新 readDb/writeDb，避免覆盖，参考现有写法；为减少写库频率，可每完成一块才写一次）。
  4. 成功：`status = 'ready'`，填 `audio`，job `succeeded`。
  5. 失败：`status = 'failed'`，job `failed`，`error` 存消息。
- **并发限制**：新增 job 前检查该用户 `generate-podcast` 且 `['queued','running']` 的数量，超过 `MAX_ACTIVE_PODCAST_JOBS`（默认 2）则拒绝入队并返回提示。这是**成本护栏**，务必实现（Gemini 全书合成较贵）。

> `recoverInterruptedJobs`（server/index.js:1934）也要覆盖新 type——服务重启时把 running 的 podcast job 重新排队，并把对应 podcast 的中间态 reset。

### 5.3 新增 API 路由（都挂 `auth`，放在现有路由区）

```
POST   /api/books/:bookId/podcasts/generate
  - 校验 book 属于当前用户
  - 检查并发上限（MAX_ACTIVE_PODCAST_JOBS）
  - planPodcastEpisodes(book, units) → 为每集创建 podcast 记录(status:'planned') + generate-podcast job
  - writeDb, setTimeout(processJobQueue, 0)
  - 返回 { podcasts: [...], jobs: [...], enqueued }

GET    /api/books/:bookId/podcasts
  - 返回该书所有 podcast 记录（不含 scriptText 全文可选，列表用精简版）

GET    /api/podcasts/:podcastId
  - 返回单集详情（含 scriptText，供展示 transcript）

GET    /api/podcasts/:podcastId/audio
  - 校验归属 + status==='ready'
  - res.setHeader('Content-Type','audio/wav'); res.sendFile(path.join(audioDir, podcast.audio.file))
  - 参考现有 GET /api/units/:unitId/audio (server/index.js:2671) 的写法

DELETE /api/podcasts/:podcastId   (可选，第一版可省)
  - 删记录 + 删音频文件
```

- `publicPodcast(p)` 辅助函数：列表场景去掉 `scriptText` 减小体积；详情场景保留。参考现有 `publicUnit`（server/index.js:1532）去字段的思路。
- job 的 `publicJob`（server/index.js:1857）已通用，podcast job 也能用；前端轮询走现有 `GET /api/jobs/:jobId`。

---

## 6. 前端集成（src/App.tsx）

### 6.1 新增类型（文件顶部类型区，第 28-293 行附近）

```ts
type Podcast = {
  id: string
  bookId: string
  index: number
  title: string
  status: 'planned' | 'scripting' | 'synthesizing' | 'ready' | 'failed'
  sourceWordCount: number
  lexile: number
  scriptText?: string | null
  scriptMode?: string
  audio?: {
    file: string
    format: string
    voice: string
    durationSeconds: number
    chunkCount: number
    generatedAt: string
  } | null
  jobId?: string
  createdAt: string
  updatedAt: string
}
```

`UserSettings` 类型里加 `podcastLexile: number` 和 `podcastVoice: string`。

### 6.2 BookView 改造

`BookView` 组件（`src/App.tsx`，约第 1140-1196 行区域是其单元列表尾部；组件签名在更靠前，用编辑器搜 `function BookView`）。要加：

1. 一个「生成播客」按钮（放在书籍标题/操作区）。点击调 `POST /api/books/:bookId/podcasts/generate`，拿到 jobs 后复用现有 `watchJobs` 式轮询（参考 App 组件里的 `watchJobs` server 第 488 行；BookView 内可自建局部轮询，或把回调透传下来）。
2. 一个「播客」区块：进入 BookView 时 `GET /api/books/:bookId/podcasts` 拉列表；渲染每集：标题、状态徽标、时长（`durationSeconds` 格式化成 mm:ss）、播放按钮。
3. 播放：`ready` 状态的集，用 `<audio controls src={`/api/podcasts/${p.id}/audio`}>`，并带 `Authorization` 头——注意 `<audio src>` 无法带自定义头。**解决方案**：像现有听力音频那样，用 `fetch` 带 token 拉成 blob 再 `URL.createObjectURL`（参考 StudyView 里 audio 的处理，server 交互见 src/App.tsx:1436 那段 `headers: { Authorization }` 的音频拉取）。据此实现一个 `loadPodcastAudio(p)`：

```ts
const res = await fetch(`/api/podcasts/${p.id}/audio`, { headers: { Authorization: `Bearer ${token}` } })
const blob = await res.blob()
const url = URL.createObjectURL(blob)
// 赋给 audio 元素的 src；组件卸载时 URL.revokeObjectURL
```

4. `scripting` / `synthesizing` 状态显示进度条（复用现有 `.progress-line` 样式）和轮询 job。
5. `failed` 状态显示错误 + 「重试」按钮（对该集重新入队一个 job，或加个 `POST /api/podcasts/:id/retry`——第一版可复用 generate 接口重跑）。

### 6.3 SettingsView 改造

`SettingsView`（src/App.tsx，搜 `function SettingsView`，约第 1746 行）加两个控件：

- Lexile 难度：下拉选 700 / 900 / 1100（默认 900），PATCH `/api/settings` 的 `podcastLexile`。
- 播客音色：下拉选 Gemini 音色（Kore / Puck / Charon / Aoede …），PATCH `podcastVoice`。

### 6.4 样式（src/style.css）

复用现有卡片/按钮/进度条样式类即可（`.progress-line`, `.icon-button`, 卡片类）。播客列表可套用现有 unit 列表的卡片样式，减少新增 CSS。

---

## 7. 施工顺序与验收

### 7.1 建议施工顺序

1. **后端数据层**：`defaultDb` 加 `podcasts`；`userSettings` 加字段；`.env.example` 补配置。
2. **后端工具函数**：`pcmToWav` / `pcmDurationSeconds` / `silencePcm` / `chunkTextForTts` / `geminiTtsChunk` / `synthesizePodcastAudio`。
3. **后端脚本生成**：`podcastScriptSchema` / `buildPodcastPrompt` / `generatePodcastScript`。
4. **后端分集 + 队列 + 路由**：`planPodcastEpisodes`；扩展 `processJobQueue` 与 `recoverInterruptedJobs`；新增 5 条路由；并发护栏。
5. **前端**：类型 → BookView（生成按钮+列表+播放）→ SettingsView（Lexile/音色）。
6. **验证**（见下）。

### 7.2 验收标准（务必逐条验证）

**编译/构建**
- `npm run check`（`tsc --noEmit`）通过，无类型错误。
- `npm run build`（`tsc && vite build`）通过。

**后端功能**（可写一个临时 mjs 脚本直连函数，或起服务用 curl）
- [ ] `chunkTextForTts` 对一段 8000 字符文本，切出的每块 ≤ 2500 字符，且不从单词中间断（块边界落在句号后）。
- [ ] `pcmToWav` 产出的文件头是合法 WAV：前 4 字节 `RIFF`，第 8-11 字节 `WAVE`，`fmt ` chunk 声明 24000 采样率、1 声道、16 bit。（用 `xxd file.wav | head` 核对。）
- [ ] `geminiTtsChunk` 用 .env 里的真实 key 对一段 ~400 字符文本能返回非空 PCM（>100KB）。
- [ ] `synthesizePodcastAudio` 对一段跨 2-3 块的脚本，产出单个可播放 WAV，时长与字数大致相符（约每分钟 130-150 词），`chunkCount` 正确。
- [ ] `planPodcastEpisodes` 对一本已上传的书，分集数随篇幅增长，且不超过 `MAX_PODCAST_EPISODES`。
- [ ] 并发护栏：连续两次触发生成后，第三次在上限内被拒绝并返回中文提示。
- [ ] 服务重启时 `recoverInterruptedJobs` 把未完成的 podcast job 重新排队，不产生半个坏文件。

**前端功能**
- [ ] 书籍详情页出现「生成播客」按钮；点击后出现进度；完成后出现可播放的集列表。
- [ ] 播放能出声（blob + Authorization 方案生效，不是 401）。
- [ ] 设置页能改 Lexile 和音色，刷新后保持。
- [ ] 生成失败时前端有可读的错误提示与重试入口。

**成本/安全自查**
- [ ] Gemini/OpenAI key 全部从 env 读，源码无硬编码。
- [ ] 生成类路由都在 `auth` 之后，且并发上限生效。
- [ ] 播客音频路由校验了 `podcast.userId === req.user.id`，不能越权拉别人的音频。

### 7.3 已知限制（第一版可接受，写进交付说明）

- 单集原文若超 ~3000 词，喂给 LLM 时会截断（`takeWords(...,3000)`），可能漏掉尾部内容。后续可改成分段喂+合并。
- 无 mp3，输出 WAV 体积较大（24kHz/16bit 约 2.8MB/分钟）。若要压缩需另引入编码（第一版不做）。
- TTS 与脚本生成的耗时较长（全书多集可能数分钟），已用 job 队列异步化，前端轮询即可。

---

## 8. 参考：实测样本与调用代码位置

- 试听样本（已生成，供施工者参考音质/格式）：项目根目录 `sample-gemini-Kore.wav`（Gemini，选定）、`sample-mimo-Mia.wav`（MiMo，未选）。
- 实测调用脚本：项目根目录 `sample-tts.mjs`（含 MiMo 与 Gemini 两家的可运行调用，Gemini 部分即本文档 4.3/4.4 的来源）。施工完成后可删除。

---

*本方案所有 API 请求结构均经过实测验证。施工时如遇 Gemini 返回结构变化，以 `data.candidates[0].content.parts[].inlineData.data` 为准解析 base64 PCM。*
