import { useCallback, useEffect, useRef, useState } from 'react'
import { backendHttpUrl } from '../services/backendConfig'

export type SpeechStatus = 'ready' | 'loading' | 'speaking' | 'stopped' | 'error'

function prepareSpeechText(text: string): string {
  const cleanText = text.trim().replace(/\s+/g, ' ')
  if (!cleanText) return ''

  const sentenceText =
    cleanText === cleanText.toLocaleUpperCase()
      ? cleanText.toLocaleLowerCase().replace(/^[a-z]/, (letter) => letter.toLocaleUpperCase())
      : cleanText
  return /[.!?]["')\]]*$/.test(sentenceText) ? sentenceText : `${sentenceText}.`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected audio error occurred.'
}

export function useSpeech() {
  const [status, setStatus] = useState<SpeechStatus>('ready')
  const [error, setError] = useState('')
  const [needsUserPlay, setNeedsUserPlay] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    audioRef.current = null
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
  }, [])

  useEffect(
    () => () => {
      requestIdRef.current += 1
      controllerRef.current?.abort()
      releaseAudio()
    },
    [releaseAudio],
  )

  const play = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return false
    const requestId = requestIdRef.current
    try {
      await audio.play()
      if (requestId !== requestIdRef.current) return false
      setNeedsUserPlay(false)
      setError('')
      setStatus('speaking')
      return true
    } catch (playError) {
      if (requestId !== requestIdRef.current) return false
      if (playError instanceof DOMException && playError.name === 'NotAllowedError') {
        setNeedsUserPlay(true)
        setError('Your browser blocked automatic playback. Select Play audio to start it.')
        setStatus('ready')
        return false
      }
      setError(`Audio playback failed: ${errorMessage(playError)}`)
      setStatus('error')
      return false
    }
  }, [])

  const speak = useCallback(
    async (text: string) => {
      const preparedText = prepareSpeechText(text)
      if (!preparedText) {
        setError('Enter some text before requesting speech.')
        setStatus('error')
        return false
      }

      controllerRef.current?.abort()
      releaseAudio()
      const requestId = ++requestIdRef.current
      const controller = new AbortController()
      controllerRef.current = controller
      setNeedsUserPlay(false)
      setError('')
      setStatus('loading')

      try {
        const response = await fetch(backendHttpUrl('tts'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: preparedText }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const responseBody: unknown = await response.json().catch(() => null)
          const detail =
            responseBody &&
            typeof responseBody === 'object' &&
            'detail' in responseBody &&
            typeof responseBody.detail === 'string'
              ? responseBody.detail
              : `Gemini TTS request failed (${response.status}).`
          throw new Error(detail)
        }

        const audioBlob = await response.blob()
        if (!audioBlob.size || !audioBlob.type.includes('audio/wav')) {
          throw new Error('The TTS backend returned an invalid audio response.')
        }
        if (requestId !== requestIdRef.current) return false

        const objectUrl = URL.createObjectURL(audioBlob)
        objectUrlRef.current = objectUrl
        const audio = new Audio(objectUrl)
        audio.preload = 'auto'
        audio.onplay = () => {
          if (requestId === requestIdRef.current) {
            setNeedsUserPlay(false)
            setError('')
            setStatus('speaking')
          }
        }
        audio.onended = () => {
          if (requestId === requestIdRef.current) setStatus('ready')
        }
        audio.onerror = () => {
          if (requestId === requestIdRef.current) {
            setError('The generated audio could not be played.')
            setStatus('error')
          }
        }
        audioRef.current = audio
        await play()
        return true
      } catch (requestError) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return false
        setNeedsUserPlay(false)
        setError(`Speech request failed: ${errorMessage(requestError)}`)
        setStatus('error')
        return false
      }
    },
    [play, releaseAudio],
  )

  const stop = useCallback(() => {
    requestIdRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    releaseAudio()
    setNeedsUserPlay(false)
    setError('')
    setStatus('stopped')
  }, [releaseAudio])

  return { status, error, needsUserPlay, speak, play, stop }
}
