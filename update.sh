#!/bin/bash
# Update script: run as root from /opt/now-playing (sudo ./update.sh)

set -euo pipefail

APP_DIR="/opt/now-playing"
CONFIG_FILE="server/src/config/app.json"
BACKUP_FILE="/tmp/now-playing-config-backup.json"

fail() { echo "❌ $1"; exit 1; }

echo "🔄 Updating Now Playing for Plex..."

[ "$EUID" -eq 0 ] || fail "Please run as root (use sudo)"
[ "$(pwd)" = "$APP_DIR" ] || fail "Run this script from $APP_DIR: cd $APP_DIR && sudo ./update.sh"

# The configuration is not tracked by git, but keep a copy anyway
if [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" "$BACKUP_FILE"
    echo "💾 Configuration backed up to $BACKUP_FILE"
fi

echo "📥 Downloading the latest version..."
git fetch origin
git reset --hard origin/main

if [ -f "$BACKUP_FILE" ] && [ ! -f "$CONFIG_FILE" ]; then
    cp "$BACKUP_FILE" "$CONFIG_FILE"
    echo "♻️  Configuration restored"
fi

# Build tools for native modules (bcrypt), if missing
if ! command -v make >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1; then
    echo "📦 Installing build tools..."
    apt update && apt install -y build-essential python3
fi

# The service keeps running during the update: it is reloaded at the end
echo "📦 Updating dependencies..."
for dir in . client server; do
    (cd "$dir" && npm ci --no-audit --no-fund)
done

for pkg in express socket.io bcrypt ws qrcode; do
    [ -d "server/node_modules/$pkg" ] || fail "Server dependency '$pkg' is missing: check the npm output above"
done

echo "🏗️  Building the interface..."
npm run build
[ -f client/dist/index.html ] || fail "Build failed: client/dist/index.html not found"

echo "🗂️  Checking log rotation..."
pm2 describe pm2-logrotate >/dev/null 2>&1 || pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 5M
pm2 set pm2-logrotate:retain 3
pm2 set pm2-logrotate:compress true

echo "🔄 Restarting..."
pm2 startOrReload ecosystem.config.cjs
pm2 save

echo "🩺 Checking the server..."
for i in $(seq 1 15); do
    if curl -fs -o /dev/null http://localhost:3001/api/auth/state; then
        echo "✅ Server is running"
        break
    fi
    [ "$i" -eq 15 ] && fail "The server is not answering: check 'pm2 logs now-playing'"
    sleep 2
done

rm -f "$BACKUP_FILE"

echo ""
echo "✅ Update completed!"
echo ""
echo "🔧 Useful commands:"
echo "  pm2 status                      - Check application status"
echo "  pm2 logs now-playing            - View application logs"
echo "  curl localhost:3001/api/health  - Plex / Last.fm status"
