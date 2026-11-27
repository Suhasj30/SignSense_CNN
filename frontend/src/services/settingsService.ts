import type { AppSettings } from '../types'

const STORAGE_KEY = 'signsense.settings.v1'

export const defaultSettings: AppSettings = {
  speechEnabled: true,
  autoSpeak: false,
  confidenceThreshold: 0.72,
  recognitionCooldownMs: 1200,
  cameraDeviceId: '',
}

export function loadSettings(): AppSettings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return defaultSettings
    const stored = value as Partial<AppSettings>
    return {
      speechEnabled:
        typeof stored.speechEnabled === 'boolean'
          ? stored.speechEnabled
          : defaultSettings.speechEnabled,
      autoSpeak:
        typeof stored.autoSpeak === 'boolean' ? stored.autoSpeak : defaultSettings.autoSpeak,
      confidenceThreshold:
        typeof stored.confidenceThreshold === 'number' &&
        stored.confidenceThreshold >= 0.5 &&
        stored.confidenceThreshold <= 0.95
          ? stored.confidenceThreshold
          : defaultSettings.confidenceThreshold,
      recognitionCooldownMs:
        typeof stored.recognitionCooldownMs === 'number' &&
        stored.recognitionCooldownMs >= 500 &&
        stored.recognitionCooldownMs <= 3000
          ? stored.recognitionCooldownMs
          : defaultSettings.recognitionCooldownMs,
      cameraDeviceId:
        typeof stored.cameraDeviceId === 'string'
          ? stored.cameraDeviceId
          : defaultSettings.cameraDeviceId,
    }
  } catch (error) {
    console.error('Could not read SignSense settings from local storage; using defaults.', error)
    return defaultSettings
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (error) {
    console.error('Could not save SignSense settings to local storage.', error)
  }
}
