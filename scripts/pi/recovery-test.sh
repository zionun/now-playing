#!/bin/bash
# Recovery test for the v1.0 criteria: after a Plex restart or a Wi-Fi drop the
# app must be back to normal (health "ok", real-time updates) within a minute.
#
#   sudo ./recovery-test.sh plex
#       Waits for you to restart the Plex server, detects the outage by
#       itself and measures how long the app takes to recover once Plex
#       answers again.
#
#   sudo ./recovery-test.sh status
#       Shows the current app and Plex state (useful before a test).
#
#   sudo ./recovery-test.sh wifi [seconds]
#       Turns the Wi-Fi radio off for [seconds] (default 30) and back on, like
#       a real Wi-Fi drop (rfkill: the network configuration stays), then
#       measures the recovery. The SSH connection drops meanwhile: the test
#       keeps running in the background and writes its result to a log file.
#
# Options: APP_URL (default http://localhost:3001), WIFI_IFACE (default wlan0),
# NOW_PLAYING_CONFIG (default /var/lib/now-playing/config.json).

set -uo pipefail

APP_URL="${APP_URL:-http://localhost:3001}"
CONFIG="${NOW_PLAYING_CONFIG:-/var/lib/now-playing/config.json}"
WIFI_IFACE="${WIFI_IFACE:-wlan0}"
LOG="${RECOVERY_LOG:-/var/log/now-playing-recovery.log}"
LIMIT_S=60      # criterion: recovered within a minute
TIMEOUT_S=600   # give up after 10 minutes

mode="${1:-}"
now() { date +%s; }
stamp() { date '+%H:%M:%S'; }
say() { echo "$(stamp) $*" | tee -a "$LOG"; }

# "ok" when the app reports health ok with real-time Plex updates
app_state() {
    curl -s -m 10 "$APP_URL/api/health?fresh=1" | node -e '
        let d = ""
        process.stdin.on("data", c => (d += c)).on("end", () => {
          try {
            const h = JSON.parse(d)
            console.log(h.status === "ok" && h.plex?.updates === "realtime" ? "ok" : `${h.status}/${h.plex?.updates}`)
          } catch { console.log("app-unreachable") }
        })'
}

# "up" when the Plex server itself answers (address and token from the app configuration)
plex_state() {
    node -e '
        const fs = require("fs")
        try {
          const { plex } = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
          fetch(`http://${plex.url}:${plex.port || 32400}/identity`, {
            headers: { "X-Plex-Token": plex.token, Accept: "application/json" },
            signal: AbortSignal.timeout(5000)
          }).then(r => console.log(r.ok ? "up" : "down"), () => console.log("down"))
        } catch { console.log("no-config") }' "$CONFIG"
}

# "yes" while the app is not in its normal state
app_not_ok() { [ "$(app_state)" = "ok" ] && echo no || echo yes; }

# The default route: taking an interface down (ip link down) deletes it and
# bringing it up doesn't restore it, which a real Wi-Fi drop wouldn't do.
default_route() { ip route show default 2>/dev/null | head -1; }

wifi_off() {
    if command -v rfkill >/dev/null; then
        rfkill block wifi
    else
        ip link set "$WIFI_IFACE" down
    fi
}

wifi_on() {
    if command -v rfkill >/dev/null; then
        rfkill unblock wifi
    else
        ip link set "$WIFI_IFACE" up
    fi
}

wait_for() { # wait_for <function> <value> <timeout>: seconds waited, or -1
    local start
    start=$(now)
    while [ $(( $(now) - start )) -lt "$3" ]; do
        [ "$($1)" = "$2" ] && { echo $(( $(now) - start )); return; }
        sleep 2
    done
    echo -1
}

measure_recovery() {
    say "Waiting for Plex to answer again..."
    local start state
    start=$(now)
    while :; do
        state=$(plex_state)
        [ "$state" = "up" ] && break
        if [ $(( $(now) - start )) -ge "$TIMEOUT_S" ]; then
            say "RESULT: FAIL - Plex not reachable from this device within ${TIMEOUT_S}s ($state)"
            say "Network: default route '$(default_route)', addresses: $(ip -4 -o addr show "$WIFI_IFACE" 2>/dev/null | awk '{print $4}')"
            return 1
        fi
        # Progress every 30 s, so a stuck network is visible in the log
        [ $(( ($(now) - start) % 30 )) -lt 2 ] && say "  still waiting: plex $state, default route '$(default_route)'"
        sleep 2
    done
    say "Plex answers again"

    local recovery
    recovery=$(wait_for app_state ok "$TIMEOUT_S")
    if [ "$recovery" -lt 0 ]; then
        say "RESULT: FAIL - the app did not recover within ${TIMEOUT_S}s (state: $(app_state))"
        return 1
    fi
    if [ "$recovery" -le "$LIMIT_S" ]; then
        say "RESULT: PASS - app recovered ${recovery}s after Plex came back (limit ${LIMIT_S}s)"
    else
        say "RESULT: FAIL - app recovered ${recovery}s after Plex came back (limit ${LIMIT_S}s)"
        return 1
    fi
}

check_baseline() {
    local state
    state=$(app_state)
    if [ "$state" != "ok" ]; then
        say "The app is not in a normal state before the test ($state): fix that first"
        exit 1
    fi
    say "Baseline: app ok, real-time updates active"
}

case "$mode" in
    status)
        echo "app: $(app_state)   plex: $(plex_state)"
        exit 0
        ;;
    plex)
        check_baseline
        say "Now restart the Plex server (e.g. restart its Docker container)."
        say "Waiting for the app to notice the outage (up to 10 minutes)..."
        down=$(wait_for app_not_ok yes "$TIMEOUT_S")
        ;;
    wifi)
        seconds="${2:-30}"
        [ "$EUID" -eq 0 ] || { echo "Run with sudo (the Wi-Fi interface is turned off and on)"; exit 1; }
        if [ "${RECOVERY_DETACHED:-}" != "1" ]; then
            check_baseline
            echo "The Wi-Fi ($WIFI_IFACE) goes off for ${seconds}s: the SSH connection will drop."
            echo "Reconnect in 2-3 minutes and read the result with:  tail $LOG"
            RECOVERY_DETACHED=1 setsid nohup "$0" wifi "$seconds" >/dev/null 2>&1 &
            exit 0
        fi
        sleep 3
        saved_route=$(default_route)
        say "Wi-Fi off for ${seconds}s (default route: '$saved_route')"
        wifi_off
        sleep "$seconds"
        wifi_on
        say "Wi-Fi back on, waiting for the connection"
        # Wait for the Wi-Fi to reconnect; if the default route was lost,
        # put it back (the test must not leave the device off the network)
        for _ in $(seq 1 30); do
            [ -n "$(default_route)" ] && break
            sleep 2
        done
        if [ -z "$(default_route)" ] && [ -n "$saved_route" ]; then
            ip route replace $saved_route && say "Default route restored: $saved_route"
        fi
        measure_recovery
        exit $?
        ;;
    *)
        sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac

# plex mode, continued: the outage was detected
if [ "${down:-}" = "-1" ]; then
    say "No outage detected within ${TIMEOUT_S}s: was Plex restarted?"
    exit 1
fi
say "Outage detected (app state: $(app_state))"
measure_recovery
