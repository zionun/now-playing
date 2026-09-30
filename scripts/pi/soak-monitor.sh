#!/bin/bash
# Soak test for the v1.0 criteria: records, every INTERVAL seconds, the PM2
# restarts and memory of the app, the free system memory, the CPU temperature
# and the /api/health status, to a CSV file. Summarize it with soak-report.mjs.
#
# Usage (on the Raspberry Pi, survives the SSH session ending):
#   sudo nohup /opt/now-playing/scripts/pi/soak-monitor.sh > /dev/null 2>&1 &
# Options (environment variables):
#   SOAK_CSV=/var/log/now-playing-soak.csv   output file (appended to)
#   SOAK_INTERVAL=300                        seconds between samples
#   SOAK_HOURS=72                            stops after this many hours (0 = never)
#   APP_URL=http://localhost:3001            app address

set -uo pipefail

CSV="${SOAK_CSV:-/var/log/now-playing-soak.csv}"
INTERVAL="${SOAK_INTERVAL:-300}"
HOURS="${SOAK_HOURS:-72}"
APP_URL="${APP_URL:-http://localhost:3001}"
APP_NAME="now-playing"

command -v pm2 >/dev/null || { echo "pm2 not found"; exit 1; }
command -v node >/dev/null || { echo "node not found"; exit 1; }

if [ ! -s "$CSV" ]; then
    echo "timestamp,pm2_status,pm2_restarts,app_rss_mb,app_uptime_min,mem_available_mb,cpu_temp_c,health_status,plex_reachable,plex_updates,lastfm_reachable,screen" >"$CSV"
fi

end=$(( $(date +%s) + HOURS * 3600 ))
echo "Soak monitor started: every ${INTERVAL}s for ${HOURS}h -> $CSV"

while :; do
    now=$(date -Iseconds)

    # PM2: status, restart count, memory and uptime of the app
    pm2_fields=$(pm2 jlist 2>/dev/null | node -e '
        let d = ""
        process.stdin.on("data", c => (d += c)).on("end", () => {
          try {
            const app = JSON.parse(d).find(p => p.name === process.argv[1])
            if (!app) return console.log("missing,,,")
            const env = app.pm2_env || {}
            const uptime = env.pm_uptime ? Math.round((Date.now() - env.pm_uptime) / 60000) : ""
            console.log([env.status, env.restart_time, (app.monit.memory / 1048576).toFixed(1), uptime].join(","))
          } catch { console.log("error,,,") }
        })' "$APP_NAME")

    mem_available=$(awk '/MemAvailable/ { printf "%.0f", $2 / 1024 }' /proc/meminfo 2>/dev/null)
    temp=""
    if [ -r /sys/class/thermal/thermal_zone0/temp ]; then
        temp=$(awk '{ printf "%.1f", $1 / 1000 }' /sys/class/thermal/thermal_zone0/temp)
    fi

    health_fields=$(curl -s -m 20 "$APP_URL/api/health" | node -e '
        let d = ""
        process.stdin.on("data", c => (d += c)).on("end", () => {
          try {
            const h = JSON.parse(d)
            console.log([h.status, h.plex?.reachable, h.plex?.updates, h.lastfm?.reachable, h.screen].join(","))
          } catch { console.log("unreachable,,,,") }
        })')

    echo "$now,$pm2_fields,$mem_available,$temp,$health_fields" >>"$CSV"

    if [ "$HOURS" -gt 0 ] && [ "$(date +%s)" -ge "$end" ]; then
        echo "Soak monitor finished: run: node soak-report.mjs"
        break
    fi
    sleep "$INTERVAL"
done
