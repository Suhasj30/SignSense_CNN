import { useState } from 'react'
import { Activity, Check, ChevronDown, CircleDot, FlaskConical, Plus, Radio, Sparkles } from 'lucide-react'
import type { Prediction } from '../types'

const testCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')

interface PredictionCardProps {
  prediction: Prediction | null
  recent: Prediction[]
  recognitionRunning: boolean
  onToggleRecognition: () => void
  recognitionMode: 'demo' | 'camera'
  onRecognitionModeChange: (mode: 'demo' | 'camera') => void
  cameraAvailable: boolean
  onManualPrediction: (character: string) => void
  confidenceThreshold: number
}

export function PredictionCard({
  prediction,
  recent,
  recognitionRunning,
  onToggleRecognition,
  recognitionMode,
  onRecognitionModeChange,
  cameraAvailable,
  onManualPrediction,
  confidenceThreshold,
}: PredictionCardProps) {
  const [selectedCharacter, setSelectedCharacter] = useState('A')
  const visiblePrediction =
    prediction?.source === (recognitionMode === 'demo' ? 'mock' : 'cnn') ? prediction : null
  const visibleRecent = recent.filter(
    (item) => item.source === (recognitionMode === 'demo' ? 'mock' : 'cnn'),
  )
  const hasPrediction = visiblePrediction?.status === 'recognized'
  const isRecognized =
    hasPrediction &&
    visiblePrediction.confidence >= confidenceThreshold
  const confidence = visiblePrediction?.confidence ?? 0

  return (
    <section className="card prediction-card">
      <div className="card-heading prediction-heading">
        <div>
          <div className="card-title-row">
            <h2>Recognition</h2>
            <span className="mock-tag"><FlaskConical size={12} /> {recognitionMode === 'demo' ? 'DEMO' : 'CNN'}</span>
          </div>
          <p>{recognitionMode === 'demo' ? 'Simulated predictions · camera is not processed' : 'Real-time predictions from the local CNN'}</p>
        </div>
        <button
          className={`recognition-toggle${recognitionRunning ? ' is-running' : ''}`}
          onClick={onToggleRecognition}
          disabled={recognitionMode === 'camera' && !cameraAvailable && !recognitionRunning}
          aria-pressed={recognitionRunning}
        >
          <Radio size={15} />
          {recognitionRunning
            ? recognitionMode === 'demo' ? 'Pause demo' : 'Stop recognition'
            : recognitionMode === 'demo' ? 'Run demo' : 'Start recognition'}
        </button>
      </div>

      <div className={`prediction-display${isRecognized ? ' has-prediction' : ''}`}>
        <div className="prediction-orbit"><span>{hasPrediction ? visiblePrediction.className : '—'}</span></div>
        <div className="prediction-meta">
          <span className={`recognition-state${recognitionRunning && visiblePrediction?.status !== 'error' ? ' state-active' : ''}`}>
            <i /> {visiblePrediction?.status === 'error'
              ? 'Connection error'
              : recognitionRunning
                ? (isRecognized ? 'Sign detected' : hasPrediction ? 'Low-confidence candidate' : 'Listening for a sign')
                : 'Recognition paused'}
          </span>
          {hasPrediction && (
            <span className="confidence-line">
              <strong>{Math.round(confidence * 100)}%</strong> confidence
              {!isRecognized && ` · below ${Math.round(confidenceThreshold * 100)}% minimum`}
            </span>
          )}
          {visiblePrediction?.status === 'error' && (
            <span className="confidence-line">{visiblePrediction.message}</span>
          )}
          {!hasPrediction && visiblePrediction?.status !== 'error' && (
            <span className="confidence-line">
              {recognitionRunning ? 'Waiting for next prediction' : 'Start recognition to see a prediction'}
            </span>
          )}
        </div>
        {isRecognized && <Sparkles className="prediction-sparkle" size={18} />}
      </div>

      <div className="confidence-meter" role="progressbar" aria-label="Prediction confidence" aria-valuenow={Math.round(confidence * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${confidence * 100}%` }} />
      </div>

      <div className="recent-row">
        <div className="recent-label"><Activity size={14} /> Recent signs</div>
        <div className="recent-list">
          {visibleRecent.length ? (
            visibleRecent.slice(0, 5).map((item, index) => (
              <span key={`${item.timestamp}-${index}`} className={`recent-character${index === 0 ? ' recent-current' : ''}`}>
                {item.className}
              </span>
            ))
          ) : (
            <span className="recent-empty">Nothing yet</span>
          )}
        </div>
      </div>

      <div className="mock-controls">
        <div className="recognition-mode-row">
          <label htmlFor="recognition-mode">Recognition mode</label>
          <select
            id="recognition-mode"
            className="recognition-mode-select"
            value={recognitionMode}
            onChange={(event) =>
              onRecognitionModeChange(event.target.value === 'camera' ? 'camera' : 'demo')
            }
          >
            <option value="demo">Demo mode</option>
            <option value="camera">Real camera</option>
          </select>
        </div>
        {recognitionMode === 'demo' ? (
          <>
            <div className="mock-controls-label">
              <span><CircleDot size={13} /> Try a character</span>
              <span>Development controls</span>
            </div>
            <div className="mock-control-row">
              <label className="select-shell">
                <span className="sr-only">Select a simulated character</span>
                <select value={selectedCharacter} onChange={(event) => setSelectedCharacter(event.target.value)}>
                  {testCharacters.map((character) => <option key={character}>{character}</option>)}
                </select>
                <ChevronDown size={14} />
              </label>
              <button className="button button-soft" onClick={() => onManualPrediction(selectedCharacter)}>
                <Plus size={15} /> Add sign
              </button>
              {visiblePrediction?.source === 'mock' && visiblePrediction.status === 'recognized' && (
                <span className="mock-success"><Check size={13} /> Simulated</span>
              )}
            </div>
          </>
        ) : (
          <p className="recognition-mode-help">
            {cameraAvailable
              ? 'Camera frames are sent to the local backend for inference.'
              : 'Start the camera above before running real-time recognition.'}
          </p>
        )}
      </div>
    </section>
  )
}
