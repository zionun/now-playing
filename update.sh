#!/bin/bash
# Update script: run as root from /opt/now-playing (sudo ./update.sh)

set -euo pipefail

APP_DIR="/opt/now-playing"

fail() { echo "❌ $1"; exit 1; }

echo "🔄 Updating Now Playing for Plex..."

[ "$EUID" -eq 0 ] || fail "Please run as root (use sudo)"
[ "$(pwd)" = "$APP_DIR" ] || fail "Run this script from $APP_DIR: cd $APP_DIR && sudo ./update.sh"

# The configuration lives outside the repository (/var/lib/now-playing),
# so updating the code never touches it. An old server/src/config/app.json
# is ignored by git and moved there automatically when the server starts.
echo "📥 Downloading the latest version..."
git fetch origin
git reset --hard origin/main

# The service keeps running during the update: it is reloaded at the end.
# Dependencies (exact versions from the lockfiles). Only what production
# needs: the server without its dev tools; the client packages only for the
# build, then removed. The root package only has development tools.
echo "📦 Updating server dependencies..."
(cd server && npm ci --omit=dev --no-audit --no-fund)

for pkg in express socket.io bcryptjs ws qrcode; do
    [ -d "server/node_modules/$pkg" ] || fail "Server dependency '$pkg' is missing: check the npm output above"
done

echo "🏗️  Building the interface..."
(cd client && npm ci --no-audit --no-fund && npm run build)
[ -f client/dist/index.html ] || fail "Build failed: client/dist/index.html not found"
rm -rf client/node_modules node_modules

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

echo ""
echo "✅ Update completed!"
echo ""
echo "🔧 Useful commands:"
echo "  pm2 status                      - Check application status"
echo "  pm2 logs now-playing            - View application logs"
echo "  curl localhost:3001/api/health  - Plex / Last.fm status"
