# Now Playing - Plex Music Display

A touch-friendly "now playing" display for your Plex music. Built for a Raspberry Pi with a HyperPixel 4.0 Square screen (720×720), it works on any device with a browser.

- **Real-time display** of the track, artist, album and artwork playing on Plex
- **Playback controls** (play/pause, previous, next) when the player accepts remote commands
- **Idle screen** with your Last.fm statistics and most played albums
- **Setup from your phone**: scan a QR code, choose a password, log in to Plex, done — no tokens to copy
- **Filters**: show only players on your home network, only some users or only some players
- **Kiosk ready**: starts at boot, updates itself with one command, keeps logs small for the SD card

## Quick start

Requirements: a Plex Media Server with a music library and a Raspberry Pi (tested on Pi Zero 2 W) running DietPi or Raspberry Pi OS with Git installed. Node.js 20 is installed automatically if missing.

```bash
git clone https://github.com/zionun/now-playing.git
cd now-playing
sudo ./install.sh
```

The installer copies the app to `/opt/now-playing`, installs only what production needs, builds the interface and starts it with PM2 at boot.

Then:

1. **Open the screen** — in kiosk mode (see [Kiosk mode](docs/GUIDE.md#7-kiosk-mode)) or at `http://<raspberry-ip>:3001`.
2. **Scan the QR code** shown on the screen with your phone (same Wi-Fi network).
3. **Follow the three steps** on the phone:
   1. choose the device password
   2. log in to Plex (your account, then the server if you have more than one)
   3. optionally, enter your Last.fm username and [API key](https://www.last.fm/api/account/create)

That's it: play something on Plex and it appears on the screen.

## Everyday use

| Action | How |
|--------|-----|
| Show the controls | Tap the screen while music is playing |
| Change settings | Tap **⚙︎** in the top-right corner and scan the QR code (password required) |
| Forgot the password | On the settings page, tap *Forgot password?* and log in to Plex with the account used during setup |
| Check the status | A small dot in the bottom-left corner appears only when something is wrong (tap it for details), or open `http://<raspberry-ip>:3001/api/health` |
| Update | `cd /opt/now-playing && sudo ./update.sh` |

The settings page (on your phone) lets you reconnect Plex or change server, link or unlink Last.fm, set filters (home network only, users, players), change display options and the password, or reset the device.

## Where things are

| What | Where |
|------|-------|
| Application | `/opt/now-playing` |
| Configuration (password, Plex, Last.fm, filters) | `/var/lib/now-playing/config.json` — outside the repository, permissions 600 |
| Logs | `pm2 logs now-playing` (files in `/var/log/pm2/`, rotated automatically) |

## Documentation

The **[complete guide](docs/GUIDE.md)** covers everything else:

- [Recommended hardware](docs/GUIDE.md#1-recommended-hardware)
- [Raspberry Pi from scratch with DietPi](docs/GUIDE.md#2-flash-dietpi) (or [Raspberry Pi OS](docs/GUIDE.md#raspberry-pi-os-alternative))
- [Kiosk mode](docs/GUIDE.md#7-kiosk-mode), [HyperPixel 4.0 Square](docs/GUIDE.md#5-hyperpixel-40-square) and [performance tuning](docs/GUIDE.md#6-performance-tuning-optional)
- [Configuration reference](docs/GUIDE.md#configuration-reference), [updates](docs/GUIDE.md#updating) and [backup](docs/GUIDE.md#backup-and-restore)
- [Troubleshooting](docs/GUIDE.md#troubleshooting)
- [Development](docs/GUIDE.md#development)

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
