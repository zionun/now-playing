import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { detectHyperPixelSquare } from '../src/app/displayDetect.js'

// A fake /sys with the given DRM outputs and backlight devices
function fakeSys({ outputs = {}, backlights = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sys-'))
  const drmRoot = path.join(root, 'drm')
  const backlightRoot = path.join(root, 'backlight')
  fs.mkdirSync(drmRoot)
  fs.mkdirSync(backlightRoot)
  for (const [name, { status, modes }] of Object.entries(outputs)) {
    fs.mkdirSync(path.join(drmRoot, name))
    fs.writeFileSync(path.join(drmRoot, name, 'status'), `${status}\n`)
    fs.writeFileSync(path.join(drmRoot, name, 'modes'), `${modes.join('\n')}\n`)
  }
  for (const name of backlights) fs.mkdirSync(path.join(backlightRoot, name))
  return { drmRoot, backlightRoot, env: {} }
}

test('HyperPixel 4.0 Square: DPI output at 720x720 and a backlight device', () => {
  const sys = fakeSys({
    outputs: { 'card1-DPI-1': { status: 'connected', modes: ['720x720'] } },
    backlights: ['backlight']
  })
  assert.equal(detectHyperPixelSquare(sys).present, true)
})

test('HDMI display only: not detected', () => {
  const sys = fakeSys({ outputs: { 'card1-HDMI-A-1': { status: 'connected', modes: ['1920x1080'] } } })
  const result = detectHyperPixelSquare(sys)
  assert.equal(result.present, false)
  assert.match(result.reason, /no DPI output/)
})

test('other DPI display (e.g. HyperPixel 4.0 rectangular): not detected', () => {
  const sys = fakeSys({
    outputs: { 'card1-DPI-1': { status: 'connected', modes: ['480x800'] } },
    backlights: ['backlight']
  })
  assert.equal(detectHyperPixelSquare(sys).present, false)
})

test('720x720 without the backlight device: not detected', () => {
  const sys = fakeSys({ outputs: { 'card1-DPI-1': { status: 'connected', modes: ['720x720'] } } })
  assert.equal(detectHyperPixelSquare(sys).present, false)
})

test('HYPERPIXEL forces the result', () => {
  const sys = fakeSys({})
  assert.equal(detectHyperPixelSquare({ ...sys, env: { HYPERPIXEL: '1' } }).present, true)
  const square = fakeSys({
    outputs: { 'card1-DPI-1': { status: 'connected', modes: ['720x720'] } },
    backlights: ['backlight']
  })
  assert.equal(detectHyperPixelSquare({ ...square, env: { HYPERPIXEL: '0' } }).present, false)
})
