import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import { createLogger } from '../lib/logger.js'

const log = createLogger('display')

// Screens where something is shown that must stay visible: music playing, the
// pause countdown, and the setup/login QR codes.
const ACTIVE_SCREENS = new Set(['playing', 'paused', 'setup', 'login'])

// 📋 BACKLIGHT - /sys/class/backlight/<device>/brightness (the HyperPixel is
// "backlight"): 0 turns it off, max_brightness turns it on. Without such a
// device (e.g. an HDMI display or development) only the kiosk's black
// overlay is used.
export function createBacklight({ dir = process.env.BACKLIGHT_PATH, root = '/sys/class/backlight' } = {}) {
  let device = dir
  if (!device) {
    try {
      const names = fs.readdirSync(root)
      const name = names.includes('backlight') ? 'backlight' : names[0]
      if (name) device = path.join(root, name)
    } catch {
      // no backlight devices
    }
  }
  if (!device) {
    log.info('No backlight device: the screen is only blanked by the kiosk')
    return { available: false, set: async () => {} }
  }

  let onValue = '1'
  try {
    onValue = fs.readFileSync(path.join(device, 'max_brightness'), 'utf8').trim() || '1'
  } catch {
    // keep 1
  }

  let failed = false
  return {
    available: true,
    async set(on) {
      try {
        await fs.promises.writeFile(path.join(device, 'brightness'), on ? onValue : '0')
        failed = false
      } catch (error) {
        // Log once, not on every change (e.g. not running as root)
        if (!failed) log.warn(`Can't change the backlight (${device}):`, error.message)
        failed = true
      }
    }
  }
}

// 📋 SCREEN SLEEP - Turns the screen off after some minutes with nothing
// playing, and back on when:
// - music starts (or the pause countdown / a setup QR code is shown)
// - the kiosk is tapped (the kiosk reports it with a "wake" event)
// - the settings are saved from the phone (so the result is visible)
// - the app starts or stops (the screen is never left off)
// Emits 'change' with { on }.
export class DisplayPower extends EventEmitter {
  // available: false when the display doesn't support it (no HyperPixel
  // Square): the screen then simply stays on.
  constructor({
    backlight,
    getSettings,
    available = true,
    setTimer = setTimeout,
    clearTimer = clearTimeout
  }) {
    super()
    this.available = available
    this.backlight = backlight
    this.getSettings = getSettings
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.screenOn = true
    this.screen = 'setup'
    this.timer = null
  }

  get isOn() {
    return this.screenOn
  }

  settings() {
    const { screenAlwaysOn = false, screenSleepMinutes = 5 } = this.getSettings() || {}
    const minutes = Number(screenSleepMinutes)
    return { alwaysOn: !!screenAlwaysOn, minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 5 }
  }

  async start() {
    await this.turn(true, 'start', { force: true })
    this.schedule()
  }

  // The app is stopping: never leave the screen off
  async stop() {
    this.cancel()
    await this.turn(true, 'stop', { force: true })
  }

  // Screen of the state machine changed
  update(screen) {
    this.screen = screen
    if (ACTIVE_SCREENS.has(screen)) {
      this.cancel()
      this.turn(true, `screen ${screen}`)
    } else {
      this.schedule()
    }
  }

  // A tap on the kiosk or a settings change: on, and the countdown restarts
  activity(reason = 'activity') {
    this.turn(true, reason)
    this.cancel()
    this.schedule()
  }

  settingsChanged() {
    this.activity('settings')
  }

  schedule() {
    if (!this.available) return
    if (ACTIVE_SCREENS.has(this.screen)) return
    const { alwaysOn, minutes } = this.settings()
    if (alwaysOn) {
      this.cancel()
      this.turn(true, 'always on')
      return
    }
    if (this.timer || !this.screenOn) return
    this.timer = this.setTimer(
      () => {
        this.timer = null
        if (!ACTIVE_SCREENS.has(this.screen) && !this.settings().alwaysOn) {
          this.turn(false, `nothing playing for ${minutes} min`)
        }
      },
      minutes * 60 * 1000
    )
  }

  cancel() {
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
  }

  async turn(on, reason, { force = false } = {}) {
    if (this.screenOn === on && !force) return
    this.screenOn = on
    log.info(`Screen ${on ? 'on' : 'off'} (${reason})`)
    this.emit('change', { on })
    await this.backlight.set(on)
  }
}
