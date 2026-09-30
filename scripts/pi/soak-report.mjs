#!/usr/bin/env node
// Summary of the CSV written by soak-monitor.sh, checked against the v1.0
// criteria: at least 72 hours, no PM2 restarts, no memory growth.
// Usage: node soak-report.mjs [/var/log/now-playing-soak.csv]
import { readFileSync } from 'fs'

const MIN_HOURS = 72
// Memory growth tolerated (MB per day, least-squares trend after the first
// hour, when caches have filled up)
const MAX_GROWTH_MB_PER_DAY = 2

const file = process.argv[2] || '/var/log/now-playing-soak.csv'
const [header, ...lines] = readFileSync(file, 'utf8').trim().split('\n')
const keys = header.split(',')
const rows = lines
  .map(line => Object.fromEntries(line.split(',').map((value, i) => [keys[i], value])))
  .map(row => ({ ...row, time: new Date(row.timestamp).getTime() }))
  .filter(row => !Number.isNaN(row.time))

if (rows.length < 2) {
  console.log('Not enough samples yet.')
  process.exit(1)
}

const first = rows[0]
const last = rows[rows.length - 1]
const hours = (last.time - first.time) / 3600000
const num = value => (value === '' || value === undefined ? NaN : Number(value))

// PM2 restarts during the test
const restarts = Math.max(...rows.map(r => num(r.pm2_restarts)).filter(Number.isFinite))
const restartsAtStart = num(first.pm2_restarts)
const newRestarts = restarts - restartsAtStart
const notOnline = rows.filter(r => r.pm2_status !== 'online')

// Memory: values and linear trend after the first hour
const memory = rows.map(r => ({ t: r.time, mb: num(r.app_rss_mb) })).filter(m => Number.isFinite(m.mb))
const settled = memory.filter(m => m.t - first.time >= 3600000)
const trendSource = settled.length >= 10 ? settled : memory
const slopePerDay = (() => {
  const n = trendSource.length
  const xs = trendSource.map(m => (m.t - trendSource[0].t) / 86400000)
  const ys = trendSource.map(m => m.mb)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  const cov = xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0)
  const varX = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0)
  return varX ? cov / varX : 0
})()
const memValues = memory.map(m => m.mb)

// Health: samples and periods that were not "ok"
const problems = []
let current = null
for (const row of rows) {
  const bad = row.health_status !== 'ok'
  if (bad && !current) current = { from: row.timestamp, to: row.timestamp, status: row.health_status, count: 1 }
  else if (bad) Object.assign(current, { to: row.timestamp, count: current.count + 1 })
  else if (current) problems.push(current), (current = null)
}
if (current) problems.push(current)

const temps = rows.map(r => num(r.cpu_temp_c)).filter(Number.isFinite)
const available = rows.map(r => num(r.mem_available_mb)).filter(Number.isFinite)

const pass = {
  duration: hours >= MIN_HOURS,
  restarts: newRestarts === 0 && notOnline.length === 0,
  memory: slopePerDay <= MAX_GROWTH_MB_PER_DAY
}

const fmt = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '-')
const mark = ok => (ok ? 'PASS' : 'FAIL')

console.log(`Samples: ${rows.length}, from ${first.timestamp} to ${last.timestamp}`)
console.log('')
console.log(`[${mark(pass.duration)}] Duration: ${fmt(hours)} h (at least ${MIN_HOURS} h)`)
console.log(
  `[${mark(pass.restarts)}] PM2 restarts during the test: ${newRestarts}` +
    (notOnline.length ? `, ${notOnline.length} samples not "online"` : '')
)
console.log(
  `[${mark(pass.memory)}] App memory: start ${fmt(memValues[0])} MB, end ${fmt(memValues.at(-1))} MB, ` +
    `max ${fmt(Math.max(...memValues))} MB, trend ${fmt(slopePerDay, 2)} MB/day ` +
    `(at most ${MAX_GROWTH_MB_PER_DAY})`
)
console.log('')
console.log(`System memory available: min ${fmt(Math.min(...available), 0)} MB`)
if (temps.length) console.log(`CPU temperature: max ${fmt(Math.max(...temps))} °C`)
if (problems.length === 0) {
  console.log('Health: always "ok"')
} else {
  console.log(`Health: ${problems.length} ${problems.length === 1 ? 'period' : 'periods'} not "ok":`)
  for (const p of problems) console.log(`  ${p.from} → ${p.to}  ${p.status} (${p.count} samples)`)
}
console.log('')
console.log(pass.duration && pass.restarts && pass.memory ? 'RESULT: PASS' : 'RESULT: FAIL')
process.exit(pass.duration && pass.restarts && pass.memory ? 0 : 1)
