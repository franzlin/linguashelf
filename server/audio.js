// Audio encoding, on-disk audio files, and TTS text chunking.
//
// Providers return 24kHz mono PCM; this module concatenates it and encodes to
// MP3, falling back to WAV when the encoder fails. File deletion is guarded by
// `isPathInside` so a crafted id cannot reach outside the data directory.
import fs from 'node:fs/promises'
import path from 'node:path'
import lamejs from '@breezystack/lamejs'
import { audioDir, podcastAudioFormat, podcastMp3Kbps, podcastTtsChunkChars, podcastTtsChunkTokens, uploadDir } from './config.js'
import { wordCount } from './text.js'

export function pcmToWav(pcm, sampleRate = 24000, channels = 1, bits = 16) {
  const byteRate = (sampleRate * channels * bits) / 8
  const blockAlign = (channels * bits) / 8
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bits, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export function pcmDurationSeconds(pcmLength, sampleRate = 24000, channels = 1, bits = 16) {
  return pcmLength / (sampleRate * channels * (bits / 8))
}

export function silencePcm(ms, sampleRate = 24000, channels = 1, bits = 16) {
  const samples = Math.round((sampleRate * ms) / 1000)
  return Buffer.alloc(samples * channels * (bits / 8))
}

export function pcmBufferToInt16Array(pcm) {
  const samples = new Int16Array(Math.floor(pcm.length / 2))
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = pcm.readInt16LE(index * 2)
  }
  return samples
}

export function encodePcmToMp3(pcm, sampleRate = 24000, kbps = podcastMp3Kbps) {
  const samples = pcmBufferToInt16Array(pcm)
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, Math.max(48, Math.min(128, Number(kbps || 64))))
  const chunks = []
  for (let offset = 0; offset < samples.length; offset += 1152) {
    const frame = samples.subarray(offset, offset + 1152)
    const bytes = encoder.encodeBuffer(frame)
    if (bytes.length) chunks.push(Buffer.from(bytes))
  }
  const flushed = encoder.flush()
  if (flushed.length) chunks.push(Buffer.from(flushed))
  const output = Buffer.concat(chunks)
  if (output.length < 1000) throw new Error('MP3 编码输出过小')
  return output
}

export function podcastAudioContentType(format = '') {
  return String(format).toLowerCase() === 'mp3' ? 'audio/mpeg' : 'audio/wav'
}

export function podcastAudioFilename(podcast, format) {
  return `${podcast.id}.${format === 'mp3' ? 'mp3' : 'wav'}`
}

export async function writePodcastAudio(podcast, pcm) {
  await fs.mkdir(audioDir, { recursive: true })
  const requested = podcastAudioFormat === 'wav' ? 'wav' : 'mp3'
  const durationSeconds = Math.round(pcmDurationSeconds(pcm.length))

  try {
    if (requested === 'mp3') {
      const file = podcastAudioFilename(podcast, 'mp3')
      const bytes = encodePcmToMp3(pcm)
      await fs.writeFile(path.join(audioDir, file), bytes)
      return {
        file,
        format: 'mp3',
        contentType: 'audio/mpeg',
        byteLength: bytes.length,
        durationSeconds,
      }
    }
  } catch (error) {
    console.error('podcast mp3 encoding failed, falling back to wav', error)
  }

  const file = podcastAudioFilename(podcast, 'wav')
  const bytes = pcmToWav(pcm)
  await fs.writeFile(path.join(audioDir, file), bytes)
  return {
    file,
    format: 'wav',
    contentType: 'audio/wav',
    byteLength: bytes.length,
    durationSeconds,
  }
}

export async function deletePodcastAudioFiles(podcast) {
  const files = new Set([podcast?.audio?.file, `${podcast?.id}.wav`, `${podcast?.id}.mp3`].filter(Boolean))
  for (const file of files) {
    const audioPath = path.resolve(audioDir, file)
    if (!isPathInside(audioPath, audioDir)) continue
    await fs.unlink(audioPath).catch(() => undefined)
  }
}

export function isPathInside(targetPath, parentDir) {
  const target = path.resolve(targetPath)
  const parent = path.resolve(parentDir)
  return target === parent || target.startsWith(`${parent}${path.sep}`)
}

export async function deleteUnitAudioFiles(unit) {
  const files = new Set()
  if (unit?.audio?.hash && unit?.audio?.format) files.add(`${unit.id}-${unit.audio.hash}.${unit.audio.format}`)
  try {
    const entries = await fs.readdir(audioDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith(`${unit.id}-`)) files.add(entry.name)
    }
  } catch {
    // Audio cache may not exist yet.
  }
  for (const file of files) {
    const audioPath = path.resolve(audioDir, file)
    if (!isPathInside(audioPath, audioDir)) continue
    await fs.unlink(audioPath).catch(() => undefined)
  }
}

export async function deleteSourceFileIfSafe(sourcePath) {
  if (!sourcePath) return
  const resolved = path.resolve(sourcePath)
  if (!isPathInside(resolved, uploadDir)) return
  await fs.unlink(resolved).catch(() => undefined)
}

export function estimateTtsInputTokens(text) {
  const value = String(text || '').trim()
  if (!value) return 0
  const cjkChars = value.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g)?.length || 0
  const words = value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length || 0
  const nonCjkChars = Math.max(0, value.length - cjkChars)
  return Math.ceil(words * 1.35 + cjkChars + nonCjkChars / 12)
}

export function fitsTtsChunk(text, maxChars, maxTokens) {
  const value = String(text || '').trim()
  return value.length <= maxChars && estimateTtsInputTokens(value) <= maxTokens
}

export function splitOversizedTtsChunk(text, maxChars, maxTokens) {
  const chunks = []
  let current = ''
  const pieces = String(text || '').match(/\S+\s*/g) || []
  for (const piece of pieces) {
    const candidate = `${current}${piece}`.trim()
    if (current && !fitsTtsChunk(candidate, maxChars, maxTokens)) {
      chunks.push(current.trim())
      current = piece.trim()
    } else {
      current = candidate
    }

    while (current && !fitsTtsChunk(current, maxChars, maxTokens)) {
      const hardLimit = Math.max(1, Math.min(maxChars, Math.floor(current.length * 0.8)))
      let sliceAt = current.lastIndexOf(' ', hardLimit)
      if (sliceAt < Math.floor(hardLimit * 0.6)) sliceAt = hardLimit
      chunks.push(current.slice(0, sliceAt).trim())
      current = current.slice(sliceAt).trim()
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(Boolean)
}

export function chunkTextForTts(text, maxChars = podcastTtsChunkChars, maxTokens = podcastTtsChunkTokens) {
  const sentences = String(text || '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+|\S+$/g) || []
  const chunks = []
  let current = ''
  for (const sentence of sentences) {
    const value = sentence.trim()
    if (!value) continue
    if (!fitsTtsChunk(value, maxChars, maxTokens)) {
      if (current) chunks.push(current)
      chunks.push(...splitOversizedTtsChunk(value, maxChars, maxTokens))
      current = ''
      continue
    }
    const candidate = current ? `${current} ${value}` : value
    if (current && !fitsTtsChunk(candidate, maxChars, maxTokens)) {
      chunks.push(current)
      current = value
    } else {
      current = candidate
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

export function mockPodcastPcm(scriptText) {
  const seconds = Math.max(6, Math.min(45, Math.round(wordCount(scriptText) / 2.4)))
  return silencePcm(seconds * 1000)
}
