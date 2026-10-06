// Leader mode: shortcut opens this, type the window's number. Commits as soon
// as the number is unambiguous; Enter commits otherwise (or creates the window).

const q = document.getElementById('q');
const namesEl = document.getElementById('names');
const statusEl = document.getElementById('status');

let current, targets = null;

// Same rule as background.js nameMatches.
function nameMatches(name, digits) {
  if (!digits || !name.startsWith(digits)) return false;
  const next = name.slice(digits.length)[0];
  return next === undefined || !/\p{N}/u.test(next);
}

// Some other window's number continues what was typed ("1" → "12"), so wait.
const extendsTo = (name, digits) => name.startsWith(digits) && /^\p{N}/u.test(name.slice(digits.length));

function setStatus(text, err = false) {
  statusEl.textContent = text;
  statusEl.className = err ? 'err' : '';
}

async function commit(create = false) {
  const digits = q.value;
  if (!digits) return;
  await chrome.runtime.sendMessage({ op: 'move', digits, windowId: current.id, create });
  window.close();
}

function update() {
  q.value = q.value.replace(/\D/g, '');
  const digits = q.value;
  if (!targets || !digits) return setStatus('');
  const hit = targets.some(w => nameMatches(w.name, digits));
  const longer = targets.some(w => extendsTo(w.name, digits));
  if (hit && !longer) return commit();
  if (hit) setStatus('Enter to move');
  else if (longer) setStatus('Keep typing…');
  else setStatus(`No window "${digits}" — Enter creates it`);
}

q.addEventListener('input', update);
q.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !targets) return;
  const hit = targets.some(w => nameMatches(w.name, q.value));
  commit(!hit);
});

async function init() {
  current = await chrome.windows.getCurrent();
  const res = await chrome.runtime.sendMessage({ op: 'list' });
  if (res.error) {
    namesEl.textContent = '';
    return setStatus(`Host error: ${res.error}`, true);
  }
  targets = res.windows.filter(w => w.id !== current.id && w.incognito === current.incognito && w.name);
  const here = res.windows.find(w => w.id === current.id)?.name;
  const names = targets.map(w => w.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  namesEl.textContent = (names.length ? names.join(' · ') : 'No other named windows')
                      + (here ? `   (here: ${here})` : '');
  update(); // digits typed before the list arrived
}

init().catch(err => setStatus(String(err.message ?? err), true));
