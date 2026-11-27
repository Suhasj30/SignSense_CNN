import { Activity, Cpu, Radio, Sparkles } from 'lucide-react'
import type { Prediction } from '../types'

interface PredictionCardProps {
  prediction: Prediction | null
  recent: Prediction[]
  recognitionRunning: boolean
  onToggleRecognition: () => void
  cameraAvailable: boolean
  confidenceThreshold: number
  backendReady: boolean
}

export function PredictionCard({
  prediction,
  recent,
  recognitionRunning,
  onToggleRecognition,
  cameraAvailable,
  confidenceThreshold,
  backendReady,
}: PredictionCardProps) {
  const visiblePrediction = prediction
  const hasPrediction = visiblePrediction?.status === 'recognized'
  const isRecognized = hasPrediction && visiblePrediction.confidence >= confidenceThreshold
  const confidence = visiblePrediction?.confidence ?? 0
  const recognitionLabel =
    visiblePrediction?.status === 'error'
      ? 'Connection error'
      : visiblePrediction?.status === 'detecting'
        ? visiblePrediction.message ?? 'Connecting to the CNN backend'
        : recognitionRunning
          ? isRecognized
            ? 'Sign detected'
            : hasPrediction
              ? 'Low-confidence candidate'
              : 'Listening for a sign'
          : 'Recognition paused'

  return (
    <section className="card prediction-card">
      <div className="card-heading prediction-heading">
        <div>
          <div className="card-title-row">
            <h2>Recognition</h2>
            <span className="cnn-tag"><Cpu size={12} /> LIVE CNN</span>
          </div>
          <p>Real-time predictions from the trained local model</p>
        </div>
        <button
          className={`recognition-toggle${recognitionRunning ? ' is-running' : ''}`}
          onClick={onToggleRecognition}
          disabled={!cameraAvailable && !recognitionRunning}
          aria-pressed={recognitionRunning}
        >
          <Radio size={15} />
          {recognitionRunning ? 'Stop recognition' : 'Start recognition'}
        </button>
      </div>

      <div className={`prediction-display${isRecognized ? ' has-prediction' : ''}`}>
        <div className="prediction-orbit"><span>{hasPrediction ? visiblePrediction.className : '—'}</span></div>
        <div className="prediction-meta">
          <span className={`recognition-state${recognitionRunning && visiblePrediction?.status !== 'error' ? ' state-active' : ''}`}>
            <i /> {recognitionLabel}
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
          {!hasPrediction && visiblePrediction?.status === 'detecting' && (
            <span className="confidence-line">{visiblePrediction.message}</span>
          )}
          {!hasPrediction &&
            visiblePrediction?.status !== 'error' &&
            visiblePrediction?.status !== 'detecting' && (
              <span className="confidence-line">
                {recognitionRunning ? 'Waiting for next prediction' : 'Start the camera and recognition to begin'}
              </span>
            )}
        </div>
        {isRecognized && <Sparkles className="prediction-sparkle" size={18} />}
      </div>

      <div
        className="confidence-meter"
        role="progressbar"
        aria-label="Prediction confidence"
        aria-valuenow={Math.round(confidence * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${confidence * 100}%` }} />
      </div>

      <div className="recent-row">
        <div className="recent-label"><Activity size={14} /> Recent signs</div>
        <div className="recent-list">
          {recent.length ? (
            recent.slice(0, 5).map((item, index) => (
              <span
                key={`${item.timestamp}-${index}`}
                className={`recent-character${index === 0 ? ' recent-current' : ''}`}
              >
                {item.className}
              </span>
            ))
          ) : (
            <span className="recent-empty">Nothing yet</span>
          )}
        </div>
      </div>

      <div className="recognition-mode-help" role="status">
        {!cameraAvailable
          ? 'Start the camera above before running real-time recognition.'
          : backendReady
            ? 'Camera frames are sent to the local CNN backend only while recognition is running.'
            : 'Waiting for the backend and trained model to become available.'}
      </div>
    </section>
  )
}
