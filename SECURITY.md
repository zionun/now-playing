# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately
through GitHub: *Security* tab → *Report a vulnerability*.

Include what is affected, how to reproduce it and, if you can, a suggested fix. You
will get an answer within a week; once a fix is released the report can be made
public, with credit if you wish.

## Supported versions

Only the latest release receives security fixes.

## Scope

Now Playing runs on your home network. Particularly relevant:

- the Plex token and the Last.fm keys (they must never reach the browser or the logs)
- the device password and the settings it protects
- the endpoints the kiosk and the phone use (`/api/...`) and the Socket.IO events
- the install and update scripts, which run as root on the Raspberry Pi
