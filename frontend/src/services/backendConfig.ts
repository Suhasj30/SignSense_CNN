const configuredBackendUrl =
  import.meta.env.VITE_BACKEND_URL?.trim() || 'http://127.0.0.1:8000'
const backendBaseUrl = new URL(
  configuredBackendUrl.endsWith('/') ? configuredBackendUrl : `${configuredBackendUrl}/`,
)

if (backendBaseUrl.protocol !== 'http:' && backendBaseUrl.protocol !== 'https:') {
  throw new Error('VITE_BACKEND_URL must use http:// or https://.')
}

export function backendHttpUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ''), backendBaseUrl).toString()
}

export function backendWebSocketUrl(path: string): string {
  const url = new URL(backendHttpUrl(path))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
