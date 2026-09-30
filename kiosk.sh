#!/bin/bash
# Starts Chromium in kiosk mode on the HyperPixel (720x720).
# Launched by start-kiosk.sh through xinit, so WITHOUT a window manager.

export DISPLAY=:0
URL="http://localhost:3001"
SIZE="${KIOSK_SIZE:-720,720}"          # HyperPixel Square resolution
PROFILE=/tmp/chromium-kiosk
LOG=/tmp/kiosk-chromium.log

# 1. Wait for X to be ready
until xset q &>/dev/null; do
    sleep 0.2
done

# No screensaver/DPMS, black background instead of X's grey/white
xset s off
xset s noblank
xset -dpms
xsetroot -solid black 2>/dev/null || true

# 2. Wait until the server really serves the app (not just an open port).
#    Safety timeout: after 120 s start anyway, the page recovers by itself.
for _ in $(seq 1 240); do
    curl -sf --max-time 2 "$URL/" | grep -q 'id="root"' && break
    sleep 0.5
done

# Clean profile on every start (no "restore session" or locks left by a crash)
rm -rf "$PROFILE"

# 3. Chromium in kiosk mode. Without a window manager --kiosk doesn't know the
#    screen size, so the window is sized explicitly.
#    --no-memcheck avoids the "less than 1 GB of RAM" warning of the Raspberry Pi wrapper.
#    Translation is also disabled by policy (/etc/chromium/policies/managed).
#    --lang sets the browser language, followed by the app when its language
#    setting is "Automatic".
chromium \
  --user-data-dir="$PROFILE" \
  --no-sandbox \
  --no-memcheck \
  --kiosk \
  --window-size="$SIZE" \
  --window-position=0,0 \
  --force-device-scale-factor=1 \
  --default-background-color=ff000000 \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows \
  --disable-features=Translate \
  --disable-extensions \
  --disable-sync \
  --disable-background-networking \
  --disable-default-apps \
  --no-first-run \
  --no-default-browser-check \
  --disable-gpu-process-crash-limit \
  --check-for-update-interval=31536000 \
  --lang=it \
  "$URL" >"$LOG" 2>&1 &
CHROMIUM_PID=$!

# 4. Watchdog: the first navigation sometimes doesn't start ("Untitled" window).
#    Checks the window title every second:
#    - "Now Playing..."  -> page loaded, the watchdog ends;
#    - "Untitled"/empty  -> document not arrived yet: F5 after $grace seconds;
#    - anything else (e.g. "localhost:3001" while loading) -> loading, leave it.
#    After each reload the wait doubles (4, 8, 16, 30 s): on the Zero 2W a
#    reload can take a while and must not be interrupted by another one.
TITLE="Now Playing"
grace=4
waited=0
for _ in $(seq 1 180); do
    sleep 1
    kill -0 "$CHROMIUM_PID" 2>/dev/null || break
    WID=$(xdotool search --onlyvisible --class chromium 2>/dev/null | tail -1)
    [ -z "$WID" ] && continue
    name=$(xdotool getwindowname "$WID" 2>/dev/null)
    if echo "$name" | grep -q "$TITLE"; then
        echo "$(date +%T) page loaded" >>"$LOG"
        break
    fi
    case "$name" in
        ""|Untitled*) waited=$((waited + 1)) ;;
        *)            waited=0; continue ;;   # loading
    esac
    if [ "$waited" -ge "$grace" ]; then
        echo "$(date +%T) title '$name' after ${grace}s, reloading" >>"$LOG"
        xdotool key --window "$WID" F5
        waited=0
        grace=$((grace * 2)); [ "$grace" -gt 30 ] && grace=30
    fi
done

# xinit closes X when this script ends: stay attached to Chromium
wait "$CHROMIUM_PID"
