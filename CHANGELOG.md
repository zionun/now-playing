# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Work towards v1.0.0 (roadmap phases 4–6).

### Added

- `GET /api/health` and a discreet on-screen status indicator for Plex, real-time updates
  and Last.fm.
- Player discovery without nmap: the Plex server's clients, plex.tv player resources, GDM
  (UDP 32412) and the addresses of players in local sessions.
- Playback commands sent through the Plex server, with a direct fallback to the player.
- Display settings (controls duration, Last.fm when idle) now applied by the kiosk.
- Unit and integration tests with Vitest (server logic, full setup flow against a simulated
  Plex, key React components), ESLint and Prettier, CI on GitHub Actions.
- Release workflow creating GitHub releases from this changelog.
- Acceptance test scripts for the device (`scripts/pi/`): 72-hour soak monitor with a
  pass/fail report, recovery test after a Plex restart or a Wi-Fi drop.
- Screen sleep: with nothing playing the screen turns off after a configurable time
  (default 5 minutes, or always on); a tap (which never presses what is underneath),
  music starting, a settings change or a change in the health state turn it back on.
  Only on a HyperPixel 4.0 Square, detected at startup (`HYPERPIXEL=1`/`0` to force).
- `scripts/pi/boot-config.sh` sets `config.txt` options in place (no duplicates, commented
  lines enabled, backup kept), used by the guide for the HyperPixel and the tuning.
- Pinch-to-zoom is disabled everywhere (kiosk and phone pages).
- Interface in English and Italian, with a language setting (automatic = device language);
  API errors carry codes translated by the interface.

### Changed

- The server is split into modules with an explicit screen state machine (setup, login,
  idle, playing, paused, resume); `index.js` is only the bootstrap.
- Plex real-time connection with exponential backoff (capped at 20 s, so the app recovers
  within a minute of Plex coming back); polling only while it is down.
- Leveled logs (`LOG_LEVEL`), pm2-logrotate, PM2 memory limits for the Pi Zero 2 W.
- Configuration stored outside the repository (`/var/lib/now-playing/config.json`),
  permissions 600, atomic writes; the old `server/src/config/app.json` is moved
  automatically.
- `install.sh` and `update.sh` fail fast, verify each step and install only what production
  needs (`bcryptjs` replaces `bcrypt`, no compilers needed).
- Playback controls are shown only when the player really accepts commands.
- README split into a quick start and a complete guide (`docs/GUIDE.md`).
- Code, comments and logs are in English.
- The on-screen controls stay open after a command (pause then play, several skips) and
  their countdown restarts.
- Guide: 16 GB SD card is enough; HyperPixel setup is its own required step; options go
  to `/boot/firmware/config.txt`; DietPi's GPU memory split is kept; the non-existent
  `disable-wifi-poweroff` overlay is dropped.

### Removed

- nmap-based discovery and shell commands.
- Unused Socket.IO events and the unauthenticated `/api/sessions` and `/api/discover`
  endpoints.

### Fixed

- The screen did not update after startup until a network scan finished.
- An unreadable configuration file was silently replaced by an empty one.
- A tap on the kiosk sometimes didn't open the controls, or opened and closed them at
  once (worse while paused): every kiosk control now reacts to a single pointerdown, and
  browser gestures are off on the kiosk screens, so a tap is never cancelled.
- No more zoom effect on the cover art (and other hover effects) after a tap: smoother
  on the Pi Zero 2 W.

## [0.9.0] - 2026-09-29

First pre-release (roadmap phases 0–3).

### Added

- Device setup from the phone: the kiosk shows a QR code, the phone guides through device
  password, Plex login (PIN flow, no token to copy) and optional Last.fm.
- Settings from the phone (⚙︎ on the kiosk), protected by the device password; "forgot
  password" through the Plex account that set up the device; device reset.
- The device stays bound to the Plex account used during setup.
- Session filters: home network only, selected users, selected players; applied without a
  restart.

### Security

- Secrets removed from the repository; the Plex token never reaches the browser (album art
  is proxied) nor the logs.
- A revoked or expired Plex token brings the kiosk back to the setup QR code.

### Fixed

- A reachable Plex connection is picked after login (plex.tv may advertise unreachable local
  addresses, e.g. Plex running in Docker).

[Unreleased]: https://github.com/zionun/now-playing/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/zionun/now-playing/releases/tag/v0.9.0
