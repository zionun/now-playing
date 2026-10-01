# Now Playing — Complete Guide

This guide covers a Raspberry Pi set up from scratch, kiosk mode, configuration, updates, backup, troubleshooting and development. For the short version see the [README](../README.md).

**Contents**

1. [Recommended hardware](#1-recommended-hardware)
2. [Flash DietPi](#2-flash-dietpi)
3. [First boot](#3-first-boot)
4. [Performance tuning (optional)](#4-performance-tuning-optional)
5. [Install Now Playing](#5-install-now-playing)
6. [Kiosk mode](#6-kiosk-mode)
7. [First setup from your phone](#7-first-setup-from-your-phone)
- [Raspberry Pi OS (alternative)](#raspberry-pi-os-alternative)
- [Configuration reference](#configuration-reference)
- [Updating](#updating)
- [Backup and restore](#backup-and-restore)
- [Troubleshooting](#troubleshooting)
- [v1.0 acceptance tests](#v10-acceptance-tests)
- [Development](#development)

---

## 1. Recommended hardware

**Essential**
- **Raspberry Pi Zero 2 W** — good balance between performance and power consumption
- **MicroSD card** — SanDisk Extreme 32 GB+ (Class 10, U3): fast I/O matters for a smooth UI
- **Power supply** — 5 V / 2.5 A (stable power means stable performance)

**Display**
- **HyperPixel 4.0 Square** — 720×720 capacitive touchscreen, the size the interface is designed for
- Any HDMI display (with a mouse for interaction)
- Waveshare 7" DSI display as an alternative touchscreen

**Optional**: HyperPixel case, heat sink (recommended if overclocking), USB OTG hub for setup.

**Why DietPi** (measured on a Pi Zero 2 W with HyperPixel 4.0 Square):

| Metric | DietPi | Pi OS Lite |
|--------|--------|------------|
| Boot time | ~15 s | ~25 s |
| RAM usage (idle) | ~80 MB | ~150 MB |
| Storage used | ~400 MB | ~1.2 GB |
| App startup time | ~8 s | ~15 s |

Raspberry Pi OS works too: see [Raspberry Pi OS (alternative)](#raspberry-pi-os-alternative).

## 2. Flash DietPi

1. **Download** [DietPi](https://dietpi.com/#download) — *DietPi ARMv8 64-bit* for the Pi Zero 2 W — and extract the `.img` file.
2. **Flash** it to the microSD card with [balenaEtcher](https://www.balena.io/etcher/). Don't eject the card yet.
3. **Configure the headless setup** on the boot partition.

   `dietpi.txt`:
   ```bash
   AUTO_SETUP_AUTOMATED=1

   # Wi-Fi
   AUTO_SETUP_NET_WIFI_ENABLED=1
   AUTO_SETUP_NET_WIFI_COUNTRY_CODE=IT     # your country code

   # System
   AUTO_SETUP_NET_HOSTNAME=nowplaying
   AUTO_SETUP_GLOBAL_PASSWORD=YOUR_SECURE_PASSWORD   # change this!
   AUTO_SETUP_TIMEZONE=Europe/Rome         # your timezone
   AUTO_SETUP_LOCALE=en_GB.UTF-8

   # SSH (OpenSSH)
   AUTO_SETUP_SSH_SERVER_INDEX=-2

   # Node.js (9), Git (17), Chromium (113)
   AUTO_SETUP_INSTALL_SOFTWARE_ID=9 17 113

   # Chromium resolution
   SOFTWARE_CHROMIUM_RES_X=720
   SOFTWARE_CHROMIUM_RES_Y=720
   ```

   `dietpi-wifi.txt`:
   ```bash
   aWIFI_SSID[0]='YOUR_WIFI_NAME'
   aWIFI_KEY[0]='YOUR_WIFI_PASSWORD'
   ```
   No spaces around `=`, single quotes around name and password. The Pi Zero only supports 2.4 GHz networks.

4. **Eject** the card and put it in the Raspberry Pi.

## 3. First boot

1. **Power on and wait** 5–10 minutes: DietPi resizes the filesystem, connects to Wi-Fi, updates the system and installs Node.js, Git and Chromium.
2. **Find the IP address** in your router's admin panel (device `nowplaying`), or from a computer on the same network:
   ```bash
   nmap -sn 192.168.1.0/24 | grep -A2 "nowplaying\|Raspberry"
   ```
3. **Connect via SSH** with the password set in `dietpi.txt`:
   ```bash
   ssh root@192.168.1.XXX
   ```
4. **Install the X server** used by the kiosk (Chromium is already installed):
   ```bash
   apt install -y xserver-xorg xinit
   chromium --version
   ```
5. **CPU governor**: `dietpi-config` → *Performance Options* → *CPU Governor* → `performance`.

## 4. Performance tuning (optional)

```bash
echo "
# Performance optimizations for Now Playing
arm_freq=1200
gpu_freq=400
gpu_mem=128
over_voltage=2

# Disable unused hardware
dtparam=audio=off
dtparam=spi=off
dtparam=i2c=off

# Network
dtoverlay=disable-bt
dtoverlay=disable-wifi-poweroff

# HyperPixel 4.0 Square (comment out if not used)
dtoverlay=vc4-kms-dpi-hyperpixel4sq
" | sudo tee -a /boot/config.txt

# Temporary files in RAM (fewer SD card writes)
echo "tmpfs /tmp tmpfs defaults,noatime,nosuid,size=100m 0 0" | sudo tee -a /etc/fstab

# Disable unused services
sudo systemctl disable avahi-daemon
sudo systemctl disable triggerhappy

sudo reboot
```

## 5. Install Now Playing

```bash
git clone https://github.com/zionun/now-playing.git
cd now-playing
sudo ./install.sh
```

The installer:

- installs only the missing system packages (`git`, `curl`, `ca-certificates`, `xdotool` for the kiosk watchdog), without extras and without compilers
- installs Node.js 20 LTS if the current version is older
- installs PM2 and **pm2-logrotate** (5 MB files, 3 kept, compressed)
- copies the app to `/opt/now-playing` (the cloned folder can then be removed)
- installs the server dependencies (production only), builds the interface and removes the build tools
- starts the app with PM2 at boot and checks that it answers on port 3001

Every step is checked: if something fails, the script stops and tells you what went wrong.

## 6. Kiosk mode

With DietPi:

```bash
sudo dietpi-autostart
# → 17: Custom script (foreground, with autologin), user root

sudo cp /opt/now-playing/start-kiosk.sh /var/lib/dietpi/dietpi-autostart/custom.sh
sudo chmod +x /var/lib/dietpi/dietpi-autostart/custom.sh
sudo reboot
```

`start-kiosk.sh` starts X without a cursor and runs `kiosk.sh`, which waits for the server, opens Chromium full screen on `http://localhost:3001` and reloads the page if it gets stuck. Chromium's translation prompt is disabled by the installer.

## 7. First setup from your phone

The first time, the screen shows a **"Set up the device"** QR code. Scan it with your phone, on the same Wi-Fi network:

1. **Password** — protects the settings from now on
2. **Plex** — tap *Log in with Plex*, sign in on plex.tv and you are brought back to the setup; if your account has more than one server, choose one. The device stays bound to this Plex account.
3. **Last.fm** (optional) — username and [API key](https://www.last.fm/api/account/create), checked with Last.fm before saving

The screen switches to the display as soon as the setup is complete.

**Later changes**: tap **⚙︎** in the top-right corner of the screen and scan the QR code. The settings always ask for the password. If you forget it, tap *Forgot password?* and log in to Plex with the same account used during setup.

**Reset device** (at the bottom of the settings page, password required) erases the whole configuration — including the bound Plex account — and brings the screen back to the initial setup.

## Raspberry Pi OS (alternative)

<details>
<summary>Raspberry Pi OS Lite instructions</summary>

```bash
# Flash Raspberry Pi OS Lite 64-bit with Raspberry Pi Imager,
# configuring SSH, Wi-Fi and the user account in the imager.

ssh pi@YOUR_PI_IP
sudo apt update && sudo apt upgrade -y

# Display packages and Chromium
sudo apt install -y xserver-xorg xinit chromium

# HyperPixel (if used)
curl https://get.pimoroni.com/hyperpixel4 | bash
sudo reboot

# Install the app
git clone https://github.com/zionun/now-playing.git
cd now-playing
sudo ./install.sh

# Autologin: sudo raspi-config → System Options → Boot → Console Autologin,
# then start /opt/now-playing/start-kiosk.sh at login (e.g. from ~/.bash_profile).
```
</details>

## Configuration reference

All settings are made from the phone (see [First setup](#7-first-setup-from-your-phone)) and saved in:

```
/var/lib/now-playing/config.json      (server running as root, e.g. on the Raspberry)
~/.config/now-playing/config.json     (server running as a normal user, e.g. development)
```

The file is outside the repository, so updates never touch it and secrets never end up in git. It has permissions 600 and is written atomically (a power cut during a save cannot corrupt it). If it ever becomes unreadable, it is moved aside as `config.json.broken-<timestamp>` instead of being overwritten. A configuration left by older versions in `server/src/config/app.json` is moved automatically at the first start.

| Setting | Where | Default |
|---------|-------|---------|
| Device password | Setup, then *Settings → Device password* | — |
| Plex server and account | Setup (Plex login), then *Settings → Plex* | — |
| Manual Plex server (address, port, token) | *Settings → Advanced* | — |
| Last.fm username and API key | Setup, then *Settings → Last.fm* | — |
| Filters: home network only / users / players | *Settings → Filters* | all |
| Language (automatic, English, Italian) | *Settings → Screen* | automatic |
| On-screen controls duration | *Settings → Screen* | 4 s |
| Last.fm data when idle | *Settings → Screen* | on |
| Screen always on | *Settings → Screen* | off |
| Turn the screen off after (minutes with nothing playing) | *Settings → Screen* | 5 |

### Screen sleep

With nothing playing, the screen turns off after the configured minutes (unless *Screen always on* is set). It turns back on when music starts, when the screen is tapped (that first tap only wakes it: it never presses the button underneath), when the settings are saved from the phone, when the health state changes (e.g. Plex unreachable or back online, so the problem is visible), and when the app starts or stops, so it is never left off.

The backlight is switched off through `/sys/class/backlight/backlight/brightness`. Another backlight device can be set with `BACKLIGHT_PATH`.

Screen sleep is only available on a **HyperPixel 4.0 Square**: on other displays the screen stays on and the two settings are not shown on the phone. The display is detected at startup; the driver (`dtoverlay=vc4-kms-dpi-hyperpixel4sq`) creates both of these, and both must be there:

- a DPI video output with a 720x720 mode (`/sys/class/drm/cardN-DPI-N/modes`);
- the backlight device `/sys/class/backlight/backlight`.

The result is in the startup log (`Screen sleep available|not available: HyperPixel 4.0 Square found|not found (...)`) and in `/api/health` (`display.sleepAvailable`). To check by hand:

```bash
ls /sys/class/drm /sys/class/backlight
cat /sys/class/drm/card*-DPI-*/modes
```

`HYPERPIXEL=1` or `HYPERPIXEL=0` forces the result.

### Environment variables

Optional, in `server/.env` or in `ecosystem.config.cjs`:

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | Server port | `3001` |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |
| `NOW_PLAYING_CONFIG` | Path of the configuration file | see above |
| `LASTFM_API_KEY` | Last.fm API key, if not set from the phone | — |
| `PLEX_SERVER_URL`, `PLEX_TOKEN` | Override the Plex connection (debugging) | — |
| `CLIENT_URL` | Development client origin | `http://localhost:3000` |
| `BACKLIGHT_PATH` | Backlight device for screen sleep | first in `/sys/class/backlight` |
| `HYPERPIXEL` | `1`/`0`: force HyperPixel Square detection (screen sleep) | detected |

### PM2

`ecosystem.config.cjs` is tuned for a Pi Zero 2 W (512 MB shared with Chromium): the server normally uses 80–90 MB, the V8 heap is capped at 128 MB and PM2 restarts the process above 200 MB. Crashes are restarted with an increasing delay; after 10 restarts within 30 seconds of starting, PM2 gives up instead of looping.

## Updating

```bash
cd /opt/now-playing
sudo ./update.sh
```

The update script downloads the latest version, installs the dependencies, rebuilds the interface, checks log rotation and reloads the app, then verifies that the server answers. The app keeps running until the final reload, and the configuration is not touched (it lives outside the repository).

## Backup and restore

The only file to back up is the configuration:

```bash
# Backup (on the Raspberry)
sudo cp /var/lib/now-playing/config.json ~/now-playing-config.backup.json

# Restore
sudo install -m 600 ~/now-playing-config.backup.json /var/lib/now-playing/config.json
pm2 restart now-playing
```

The backup contains the Plex token and the device password hash: keep it private.

For a full SD card image (on your computer): `sudo dd if=/dev/sdX of=now-playing.img bs=4M status=progress`.

## Troubleshooting

### Check the status first

```bash
pm2 status
pm2 logs now-playing --lines 50
curl -s localhost:3001/api/health
```

`/api/health` tells you whether Plex is reachable, whether updates arrive in real time or by polling, whether Last.fm answers, and which players are known and controllable. On the screen, a small dot in the bottom-left corner appears only when something is wrong (orange: degraded, red: error); tap it for details. For more detail in the logs, set `LOG_LEVEL: 'debug'` in `ecosystem.config.cjs` and run `pm2 restart now-playing --update-env`.

### Common problems

**The screen shows the setup QR code but the phone can't open it**
The phone must be on the same Wi-Fi network as the Raspberry Pi. The address in the QR code is the Raspberry's local IP.

**"Plex not reachable" (red dot)**
Check that the Plex server is on and reachable from the Raspberry. If you changed network or server, open the settings and use *Reconnect Plex or change server*.

**Music is playing but nothing appears**
Only music sessions are shown. Check the filters in the settings (home network only, users, players): filtered sessions never appear.

**The controls don't appear**
Controls are shown only when the player really accepts remote commands (through the Plex server or directly). Check `players` in `/api/health`: `controllable` should be `true`. After a failed command, the controls of that player are hidden for 10 minutes.

**Last.fm not working**
Check the username and API key in the settings; the orange dot says whether Last.fm is unreachable.

**The app does not start after an update** (`Cannot find package …`)
Run `sudo ./update.sh` again from `/opt/now-playing`: it reinstalls the dependencies and stops with a clear message if something fails.

### Raspberry Pi

**Sluggish interface**
```bash
htop
vcgencmd get_mem gpu        # gpu=128M
vcgencmd measure_clock arm  # 1200000000
cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor   # performance
```

**Chromium crashes or freezes** — increase swap:
```bash
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile    # CONF_SWAPSIZE=512
sudo dphys-swapfile setup && sudo dphys-swapfile swapon
```

**Kiosk not starting**
```bash
sudo dietpi-autostart   # must be "17: Custom script (foreground, with autologin)"
ls -la /var/lib/dietpi/dietpi-autostart/custom.sh
which chromium || sudo dietpi-software install 113
```

**DietPi doesn't connect to Wi-Fi** — check `dietpi-wifi.txt` (quotes, no spaces around `=`, 2.4 GHz network, country code), or configure it with `dietpi-config` → *Network Options: Adapters*.

**First boot setup failed**
```bash
cat /var/tmp/dietpi/logs/dietpi-firstrun-setup.log
sudo dietpi-software install 9 17 113   # Node.js, Git, Chromium
```

**No display / touch not working** — for HDMI try `hdmi_force_hotplug=1` in `/boot/config.txt`; for the HyperPixel make sure its installer completed and the overlay is in `/boot/config.txt`.

## v1.0 acceptance tests

Tests to run on the real device before releasing v1.0 (scripts in `/opt/now-playing/scripts/pi/`).

**72 hours without restarts or memory growth**

```bash
# start (keeps running after you log out; one sample every 5 minutes for 72 hours)
sudo nohup /opt/now-playing/scripts/pi/soak-monitor.sh > /dev/null 2>&1 &

# at any time, and at the end
node /opt/now-playing/scripts/pi/soak-report.mjs
```

The report checks the duration (at least 72 hours), PM2 restarts (none) and the memory trend after the first hour (at most 2 MB per day), and lists free system memory, CPU temperature and any period in which `/api/health` was not "ok". The samples are in `/var/lib/now-playing/soak.csv` (not in `/var/log`, which DietPi keeps in RAM, empties every hour and loses on reboot); a gap of more than 30 minutes between samples fails the test.

**Recovery within a minute**

```bash
cd /opt/now-playing/scripts/pi
sudo ./recovery-test.sh status      # app and Plex state now
sudo ./recovery-test.sh plex        # then restart the Plex server
sudo ./recovery-test.sh wifi 60     # Wi-Fi off for 60 s, then back on
```

`plex` detects the outage by itself and measures how long the app takes to be back to normal (health "ok", real-time updates) once Plex answers again. `wifi` turns the Wi-Fi off and on by itself: the SSH connection drops, the test keeps running and writes the result to `/var/log/now-playing-recovery.log` (`tail` it after reconnecting). Both end with `RESULT: PASS` or `RESULT: FAIL`.

**Install from scratch**: on a freshly flashed SD card follow [steps 2–7](#2-flash-dietpi) without editing any file by hand.

**CI**: the last commit on `main` must be green on GitHub Actions.

## Development

```bash
git clone https://github.com/zionun/now-playing.git
cd now-playing
npm run install:all
npm run dev          # server (nodemon, port 3001) + client (Vite, port 3000)
```

In development the configuration is saved in `~/.config/now-playing/config.json`. The pages opened from the phone are served by the server on port 3001 from the built interface, so run `npm run build` after changing the client if you test them from a phone.

| Command | What it does |
|---------|--------------|
| `npm run dev` | Server and client in development mode |
| `npm run dev:server` / `npm run dev:client` | Only one of the two |
| `npm run build` | Builds the interface into `client/dist` |
| `npm start` | Starts the server in production mode |

In `server/` and `client/`:

| Command | What it does |
|---------|--------------|
| `npm test` | Tests (Vitest); `npm run test:watch` while developing |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Prettier (write / check) |

Every pull request and every push to `main` runs lint, format check, tests and the client build on GitHub Actions (`.github/workflows/ci.yml`).

### Project structure

```
now-playing/
├── client/                    React + Vite interface
│   └── src/
│       ├── components/        Kiosk screens (display, idle, overlay, QR codes)
│       │   └── phone/         Pages opened from the phone (setup, settings)
│       └── context/           Socket.IO connection
├── server/
│   ├── src/
│   │   ├── index.js           Bootstrap only
│   │   ├── app/               NowPlayingService: timers, state, coordination
│   │   ├── core/              Pure logic: session analysis, screen state machine
│   │   ├── plex/              Plex HTTP client, real-time events, players, playback
│   │   ├── routes/            REST API (auth/setup, config, Plex, Last.fm, health)
│   │   ├── realtime/          Socket.IO handlers
│   │   ├── services/          Configuration, Last.fm, Plex login, setup, filters
│   │   └── lib/               Logger, backoff
│   └── test/                  Tests (Vitest)
├── docs/GUIDE.md              This guide
├── .github/workflows/         CI and releases
├── CHANGELOG.md               Version history
├── install.sh / update.sh     Raspberry Pi installation and updates
├── kiosk.sh / start-kiosk.sh  Kiosk mode
└── ecosystem.config.cjs       PM2 configuration
```

### Languages

Code, comments and logs are in English. The interface text lives in `client/src/i18n/messages.js` (English and Italian); components get it with `const t = useT()` and `t('section.key', { name: value })`. The language comes from *Settings → Screen*: *Automatic* follows each device's own language (the kiosk and the phone can differ; on the kiosk it is Chromium's `--lang` in `kiosk.sh`).

API errors carry a stable `code` (and `params`), created with `AppError` / `sendError` in `server/src/lib/errors.js`; the interface translates them with `errorText(t, error)` from `errors.<code>`.

To add a language, copy the `en` block in `messages.js` under a new language code and translate it: a test checks that every language has exactly the same keys.

### Releasing

Versions follow [SemVer](https://semver.org/) and every change is listed in [CHANGELOG.md](../CHANGELOG.md).

1. Move the `[Unreleased]` entries of `CHANGELOG.md` under a new `## [x.y.z] - YYYY-MM-DD` heading and update the links at the bottom.
2. Set the version in the three `package.json` files:
   ```bash
   for d in . client server; do (cd $d && npm version x.y.z --no-git-tag-version); done
   ```
3. Commit, then tag and push:
   ```bash
   git tag -a vx.y.z -m "vx.y.z"
   git push origin main vx.y.z
   ```

Pushing the tag runs `.github/workflows/release.yml`, which creates the GitHub release with the text of that version's CHANGELOG section (`0.x` and `-rc` versions are marked as pre-releases). For a tag created on an older commit, run the workflow by hand from *Actions → Release → Run workflow*.

Contributions are welcome: fork the repository, create a branch, commit and open a pull request.
