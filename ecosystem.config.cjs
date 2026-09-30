// Configurazione PM2 per il Raspberry Pi (pensata per un Pi Zero 2 W: 512 MB
// di RAM condivisi con Chromium in modalità kiosk)
module.exports = {
  apps: [{
    name: 'now-playing',
    script: 'server/src/index.js',
    cwd: '/opt/now-playing',
    instances: 1,
    exec_mode: 'fork',

    // Il server usa normalmente 80-90 MB. Heap V8 limitato, così la memoria
    // viene recuperata prima invece di crescere; se si supera comunque la
    // soglia (es. una perdita di memoria) PM2 riavvia il processo.
    node_args: '--max-old-space-size=128',
    max_memory_restart: '200M',

    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      // debug solo per indagini: in produzione niente dump degli eventi
      LOG_LEVEL: 'info'
      // La configurazione sta in /var/lib/now-playing/config.json
      // (per spostarla: NOW_PLAYING_CONFIG=/percorso/config.json)
    },

    // Due soli file di log (niente file combinato che duplica le scritture
    // sulla scheda SD); la rotazione è gestita da pm2-logrotate
    error_file: '/var/log/pm2/now-playing-error.log',
    out_file: '/var/log/pm2/now-playing-out.log',
    time: true,

    // Riavvio automatico con attesa crescente; se il processo si chiude di
    // continuo entro 30s dall'avvio, dopo 10 tentativi PM2 smette di insistere
    autorestart: true,
    exp_backoff_restart_delay: 1000,
    min_uptime: '30s',
    max_restarts: 10,
    kill_timeout: 5000
  }]
}
