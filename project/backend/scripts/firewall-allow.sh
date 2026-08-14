#!/usr/bin/env sh
# scripts/firewall-allow.sh [--global] <binary-path>
#
# Default: idempotently add the binary path to the macOS per-app firewall
# allow list.
#
# --global: also `socketfilterfw --setglobalstate off`. This is the only
# setting that observably lets unsigned locally-built Go binaries accept
# non-loopback traffic on macOS — per-app rules alone get a "permitted"
# readback yet connections are still silently dropped.

set -eu

case "$(uname -s)" in
  Darwin) : ;;
  *) echo "[fw] non-macOS ($(uname -s)): skip"; exit 0 ;;
esac

mode="per-binary"
case "${1:-}" in
  --global) mode="global"; shift ;;
esac

raw="${1:?usage: firewall-allow.sh [--global] <binary-path>}"
case "$raw" in
  /*) bin="$raw" ;;
  *)  bin="$(cd "$(dirname -- "$raw")" 2>/dev/null && pwd)/$(basename -- "$raw")" ;;
esac
[ -x "$bin" ] || { printf '[fw] %s is missing or not executable\n' "$bin" >&2; exit 1; }

FW=/usr/libexec/ApplicationFirewall/socketfilterfw

has_rule() {
  "$FW" --listapps 2>/dev/null \
    | awk -v p="$bin" '
        /^[[:space:]]*[0-9]+[[:space:]]*:[[:space:]]*/ {
          line = $0
          sub(/^[[:space:]]*[0-9]+[[:space:]]*:[[:space:]]*/, "", line)
          sub(/[[:space:]]+$/, "", line)
          if (line == p) { found = 1; exit }
        }
        END { exit (found ? 0 : 1) }
      '
}

if has_rule; then
  echo "[fw] per-app allow rule already present: $bin"
else
  echo "[fw] adding per-app allow rule for $bin (sudo may prompt)..."
  sudo "$FW" --add "$bin" || { echo "[fw] sudo --add failed" >&2; exit 1; }
  sudo "$FW" --unblock "$bin" || true
  has_rule || { echo "[fw] rule add did not take effect — aborting" >&2; exit 1; }
  echo "[fw] per-app allow rule added: $bin"
fi

if [ "$mode" = "global" ]; then
  state=$("$FW" --getglobalstate 2>/dev/null || echo "?")
  if printf '%s' "$state" | grep -qi disabled; then
    echo "[fw] global firewall already off"
  else
    echo "[fw] disabling macOS firewall globally — this is the only mode that lets unsigned Go binaries accept LAN traffic on this machine"
    sudo "$FW" --setglobalstate off
    echo "[fw] global firewall is now OFF. Re-enable via System Settings → Network → Firewall."
  fi
fi
