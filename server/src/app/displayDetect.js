import fs from 'fs'
import path from 'path'

const read = file => {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

const list = dir => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

// 📋 HYPERPIXEL 4.0 SQUARE DETECTION - Screen sleep is only available on it.
// Its driver (dtoverlay=vc4-kms-dpi-hyperpixel4sq) creates:
// - a DPI video output (/sys/class/drm/cardN-DPI-N) with a 720x720 mode
// - a backlight device (/sys/class/backlight/backlight)
// Both must be there. HYPERPIXEL=1 / HYPERPIXEL=0 force the result.
export function detectHyperPixelSquare({
  drmRoot = '/sys/class/drm',
  backlightRoot = '/sys/class/backlight',
  env = process.env
} = {}) {
  if (env.HYPERPIXEL === '1') return { present: true, reason: 'forced by HYPERPIXEL=1' }
  if (env.HYPERPIXEL === '0') return { present: false, reason: 'disabled by HYPERPIXEL=0' }

  const dpi = list(drmRoot)
    .filter(name => /^card\d+-DPI-\d+$/.test(name))
    .map(name => ({
      name,
      status: read(path.join(drmRoot, name, 'status')),
      modes: (read(path.join(drmRoot, name, 'modes')) || '').split('\n')
    }))
  const square = dpi.find(output => output.status !== 'disconnected' && output.modes.includes('720x720'))
  const backlight = list(backlightRoot).includes('backlight')

  if (!square) {
    const found = dpi.map(o => `${o.name} ${o.status} ${o.modes.join('/')}`).join(', ')
    return { present: false, reason: dpi.length ? `no 720x720 DPI output (${found})` : 'no DPI output' }
  }
  if (!backlight) return { present: false, reason: `${square.name} 720x720 but no backlight device` }
  return { present: true, reason: `${square.name} 720x720 and backlight device` }
}
