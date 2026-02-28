#!/bin/bash

# Set display
export DISPLAY=:0

until xset q &>/dev/null; do
    sleep 0.2
done

# Disable screen blanking / DPMS
xset s off
xset s noblank

# Launch Chromium in kiosk mode
chromium \
  --user-data-dir=/tmp/chromium-kiosk \
  --no-sandbox \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows \
  --disable-features=Translate,VizDisplayCompositor \
  --enable-features=VaapiVideoDecoder \
  --disable-extensions \
  --disable-plugins \
  --disable-sync \
  --disable-background-networking \
  --disable-default-apps \
  --disable-translate \
  --lang=en \
  --no-memcheck \
  --no-first-run \
  --no-default-browser-check \
  --disable-gpu-process-crash-limit \
  --kiosk \
  http://localhost:3001