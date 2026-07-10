export const cookieSessionToken = 'cookie-session'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function requestJson<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (token && token !== cookieSessionToken) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' })
  const text = await response.text()
  let payload: Record<string, unknown> = {}
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { error: text.slice(0, 240) }
    }
  }
  if (!response.ok) throw new ApiError(String(payload.error || '请求失败'), response.status)
  return payload as T
}

export function sessionFetch(path: string, token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers)
  if (token && token !== cookieSessionToken) headers.set('Authorization', `Bearer ${token}`)
  return fetch(path, { ...options, headers, credentials: 'same-origin' })
}
