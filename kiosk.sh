#!/bin/bash

# Set display
export DISPLAY=:0

# Disable screen blanking / DPMS
xset s off
xset -dpms
xset s noblank

# Launch Chromium in kiosk mode
chromium \
  --no-sandbox \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows \
  --disable-features=TranslateUI,VizDisplayCompositor \
  --enable-features=VaapiVideoDecoder \
  --disable-extensions \
  --disable-plugins \
  --disable-sync \
  --disable-background-networking \
  --disable-default-apps \
  --disable-translate \
  --no-memcheck \
  --no-first-run \
  --no-default-browser-check \
  --disable-gpu-process-crash-limit \
  --kiosk \
  --app=http://localhost:3001