import { useState, type FormEvent } from 'react'
import {
  AudioLines,
  Check,
  Clipboard,
  Eraser,
  Play,
  Plus,
  RotateCcw,
  Square,
  Volume2,
} from 'lucide-react'
import type { SpeechStatus } from '../hooks/useSpeech'
import type { AppSettings } from '../types'

interface SentenceBuilderProps {
  sentence: string
  onSentenceChange: (value: string) => void
  settings: AppSettings
  speechStatus: SpeechStatus
  speechError: string
  needsUserPlay: boolean
  onSettingsChange: (settings: AppSettings) => void
  onSpeak: (text: string) => Promise<boolean>
  onPlay: () => Promise<boolean>
  onStop: () => void
}

export function SentenceBuilder({
  sentence,
  onSentenceChange,
  settings,
  speechStatus,
  speechError,
  needsUserPlay,
  onSettingsChange,
  onSpeak,
  onPlay,
  onStop,
}: SentenceBuilderProps) {
  const [word, setWord] = useState('')
  const [copied, setCopied] = useState(false)
  const hasText = sentence.trim().length > 0
  function addWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanWord = word.trim()
    if (!cleanWord) return
    const next = `${sentence.trimEnd()}${sentence.trim() ? ' ' : ''}${cleanWord}`
    onSentenceChange(next)
    setWord('')
    if (settings.autoSpeak && !/[.!?]["')\]]*\s*$/.test(next.trim())) void onSpeak(next)
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

  const speechLabels: Record<SpeechStatus, string> = {
    ready: 'Ready',
    loading: 'Generating audio',
    speaking: 'Speaking',
    stopped: 'Stopped',
    error: 'Speech error',
  }
  const speechLabel = speechLabels[speechStatus]

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
            disabled={!settings.speechEnabled}
            onChange={(event) => onSettingsChange({ ...settings, autoSpeak: event.target.checked })}
          />
          <i />
        </label>
      </div>

      <div className="speech-controls">
        <div className="speech-actions">
          <button
            className="button button-primary speak-button"
            disabled={!hasText || !settings.speechEnabled || speechStatus === 'loading'}
            onClick={() => void onSpeak(sentence)}
          >
            <Volume2 size={16} /> {speechStatus === 'loading' ? 'Generating…' : speechStatus === 'speaking' ? 'Speak again' : 'Speak sentence'}
          </button>
          {needsUserPlay && (
            <button className="button button-outline stop-button" onClick={() => void onPlay()}>
              <Play size={14} fill="currentColor" /> Play audio
            </button>
          )}
          <button
            className="button button-outline stop-button"
            disabled={!['loading', 'speaking'].includes(speechStatus) && !needsUserPlay}
            onClick={onStop}
          >
            <Square size={14} fill="currentColor" /> Stop
          </button>
          <button className="icon-button copy-button" disabled={!hasText} onClick={() => void copyText()} aria-label="Copy sentence" title="Copy sentence">
            {copied ? <Check size={16} /> : <Clipboard size={16} />}
          </button>
        </div>
      </div>
      {speechError && speechStatus === 'error' && <p className="inline-error">{speechError}</p>}
      {speechError && speechStatus !== 'error' && <p className="inline-warning">{speechError}</p>}
    </section>
  )
}
