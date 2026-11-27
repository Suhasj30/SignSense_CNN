export type View = 'dashboard' | 'history' | 'settings'

export type RecognitionStatus = 'idle' | 'detecting' | 'recognized' | 'no_sign' | 'error'

export interface Prediction {
  className: string
  confidence: number
  timestamp: number
  status: RecognitionStatus
  source: 'cnn'
  message?: string
}

export interface HistoryEntry {
  id: string
  text: string
  createdAt: number
}

export interface AppSettings {
  speechEnabled: boolean
  autoSpeak: boolean
  confidenceThreshold: number
  recognitionCooldownMs: number
  cameraDeviceId: string
}
