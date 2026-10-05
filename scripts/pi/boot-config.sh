#!/bin/bash
# Sets options in the Raspberry Pi config.txt without duplicating them:
# an option already there (also commented out) is changed in place,
# otherwise it is added at the end. A backup is kept as config.txt.bak.
#
# Usage:
#   sudo /opt/now-playing/scripts/pi/boot-config.sh arm_freq=1200 dtoverlay=disable-bt
# - key=value: replaces the value of key (gpu_mem_512=64, arm_freq=1200, ...)
# - dtoverlay=name[,params] / dtparam=name[=value]: enables that overlay or
#   parameter; an existing line for the same name is uncommented, keeping
#   its params unless new ones are given
# New lines go under an [all] section, so a filter such as [pi4] earlier in
# the file can't restrict them.
# Options (environment variables):
#   BOOT_CONFIG=/boot/firmware/config.txt   file to change (default: the
#                                           first of /boot/firmware/config.txt
#                                           and /boot/config.txt that exists)

set -euo pipefail

if [ -n "${BOOT_CONFIG:-}" ]; then
    CONFIG="$BOOT_CONFIG"
elif [ -f /boot/firmware/config.txt ]; then
    CONFIG=/boot/firmware/config.txt
else
    CONFIG=/boot/config.txt
fi
[ -f "$CONFIG" ] || { echo "config.txt not found ($CONFIG)"; exit 1; }
[ $# -gt 0 ] || { echo "Usage: $0 key=value ..."; exit 1; }

cp "$CONFIG" "$CONFIG.bak"

# Escapes a string for a basic regular expression
escape() { printf '%s' "$1" | sed 's/[][\.*^$/]/\\&/g'; }

for option in "$@"; do
    case "$option" in
        *=*) ;;
        *) echo "Not key=value: $option"; exit 1 ;;
    esac
    key="${option%%=*}"
    value="${option#*=}"

    case "$key" in
        dtoverlay | dtparam)
            # Same line = same overlay/parameter name, whatever its params
            name="${value%%[,=]*}"
            pattern="^[[:space:]]*#*[[:space:]]*$(escape "$key")=$(escape "$name")([,=].*)?[[:space:]]*$"
            ;;
        *)
            pattern="^[[:space:]]*#*[[:space:]]*$(escape "$key")=.*$"
            ;;
    esac

    if grep -Eq "^[[:space:]]*$(escape "$option")[[:space:]]*$" "$CONFIG"; then
        echo "  unchanged  $option"
    elif grep -Eq "$pattern" "$CONFIG"; then
        # Changed in place (first match); further copies are removed. An
        # overlay given without params keeps those of the existing line.
        keep=0
        case "$key" in dtoverlay | dtparam) [ "$value" = "${value%%[,=]*}" ] && keep=1 ;; esac
        tmp=$(mktemp)
        awk -v re="$pattern" -v line="$option" -v keep="$keep" '
            $0 ~ re {
                if (!done) {
                    if (keep == 1) { sub(/^[[:space:]]*#*[[:space:]]*/, ""); sub(/[[:space:]]*$/, ""); print }
                    else print line
                    done = 1
                }
                next
            }
            { print }' "$CONFIG" >"$tmp"
        cat "$tmp" >"$CONFIG"
        rm -f "$tmp"
        echo "  set        $(grep -E "^$(escape "$key")=$(escape "${value%%[,=]*}")" "$CONFIG" | head -1 || echo "$option")"
    else
        last_section=$(grep -E '^[[:space:]]*\[' "$CONFIG" | tail -1 | tr -d '[:space:]' || true)
        if [ -n "$last_section" ] && [ "$last_section" != "[all]" ]; then
            printf '\n[all]\n' >>"$CONFIG"
        fi
        printf '%s\n' "$option" >>"$CONFIG"
        echo "  added      $option"
    fi
done

echo "Updated $CONFIG (backup: $CONFIG.bak). Reboot to apply."
