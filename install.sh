# Install script for Raspberry Pi (DietPi)
# Run as root: curl -sSL https://raw.githubusercontent.com/your-repo/install.sh | bash

#!/bin/bash

set -e

echo "🚀 Installing Now Playing for Plex..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Please run as root (use sudo)"
    exit 1
fi

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Check if Node.js is already installed (from DietPi auto-setup)
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js is already installed: $NODE_VERSION"
    
    # Check if version is adequate (18+)
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
    if [ "$NODE_MAJOR" -lt 18 ]; then
        echo "⚠️  Node.js version too old, updating to 18..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt install -y nodejs
    fi
else
    # Fallback: install Node.js if not present
    echo "📥 Installing Node.js 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt install -y nodejs
fi

# Check if Git is already installed (from DietPi auto-setup)
if ! command -v git >/dev/null 2>&1; then
    echo "📥 Installing Git..."
    apt install -y git
else
    echo "✅ Git is already installed"
fi

# Install PM2 globally
echo "🔧 Installing PM2..."
npm install -g pm2

# Create app directory and copy files
APP_DIR="/opt/now-playing"
echo "📁 Creating application directory: $APP_DIR"
mkdir -p $APP_DIR

# Copy current repository contents to /opt/now-playing
echo "📋 Copying application files..."
cp -r . $APP_DIR/
cd $APP_DIR

# Install dependencies
echo "📦 Installing dependencies..."
npm run install:all

# Build production
echo "🏗️  Building production version..."
npm run build

# Setup PM2
echo "🔄 Setting up PM2..."
pm2 start ecosystem.config.cjs
pm2 startup systemd -u root --hp /root
pm2 save

# Setup kiosk mode
echo "🖥️  Setting up kiosk mode..."
chmod +x kiosk.sh
cp kiosk.sh /opt/kiosk.sh

# Install Chromium for kiosk mode
echo "🌐 Installing Chromium..."
apt install -y chromium-browser unclutter x11-xserver-utils

# Create systemd service for kiosk
cat > /etc/systemd/system/kiosk.service << EOF
[Unit]
Description=Kiosk Mode
After=graphical-session.target

[Service]
Type=simple
User=root
ExecStart=/opt/kiosk.sh
Restart=always
RestartSec=10

[Install]
WantedBy=graphical-session.target
EOF

# Enable kiosk service
systemctl enable kiosk.service

echo "✅ Installation completed!"
echo ""

# Ask user about cleaning up the original directory
ORIGINAL_DIR=$(pwd)
echo "🧹 Cleanup Options:"
echo "The application has been installed to /opt/now-playing"
echo "Current directory: $ORIGINAL_DIR"
echo ""
read -p "Do you want to remove the original directory? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd /
    echo "🗑️  Removing original directory: $ORIGINAL_DIR"
    rm -rf "$ORIGINAL_DIR"
    echo "✅ Original directory removed"
else
    echo "📁 Original directory kept: $ORIGINAL_DIR"
fi

echo ""
echo "📋 Next steps:"
echo "1. Reboot your Raspberry Pi"
echo "2. Access configuration at http://your-pi-ip:3001/config"
echo "3. Configure Plex server settings"
echo "4. (Optional) Configure Last.fm integration"
echo ""
echo "🔧 Useful commands:"
echo "  pm2 status          - Check application status"
echo "  pm2 logs now-playing - View application logs"
echo "  pm2 restart now-playing - Restart application"
echo ""
echo "🌐 The app will be available at: http://localhost:3001"