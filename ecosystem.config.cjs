module.exports = {
  apps: [{
    name: 'now-playing',
    script: 'server/src/index.js',
    cwd: '/opt/now-playing',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      // debug solo per indagini: in produzione niente dump degli eventi
      LOG_LEVEL: 'info'
    },
    error_file: '/var/log/pm2/now-playing-error.log',
    out_file: '/var/log/pm2/now-playing-out.log',
    log_file: '/var/log/pm2/now-playing.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1000
  }]
}