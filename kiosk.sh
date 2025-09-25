#!/bin/bash

# Kiosk mode script for Raspberry Pi
# Place this file in /opt/kiosk.sh and make it executable

export DISPLAY=:0

# Hide cursor and disable screen blanking
unclutter -idle 0.1 -root &
xset s off
xset -dpms
xset s noblank

# Launch Chromium in kiosk mode
chromium-browser \
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
  --no-first-run \
  --no-default-browser-check \
  --disable-gpu-process-crash-limit \
  --kiosk \
  --app=http://localhost:3001