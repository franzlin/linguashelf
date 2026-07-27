// Book upload middleware.
//
// Uploads land in a temporary directory first and are only moved into place
// after parsing succeeds, so a failed or oversized upload leaves nothing behind.
import fs from 'node:fs/promises'
import path from 'node:path'
import multer from 'multer'
import { nanoid } from 'nanoid'
import { formatMegabytes, maxUploadBytes, uploadTempDir } from './config.js'
import { consumeUserQuota } from './ratelimit.js'

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdir(uploadTempDir, { recursive: true }).then(() => callback(null, uploadTempDir), callback)
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname || '').toLowerCase().slice(0, 12)
      callback(null, `${Date.now()}-${nanoid()}${extension}`)
    },
  }),
  limits: { fileSize: maxUploadBytes, files: 1 },
})

export function uploadBookFile(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) {
      next()
      return
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `文件不能超过 ${formatMegabytes(maxUploadBytes)}` })
      return
    }
    next(error)
  })
}

export function limitBookUpload(req, res, next) {
  if (!consumeUserQuota(req, res, 'upload')) return
  next()
}
