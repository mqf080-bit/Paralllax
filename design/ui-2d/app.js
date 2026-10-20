const SONGS = {
  'proving-ground': {
    title: 'Proving Ground',
    artist: 'demo',
    difficulty: 'IN 8',
    length: '0:42',
    source: 'BUILT-IN',
    index: '01',
    bpm: '150',
    notes: '79',
    shifts: '02',
    types: '04',
  },
  antagonism: {
    title: 'Antagonism',
    artist: 'demo',
    difficulty: 'IN 7',
    length: '0:12',
    source: 'BUILT-IN',
    index: '02',
    bpm: '160',
    notes: '48',
    shifts: '00',
    types: '04',
  },
  'air-ticks': {
    title: 'Air / Ticks',
    artist: 'example',
    difficulty: 'IN 4',
    length: '0:18',
    source: 'CHART FILE',
    index: '03',
    bpm: '140',
    notes: '07',
    shifts: '01',
    types: '03',
  },
  'infinity-heaven': {
    title: 'Infinity Heaven',
    artist: 'HyuN',
    difficulty: 'IN 1',
    length: '2:33',
    source: 'LOCAL PACK',
    index: '04',
    bpm: '160',
    notes: '48',
    shifts: '00',
    types: '02',
  },
};

const screens = [...document.querySelectorAll('.screen')];
const tabs = [...document.querySelectorAll('.screen-tabs button')];
const panel = document.getElementById('panel');
const toast = document.getElementById('toast');
let toastTimer = null;

function screenFromQuery() {
  const value = new URLSearchParams(window.location.search).get('screen');
  return screens.some((node) => node.dataset.screen === value) ? value : 'home';
}

function showScreen(name, syncUrl = true) {
  const next = screens.some((node) => node.dataset.screen === name) ? name : 'home';
  for (const screen of screens) screen.classList.toggle('is-active', screen.dataset.screen === next);
  for (const tab of tabs) tab.classList.toggle('is-active', tab.dataset.screen === next);
  panel.dataset.screen = next;
  document.body.dataset.screen = next;
  if (syncUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set('screen', next);
    window.history.replaceState(null, '', url);
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 1600);
}

function renderDensity(song) {
  const bars = document.getElementById('density-bars');
  const meta = document.getElementById('density-meta');
  if (!bars || !meta) return;
  bars.replaceChildren();
  const notes = Number(song.notes) || 0;
  const shifts = Number(song.shifts) || 0;
  const shiftAt = new Set(shifts > 0 ? [8] : []);
  if (shifts > 1) shiftAt.add(23);
  for (let i = 0; i < 32; i += 1) {
    const bar = document.createElement('i');
    const height = 8 + ((i * 13 + notes * 7) % 38);
    bar.style.height = `${height}%`;
    if (shiftAt.has(i)) bar.className = 'is-shift';
    bars.append(bar);
  }
  meta.textContent = `${song.notes} NOTES · ${song.shifts} SHIFTS`;
}

function selectSong(id) {
  const song = SONGS[id];
  if (!song) return;
  for (const row of document.querySelectorAll('.song-row')) {
    row.classList.toggle('is-selected', row.dataset.song === id);
  }
  document.getElementById('detail-index').textContent = song.index;
  document.getElementById('cover-index').textContent = song.index;
  document.getElementById('detail-title').textContent = song.title;
  document.getElementById('detail-artist').textContent = song.artist;
  document.getElementById('detail-difficulty').textContent = song.difficulty;
  document.getElementById('detail-length').textContent = song.length;
  document.getElementById('detail-source').textContent = song.source;
  document.getElementById('detail-bpm').textContent = song.bpm;
  document.getElementById('detail-notes').textContent = song.notes;
  document.getElementById('detail-shifts').textContent = song.shifts;
  document.getElementById('detail-types').textContent = song.types;
  renderDensity(song);
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-screen], [data-song], [data-action]');
  if (!target) return;

  if (target.dataset.song) {
    selectSong(target.dataset.song);
    return;
  }

  if (target.dataset.action === 'start') {
    showToast('START · PROVING GROUND');
    return;
  }
  if (target.dataset.action === 'play') {
    const title = document.getElementById('detail-title')?.textContent ?? 'PROVING GROUND';
    showToast(`PLAY · ${title.toUpperCase()}`);
    return;
  }
  if (target.dataset.action === 'exit') {
    showToast('EXIT VR · ONLY IN HEADSET');
    return;
  }

  if (target.dataset.screen) {
    showScreen(target.dataset.screen);
  }
});

document.addEventListener('keydown', (event) => {
  const map = {
    Digit1: 'home',
    Digit2: 'songs',
    Digit3: 'packs',
    Digit4: 'paused',
    Digit5: 'settings',
    Digit6: 'result',
    Escape: 'home',
  };
  const screen = map[event.code];
  if (screen) {
    event.preventDefault();
    showScreen(screen);
  }
});

const initial = screenFromQuery();
selectSong('proving-ground');
showScreen(initial, false);
