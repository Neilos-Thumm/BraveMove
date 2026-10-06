# BraveMove

Keyboard-driven "Move tabs to another window" for Brave on macOS. Press a
shortcut, type a number, and the selected tab(s) move to the Brave window
**named** with that number (*Window → Name Window…*). You follow them: the
target window is focused and the moved tab is active.

It works with single or multi-tab selections (⌘/⇧-click in the tab strip),
needs no Accessibility permission, and runs no background daemon. It uses
the same window names as [BraveFocus](https://github.com/Neilos-Thumm/BraveFocus), so `⌘⇧1` focuses window 1
and BraveMove moves tabs into it.

## Tech stack

| Layer | Tech |
|---|---|
| Extension | Chrome Extension **Manifest V3**: JavaScript service worker, `chrome.tabs` / `chrome.windows` / `chrome.commands` / `chrome.action` |
| Bridge | Chrome **Native Messaging** (stdio, 4-byte little-endian length-prefixed JSON) |
| Native host | **Swift** (Foundation only), `NSAppleScript` / `NSAppleEventDescriptor` |
| Window names | Brave's **AppleScript dictionary**: `window` → `given name`, `id`, `bounds`, `mode` |
| Build | `swiftc` (Xcode Command Line Tools), zsh install script |

No third-party code or tools.

## Why it's built this way

- **Extensions can't read window names.** No `chrome.windows` field
  exposes them. Brave's AppleScript dictionary does
  (`sdef "/Applications/Brave Browser.app"` → `given name`, read/write).
- **AppleScript can't see multi-tab selection** (it only has `active tab`),
  and it can't move tabs as cleanly as `chrome.tabs.move`.
- **So the work is split.** The extension handles the selection, the move
  and the focus. A tiny native host only answers "which window has which
  name".
- **The move runs in the service worker, not the popup.** Brave destroys a
  popup as soon as another window takes focus. A popup that moves and then
  focuses gets killed halfway, which is why the old `demo/` never followed
  the tabs.
- **Window ids line up.** AppleScript's window `id` and the extension's
  `windowId` are the same Chromium session id, so the join is exact. Bounds
  matching is kept as a fallback.

## How it works

```
shortcut ─► extension (service worker)
              │  sendNativeMessage {op:"list"}
              ▼
            Brave launches bravemove-host ─► AppleScript ─► Brave
              │  {windows:[{id,name,bounds,incognito}]}  (host exits)
              ▼
            match name ─► chrome.tabs.move(highlighted ids)
                       ─► chrome.tabs.update(active) ─► chrome.windows.update(focused)
```

Name matching is a port of BraveFocus's `titleMatches`. The name must
**start with the number**, and the next character must not be another
digit.

## Files

```
extension/manifest.json    MV3 manifest
extension/background.js    matching, move + follow, commands, popup messages
extension/popup.html/.js   "Move to __" number prompt (leader mode)
host/bravemove-host.swift  native host: list window names / rename a window
host/com.parun.bravemove.json  host manifest template
install.sh                 build + install host + register it with Brave
```

## Setup

### 1. Load the extension

`brave://extensions` → enable Developer mode → **Load unpacked** →
choose `extension/`. Copy the extension's **ID** (32 letters `a`–`p`).
Brave derives it from the folder's path, so it's unique to your
install. Only this folder is loaded; the host lives outside Brave.

### 2. Build and register the host

```zsh
xcode-select --install   # once, if swiftc is missing
./install.sh <extension-id>
```

The script does three things:
- compiles `bravemove-host`;
- copies it to `~/Library/Application Support/BraveMove/`;
- writes the host manifest, allowing only your extension ID, to `NativeMessagingHosts/` under
  `~/Library/Application Support/` in **BraveSoftware/Brave-Browser**,
  **Google/Chrome** and **Chromium**.

Brave doesn't always pick up its own folder and may find the host
through the Chrome/Chromium ones instead. Registering in all three covers
both cases.

### 3. Allow Automation (first use)

macOS asks: *"bravemove-host" wants access to control "Brave Browser"*.
Click **Allow**.
- The grant lets **the host control Brave**, and only Brave. Brave gets no
  new access to your Mac, and the host gets no access to anything else.
- The host only reads window id, name, bounds and mode, and sets a window
  name when it creates a window. It never reads tabs or page content and
  has no network code.
- To revoke it: System Settings → Privacy & Security → Automation.
- Rebuilding the host may trigger the prompt again, because macOS sees
  each ad-hoc-signed build as a new app.

## Usage

| Shortcut | Action |
|---|---|
| `⌥⇧M`, then digits | Opens the **Move to __** prompt, which lists your other named windows. A number moves **as soon as it's unambiguous**. If a window `12` exists, `1` waits for Enter. An unknown number + **Enter** creates a new window with that name and moves the tabs into it. Esc cancels. |
| `move-to-1` … `move-to-9` | Moves immediately, with no UI. Unbound by default (see below). |

Badges on the toolbar icon: red `∅3` means no window is named 3; red
`ERR` means the host failed (see Troubleshooting).

### Rebinding the hotkeys

1. Open `brave://extensions/shortcuts` → **BraveMove**.
2. Click the pencil next to a command and press the new keys:
   - **Move to window: type its number** opens the prompt (default `⌥⇧M`).
   - **Move tab(s) to window 1 … 9** are direct moves. A good set is
     `⌘⌥1` … `⌘⌥9`.
3. Leave the scope as **In Brave**.

Rules: a shortcut is a modifier plus a letter, digit, punctuation key or
arrow. **Enter can't be used**, and Enter isn't a modifier, so a chord
like `⌘⌥↩`+`1` can't exist. That's why there's a two-step prompt and
direct `⌘⌥N` commands instead. Avoid `⌘⌥M` (macOS "minimize all") and
`⌘⇧3/4/5` (screenshots).

### Windows whose names aren't numbers

These windows are simply **never targets**; nothing breaks.

| Window name | Reachable as |
|---|---|
| `1`, `1 work`, `1🔊` | `1` |
| `12 notes` | `12` (not `1`) |
| `work`, `work 1`, `#1` | never |
| *(no name)* | never |

- Non-number names still show in the prompt's list (e.g. `1 · 2 · work`).
  The prompt only accepts digits, so you can't pick them.
- You can still move tabs **out of** such a window, and the prompt shows
  `here: work`.
- Typing a number that doesn't exist and pressing Enter creates a new
  window. Existing windows are never renamed.
- To make a window reachable while keeping a label, put the number first:
  `3 research`.

## Day-to-day

- After editing `extension/`: click ↻ on BraveMove in `brave://extensions`.
- After editing the host: `./install.sh <id>` (you may get the Automation
  prompt again).
- Host log: `~/Library/Application Support/BraveMove/host.log`. It has one
  line per launch and one per result.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Specified native messaging host not found` and no new `host.log` line | Brave can't see the host manifest. Run `./install.sh <id>`, which registers it in all three folders. Brave re-reads manifests on every call, so no restart is needed. |
| `Access to the specified native messaging host is forbidden` | The extension ID differs from the one registered. Re-run `./install.sh <id>` with the ID shown in `brave://extensions`. |
| `Not authorized to send Apple events to Brave Browser` | The Automation grant was denied. Enable it in Privacy & Security → Automation, or remove the entry and retry to get the prompt again. |
| Prompt shows no names | No *other* window in the same (normal/private) mode has a name. |

## Caveats

1. Shortcuts only fire while Brave is focused. Use BraveFocus for global
   window focus.
2. Moving tabs out of a tab group ungroups them; that's how
   `chrome.tabs.move` behaves.
3. Private tabs only move between private windows.
4. If two windows share a name, the first match wins.
5. Moving this folder changes the extension ID (it's derived from the
   path). Reload the extension, then re-run `./install.sh <new-id>`.

## Uninstall

```zsh
rm -rf ~/Library/Application\ Support/BraveMove
rm -f ~/Library/Application\ Support/{BraveSoftware/Brave-Browser,Google/Chrome,Chromium}/NativeMessagingHosts/com.parun.bravemove.json
```

Then remove the extension in `brave://extensions` and the
**bravemove-host** entry under Privacy & Security → Automation.
