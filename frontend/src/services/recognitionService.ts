import { backendWebSocketUrl } from './backendConfig'
import { getCenterCropRect } from './frameCrop'
import type { Prediction } from '../types'

export type PredictionListener = (prediction: Prediction) => void

export class WebSocketRecognitionService {
  start(
    onPrediction: PredictionListener,
    stream: MediaStream,
    intervalMs = 250,
  ): () => void {
    const backendUrl = backendWebSocketUrl('ws/predict')
    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const videoTrack = stream.getVideoTracks()[0]
    let active = true
    let pending = false
    let reconnectAttempts = 0
    let socket: WebSocket | null = null
    let interval: number | undefined
    let reconnectTimer: number | undefined
    let responseTimeout: number | undefined

    console.info(`[SignSense CNN] Connecting to ${backendUrl}`)
    canvas.width = 224
    canvas.height = 224
    video.muted = true
    video.playsInline = true
    video.srcObject = stream

    const clearResponseTimeout = () => {
      if (responseTimeout !== undefined) {
        window.clearTimeout(responseTimeout)
        responseTimeout = undefined
      }
    }

    const emitStatus = (status: 'detecting' | 'error', message: string) => {
      onPrediction({
        className: '',
        confidence: 0,
        timestamp: Date.now(),
        status,
        source: 'cnn',
        message,
      })
    }

    const reportFatalError = (message: string) => {
      if (!active) return
      active = false
      if (interval !== undefined) window.clearInterval(interval)
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      clearResponseTimeout()
      videoTrack?.removeEventListener('ended', onTrackEnded)
      video.pause()
      video.srcObject = null
      const currentSocket = socket
      socket = null
      if (
        currentSocket &&
        (currentSocket.readyState === WebSocket.OPEN ||
          currentSocket.readyState === WebSocket.CONNECTING)
      ) {
        currentSocket.close()
      }
      emitStatus('error', message)
      console.error(`[SignSense CNN] ${message}`)
    }

    const scheduleReconnect = (message: string) => {
      if (!active || reconnectTimer !== undefined) return
      pending = false
      clearResponseTimeout()
      const delay = Math.min(500 * 2 ** reconnectAttempts, 8000)
      reconnectAttempts += 1
      emitStatus('detecting', `${message} Retrying in ${(delay / 1000).toFixed(1)} seconds.`)
      console.warn(`[SignSense CNN] ${message}; retrying in ${delay} ms`)

      const currentSocket = socket
      socket = null
      if (
        currentSocket &&
        (currentSocket.readyState === WebSocket.OPEN ||
          currentSocket.readyState === WebSocket.CONNECTING)
      ) {
        currentSocket.close()
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined
        if (!active) return
        emitStatus('detecting', 'Reconnecting to the CNN backend.')
        connect()
      }, delay)
    }

    const captureFrame = () => {
      const currentSocket = socket
      if (
        !active ||
        pending ||
        !currentSocket ||
        currentSocket.readyState !== WebSocket.OPEN ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        return
      }
      if (!context) {
        reportFatalError('Could not prepare the camera frame for inference.')
        return
      }

      try {
        const crop = getCenterCropRect(video.videoWidth, video.videoHeight)
        context.drawImage(
          video,
          crop.sx,
          crop.sy,
          crop.width,
          crop.height,
          0,
          0,
          canvas.width,
          canvas.height,
        )
      } catch {
        reportFatalError('Could not capture a frame from the camera stream.')
        return
      }

      pending = true
      canvas.toBlob((blob) => {
        if (!active) return
        if (!blob) {
          pending = false
          reportFatalError('Could not encode a camera frame.')
          return
        }
        if (socket !== currentSocket || currentSocket.readyState !== WebSocket.OPEN) {
          pending = false
          return
        }
        try {
          currentSocket.send(blob)
          if (currentSocket.bufferedAmount > 4 * 1024 * 1024) {
            scheduleReconnect('The inference connection is congested.')
            return
          }
          responseTimeout = window.setTimeout(() => {
            pending = false
            scheduleReconnect('The inference backend did not respond in time.')
          }, 10_000)
        } catch {
          pending = false
          scheduleReconnect('Could not send a frame to the inference backend.')
        }
      }, 'image/jpeg', 0.65)
    }

    const connect = () => {
      if (!active) return
      let connection: WebSocket
      try {
        connection = new WebSocket(backendUrl)
      } catch {
        scheduleReconnect(`Could not connect to the inference backend at ${backendUrl}.`)
        return
      }
      socket = connection

      connection.addEventListener('open', () => {
        if (!active || socket !== connection) {
          connection.close()
          return
        }
        reconnectAttempts = 0
        emitStatus('detecting', 'Connected to the CNN backend. Waiting for a sign.')
        console.info('[SignSense CNN] WebSocket connected')
        void video.play().then(() => {
          if (active && interval === undefined) {
            interval = window.setInterval(captureFrame, intervalMs)
          }
        }).catch(() => {
          reportFatalError('Could not read frames from the camera stream.')
        })
      })

      connection.addEventListener('message', (event: MessageEvent<string>) => {
        if (!active || socket !== connection) return
        pending = false
        clearResponseTimeout()
        try {
          const result: unknown = JSON.parse(event.data)
          if (!result || typeof result !== 'object') throw new Error('Invalid response')
          const response = result as {
            class?: unknown
            confidence?: unknown
            error?: unknown
          }
          if (typeof response.error === 'string') {
            scheduleReconnect(response.error)
            return
          }
          if (
            typeof response.class !== 'string' ||
            !/^(?:[A-Z]|[0-9])$/.test(response.class) ||
            typeof response.confidence !== 'number' ||
            !Number.isFinite(response.confidence) ||
            response.confidence < 0 ||
            response.confidence > 1
          ) {
            throw new Error('Invalid prediction response')
          }
          onPrediction({
            className: response.class,
            confidence: response.confidence,
            timestamp: Date.now(),
            status: 'recognized',
            source: 'cnn',
          })
        } catch {
          scheduleReconnect('Received an invalid response from the inference backend.')
        }
      })

      connection.addEventListener('error', () => {
        scheduleReconnect(`Could not connect to the inference backend at ${backendUrl}.`)
      })
      connection.addEventListener('close', () => {
        scheduleReconnect('The inference backend connection closed.')
      })
    }

    const onTrackEnded = () => {
      reportFatalError('The camera stream ended. Restart the camera and recognition.')
    }
    videoTrack?.addEventListener('ended', onTrackEnded)
    if (!videoTrack) {
      reportFatalError('The camera stream has no video track.')
    } else {
      emitStatus('detecting', 'Connecting to the CNN backend.')
      connect()
    }

    return () => {
      active = false
      if (interval !== undefined) window.clearInterval(interval)
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      clearResponseTimeout()
      videoTrack?.removeEventListener('ended', onTrackEnded)
      video.pause()
      video.srcObject = null
      const currentSocket = socket
      socket = null
      if (
        currentSocket &&
        (currentSocket.readyState === WebSocket.OPEN ||
          currentSocket.readyState === WebSocket.CONNECTING)
      ) {
        currentSocket.close()
      }
    }
  }
}

export class PredictionProcessor {
  private activeClass = ''
  private lastAcceptedAt = 0

  shouldAppend(prediction: Prediction, confidenceThreshold: number, cooldownMs: number): boolean {
    if (prediction.status !== 'recognized') {
      this.activeClass = ''
      return false
    }
    if (prediction.confidence < confidenceThreshold) return false
    if (!prediction.className || prediction.className === this.activeClass) return false
    if (prediction.timestamp - this.lastAcceptedAt < cooldownMs) return false
    this.activeClass = prediction.className
    this.lastAcceptedAt = prediction.timestamp
    return true
  }

  reset(): void {
    this.activeClass = ''
    this.lastAcceptedAt = 0
  }
}
