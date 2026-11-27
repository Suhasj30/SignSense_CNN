import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getCenterCropRect } from '../src/services/frameCrop.ts'

test('center-crops a landscape webcam frame to a square before resizing', () => {
  const crop = getCenterCropRect(1280, 720)

  assert.deepEqual(crop, {
    sx: 280,
    sy: 0,
    width: 720,
    height: 720,
  })
})
