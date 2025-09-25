# Now Playing - Plex Music Display

A modern, touch-friendly web application that displays currently playing music from your Plex Media Server. Designed specifically for Raspberry Pi with HyperPixel 4.0 Square display (720x720), but works great on any device.

![Now Playing Screenshot](screenshot.png)

## ✨ Features

- **Real-time Music Display**: Shows currently playing track, artist, album, and artwork from Plex
- **Touch & Mouse Friendly**: Optimized interface with fade-in/fade-out controls
- **WebSocket Integration**: Live updates without page refreshes
- **Idle Screen**: Displays Last.fm statistics when no music is playing
- **Multi-user Support**: Handles multiple Plex users and allows switching between them
- **Responsive Design**: Optimized for 720x720 displays but scales to any screen size
- **Web Configuration**: Easy setup through browser-based configuration panel
- **Kiosk Mode Ready**: Perfect for dedicated music displays

## 🛠 Tech Stack

- **Frontend**: React 18 + Vite, modern CSS with CSS Grid/Flexbox
- **Backend**: Node.js + Express + Socket.IO
- **Real-time**: WebSocket communication for instant updates
- **APIs**: Plex Media Server API, Last.fm API integration
- **Process Management**: PM2 for production deployment

## 📋 Requirements

- **Plex Media Server** with music library
- **Node.js** 18+ (tested with Node.js 22)
- **Raspberry Pi** (tested on Pi Zero 2 W) or any Linux/macOS system
- **Last.fm Account** (optional, for idle screen statistics)

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/zionun/now-playing.git
cd now-playing
chmod +x install.sh
./install.sh
```

### 2. Configure Plex

1. Open your browser and go to `http://localhost:3001`
2. Click on "Configuration" (gear icon)
3. Enter your Plex server details:
   - **Server IP**: Your Plex server IP address (e.g., `192.168.1.100`)
   - **Port**: Usually `32400`
   - **Token**: Your Plex authentication token

### 3. Get Your Plex Token

To get your Plex token:
1. Open Plex Web App in your browser
2. Play any media and open browser developer tools (F12)
3. Go to Network tab and look for requests containing `X-Plex-Token`
4. Copy the token value

### 4. Optional: Last.fm Integration

For idle screen statistics:
1. Create a Last.fm API account at https://www.last.fm/api
2. Get your API Key and Secret
3. Enter them in the configuration panel
4. Enter your Last.fm username

### 5. Start the Application

```bash
npm start
```

The application will be available at `http://localhost:3001`

## 🎛 Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| **Plex Server URL** | IP address of your Plex Media Server | - |
| **Plex Port** | Plex server port | `32400` |
| **Plex Token** | Authentication token for Plex API | - |
| **Preferred User** | Specific user to display (optional) | Any user |
| **Last.fm Username** | Your Last.fm username | - |
| **Last.fm API Key** | Last.fm API key for statistics | - |
| **Controls Timeout** | How long controls stay visible | `4 seconds` |
| **Enable Last.fm Idle** | Show Last.fm stats when idle | `true` |

## 🏗 Production Deployment

### Using PM2 (Recommended)

```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2 using the ecosystem file
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### Kiosk Mode Setup

For a dedicated music display, create a kiosk setup:

```bash
# Make kiosk script executable
chmod +x kiosk.sh

# Run kiosk mode (starts browser in fullscreen)
./kiosk.sh
```

## 📱 Usage

### Main Display
- **Automatic Display**: Shows currently playing music from Plex
- **Touch/Click**: Tap screen or click to show controls
- **Controls**: Play/pause, skip tracks, switch users
- **Auto-hide**: Controls automatically hide after 4 seconds

### Idle Screen
- **Last.fm Integration**: Shows your music statistics when nothing is playing
- **Top Albums**: Displays your most played albums with artwork
- **Statistics**: Shows total plays and listening trends

### Configuration Panel
- **Access**: Click the gear icon when controls are visible
- **Settings**: Configure Plex server, Last.fm, display options
- **Password Protection**: Optionally password-protect settings
- **Test Connection**: Verify Plex server connectivity

## 🔧 Development

### Project Structure

```
now-playing/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── context/       # WebSocket context
│   │   └── main.jsx       # Entry point
│   └── dist/              # Built frontend
├── server/                 # Node.js backend
│   ├── src/
│   │   ├── routes/        # API routes
│   │   ├── services/      # Business logic
│   │   └── config/        # Configuration files
│   └── package.json
├── install.sh             # Installation script
├── kiosk.sh              # Kiosk mode script
└── ecosystem.config.js    # PM2 configuration
```

### Available Scripts

```bash
# Development
npm run dev          # Start both client and server in dev mode
npm run dev:client   # Start only React dev server
npm run dev:server   # Start only Node.js server

# Production
npm run build        # Build React app for production
npm start            # Start production server
npm run start:dev    # Start server with nodemon

# Process Management
npm run pm2:start    # Start with PM2
npm run pm2:stop     # Stop PM2 processes
npm run pm2:restart  # Restart PM2 processes
npm run pm2:logs     # View PM2 logs
```

### Environment Variables

Create a `.env` file in the server directory:

```env
PORT=3001
CLIENT_URL=http://localhost:3000
NODE_ENV=production
```

## 🐛 Troubleshooting

### Common Issues

**"Cannot connect to Plex server"**
- Verify Plex server IP and port
- Check that Plex server is running and accessible
- Ensure Plex token is correct and not expired

**"No music sessions found"**
- Make sure music is actually playing in Plex
- Check that the Plex client is actively streaming (not paused)
- Verify the user has access to the music library

**"Last.fm not working"**
- Ensure API key and secret are correct
- Verify Last.fm username exists and has scrobbling enabled
- Check that Last.fm service is accessible

**Performance Issues**
- Ensure Node.js 18+ is installed
- Check available memory on Raspberry Pi
- Consider reducing image quality or timeout values

### Logs

```bash
# View application logs
npm run logs

# View PM2 logs
pm2 logs now-playing

# View server logs only
pm2 logs now-playing-server
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Plex Media Server** for the excellent media server platform
- **Last.fm** for music statistics and scrobbling
- **React** and **Vite** for the modern frontend framework
- **Socket.IO** for real-time WebSocket communication

## 📞 Support

If you encounter any issues or have questions:
1. Check the troubleshooting section above
2. Search existing issues on GitHub
3. Create a new issue with detailed information about your setup

---

**Made with ❤️ for music lovers and Raspberry Pi enthusiasts**

![Screenshot](screenshot.png)

## ✨ Caratteristiche

- **🎵 Display Now Playing**: Mostra artwork, titolo, artista e album della traccia in riproduzione
- **📱 Touch Interface**: Tap anywhere per mostrare controlli (Play/Pause/Previous/Next)
- **👥 Multi-utente**: Supporto per switch tra utenti quando più persone ascoltano musica
- **📊 Last.fm Integration**: Schermata idle con statistiche e album recenti
- **🔄 Real-time**: Aggiornamenti WebSocket senza polling
- **📱 PWA Ready**: Installabile come Progressive Web App
- **🎨 Responsive**: Ottimizzato per schermi quadrati e di varie dimensioni
- **⚙️ Configurazione Web**: Pannello di configurazione accessibile via /config

## 🏗️ Architettura

- **Frontend**: React 18 + Vite + Socket.IO Client
- **Backend**: Node.js + Express + Socket.IO
- **Storage**: File JSON per configurazione (password con hash bcrypt)
- **Styling**: CSS moderno con Custom Properties e Grid/Flexbox

## 📋 Requisiti

- Node.js 18+
- Server Plex con API token
- (Opzionale) Account Last.fm con API key
- Raspberry Pi Zero 2 W con DietPi (consigliato)

## 🚀 Installazione

### 1. Clona il repository

```bash
git clone <repository-url>
cd now-playing
```

### 2. Installa dipendenze

```bash
npm run install:all
```

### 3. Configurazione iniziale

Avvia l'applicazione:

```bash
npm run dev
```

Naviga su `http://localhost:3000/config` per la configurazione iniziale.

### 4. Build per produzione

```bash
npm run build
```

### 5. Avvia in produzione

```bash
npm start
```

## 🔧 Configurazione Plex

1. **Ottieni il token Plex**:
   - Vai su https://www.plex.tv/claim/
   - Copia il codice claim
   - Oppure usa Plex Web > Impostazioni > Account > Mostra token XML

2. **Configura l'app**:
   - URL server (es: `192.168.1.100`)
   - Porta (default: `32400`)
   - Token Plex
   - (Opzionale) Utente preferito

## 🎵 Configurazione Last.fm

1. **Crea API Key**:
   - Vai su https://www.last.fm/api
   - Crea una nuova applicazione
   - Ottieni API Key e Shared Secret

2. **Configura nell'app**:
   - Username Last.fm
   - API Key
   - API Secret

## 📱 Setup Raspberry Pi

### DietPi Installation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Clone and setup app
git clone <repository-url> /opt/now-playing
cd /opt/now-playing
npm run install:all
npm run build

# Setup PM2
pm2 start server/src/index.js --name "now-playing"
pm2 startup
pm2 save

# Setup autostart (DietPi)
echo "pm2 start /opt/now-playing/ecosystem.config.js" >> /var/lib/dietpi/postboot.d/custom.sh
```

### Modalità Kiosk (Chromium)

```bash
# Install Chromium
sudo apt install -y chromium-browser unclutter

# Create kiosk script
sudo nano /opt/kiosk.sh
```

Contenuto del file `/opt/kiosk.sh`:

```bash
#!/bin/bash
export DISPLAY=:0
unclutter -idle 0.1 -root &
chromium-browser \
  --no-sandbox \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows \
  --disable-features=TranslateUI \
  --kiosk \
  --app=http://localhost:3001
```

```bash
# Make executable
sudo chmod +x /opt/kiosk.sh

# Add to autostart
echo "/opt/kiosk.sh &" >> /var/lib/dietpi/postboot.d/custom.sh
```

### HyperPixel 4.0 Square Setup

Segui le istruzioni ufficiali Pimoroni per il setup del display.

## ⚙️ Configurazione Avanzata

### Variabili d'ambiente

Crea un file `.env` nella cartella `server/`:

```env
PORT=3001
CLIENT_URL=http://localhost:3000
NODE_ENV=production
```

### PM2 Ecosystem

Crea `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'now-playing',
    script: 'server/src/index.js',
    cwd: '/opt/now-playing',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: '/var/log/pm2/now-playing-error.log',
    out_file: '/var/log/pm2/now-playing-out.log',
    log_file: '/var/log/pm2/now-playing.log'
  }]
}
```

## 🔐 Sicurezza

- Password di configurazione con hash bcrypt (salt rounds: 12)
- Token Plex non esposti nel client
- CORS configurato per origin specifici
- Input validation sui form

## 📊 API Endpoints

### Plex
- `GET /api/plex/now-playing` - Stato attuale
- `POST /api/plex/test-connection` - Test connessione
- `POST /api/plex/control/:action` - Controlli media

### Last.fm
- `GET /api/lastfm/idle-data` - Dati per schermata idle
- `POST /api/lastfm/test-connection` - Test connessione

### Configurazione
- `GET /api/config` - Ottieni configurazione
- `POST /api/config` - Aggiorna configurazione
- `POST /api/config/verify-password` - Verifica password

### WebSocket Events
- `nowPlaying` - Aggiornamenti stato
- `mediaControl` - Invia comandi
- `switchUser` - Cambia utente attivo

## 🎨 Customizzazione CSS

L'app usa CSS Custom Properties per easy theming:

```css
:root {
  --primary-bg: #000;
  --text-primary: #fff;
  --accent-color: #e5a00d;
  --border-radius: 12px;
  --transition-fast: 0.2s ease;
}
```

## 🐛 Troubleshooting

### Connessione Plex fallisce
- Verifica che Plex sia accessibile dalla rete
- Controlla firewall e porte
- Verifica validità del token

### WebSocket disconnessi
- Controlla proxy/firewall settings
- Verifica che il server sia raggiungibile
- Controlla i log del server

### Performance su Raspberry Pi
- Usa build di produzione
- Abilita hardware acceleration su Chromium
- Monitora usage memoria con `htop`

## 📈 Performance

- **Bundle size**: ~200KB gzipped
- **Memory usage**: ~50MB (server + client)
- **CPU usage**: <5% su RPi Zero 2W
- **Network**: WebSocket + occasional API calls

## 🤝 Contributi

Pull requests welcome! Per major changes, apri prima una issue.

## 📄 Licenza

MIT License - vedi [LICENSE](LICENSE) file per dettagli.

## 🙏 Credits

- Built with [React](https://reactjs.org/) + [Vite](https://vitejs.dev/)
- [Plex API](https://www.plex.tv/) integration
- [Last.fm API](https://www.last.fm/api) integration
- Ottimizzato per [HyperPixel 4.0 Square](https://shop.pimoroni.com/products/hyperpixel-4-square)