#!/bin/bash
# Install script for Raspberry Pi (DietPi / Raspberry Pi OS)
# Run as root from the cloned repository: sudo ./install.sh

set -euo pipefail

APP_DIR="/opt/now-playing"
NODE_MAJOR_REQUIRED=20
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() { echo "❌ $1"; exit 1; }

echo "🚀 Installing Now Playing for Plex..."

[ "$EUID" -eq 0 ] || fail "Please run as root (use sudo)"

# System packages, only the missing ones and without "recommended" extras:
# - git: updates (update.sh)
# - curl + ca-certificates: Node.js setup, server and kiosk checks
# - xdotool: kiosk watchdog (kiosk.sh)
# No compilers needed: the server has no native modules.
PACKAGES=""
command -v git >/dev/null 2>&1 || PACKAGES="$PACKAGES git"
command -v curl >/dev/null 2>&1 || PACKAGES="$PACKAGES curl"
[ -d /etc/ssl/certs ] && [ -n "$(ls -A /etc/ssl/certs 2>/dev/null)" ] || PACKAGES="$PACKAGES ca-certificates"
command -v xdotool >/dev/null 2>&1 || PACKAGES="$PACKAGES xdotool"
if [ -n "$PACKAGES" ]; then
    echo "📦 Installing system packages:$PACKAGES"
    apt update
    apt install -y --no-install-recommends $PACKAGES
fi

# Kiosk: disable Chromium's translate prompt via a managed policy
echo "🌐 Disabling Chromium translation..."
mkdir -p /etc/chromium/policies/managed
echo '{ "TranslateEnabled": false }' > /etc/chromium/policies/managed/kiosk.json

# Node.js (LTS)
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
    NODE_MAJOR=$(node --version | sed 's/^v//' | cut -d. -f1)
fi
if [ "$NODE_MAJOR" -lt "$NODE_MAJOR_REQUIRED" ]; then
    echo "📥 Installing Node.js $NODE_MAJOR_REQUIRED LTS..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_REQUIRED}.x" | bash -
    apt install -y --no-install-recommends nodejs
fi
echo "✅ Node.js $(node --version)"

# PM2 and log rotation (small, few log files to spare the SD card)
if ! command -v pm2 >/dev/null 2>&1; then
    echo "🔧 Installing PM2..."
    npm install -g pm2
fi
echo "🗂️  Configuring log rotation..."
pm2 describe pm2-logrotate >/dev/null 2>&1 || pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 5M
pm2 set pm2-logrotate:retain 3
pm2 set pm2-logrotate:compress true

# Application files
if [ "$SOURCE_DIR" != "$APP_DIR" ]; then
    echo "📋 Copying application files to $APP_DIR..."
    mkdir -p "$APP_DIR"
    cp -r "$SOURCE_DIR"/. "$APP_DIR"/
fi
cd "$APP_DIR"

# Dependencies (exact versions from the lockfiles). Only what production
# needs: the server without its dev tools; the client packages only for the
# build, then removed. The root package only has development tools.
echo "📦 Installing server dependencies..."
(cd server && npm ci --omit=dev --no-audit --no-fund)

for pkg in express socket.io bcryptjs ws qrcode; do
    [ -d "server/node_modules/$pkg" ] || fail "Server dependency '$pkg' is missing: check the npm output above"
done

echo "🏗️  Building the interface..."
(cd client && npm ci --no-audit --no-fund && npm run build)
[ -f client/dist/index.html ] || fail "Build failed: client/dist/index.html not found"
rm -rf client/node_modules node_modules

# Start (or reload if already running) and enable at boot
echo "🔄 Starting with PM2..."
pm2 startOrReload ecosystem.config.cjs
pm2 startup systemd -u root --hp /root >/dev/null
pm2 save

# Check that the server answers
echo "🩺 Checking the server..."
for i in $(seq 1 15); do
    if curl -fs -o /dev/null http://localhost:3001/api/auth/state; then
        echo "✅ Server is running"
        break
    fi
    [ "$i" -eq 15 ] && fail "The server is not answering: check 'pm2 logs now-playing'"
    sleep 2
done

echo ""
echo "✅ Installation completed!"
echo ""
echo "📋 Next steps:"
echo "1. Open the kiosk screen (or reboot the Raspberry Pi)"
echo "2. Scan the QR code shown on the screen with your phone"
echo "3. Follow the setup: device password, Plex login, Last.fm (optional)"
echo ""
echo "🔧 Useful commands:"
echo "  pm2 status                      - Check application status"
echo "  pm2 logs now-playing            - View application logs"
echo "  pm2 restart now-playing         - Restart application"
echo "  curl localhost:3001/api/health  - Plex / Last.fm status"
echo ""
echo "⚙️  Configuration file: /var/lib/now-playing/config.json"

if [ "$SOURCE_DIR" != "$APP_DIR" ]; then
    echo ""
    echo "The application now runs from $APP_DIR:"
    echo "the cloned folder $SOURCE_DIR is no longer needed and can be removed."
fi
