// All moving happens here, in the service worker — never in the popup, which
// Brave destroys the moment the target window takes focus.

const HOST = 'com.parun.bravemove';

// Port of titleMatches from idea/bravefocus.swift: the name starts with the
// digits and the next character (if any) is not another digit, so "1 🔊"
// matches 1 but "12 things" does not.
function nameMatches(name, digits) {
  if (!digits || !name.startsWith(digits)) return false;
  const next = name.slice(digits.length)[0];
  return next === undefined || !/\p{N}/u.test(next);
}

async function askHost(msg) {
  const res = await chrome.runtime.sendNativeMessage(HOST, msg);
  if (res?.error) throw new Error(res.error);
  return res;
}

const boundsOf = w => [w.left, w.top, w.left + w.width, w.top + w.height];
const sameBounds = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);

// Brave's windows as the extension sees them, each with its given name.
// Joined by id (AppleScript's window id is the same session id); bounds is
// only a fallback in case that ever stops being true.
async function namedWindows() {
  const [{ windows: named }, wins] = await Promise.all([
    askHost({ op: 'list' }),
    chrome.windows.getAll({ windowTypes: ['normal'] })
  ]);
  return wins.map(w => {
    const n = named.find(n => n.id === String(w.id))
           ?? named.find(n => n.incognito === w.incognito && sameBounds(n.bounds, boundsOf(w)));
    return { id: w.id, incognito: w.incognito, name: n?.name ?? '' };
  });
}

async function flashBadge(text) {
  await chrome.action.setBadgeBackgroundColor({ color: '#d33' });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}

// Move the highlighted tab(s) of `fromWindowId` to the window named `digits`
// and follow them. With `create`, a missing window is created and named.
async function moveTo(digits, fromWindowId, { create = false } = {}) {
  const from = await chrome.windows.get(fromWindowId);
  const tabs = await chrome.tabs.query({ windowId: from.id, highlighted: true });
  const ids = tabs.map(t => t.id);
  const focusTab = (tabs.find(t => t.active) ?? tabs[0]).id;

  const target = (await namedWindows()).find(w =>
    w.id !== from.id && w.incognito === from.incognito && nameMatches(w.name, digits));

  let targetId;
  if (target) {
    targetId = target.id;
    await chrome.tabs.move(ids, { windowId: targetId, index: -1 });
  } else if (create) {
    const w = await chrome.windows.create({ tabId: ids[0], incognito: from.incognito, focused: true });
    targetId = w.id;
    if (ids.length > 1) await chrome.tabs.move(ids.slice(1), { windowId: targetId, index: -1 });
    await askHost({ op: 'rename', id: String(w.id), bounds: boundsOf(w), name: digits });
  } else {
    return flashBadge(`∅${digits}`);
  }

  await chrome.tabs.update(focusTab, { active: true });
  await chrome.windows.update(targetId, { focused: true });
}

function report(err) {
  console.error('BraveMove:', err);
  flashBadge('ERR');
}

chrome.commands.onCommand.addListener((command, tab) => {
  const m = command.match(/^move-to-(\d)$/);
  if (m && tab) moveTo(m[1], tab.windowId).catch(report);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.op === 'list') {
    namedWindows().then(
      windows => sendResponse({ windows }),
      err => sendResponse({ error: String(err.message ?? err) })
    );
    return true;
  }
  if (msg.op === 'move') {
    // Acknowledge at once so the popup can close; the move carries on here.
    sendResponse({ accepted: true });
    moveTo(msg.digits, msg.windowId, { create: msg.create }).catch(report);
  }
});
