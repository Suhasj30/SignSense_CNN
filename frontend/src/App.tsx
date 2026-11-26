import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, HandHeart } from 'lucide-react'
import { CameraPanel } from './components/CameraPanel'
import { DashboardHeader } from './components/DashboardHeader'
import { HistoryPage } from './components/HistoryPage'
import { PredictionCard } from './components/PredictionCard'
import { SentenceBuilder } from './components/SentenceBuilder'
import { SettingsPage } from './components/SettingsPage'
import { Sidebar } from './components/Sidebar'
import { useCamera } from './hooks/useCamera'
import { useSpeech } from './hooks/useSpeech'
import { addHistoryEntry, clearHistory, deleteHistoryEntry, loadHistory } from './services/historyService'
import {
  MockRecognitionService,
  PredictionProcessor,
  WebSocketRecognitionService,
} from './services/recognitionService'
import { loadSettings, saveSettings } from './services/settingsService'
import type { AppSettings, HistoryEntry, Prediction, View } from './types'

export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [sentence, setSentence] = useState('')
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [recentPredictions, setRecentPredictions] = useState<Prediction[]>([])
  const [recognitionRunning, setRecognitionRunning] = useState(false)
  const [recognitionMode, setRecognitionMode] = useState<'demo' | 'camera'>('demo')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const speech = useSpeech()
  const camera = useCamera(settings.cameraDeviceId)
  const processor = useRef(new PredictionProcessor())
  const cnnPredictionCount = useRef(0)

  useEffect(() => saveSettings(settings), [settings])

  const updateSettings = useCallback((next: AppSettings) => {
    if (!next.speechEnabled) speech.stop()
    setSettings(next)
  }, [speech.stop])

  const speakText = useCallback((text: string) => {
    if (!settings.speechEnabled) return
    const started = speech.speak(text, {
      voiceURI: settings.voiceURI,
      rate: settings.speechRate,
      pitch: settings.speechPitch,
    })
    if (started) setHistory(addHistoryEntry(text))
  }, [settings, speech])

  const updateSentence = useCallback((next: string) => {
    setSentence(next)
    if (speech.status === 'speaking' || speech.status === 'paused') speech.stop()
    if (settings.autoSpeak && /[.!?]["')\]]*\s*$/.test(next) && next.trim() !== sentence.trim()) {
      speakText(next)
    }
  }, [sentence, settings.autoSpeak, speech, speakText])

  const processPrediction = useCallback((nextPrediction: Prediction) => {
    if (nextPrediction.source === 'cnn' && nextPrediction.status === 'recognized') {
      cnnPredictionCount.current += 1
      if (cnnPredictionCount.current === 1 || cnnPredictionCount.current % 20 === 0) {
        console.info(
          `[SignSense CNN] React received prediction ${cnnPredictionCount.current}: ${nextPrediction.className} (${Math.round(nextPrediction.confidence * 100)}%)`,
        )
      }
    }
    setPrediction(nextPrediction)
    if (nextPrediction.status === 'recognized') {
      setRecentPredictions((current) => [nextPrediction, ...current].slice(0, 5))
      if (
        processor.current.shouldAppend(
          nextPrediction,
          settings.confidenceThreshold,
          settings.recognitionCooldownMs,
        )
      ) {
        setSentence((current) => `${current}${nextPrediction.className}`)
      }
    } else if (nextPrediction.status === 'no_sign' || nextPrediction.status === 'error') {
      processor.current.reset()
    }
  }, [settings.confidenceThreshold, settings.recognitionCooldownMs])

  useEffect(() => {
    if (!recognitionRunning) return
    if (recognitionMode === 'demo') {
      return new MockRecognitionService().start(processPrediction)
    }
    if (!camera.stream) {
      setRecognitionRunning(false)
      return
    }
    return new WebSocketRecognitionService().start(processPrediction, camera.stream)
  }, [camera.stream, recognitionMode, recognitionRunning, processPrediction])

  function handleManualPrediction(character: string) {
    const manualPrediction: Prediction = {
      className: character,
      confidence: 0.96,
      timestamp: Date.now(),
      status: 'recognized',
      source: 'mock',
    }
    setPrediction(manualPrediction)
    setRecentPredictions((current) => [manualPrediction, ...current].slice(0, 5))
    setSentence((current) => `${current}${character}`)
  }

  function handleReplay(text: string) {
    speakText(text)
  }

  function navigate(nextView: View) {
    if (nextView !== 'dashboard') {
      camera.stop()
      setRecognitionRunning(false)
    }
    setView(nextView)
    setMobileMenuOpen(false)
  }

  const activeTitle =
    view === 'dashboard' ? 'Dashboard' : view === 'history' ? 'Translation history' : 'Settings'

  return (
    <div className="app-shell">
      {mobileMenuOpen && <button className="mobile-backdrop" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation" />}
      <div className={`sidebar-wrap${mobileMenuOpen ? ' mobile-open' : ''}`}>
        <Sidebar
          activeView={view}
          onNavigate={navigate}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((current) => !current)}
        />
      </div>
      <main className="main-content">
        <DashboardHeader
          view={view}
          cameraActive={camera.status === 'active'}
          onMobileMenu={() => setMobileMenuOpen((current) => !current)}
          mobileMenuOpen={mobileMenuOpen}
        />

        {view === 'dashboard' && (
          <div className="dashboard-content">
            <div className="welcome-strip">
              <span className="welcome-icon"><HandHeart size={20} /></span>
              <p><strong>Let’s get started.</strong> Try demo predictions or start your camera and switch to real-time CNN recognition.</p>
              <span className="strip-label"><i /> 36-class CNN ready</span>
            </div>

            <div className="dashboard-grid">
              <div className="dashboard-column camera-column">
                <CameraPanel
                  stream={camera.stream}
                  status={camera.status}
                  error={camera.error}
                  devices={camera.devices}
                  selectedDeviceId={settings.cameraDeviceId}
                  onDeviceChange={(cameraDeviceId) => updateSettings({ ...settings, cameraDeviceId })}
                  onStart={() => void camera.start()}
                  onStop={camera.stop}
                />
                <SentenceBuilder
                  sentence={sentence}
                  onSentenceChange={updateSentence}
                  settings={settings}
                  voices={speech.voices}
                  speechStatus={speech.status}
                  speechError={speech.error}
                  speechAvailable={speech.speechAvailable}
                  onSettingsChange={updateSettings}
                  onSpeak={speakText}
                  onStop={speech.stop}
                  onPause={speech.pause}
                  onResume={speech.resume}
                />
              </div>
              <div className="dashboard-column recognition-column">
                <PredictionCard
                  prediction={prediction}
                  recent={recentPredictions}
                  recognitionRunning={recognitionRunning}
                  onToggleRecognition={() => setRecognitionRunning((running) => !running)}
                  recognitionMode={recognitionMode}
                  onRecognitionModeChange={(mode) => {
                    setRecognitionRunning(false)
                    setRecognitionMode(mode)
                    setPrediction(null)
                    processor.current.reset()
                  }}
                  cameraAvailable={camera.status === 'active' && camera.stream !== null}
                  onManualPrediction={handleManualPrediction}
                  confidenceThreshold={settings.confidenceThreshold}
                />
                <div className="integration-card">
                  <div className="integration-card-top">
                    <span className="integration-icon"><ArrowUpRight size={17} /></span>
                    <span className="integration-label">READY FOR WHAT’S NEXT</span>
                  </div>
                  <strong>Demo or live CNN recognition.</strong>
                  <p>Run the real-time backend locally to recognize camera frames with your trained model. Demo mode remains available.</p>
                  <button className="integration-link" onClick={() => navigate('settings')}>
                    Explore preferences <ArrowUpRight size={14} />
                  </button>
                </div>
              </div>
            </div>
            <footer className="page-footer">
              <span>SignSense <b>·</b> AI-Powered Sign Language Recognition</span>
              <span>Private by design</span>
            </footer>
          </div>
        )}

        {view === 'history' && (
          <div className="subpage-content">
            <HistoryPage
              entries={history}
              onDelete={(id) => setHistory(deleteHistoryEntry(id))}
              onClear={() => {
                clearHistory()
                setHistory([])
              }}
              onReplay={handleReplay}
            />
          </div>
        )}

        {view === 'settings' && (
          <div className="subpage-content">
            <SettingsPage
              settings={settings}
              voices={speech.voices}
              speechAvailable={speech.speechAvailable}
              onChange={updateSettings}
            />
            <footer className="page-footer settings-footer">
              <span>SignSense <b>·</b> {activeTitle}</span>
              <span>Preferences are saved in this browser</span>
            </footer>
          </div>
        )}
      </main>
      <div className="sr-only" aria-live="polite">
        {prediction?.status === 'recognized' ? `${prediction.source === 'mock' ? 'Demo' : 'CNN'} prediction ${prediction.className}, ${Math.round(prediction.confidence * 100)} percent confidence` : ''}
      </div>
    </div>
  )
}
