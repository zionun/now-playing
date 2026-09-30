// 📋 LEVELED LOGS - The level is set with LOG_LEVEL (debug, info, warn,
// error; default info). In production on the Raspberry Pi debug messages are
// not written: no event dumps on every message, fewer
// writes to the SD card.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }

let currentLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info

export function setLogLevel(level) {
  if (LEVELS[level] !== undefined) currentLevel = LEVELS[level]
}

export function createLogger(scope) {
  const write =
    (level, method) =>
    (...args) => {
      if (LEVELS[level] < currentLevel) return
      method(`[${level}] [${scope}]`, ...args)
    }
  return {
    debug: write('debug', console.log),
    info: write('info', console.log),
    warn: write('warn', console.warn),
    error: write('error', console.error),
    isDebug: () => currentLevel <= LEVELS.debug
  }
}
