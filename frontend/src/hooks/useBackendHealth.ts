import { useEffect, useState } from 'react'
import { backendHttpUrl } from '../services/backendConfig'

export interface BackendHealth {
  state: 'checking' | 'online' | 'offline'
  modelLoaded: boolean
  device: string
  error: string
}

const initialHealth: BackendHealth = {
  state: 'checking',
  modelLoaded: false,
  device: 'unknown',
  error: '',
}

export function useBackendHealth(): BackendHealth {
  const [health, setHealth] = useState(initialHealth)

  useEffect(() => {
    let active = true
    let interval: number | undefined
    let timeout: number | undefined
    let controller: AbortController | undefined

    const check = async () => {
      controller = new AbortController()
      timeout = window.setTimeout(() => controller?.abort(), 4000)

      try {
        const response = await fetch(backendHttpUrl('health'), {
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`Backend health check failed (HTTP ${response.status}).`)
        }

        const payload: unknown = await response.json()
        if (
          !payload ||
          typeof payload !== 'object' ||
          !('status' in payload) ||
          !('model_loaded' in payload) ||
          !('device' in payload) ||
          typeof payload.status !== 'string' ||
          typeof payload.model_loaded !== 'boolean' ||
          typeof payload.device !== 'string'
        ) {
          throw new Error('Backend returned an invalid health response.')
        }

        const modelLoaded = payload.status === 'ok' && payload.model_loaded
        if (active) {
          setHealth({
            state: modelLoaded ? 'online' : 'offline',
            modelLoaded,
            device: payload.device,
            error: modelLoaded ? '' : 'The CNN model is not loaded.',
          })
        }
      } catch (error) {
        if (active) {
          setHealth({
            state: 'offline',
            modelLoaded: false,
            device: 'unknown',
            error:
              error instanceof DOMException && error.name === 'AbortError'
                ? 'Backend health check timed out.'
                : error instanceof Error
                  ? error.message
                  : 'Could not reach the backend.',
          })
        }
      } finally {
        if (timeout !== undefined) window.clearTimeout(timeout)
        if (active) interval = window.setTimeout(() => void check(), 5000)
      }
    }

    void check()
    return () => {
      active = false
      if (interval !== undefined) window.clearTimeout(interval)
      if (timeout !== undefined) window.clearTimeout(timeout)
      controller?.abort()
    }
  }, [])

  return health
}
