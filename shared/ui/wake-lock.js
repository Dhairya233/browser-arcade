// Asks the browser to keep the screen on while someone is in an online room. A phone that goes to
// sleep drops its connection, and if that phone is the host's the whole game stops.
// Browsers without the Wake Lock API, or that refuse the request, are simply left alone.
let sentinel = null;
let wanted = false;

async function acquire() {
  if (!wanted || sentinel || !('wakeLock' in navigator) || document.hidden) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch (e) { sentinel = null; }
}

export function keepScreenOn(on) {
  wanted = on;
  if (on) acquire();
  else if (sentinel) { const s = sentinel; sentinel = null; s.release().catch(() => {}); }
}

// A lock is dropped when the tab is hidden, so ask again when it comes back.
document.addEventListener('visibilitychange', () => { if (!document.hidden) acquire(); });
