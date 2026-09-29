#!/bin/bash
# Avvia Chromium in modalità kiosk sull'HyperPixel (720x720).
# Lanciato da start-kiosk.sh tramite xinit, quindi SENZA window manager.

export DISPLAY=:0
URL="http://localhost:3001"
SIZE="${KIOSK_SIZE:-720,720}"          # risoluzione dell'HyperPixel Square
PROFILE=/tmp/chromium-kiosk
LOG=/tmp/kiosk-chromium.log

# 1. Aspetta che X sia pronto
until xset q &>/dev/null; do
    sleep 0.2
done

# Niente screensaver/DPMS, sfondo nero al posto del grigio/bianco di X
xset s off
xset s noblank
xset -dpms
xsetroot -solid black 2>/dev/null || true

# 2. Aspetta che il server serva davvero la SPA (non solo che la porta sia aperta).
#    Timeout di sicurezza: dopo 120 s parte comunque, la pagina si riprenderà da sola.
for _ in $(seq 1 240); do
    curl -sf --max-time 2 "$URL/" | grep -q 'id="root"' && break
    sleep 0.5
done

# Profilo pulito a ogni avvio (evita "ripristina sessione" e lock rimasti da un crash)
rm -rf "$PROFILE"

# 3. Chromium in kiosk. Senza window manager --kiosk non conosce la dimensione
#    dello schermo, quindi la finestra viene dimensionata esplicitamente.
#    --no-memcheck evita l'avviso "meno di 1 GB di RAM" del wrapper Raspberry Pi.
#    La traduzione è disattivata anche via policy (/etc/chromium/policies/managed).
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

# 4. Watchdog: la prima navigazione a volte non parte (finestra "Untitled").
#    Controlla ogni secondo il titolo della finestra:
#    - "Now Playing..."  -> pagina caricata, il watchdog termina;
#    - "Untitled"/vuoto  -> documento non ancora arrivato: dopo $grace secondi F5;
#    - altro (es. "localhost:3001" mentre carica) -> sta caricando, non si tocca.
#    Dopo ogni reload l'attesa raddoppia (4, 8, 16, 30 s): sullo Zero 2W un
#    reload può impiegare parecchio e non va interrotto da un altro reload.
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
        echo "$(date +%T) pagina caricata" >>"$LOG"
        break
    fi
    case "$name" in
        ""|Untitled*) waited=$((waited + 1)) ;;
        *)            waited=0; continue ;;   # sta caricando
    esac
    if [ "$waited" -ge "$grace" ]; then
        echo "$(date +%T) titolo '$name' dopo ${grace}s, reload" >>"$LOG"
        xdotool key --window "$WID" F5
        waited=0
        grace=$((grace * 2)); [ "$grace" -gt 30 ] && grace=30
    fi
done

# xinit chiude X quando questo script termina: resta agganciato a Chromium
wait "$CHROMIUM_PID"
