export interface CameraOptions {
  deviceId?: string
}

export async function openCamera({ deviceId }: CameraOptions = {}): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    if (!window.isSecureContext) {
      throw new Error('Camera access requires a secure page. Open SignSense at http://localhost:5173 or use HTTPS.')
    }
    throw new Error('Camera access is not supported by this browser. Try a current version of Chrome, Firefox, or Edge.')
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      facingMode: deviceId ? undefined : 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  })
}

export function getCameraErrorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return 'Unable to start the camera. Try again.'

  switch (cause.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied or blocked. Allow camera access for this site in your browser settings, then try again.'
    case 'NotFoundError':
      return 'No camera was found. Connect a camera or choose another device.'
    case 'NotReadableError':
      return 'The camera could not be opened. Close other apps or tabs using it, then try again.'
    case 'OverconstrainedError':
      return 'The selected camera could not meet the requested video settings. Choose another camera or Default camera.'
    case 'AbortError':
      return 'The camera could not start. Try again.'
    default:
      return cause.message || 'Unable to start the camera. Try again.'
  }
}

export function closeCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  return (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === 'videoinput',
  )
}
