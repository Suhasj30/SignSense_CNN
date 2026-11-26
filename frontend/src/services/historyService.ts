import type { HistoryEntry } from '../types'

const STORAGE_KEY = 'signsense.history.v1'

export function loadHistory(): HistoryEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(value)) {
      console.error('Stored SignSense history is not a list; ignoring the malformed value.')
      return []
    }
    return value.filter(
      (entry): entry is HistoryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.id === 'string' &&
        typeof entry.text === 'string' &&
        typeof entry.createdAt === 'number',
    )
  } catch (error) {
    console.error('Could not read SignSense history from local storage.', error)
    return []
  }
}

function persist(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch (error) {
    console.error('Could not save SignSense translation history.', error)
  }
}

export function addHistoryEntry(text: string): HistoryEntry[] {
  const cleanText = text.trim()
  if (!cleanText) return loadHistory()
  const current = loadHistory()
  const latest = current[0]
  if (latest?.text === cleanText && Date.now() - latest.createdAt < 3000) return current
  const next = [{ id: crypto.randomUUID(), text: cleanText, createdAt: Date.now() }, ...current].slice(
    0,
    100,
  )
  persist(next)
  return next
}

export function deleteHistoryEntry(id: string): HistoryEntry[] {
  const next = loadHistory().filter((entry) => entry.id !== id)
  persist(next)
  return next
}

export function clearHistory(): void {
  persist([])
}
