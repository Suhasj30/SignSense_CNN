import { useCallback, useEffect, useRef, useState } from 'react'

export interface VoiceOption {
  voiceURI: string
  name: string
  lang: string
  isDefault: boolean
}

export type SpeechStatus = 'ready' | 'speaking' | 'paused' | 'stopped' | 'error' | 'unsupported'

export function useSpeech() {
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [status, setStatus] = useState<SpeechStatus>(() =>
    typeof window !== 'undefined' && 'speechSynthesis' in window ? 'ready' : 'unsupported',
  )
  const [error, setError] = useState('')
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window

  const refreshVoices = useCallback(() => {
    if (!speechAvailable) return
    setVoices(
      window.speechSynthesis
        .getVoices()
        .map((voice) => ({
          voiceURI: voice.voiceURI,
          name: voice.name,
          lang: voice.lang,
          isDefault: voice.default,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    )
  }, [speechAvailable])

  useEffect(() => {
    if (!speechAvailable) return
    refreshVoices()
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices)
      window.speechSynthesis.cancel()
    }
  }, [refreshVoices, speechAvailable])

  const speak = useCallback(
    (text: string, options: { voiceURI: string; rate: number; pitch: number }) => {
      const cleanText = text.trim()
      if (!speechAvailable) {
        setStatus('unsupported')
        setError('Text-to-speech is not supported by this browser.')
        return false
      }
      if (!cleanText) return false

      const synthesis = window.speechSynthesis
      synthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(cleanText)
      utterance.lang = 'en-US'
      utterance.rate = options.rate
      utterance.pitch = options.pitch
      const selectedVoice = voices.find((voice) => voice.voiceURI === options.voiceURI)
      if (selectedVoice) {
        const systemVoice = synthesis.getVoices().find((voice) => voice.voiceURI === selectedVoice.voiceURI)
        if (systemVoice) utterance.voice = systemVoice
        utterance.lang = selectedVoice.lang || 'en-US'
      }

      utterance.onstart = () => {
        if (utteranceRef.current === utterance) {
          setStatus('speaking')
          setError('')
        }
      }
      utterance.onpause = () => {
        if (utteranceRef.current === utterance) setStatus('paused')
      }
      utterance.onresume = () => {
        if (utteranceRef.current === utterance) setStatus('speaking')
      }
      utterance.onend = () => {
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null
          setStatus('ready')
        }
      }
      utterance.onerror = (event) => {
        if (utteranceRef.current !== utterance) return
        utteranceRef.current = null
        if (event.error === 'canceled' || event.error === 'interrupted') {
          setStatus('stopped')
          return
        }
        setStatus('error')
        setError(`Speech playback failed: ${event.error}.`)
      }

      utteranceRef.current = utterance
      setStatus('ready')
      synthesis.speak(utterance)
      return true
    },
    [speechAvailable, voices],
  )

  const stop = useCallback(() => {
    if (!speechAvailable) return
    window.speechSynthesis.cancel()
    utteranceRef.current = null
    setStatus('stopped')
    setError('')
  }, [speechAvailable])

  const pause = useCallback(() => {
    if (!speechAvailable || !window.speechSynthesis.speaking) return
    window.speechSynthesis.pause()
    setStatus('paused')
  }, [speechAvailable])

  const resume = useCallback(() => {
    if (!speechAvailable || !window.speechSynthesis.paused) return
    window.speechSynthesis.resume()
    setStatus('speaking')
  }, [speechAvailable])

  return { voices, status, error, speechAvailable, speak, stop, pause, resume }
}
