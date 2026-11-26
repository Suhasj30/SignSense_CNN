import { useState, type FormEvent } from 'react'
import {
  AudioLines,
  Check,
  Clipboard,
  Eraser,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Volume2,
} from 'lucide-react'
import type { SpeechStatus, VoiceOption } from '../hooks/useSpeech'
import type { AppSettings } from '../types'

interface SentenceBuilderProps {
  sentence: string
  onSentenceChange: (value: string) => void
  settings: AppSettings
  voices: VoiceOption[]
  speechStatus: SpeechStatus
  speechError: string
  speechAvailable: boolean
  onSettingsChange: (settings: AppSettings) => void
  onSpeak: (text: string) => void
  onStop: () => void
  onPause: () => void
  onResume: () => void
}

export function SentenceBuilder({
  sentence,
  onSentenceChange,
  settings,
  voices,
  speechStatus,
  speechError,
  speechAvailable,
  onSettingsChange,
  onSpeak,
  onStop,
  onPause,
  onResume,
}: SentenceBuilderProps) {
  const [word, setWord] = useState('')
  const [copied, setCopied] = useState(false)
  const hasText = sentence.trim().length > 0
  const selectedVoice = voices.some((voice) => voice.voiceURI === settings.voiceURI)

  function addWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanWord = word.trim()
    if (!cleanWord) return
    const next = `${sentence.trimEnd()}${sentence.trim() ? ' ' : ''}${cleanWord}`
    onSentenceChange(next)
    setWord('')
    if (settings.autoSpeak) onSpeak(next)
  }

  function addSpace() {
    if (!sentence || sentence.endsWith(' ')) return
    onSentenceChange(`${sentence} `)
  }

  function deleteLastCharacter() {
    const codePoints = Array.from(sentence)
    codePoints.pop()
    onSentenceChange(codePoints.join(''))
  }

  async function copyText() {
    if (!hasText) return
    try {
      await navigator.clipboard.writeText(sentence)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      console.error('Could not copy the translated sentence.', error)
    }
  }

  const speechLabel =
    speechStatus === 'speaking'
      ? 'Speaking'
      : speechStatus === 'paused'
        ? 'Paused'
        : speechStatus === 'stopped'
          ? 'Stopped'
          : speechStatus === 'error'
            ? 'Speech error'
            : speechStatus === 'unsupported'
              ? 'Unavailable'
              : 'Ready'

  return (
    <section className="card sentence-card">
      <div className="card-heading">
        <div>
          <div className="card-title-row"><h2>Sentence builder</h2><span className="editable-tag">EDITABLE</span></div>
          <p>Bring recognized signs together into a phrase.</p>
        </div>
        <span className="heading-icon sentence-heading-icon"><AudioLines size={18} /></span>
      </div>

      <label className="sr-only" htmlFor="translated-sentence">Translated sentence</label>
      <textarea
        id="translated-sentence"
        className="sentence-input"
        value={sentence}
        onChange={(event) => onSentenceChange(event.target.value)}
        placeholder="Your signs will appear here. You can also type or edit your sentence…"
        rows={4}
        maxLength={1000}
      />
      <div className="sentence-toolbar">
        <div className="sentence-tools">
          <button className="text-button" onClick={addSpace} disabled={!sentence || sentence.endsWith(' ')}>
            <Plus size={14} /> Add space
          </button>
          <button className="text-button" onClick={deleteLastCharacter} disabled={!sentence}>
            <Eraser size={14} /> Delete last
          </button>
          <button className="text-button" onClick={() => onSentenceChange('')} disabled={!sentence}>
            <RotateCcw size={14} /> Clear
          </button>
        </div>
        <span className="character-count">{sentence.length}/1000</span>
      </div>

      <form className="add-word-form" onSubmit={addWord}>
        <input
          value={word}
          onChange={(event) => setWord(event.target.value)}
          placeholder="Type a complete word…"
          aria-label="Word to add"
          maxLength={80}
        />
        <button className="button button-outline" type="submit" disabled={!word.trim()}>
          <Plus size={15} /> Add word
        </button>
      </form>

      <div className="speech-divider" />
      <div className="speech-toolbar">
        <div className="speech-status">
          <span className={`speech-status-dot speech-${speechStatus}`} />
          <div><strong>Speech</strong><small>{speechError || speechLabel}</small></div>
        </div>
        <label className="auto-speak-control">
          <span>Auto-speak</span>
          <input
            type="checkbox"
            checked={settings.autoSpeak}
            disabled={!settings.speechEnabled || !speechAvailable}
            onChange={(event) => onSettingsChange({ ...settings, autoSpeak: event.target.checked })}
          />
          <i />
        </label>
      </div>

      <div className="speech-controls">
        <div className="speech-actions">
          <button
            className="button button-primary speak-button"
            disabled={!hasText || !settings.speechEnabled || !speechAvailable}
            onClick={() => onSpeak(sentence)}
          >
            <Volume2 size={16} /> {speechStatus === 'speaking' ? 'Speak again' : 'Speak sentence'}
          </button>
          {speechStatus === 'paused' ? (
            <button className="button button-outline stop-button" disabled={!settings.speechEnabled} onClick={onResume}>
              <Play size={14} fill="currentColor" /> Resume
            </button>
          ) : speechStatus === 'speaking' ? (
            <button className="button button-outline stop-button" disabled={!settings.speechEnabled} onClick={onPause}>
              <Pause size={14} fill="currentColor" /> Pause
            </button>
          ) : null}
          <button className="button button-outline stop-button" disabled={!settings.speechEnabled || !speechAvailable || !['speaking', 'paused'].includes(speechStatus)} onClick={onStop}>
            <Square size={14} fill="currentColor" /> Stop
          </button>
          <button className="icon-button copy-button" disabled={!hasText} onClick={() => void copyText()} aria-label="Copy sentence" title="Copy sentence">
            {copied ? <Check size={16} /> : <Clipboard size={16} />}
          </button>
        </div>
        <label className="voice-select">
          <span>Voice</span>
          <select
            value={selectedVoice ? settings.voiceURI : ''}
            disabled={!settings.speechEnabled || !speechAvailable}
            onChange={(event) => onSettingsChange({ ...settings, voiceURI: event.target.value })}
          >
            <option value="">Default English voice</option>
            {voices.map((voice) => (
              <option value={voice.voiceURI} key={voice.voiceURI}>
                {voice.name} ({voice.lang}){voice.isDefault ? ' · default' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="speech-adjustments">
        <label className="range-control">
          <span>Speed <strong>{settings.speechRate.toFixed(1)}×</strong></span>
          <input
            type="range"
            min="0.6"
            max="1.5"
            step="0.1"
            value={settings.speechRate}
            disabled={!settings.speechEnabled}
            onChange={(event) => onSettingsChange({ ...settings, speechRate: Number(event.target.value) })}
          />
        </label>
        <label className="range-control">
          <span>Pitch <strong>{settings.speechPitch.toFixed(1)}</strong></span>
          <input
            type="range"
            min="0.5"
            max="1.5"
            step="0.1"
            value={settings.speechPitch}
            disabled={!settings.speechEnabled}
            onChange={(event) => onSettingsChange({ ...settings, speechPitch: Number(event.target.value) })}
          />
        </label>
      </div>
      {!speechAvailable && <p className="inline-warning">This browser does not support speech synthesis. Try an up-to-date desktop browser.</p>}
      {speechError && speechStatus === 'error' && <p className="inline-error">{speechError}</p>}
    </section>
  )
}
