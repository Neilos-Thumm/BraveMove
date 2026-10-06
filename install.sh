#!/bin/zsh
# Build the native host, install it to ~/Library/Application Support/BraveMove,
# and register it with Brave for your extension ID (from brave://extensions).
# Re-run after editing the host source or if the extension ID changes.
set -euo pipefail
cd "${0:A:h}"

id="${1:?usage: ./install.sh <extension-id from brave://extensions>}"
[[ "$id" =~ ^[a-p]{32}$ ]] || { echo "Not an extension ID: $id" >&2; exit 1; }

swiftc host/bravemove-host.swift -o host/bravemove-host

bin="$HOME/Library/Application Support/BraveMove"
mkdir -p "$bin"
cp host/bravemove-host "$bin/bravemove-host"

# Brave doesn't always pick up its own folder; it may find the host in the
# Chrome/Chromium ones instead. Register in all three.
for dir in "$HOME/Library/Application Support/"{BraveSoftware/Brave-Browser,Google/Chrome,Chromium}/NativeMessagingHosts; do
  mkdir -p "$dir"
  sed -e "s|__HOST_PATH__|$bin/bravemove-host|" -e "s|__EXTENSION_ID__|$id|" host/com.parun.bravemove.json \
    > "$dir/com.parun.bravemove.json"
  echo "Host registered: $dir/com.parun.bravemove.json"
done
echo "Registered for extension $id. Reload BraveMove in brave://extensions if it was already open."
