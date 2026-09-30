import { test, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DisplayPower, createBacklight } from '../src/app/DisplayPower.js'

let settings
let backlightStates
let display

const MINUTE = 60 * 1000

beforeEach(async () => {
  vi.useFakeTimers()
  settings = { screenAlwaysOn: false, screenSleepMinutes: 5 }
  backlightStates = []
  display = new DisplayPower({
    backlight: { set: async on => backlightStates.push(on) },
    getSettings: () => settings
  })
  await display.start()
})

afterEach(() => {
  vi.useRealTimers()
})

test('off after the configured minutes with nothing playing', () => {
  display.update('idle')
  vi.advanceTimersByTime(5 * MINUTE - 1000)
  assert.equal(display.isOn, true)
  vi.advanceTimersByTime(1000)
  assert.equal(display.isOn, false)
  assert.equal(backlightStates.at(-1), false)
})

test('music starting turns it back on and stops the countdown', () => {
  display.update('idle')
  vi.advanceTimersByTime(5 * MINUTE)
  assert.equal(display.isOn, false)

  display.update('playing')
  assert.equal(display.isOn, true)
  vi.advanceTimersByTime(60 * MINUTE)
  assert.equal(display.isOn, true)
})

test('a tap turns it on and restarts the countdown', () => {
  display.update('idle')
  vi.advanceTimersByTime(4 * MINUTE)
  display.activity('tap')
  vi.advanceTimersByTime(4 * MINUTE)
  assert.equal(display.isOn, true) // 8 minutes in total, but only 4 since the tap
  vi.advanceTimersByTime(1 * MINUTE)
  assert.equal(display.isOn, false)

  display.activity('tap')
  assert.equal(display.isOn, true)
})

test('never off while playing, paused (countdown) or showing a setup QR code', () => {
  for (const screen of ['playing', 'paused', 'setup', 'login']) {
    display.update(screen)
    vi.advanceTimersByTime(60 * MINUTE)
    assert.equal(display.isOn, true, screen)
  }
})

test('"always on" keeps it on, and applies right away when changed', () => {
  display.update('idle')
  vi.advanceTimersByTime(5 * MINUTE)
  assert.equal(display.isOn, false)

  settings = { screenAlwaysOn: true, screenSleepMinutes: 5 }
  display.settingsChanged()
  assert.equal(display.isOn, true)
  vi.advanceTimersByTime(60 * MINUTE)
  assert.equal(display.isOn, true)
})

test('the resume screen (paused track) also goes to sleep', () => {
  display.update('resume')
  vi.advanceTimersByTime(5 * MINUTE)
  assert.equal(display.isOn, false)
})

test('stop always leaves the screen on', async () => {
  display.update('idle')
  vi.advanceTimersByTime(5 * MINUTE)
  await display.stop()
  assert.equal(display.isOn, true)
  assert.equal(backlightStates.at(-1), true)
})

test('backlight: writes 0 and max_brightness to the sysfs files', async () => {
  vi.useRealTimers()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backlight-'))
  const device = path.join(root, 'backlight')
  fs.mkdirSync(device)
  fs.writeFileSync(path.join(device, 'max_brightness'), '1\n')
  fs.writeFileSync(path.join(device, 'brightness'), '1')

  const backlight = createBacklight({ root })
  assert.equal(backlight.available, true)
  await backlight.set(false)
  assert.equal(fs.readFileSync(path.join(device, 'brightness'), 'utf8'), '0')
  await backlight.set(true)
  assert.equal(fs.readFileSync(path.join(device, 'brightness'), 'utf8'), '1')

  assert.equal(createBacklight({ root: path.join(root, 'missing') }).available, false)
})

test('not available (no HyperPixel Square): the screen never turns off', async () => {
  const states = []
  const unavailable = new DisplayPower({
    available: false,
    backlight: { set: async on => states.push(on) },
    getSettings: () => ({ screenAlwaysOn: false, screenSleepMinutes: 1 })
  })
  await unavailable.start()
  unavailable.update('idle')
  vi.advanceTimersByTime(60 * MINUTE)
  assert.equal(unavailable.isOn, true)
  assert.ok(!states.includes(false))
})
