// PM2 configuration for the Raspberry Pi (sized for a Pi Zero 2 W: 512 MB of
// RAM shared with Chromium in kiosk mode)
module.exports = {
  apps: [{
    name: 'now-playing',
    script: 'server/src/index.js',
    cwd: '/opt/now-playing',
    instances: 1,
    exec_mode: 'fork',

    // The server normally uses 80-90 MB. The V8 heap is capped, so memory is
    // reclaimed earlier instead of growing; if the threshold is exceeded anyway
    // (e.g. a memory leak) PM2 restarts the process.
    node_args: '--max-old-space-size=128',
    max_memory_restart: '200M',

    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      // debug only for investigations: no event dumps in production
      LOG_LEVEL: 'info'
      // The configuration lives in /var/lib/now-playing/config.json
      // (to move it: NOW_PLAYING_CONFIG=/path/to/config.json)
    },

    // Only two log files (no combined file duplicating writes to the SD
    // card); rotation is handled by pm2-logrotate
    error_file: '/var/log/pm2/now-playing-error.log',
    out_file: '/var/log/pm2/now-playing-out.log',
    time: true,

    // Automatic restart with a growing delay; if the process keeps exiting
    // within 30s of starting, PM2 gives up after 10 attempts
    autorestart: true,
    exp_backoff_restart_delay: 1000,
    min_uptime: '30s',
    max_restarts: 10,
    kill_timeout: 5000
  }]
}
