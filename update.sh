#!/bin/bash

set -e

echo "🔄 Updating Now Playing for Plex..."

# Check if running in /opt/now-playing
if [ "$(pwd)" != "/opt/now-playing" ]; then
    echo "❌ This script must be run from /opt/now-playing"
    echo "Current directory: $(pwd)"
    echo "Please run: cd /opt/now-playing && ./update.sh"
    exit 1
fi

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Please run as root (use sudo)"
    exit 1
fi

# Backup current configuration
echo "💾 Backing up current configuration..."
if [ -f "server/src/config/app.json" ]; then
    cp server/src/config/app.json /tmp/now-playing-config-backup.json
    echo "✅ Configuration backed up to /tmp/now-playing-config-backup.json"
fi

# Stop PM2 processes
echo "⏹️  Stopping PM2 processes..."
pm2 stop now-playing 2>/dev/null || true

# Pull latest changes
echo "📥 Pulling latest changes..."
git fetch origin
git reset --hard origin/main

# Install/update dependencies
echo "📦 Updating dependencies..."
npm install

# Update client dependencies
echo "📦 Updating client dependencies..."
cd client && npm install && cd ..

# Update server dependencies  
echo "📦 Updating server dependencies..."
cd server && npm install && cd ..

# Build production frontend
echo "🏗️  Building production frontend..."
npm run build

# Restore configuration if it exists
if [ -f "/tmp/now-playing-config-backup.json" ]; then
    echo "♻️  Restoring configuration..."
    cp /tmp/now-playing-config-backup.json server/src/config/app.json
    rm /tmp/now-playing-config-backup.json
    echo "✅ Configuration restored"
fi

echo "🗂️  Checking log rotation..."
# Rotazione dei log: file piccoli e pochi, per non consumare la scheda SD
pm2 describe pm2-logrotate >/dev/null 2>&1 || pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 5M
pm2 set pm2-logrotate:retain 3
pm2 set pm2-logrotate:compress true

# Restart PM2
echo "🔄 Restarting PM2 processes..."
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "✅ Update completed successfully!"
echo ""
echo "🔧 Useful commands:"
echo "  pm2 status          - Check application status"  
echo "  pm2 logs now-playing - View application logs"
echo "  pm2 restart now-playing - Restart application"
echo ""
echo "🌐 The app is available at: http://localhost:3001"