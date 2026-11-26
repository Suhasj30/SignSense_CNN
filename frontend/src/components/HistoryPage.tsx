import { useState } from 'react'
import { Check, Copy, History, Play, Trash2, Volume2 } from 'lucide-react'
import type { HistoryEntry } from '../types'

interface HistoryPageProps {
  entries: HistoryEntry[]
  onDelete: (id: string) => void
  onClear: () => void
  onReplay: (text: string) => void
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

export function HistoryPage({ entries, onDelete, onClear, onReplay }: HistoryPageProps) {
  const [copiedId, setCopiedId] = useState('')

  async function copyEntry(entry: HistoryEntry) {
    try {
      await navigator.clipboard.writeText(entry.text)
      setCopiedId(entry.id)
      window.setTimeout(() => setCopiedId(''), 1500)
    } catch (error) {
      console.error('Could not copy history entry.', error)
    }
  }

  return (
    <section className="card history-card">
      <div className="card-heading history-page-heading">
        <div>
          <div className="card-title-row"><h2>Saved translations</h2><span className="count-pill">{entries.length}</span></div>
          <p>Translations sent to speech playback are saved in this browser.</p>
        </div>
        {entries.length > 0 && (
          <button
            className="button button-outline danger-outline"
            onClick={() => {
              if (window.confirm('Clear all saved translations from this browser?')) onClear()
            }}
          >
            <Trash2 size={15} /> Clear history
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon"><History size={25} /></span>
          <strong>No translations yet</strong>
          <p>When you speak a translation, it will be saved here for you.</p>
        </div>
      ) : (
        <div className="history-list">
          {entries.map((entry) => (
            <article className="history-entry" key={entry.id}>
              <span className="history-entry-icon"><Volume2 size={17} /></span>
              <div className="history-entry-copy">
                <p>{entry.text}</p>
                <time dateTime={new Date(entry.createdAt).toISOString()}>{formatDate(entry.createdAt)}</time>
              </div>
              <div className="history-entry-actions">
                <button className="icon-button" onClick={() => onReplay(entry.text)} aria-label={`Speak ${entry.text}`} title="Speak this translation">
                  <Play size={15} />
                </button>
                <button className="icon-button" onClick={() => void copyEntry(entry)} aria-label={`Copy ${entry.text}`} title="Copy translation">
                  {copiedId === entry.id ? <Check size={15} /> : <Copy size={15} />}
                </button>
                <button className="icon-button delete-icon" onClick={() => onDelete(entry.id)} aria-label={`Delete ${entry.text}`} title="Delete translation">
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="privacy-footnote">History is stored locally in this browser and is not sent to a server.</p>
    </section>
  )
}
