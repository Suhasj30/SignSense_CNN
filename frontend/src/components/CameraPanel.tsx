import { useEffect, useRef } from 'react'
import { Camera, CameraOff, CircleHelp, LoaderCircle, ShieldCheck, Video } from 'lucide-react'
import type { CameraDevice } from '../hooks/useCamera'

interface CameraPanelProps {
  stream: MediaStream | null
  status: 'idle' | 'starting' | 'active' | 'error'
  error: string
  devices: CameraDevice[]
  selectedDeviceId: string
  onDeviceChange: (deviceId: string) => void
  onStart: () => void
  onStop: () => void
}

export function CameraPanel({
  stream,
  status,
  error,
  devices,
  selectedDeviceId,
  onDeviceChange,
  onStart,
  onStop,
}: CameraPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    if (stream) void video.play().catch(() => undefined)
    return () => {
      video.srcObject = null
    }
  }, [stream])

  return (
    <section className="card camera-card">
      <div className="card-heading">
        <div>
          <div className="card-title-row">
            <h2>Live camera</h2>
            <span className={`live-badge${status === 'active' ? ' live' : ''}`}>
              <i /> {status === 'active' ? 'LIVE' : status === 'starting' ? 'CONNECTING' : 'OFFLINE'}
            </span>
          </div>
          <p>Position your hands in view to begin.</p>
        </div>
        <span className="heading-icon camera-heading-icon"><Video size={18} /></span>
      </div>

      <div className={`camera-viewport${status === 'active' ? ' camera-on' : ''}`}>
        <video ref={videoRef} className="camera-video" autoPlay muted playsInline aria-label="Live camera preview" />
        {status !== 'active' && (
          <div className="camera-placeholder">
            {status === 'starting' ? (
              <span className="camera-placeholder-icon loading-camera"><LoaderCircle size={26} /></span>
            ) : (
              <span className="camera-placeholder-icon"><Camera size={25} /></span>
            )}
            <strong>{status === 'starting' ? 'Starting your camera…' : 'Your camera preview will appear here'}</strong>
            <p>
              {status === 'error'
                ? error
                : 'Your video stays on this device. SignSense does not record or store it.'}
            </p>
            {status === 'error' && (
              <span className="permission-note"><CircleHelp size={13} /> Check browser camera permissions</span>
            )}
          </div>
        )}
        {status === 'active' && (
          <div className="camera-overlay">
            <span><i /> Camera preview</span>
            <span>Local only <ShieldCheck size={13} /></span>
          </div>
        )}
      </div>

      <div className="camera-footer">
        <div className="camera-select-wrap">
          <label htmlFor="camera-device">Camera</label>
          <select
            id="camera-device"
            value={selectedDeviceId}
            onChange={(event) => onDeviceChange(event.target.value)}
            disabled={status === 'active' || status === 'starting' || devices.length < 2}
            aria-label="Choose camera"
          >
            <option value="">Default camera</option>
            {devices.map((device, index) => (
              <option key={device.deviceId || index} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </div>
        {status === 'active' || status === 'starting' ? (
          <button className="button button-outline" onClick={onStop}>
            <CameraOff size={16} /> {status === 'starting' ? 'Cancel request' : 'Stop camera'}
          </button>
        ) : (
          <button className="button button-primary" onClick={onStart}>
            <Camera size={16} /> Start camera
          </button>
        )}
      </div>
    </section>
  )
}
