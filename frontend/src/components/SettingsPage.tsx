import { useState } from 'react'
import { Camera, Check, Mic2, RotateCcw, SlidersHorizontal, Volume2 } from 'lucide-react'
import type { VoiceOption } from '../hooks/useSpeech'
import type { AppSettings } from '../types'

interface SettingsPageProps {
  settings: AppSettings
  voices: VoiceOption[]
  speechAvailable: boolean
  onChange: (settings: AppSettings) => void
}

export function SettingsPage({ settings, voices, speechAvailable, onChange }: SettingsPageProps) {
  const [saved, setSaved] = useState(false)

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onChange({ ...settings, [key]: value })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1200)
  }

  return (
    <div className="settings-layout">
      <section className="card settings-card">
        <div className="settings-section-heading">
          <span className="settings-icon"><Volume2 size={18} /></span>
          <div><h2>Speech</h2><p>Choose how SignSense reads your translations.</p></div>
        </div>
        <div className="settings-row">
          <div><strong>Text-to-speech</strong><small>Use your browser’s built-in speech voices.</small></div>
          <label className="switch-control" aria-label="Enable text-to-speech">
            <input type="checkbox" checked={settings.speechEnabled} onChange={(event) => update('speechEnabled', event.target.checked)} />
            <i />
          </label>
        </div>
        <div className="settings-row">
          <div><strong>Auto-speak complete words</strong><small>Speak after adding a complete word or sentence, not each letter.</small></div>
          <label className="switch-control" aria-label="Enable auto-speak">
            <input
              type="checkbox"
              checked={settings.autoSpeak}
              disabled={!settings.speechEnabled || !speechAvailable}
              onChange={(event) => update('autoSpeak', event.target.checked)}
            />
            <i />
          </label>
        </div>
        <div className="settings-row settings-row-stack">
          <div><strong>English voice</strong><small>Available voices depend on your operating system and browser.</small></div>
          <select
            className="settings-select"
            value={settings.voiceURI}
            disabled={!settings.speechEnabled || !speechAvailable}
            onChange={(event) => update('voiceURI', event.target.value)}
          >
            <option value="">Default English voice</option>
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>
            ))}
          </select>
        </div>
        <div className="settings-ranges">
          <label className="range-control">
            <span>Speech speed <strong>{settings.speechRate.toFixed(1)}×</strong></span>
            <input type="range" min="0.6" max="1.5" step="0.1" value={settings.speechRate} disabled={!settings.speechEnabled} onChange={(event) => update('speechRate', Number(event.target.value))} />
          </label>
          <label className="range-control">
            <span>Voice pitch <strong>{settings.speechPitch.toFixed(1)}</strong></span>
            <input type="range" min="0.5" max="1.5" step="0.1" value={settings.speechPitch} disabled={!settings.speechEnabled} onChange={(event) => update('speechPitch', Number(event.target.value))} />
          </label>
        </div>
      </section>

      <section className="card settings-card">
        <div className="settings-section-heading">
          <span className="settings-icon teal-settings-icon"><SlidersHorizontal size={18} /></span>
          <div><h2>Recognition</h2><p>Adjust prediction filtering and text entry.</p></div>
        </div>
        <div className="settings-row settings-row-stack">
          <div><strong>Confidence threshold</strong><small>Ignore predictions below this confidence.</small></div>
          <label className="range-control wide-range">
            <span>Minimum confidence <strong>{Math.round(settings.confidenceThreshold * 100)}%</strong></span>
            <input type="range" min="0.5" max="0.95" step="0.01" value={settings.confidenceThreshold} onChange={(event) => update('confidenceThreshold', Number(event.target.value))} />
          </label>
        </div>
        <div className="settings-row settings-row-stack">
          <div><strong>Prediction cooldown</strong><small>Minimum gap between accepted signs. Consecutive duplicates are ignored until the sign changes.</small></div>
          <label className="range-control wide-range">
            <span>Cooldown <strong>{(settings.recognitionCooldownMs / 1000).toFixed(1)} sec</strong></span>
            <input type="range" min="500" max="3000" step="100" value={settings.recognitionCooldownMs} onChange={(event) => update('recognitionCooldownMs', Number(event.target.value))} />
          </label>
        </div>
        <div className="settings-info"><Mic2 size={16} /><span>Confidence and cooldown filters apply to both demo and live CNN predictions.</span></div>
      </section>

      <section className="card settings-card camera-preferences">
        <div className="settings-section-heading">
          <span className="settings-icon camera-settings-icon"><Camera size={18} /></span>
          <div><h2>Camera & privacy</h2><p>Camera access is requested only when you start the preview.</p></div>
        </div>
        <div className="settings-row">
          <div><strong>Video stays on this device</strong><small>SignSense does not record, upload, or store camera footage.</small></div>
          <span className="privacy-check"><Check size={16} /> Local only</span>
        </div>
      </section>
      <div className={`save-status${saved ? ' is-visible' : ''}`} role="status">
        <Check size={15} /> Preferences save automatically
        <button className="text-button" onClick={() => onChange({
          speechEnabled: true,
          autoSpeak: false,
          voiceURI: '',
          speechRate: 1,
          speechPitch: 1,
          confidenceThreshold: 0.72,
          recognitionCooldownMs: 1200,
          cameraDeviceId: '',
        })}>
          <RotateCcw size={13} /> Reset
        </button>
      </div>
      <span className="sr-only" aria-live="polite">{saved ? 'Preference saved' : ''}</span>
    </div>
  )
}
