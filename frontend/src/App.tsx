import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, HandHeart } from 'lucide-react'
import { CameraPanel } from './components/CameraPanel'
import { DashboardHeader } from './components/DashboardHeader'
import { HistoryPage } from './components/HistoryPage'
import { PredictionCard } from './components/PredictionCard'
import { SentenceBuilder } from './components/SentenceBuilder'
import { SettingsPage } from './components/SettingsPage'
import { Sidebar } from './components/Sidebar'
import { useBackendHealth } from './hooks/useBackendHealth'
import { useCamera } from './hooks/useCamera'
import { useSpeech } from './hooks/useSpeech'
import { addHistoryEntry, clearHistory, deleteHistoryEntry, loadHistory } from './services/historyService'
import {
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const backendHealth = useBackendHealth()
  const speech = useSpeech()
  const camera = useCamera(settings.cameraDeviceId)
  const processor = useRef(new PredictionProcessor())
  const cnnPredictionCount = useRef(0)
  const lastAutoSpokenText = useRef('')

  useEffect(() => saveSettings(settings), [settings])

  const updateSettings = useCallback((next: AppSettings) => {
    if (!next.speechEnabled) speech.stop()
    setSettings(next)
  }, [speech.stop])

  const speakText = useCallback(async (text: string) => {
    if (!settings.speechEnabled) return false
    const generated = await speech.speak(text)
    if (generated) setHistory(addHistoryEntry(text))
    return generated
  }, [settings.speechEnabled, speech.speak])

  const updateSentence = useCallback((next: string) => {
    setSentence(next)
    if (speech.status === 'speaking' || speech.status === 'loading') speech.stop()
    const completedSentence = /[.!?]["')\]]*\s*$/.test(next.trim())
    const previousSentenceWasComplete = /[.!?]["')\]]*\s*$/.test(sentence.trim())
    if (
      settings.autoSpeak &&
      completedSentence &&
      !previousSentenceWasComplete &&
      next.trim() !== lastAutoSpokenText.current
    ) {
      lastAutoSpokenText.current = next.trim()
      void speakText(next)
    }
  }, [sentence, settings.autoSpeak, speech.status, speech.stop, speakText])

  const processPrediction = useCallback((nextPrediction: Prediction) => {
    if (nextPrediction.source === 'cnn' && nextPrediction.status === 'recognized') {
      cnnPredictionCount.current += 1
      if (cnnPredictionCount.current === 1 || cnnPredictionCount.current % 20 === 0) {
        console.info(
          `[SignSense CNN] React received prediction ${cnnPredictionCount.current}: ${nextPrediction.className} (${Math.round(nextPrediction.confidence * 100)}%)`,
        )
      }
    }
    if (nextPrediction.status === 'error') setRecognitionRunning(false)
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
    } else {
      processor.current.reset()
    }
  }, [settings.confidenceThreshold, settings.recognitionCooldownMs])

  useEffect(() => {
    if (!recognitionRunning) return
    if (!camera.stream) {
      setRecognitionRunning(false)
      return
    }
    return new WebSocketRecognitionService().start(processPrediction, camera.stream)
  }, [camera.stream, recognitionRunning, processPrediction])

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
          backendHealth={backendHealth}
          onMobileMenu={() => setMobileMenuOpen((current) => !current)}
          mobileMenuOpen={mobileMenuOpen}
        />

        {view === 'dashboard' && (
          <div className="dashboard-content">
            <div className="welcome-strip">
              <span className="welcome-icon"><HandHeart size={20} /></span>
              <p><strong>Let’s get started.</strong> Start your camera and recognition to see live predictions from the trained CNN.</p>
              <span className="strip-label">
                <i /> {backendHealth.state === 'online' ? '36-class CNN ready' : 'Waiting for CNN backend'}
              </span>
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
                  onStop={() => {
                    setRecognitionRunning(false)
                    camera.stop()
                  }}
                />
                <SentenceBuilder
                  sentence={sentence}
                  onSentenceChange={updateSentence}
                  settings={settings}
                  speechStatus={speech.status}
                  speechError={speech.error}
                  needsUserPlay={speech.needsUserPlay}
                  onSettingsChange={updateSettings}
                  onSpeak={speakText}
                  onPlay={speech.play}
                  onStop={speech.stop}
                />
              </div>
              <div className="dashboard-column recognition-column">
                <PredictionCard
                  prediction={prediction}
                  recent={recentPredictions}
                  recognitionRunning={recognitionRunning}
                  onToggleRecognition={() => setRecognitionRunning((running) => !running)}
                  cameraAvailable={camera.status === 'active' && camera.stream !== null}
                  confidenceThreshold={settings.confidenceThreshold}
                  backendReady={backendHealth.state === 'online' && backendHealth.modelLoaded}
                />
                <div className="integration-card">
                  <div className="integration-card-top">
                    <span className="integration-icon"><ArrowUpRight size={17} /></span>
                    <span className="integration-label">READY FOR WHAT’S NEXT</span>
                  </div>
                  <strong>Live sign recognition.</strong>
                  <p>Camera frames run through the loaded checkpoint on the local backend only while recognition is active.</p>
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
        {prediction?.status === 'recognized' ? `CNN prediction ${prediction.className}, ${Math.round(prediction.confidence * 100)} percent confidence` : ''}
      </div>
    </div>
  )
}
