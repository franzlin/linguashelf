import { useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import { Check, FileText, Loader2, Trash2, Upload, X } from 'lucide-react'
import { requestJson } from '../lib/api'
import { formatNumber } from '../lib/format'
import type { Book, GenerationJob } from '../types/domain'

type LibraryPageProps = {
  books: Book[]
  token: string
  onUploaded: (book: Book) => void
  onOpenBook: (book: Book) => void
  onDeleteBook: (book: Book) => Promise<boolean>
  onError: (message: string) => void
}

export function LibraryPage({ books, token, onUploaded, onOpenBook, onDeleteBook, onError }: LibraryPageProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [deletingBookId, setDeletingBookId] = useState('')
  const [uploadNotice, setUploadNotice] = useState('')

  async function uploadFile(file: File) {
    const lowerName = file.name.toLowerCase()
    if (!lowerName.endsWith('.epub') && !lowerName.endsWith('.pdf')) {
      onError('请选择 EPUB 或 PDF 文件')
      return
    }
    if (uploading) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const result = await requestJson<{ book: Book; job?: GenerationJob }>('/api/books/upload', token, {
        method: 'POST',
        body: form,
      })
      setUploadNotice(
        result.book.status === 'processing'
          ? `《${result.book.title}》已上传，扫描 PDF 正在后台 OCR。可以离开本页，进度会保存在任务中心。`
          : `《${result.book.title}》已导入。`,
      )
      onUploaded(result.book)
    } catch (err) {
      onError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDragActive(false)
    const files = Array.from(event.dataTransfer.files || [])
    const file = files.find((item) => {
      const name = item.name.toLowerCase()
      return name.endsWith('.epub') || name.endsWith('.pdf')
    })
    if (!file) {
      onError('请拖入 EPUB 或 PDF 文件')
      return
    }
    uploadFile(file)
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = uploading ? 'none' : 'copy'
    if (!uploading) setDragActive(true)
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget as Node | null
    if (nextTarget && event.currentTarget.contains(nextTarget)) return
    setDragActive(false)
  }

  function handleUploadKey(event: KeyboardEvent<HTMLElement>) {
    if (uploading) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    inputRef.current?.click()
  }

  async function deleteFromLibrary(book: Book) {
    setDeletingBookId(book.id)
    try {
      await onDeleteBook(book)
    } finally {
      setDeletingBookId('')
    }
  }

  return (
    <section className="page-section">
      <div className="section-head">
        <div>
          <h1>我的书库</h1>
          <p>{books.length ? `${books.length} 本书正在学习` : '上传一本书开始训练'}</p>
        </div>
        <div className="upload-actions">
          <button className="primary-button" type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
            上传 EPUB/PDF
          </button>
          <span>PDF 支持文字抽取，扫描版会自动 OCR</span>
        </div>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".epub,.pdf,application/epub+zip,application/pdf"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) uploadFile(file)
          }}
        />
      </div>

      {uploadNotice && (
        <div className="notice success">
          <Check size={18} />
          <span>{uploadNotice}</span>
          <button className="icon-button" type="button" onClick={() => setUploadNotice('')} aria-label="关闭"><X size={16} /></button>
        </div>
      )}

      <section
        className={`upload-dropzone${dragActive ? ' active' : ''}${uploading ? ' busy' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="上传 EPUB 或 PDF"
        onClick={() => { if (!uploading) inputRef.current?.click() }}
        onKeyDown={handleUploadKey}
        onDrop={handleDrop}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div className="upload-drop-icon">{uploading ? <Loader2 className="spin" size={24} /> : <Upload size={24} />}</div>
        <div>
          <h2>{uploading ? '正在上传解析' : '拖放 EPUB/PDF 到这里'}</h2>
          <p>也可以点击此区域选择文件。</p>
        </div>
      </section>

      {books.length === 0 ? (
        <div className="empty-state">
          <FileText size={32} />
          <h2>还没有书</h2>
          <p>支持 EPUB、文字版 PDF 和清晰的英文扫描版 PDF。</p>
        </div>
      ) : (
        <div className="book-grid">
          {books.map((book) => {
            const progress = book.totalUnits ? book.completedUnits / book.totalUnits : 0
            return (
              <article key={book.id} className="book-card">
                <div className="book-card-status">
                  <div className="book-type">{book.type.toUpperCase()}</div>
                  {book.status === 'processing' && <span className="status-pill running">OCR 处理中</span>}
                  {book.status === 'failed' && <span className="status-pill failed">解析失败</span>}
                </div>
                <h2>{book.title}</h2>
                <p>{book.author || book.filename}</p>
                {book.status === 'processing' && <p className="book-processing-note">后台识别中，可在任务中心查看页数进度。</p>}
                {book.status === 'failed' && book.error && <p className="book-error-note">{book.error}</p>}
                <div className="book-meta">
                  <span>{formatNumber(book.wordCount)} 词</span>
                  <span>{book.totalUnits} 个单元</span>
                </div>
                <div className="progress-line" aria-label="学习进度"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                <div className="book-actions">
                  <span>{book.completedUnits}/{book.totalUnits} 完成</span>
                  <div className="book-action-buttons">
                    <button type="button" onClick={() => onOpenBook(book)} disabled={book.status !== undefined && book.status !== 'ready'}>
                      {book.status === 'processing' ? '解析中' : book.status === 'failed' ? '待重试' : '打开'}
                    </button>
                    <button className="danger-button" type="button" onClick={() => deleteFromLibrary(book)} disabled={deletingBookId === book.id}>
                      {deletingBookId === book.id ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                      删除
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
