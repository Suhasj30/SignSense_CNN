import type { Prediction } from '../types'

export type PredictionListener = (prediction: Prediction) => void

export interface RecognitionService {
  start(onPrediction: PredictionListener, intervalMs?: number): () => void
}

export class WebSocketRecognitionService {
  start(
    onPrediction: PredictionListener,
    stream: MediaStream,
    intervalMs = 250,
  ): () => void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const backendUrl = `${protocol}//${window.location.hostname}:8000/ws/predict`
    const socket = new WebSocket(backendUrl)
    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const videoTrack = stream.getVideoTracks()[0]
    let active = true
    let pending = false
    let reportedError = false
    let framesSent = 0
    let predictionsReceived = 0
    let interval: number | undefined
    let responseTimeout: number | undefined

    console.info(`[SignSense CNN] Connecting to ${backendUrl}`)
    canvas.width = 224
    canvas.height = 224
    video.muted = true
    video.playsInline = true
    video.srcObject = stream

    const reportError = (message: string) => {
      if (!active || reportedError) return
      reportedError = true
      onPrediction({
        className: '',
        confidence: 0,
        timestamp: Date.now(),
        status: 'error',
        source: 'cnn',
        message,
      })
      console.error(`[SignSense CNN] ${message}`)
      if (interval !== undefined) window.clearInterval(interval)
      if (responseTimeout !== undefined) window.clearTimeout(responseTimeout)
      pending = false
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
    }

    const stop = () => {
      active = false
      if (interval !== undefined) window.clearInterval(interval)
      if (responseTimeout !== undefined) window.clearTimeout(responseTimeout)
      videoTrack?.removeEventListener('ended', onTrackEnded)
      video.pause()
      video.srcObject = null
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
    }

    const onTrackEnded = () => reportError('The camera stream ended. Restart the camera and recognition.')
    videoTrack?.addEventListener('ended', onTrackEnded)

    socket.addEventListener('open', () => {
      console.info('[SignSense CNN] WebSocket connected; waiting for camera frames')
      void video.play().then(() => {
        if (!active) return
        interval = window.setInterval(() => {
          if (
            !active ||
            pending ||
            socket.readyState !== WebSocket.OPEN ||
            video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
            video.videoWidth === 0 ||
            video.videoHeight === 0
          ) {
            return
          }
          if (!context) {
            reportError('Could not prepare the camera frame for inference.')
            return
          }
          try {
            context.drawImage(video, 0, 0, canvas.width, canvas.height)
          } catch {
            reportError('Could not capture a frame from the camera stream.')
            return
          }
          pending = true
          canvas.toBlob((blob) => {
            if (!active) {
              pending = false
              return
            }
            if (!blob) {
              pending = false
              reportError('Could not encode a camera frame.')
              return
            }
            try {
              socket.send(blob)
              framesSent += 1
              if (framesSent === 1 || framesSent % 20 === 0) {
                console.info(
                  `[SignSense CNN] Sent JPEG frame ${framesSent} (${blob.size} bytes)`,
                )
              }
              responseTimeout = window.setTimeout(() => {
                pending = false
                reportError('The inference backend did not respond in time.')
                socket.close()
              }, 10_000)
            } catch {
              pending = false
              reportError('Could not send a frame to the inference backend.')
            }
          }, 'image/jpeg', 0.65)
        }, intervalMs)
      }).catch(() => {
        reportError('Could not read frames from the camera stream.')
      })
    })

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      pending = false
      if (responseTimeout !== undefined) window.clearTimeout(responseTimeout)
      try {
        const result: unknown = JSON.parse(event.data)
        if (!result || typeof result !== 'object') throw new Error('Invalid response')
        const response = result as { class?: unknown; confidence?: unknown; error?: unknown }
        if (typeof response.error === 'string') {
          reportError(response.error)
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
        reportedError = false
        predictionsReceived += 1
        if (predictionsReceived === 1 || predictionsReceived % 20 === 0) {
          console.info(
            `[SignSense CNN] Received prediction ${predictionsReceived}: ${response.class} (${Math.round(response.confidence * 100)}%)`,
          )
        }
        onPrediction({
          className: response.class,
          confidence: response.confidence,
          timestamp: Date.now(),
          status: 'recognized',
          source: 'cnn',
        })
      } catch {
        reportError('Received an invalid response from the inference backend.')
      }
    })

    socket.addEventListener('error', () => {
      reportError(`Could not connect to the inference backend at ${backendUrl}.`)
    })
    socket.addEventListener('close', () => {
      if (active) reportError('The inference backend connection closed.')
    })

    return stop
  }
}

export class MockRecognitionService implements RecognitionService {
  private readonly classes = ['H', 'E', 'L', 'O', 'W', 'R', 'D', 'A', 'S', 'I', 'N', 'G']
  private cursor = 0

  start(onPrediction: PredictionListener, intervalMs = 1800): () => void {
    const timer = window.setInterval(() => {
      if (this.cursor > 0 && this.cursor % 5 === 0) {
        onPrediction({
          className: '',
          confidence: 0,
          timestamp: Date.now(),
          status: 'no_sign',
          source: 'mock',
        })
        this.cursor += 1
        return
      }

      const className = this.classes[this.cursor % this.classes.length]
      this.cursor += 1
      onPrediction({
        className,
        confidence: 0.79 + Math.random() * 0.2,
        timestamp: Date.now(),
        status: 'recognized',
        source: 'mock',
      })
    }, intervalMs)
    return () => window.clearInterval(timer)
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
