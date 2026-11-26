import { useCallback, useEffect, useRef, useState } from 'react'
import { closeCamera, getCameraErrorMessage, listCameras, openCamera } from '../services/cameraService'

export interface CameraDevice {
  deviceId: string
  label: string
}

export function useCamera(deviceId: string) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [devices, setDevices] = useState<CameraDevice[]>([])
  const [status, setStatus] = useState<'idle' | 'starting' | 'active' | 'error'>('idle')
  const [error, setError] = useState('')
  const streamRef = useRef<MediaStream | null>(null)
  const requestId = useRef(0)

  const refreshDevices = useCallback(async () => {
    const found = await listCameras()
    setDevices(
      found.map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      })),
    )
  }, [])

  const stop = useCallback(() => {
    requestId.current += 1
    closeCamera(streamRef.current)
    streamRef.current = null
    setStream(null)
    setStatus('idle')
    setError('')
  }, [])

  const start = useCallback(async () => {
    stop()
    const activeRequest = ++requestId.current
    setStatus('starting')
    setError('')
    try {
      const mediaStream = await openCamera({ deviceId })
      if (requestId.current !== activeRequest) {
        closeCamera(mediaStream)
        return
      }
      streamRef.current = mediaStream
      setStream(mediaStream)
      setStatus('active')
      await refreshDevices()
    } catch (cause) {
      if (requestId.current !== activeRequest) return
      setError(getCameraErrorMessage(cause))
      setStatus('error')
    }
  }, [deviceId, refreshDevices, stop])

  useEffect(() => {
    void refreshDevices()
    return () => {
      requestId.current += 1
      closeCamera(streamRef.current)
      streamRef.current = null
    }
  }, [refreshDevices])

  return { stream, devices, status, error, start, stop, refreshDevices }
}
