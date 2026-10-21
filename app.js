'use strict';
const $ = s => document.querySelector(s);
const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const LS = 'motivatore.v1';

const DEFAULTS = {
  routines: [],
  done: {},
  settings: { vib: true, sound: true, msg: true, full: true, notif: true, lead: 60, grace: 30 }
};

// ---------- Livelli di escalation ----------
// frac: soglia come frazione dell'anticipo; every: secondi tra notifiche; fullscreen: overlay
const LEVELS = [
  { frac: 1.00, every: 15 * 60, vol: 0.10, freq: 440, beeps: 1, vib: [200],                         color: '#0f172a' },
  { frac: 0.67, every: 10 * 60, vol: 0.20, freq: 520, beeps: 2, vib: [200, 100, 200],               color: '#1e3a8a' },
  { frac: 0.42, every:  5 * 60, vol: 0.40, freq: 620, beeps: 3, vib: [300, 100, 300, 100, 300],    color: '#92400e' },
  { frac: 0.17, every:  2 * 60, vol: 0.65, freq: 740, beeps: 4, vib: [500, 100, 500, 100, 500],    color: '#b45309', fullscreen: true },
  { frac: 0.00, every:     30,  vol: 1.00, freq: 880, beeps: 6, vib: [800, 100, 800, 100, 800, 100, 800], color: '#b91c1c', fullscreen: true }
];

const MESSAGES = [
  n => `Tra poco: ${n}. Inizia a prepararti con calma.`,
  n => `${n} si avvicina. È il momento di muoversi.`,
  n => `Ehi! ${n} è tra poco. Prendi le tue cose.`,
  n => `ORA basta scuse: ${n} sta per iniziare!`,
  n => `È L'ORA DI ${n.toUpperCase()}! Conferma che stai andando!`
];

// ---------- Stato ----------
let state = load();
const runtime = {};          // chiave occorrenza -> { level, lastFire }
let sim = null;              // { realStart, simStart, speed, startMs, leadMin }
let audioCtx = null;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS));
    return {
      routines: (s && s.routines) || [],
      done: (s && s.done) || {},
      settings: Object.assign({}, DEFAULTS.settings, s && s.settings)
    };
  } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
}
function save() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {} }

const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const weekday = d => (d.getDay() + 6) % 7; // 0 = Lunedì

// ---------- Occorrenze ----------
function occurrences(nowMs) {
  if (sim) return [{ key: 'sim', id: 'sim', name: 'Test', startMs: sim.startMs }];
  const now = new Date(nowMs), out = [];
  for (const r of state.routines) {
    if (!r.days.includes(weekday(now))) continue;
    const [h, m] = r.time.split(':').map(Number);
    const start = new Date(now); start.setHours(h, m, 0, 0);
    out.push({ key: dateKey(now) + '|' + r.id, id: r.id, name: r.name, startMs: start.getTime() });
  }
  return out;
}
const currentNow = () => sim ? sim.simStart + (Date.now() - sim.realStart) * sim.speed : Date.now();

// ---------- Tick principale ----------
function tick() {
  const nowMs = currentNow();
  const s = state.settings;
  let overlayOcc = null, overlayLevel = -1;

  for (const o of occurrences(nowMs)) {
    if (state.done[o.key]) continue;
    const minsBefore = (o.startMs - nowMs) / 60000;
    const lead = sim ? sim.leadMin : s.lead;
    if (minsBefore > lead || minsBefore < -s.grace) continue;

    let level = 0;
    LEVELS.forEach((L, i) => { if (minsBefore <= L.frac * lead) level = i; });

    const rt = runtime[o.key] || (runtime[o.key] = { level: -1, lastFire: 0 });
    const every = LEVELS[level].every * 1000;
    if (level !== rt.level || nowMs - rt.lastFire >= every) {
      rt.level = level; rt.lastFire = nowMs;
      fire(o, level, minsBefore);
    }
    if (LEVELS[level].fullscreen && s.full && level > overlayLevel) { overlayOcc = o; overlayLevel = level; }
  }

  if (overlayOcc) showOverlay(overlayOcc, overlayLevel, (overlayOcc.startMs - nowMs) / 60000);
  else hideOverlay();

  if (sim && nowMs > sim.startMs + s.grace * 60000) stopSim();
  renderToday();
}

function messageFor(name, level) {
  return state.settings.msg ? MESSAGES[level](name) : `Promemoria: ${name}`;
}

function fire(o, level, minsBefore) {
  const L = LEVELS[level], s = state.settings;
  const text = messageFor(o.name, level);
  if (s.notif) notify(o, level, text);
  if (s.sound) beep(L);
  if (s.vib && navigator.vibrate) navigator.vibrate(L.vib);
}

// ---------- Notifiche di sistema ----------
async function notify(o, level, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = {
    body, tag: 'motivatore-' + o.id, renotify: true,
    requireInteraction: level >= 3, vibrate: LEVELS[level].vib, icon: 'icon.svg'
  };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) reg.showNotification(`${o.name} · livello ${level + 1}/5`, opts);
    else new Notification(`${o.name} · livello ${level + 1}/5`, opts);
  } catch (e) {}
}
async function closeNotifications() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    (await reg.getNotifications()).forEach(n => n.close());
  } catch (e) {}
}

// ---------- Suoni ----------
function beep(L) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < L.beeps; i++) {
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.type = L.vol > 0.6 ? 'square' : 'sine';
      osc.frequency.value = L.freq + (i % 2) * 120;
      const t = t0 + i * 0.28;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(L.vol, t + 0.02);
      g.gain.linearRampToValueAtTime(0, t + 0.22);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(t); osc.stop(t + 0.25);
    }
  } catch (e) {}
}

// ---------- Overlay ----------
let currentOverlayKey = null;
function showOverlay(o, level, minsBefore) {
  const ov = $('#overlay');
  currentOverlayKey = o.key;
  ov.classList.add('show');
  ov.style.background = LEVELS[level].color;
  $('#ovTitle').textContent = `${o.name} · livello ${level + 1}/5`;
  $('#ovMsg').textContent = messageFor(o.name, level);
  const m = Math.abs(minsBefore), mm = Math.floor(m), ss = Math.floor((m - mm) * 60);
  $('#ovCount').textContent = minsBefore >= 0 ? `Mancano ${mm}:${pad(ss)}` : `In ritardo di ${mm}:${pad(ss)}`;
}
function hideOverlay() { $('#overlay').classList.remove('show'); currentOverlayKey = null; }

// ---------- Conferma ----------
function confirmKey(key) {
  if (key === 'sim') { stopSim(); return; }
  state.done[key] = Date.now(); save();
  hideOverlay(); closeNotifications(); render();
}
$('#ovBtn').addEventListener('click', () => { if (currentOverlayKey) confirmKey(currentOverlayKey); });

// ---------- Simulazione ----------
function startSim() {
  const lead = state.settings.lead, simStart = Date.now();
  sim = { realStart: Date.now(), simStart, speed: 60, leadMin: lead, startMs: simStart + lead * 60000 };
  tick();
}
function stopSim() { sim = null; delete runtime.sim; hideOverlay(); closeNotifications(); render(); }
$('#sTest').addEventListener('click', () => { unlockAudio(); startSim(); });
$('#sStop').addEventListener('click', stopSim);

// ---------- UI ----------
function renderToday() {
  const nowMs = currentNow(), box = $('#today');
  const occ = occurrences(nowMs).sort((a, b) => a.startMs - b.startMs);
  if (!occ.length) { box.innerHTML = '<div class="mut">Nessuna routine per oggi.</div>'; return; }
  box.innerHTML = occ.map(o => {
    const d = new Date(o.startMs), done = state.done[o.key];
    const tag = done ? '<span class="tag ok">confermata</span>'
      : o.startMs < nowMs ? '<span class="tag wait">in ritardo</span>' : '<span class="tag">in attesa</span>';
    const btn = done ? '' : `<button class="primary" data-confirm="${esc(o.key)}">Sto andando</button>`;
    return `<div class="item"><div><strong>${esc(o.name)}</strong> <span class="mut">${pad(d.getHours())}:${pad(d.getMinutes())}</span> ${tag}</div>${btn}</div>`;
  }).join('');
}
$('#today').addEventListener('click', e => {
  const k = e.target.dataset && e.target.dataset.confirm;
  if (k) confirmKey(k);
});

function renderList() {
  const box = $('#list');
  if (!state.routines.length) { box.innerHTML = '<div class="mut">Ancora nessuna routine.</div>'; return; }
  box.innerHTML = state.routines.map(r => `
    <div class="item"><div><strong>${esc(r.name)}</strong> <span class="mut">${esc(r.time)}</span><br>
    <span class="mut">${r.days.map(d => DAYS[d]).join(', ')}</span></div>
    <button class="danger" data-del="${esc(r.id)}">Elimina</button></div>`).join('');
}
$('#list').addEventListener('click', e => {
  const id = e.target.dataset && e.target.dataset.del;
  if (!id) return;
  state.routines = state.routines.filter(r => r.id !== id); save(); render();
});

function render() { renderList(); renderToday(); renderSettings(); }

$('#rDays').innerHTML = DAYS.map((d, i) =>
  `<label><input type="checkbox" value="${i}" ${i < 5 ? 'checked' : ''}> ${d}</label>`).join('');

$('#rAdd').addEventListener('click', () => {
  const name = $('#rName').value.trim(), time = $('#rTime').value;
  const days = [...document.querySelectorAll('#rDays input:checked')].map(i => Number(i.value));
  if (!name || !time || !days.length) { alert('Inserisci nome, orario e almeno un giorno.'); return; }
  state.routines.push({ id: Date.now().toString(36), name, time, days });
  save(); $('#rName').value = ''; render();
});

// ---------- Impostazioni ----------
const BOOLS = { sVib: 'vib', sSound: 'sound', sMsg: 'msg', sFull: 'full', sNotif: 'notif' };
function renderSettings() {
  for (const [id, k] of Object.entries(BOOLS)) $('#' + id).checked = !!state.settings[k];
  $('#sLead').value = state.settings.lead;
  $('#sGrace').value = state.settings.grace;
  updatePermBanner();
}
for (const [id, k] of Object.entries(BOOLS)) {
  $('#' + id).addEventListener('change', e => {
    state.settings[k] = e.target.checked; save();
    if (k === 'notif' && e.target.checked) askPermission();
    if (k === 'sound' && e.target.checked) { unlockAudio(); beep(LEVELS[1]); }
    if (k === 'vib' && e.target.checked && navigator.vibrate) navigator.vibrate(LEVELS[1].vib);
  });
}
$('#sLead').addEventListener('change', e => { state.settings.lead = Math.max(5, Number(e.target.value) || 60); save(); });
$('#sGrace').addEventListener('change', e => { state.settings.grace = Math.max(0, Number(e.target.value) || 30); save(); });

function updatePermBanner() {
  const need = state.settings.notif && 'Notification' in window && Notification.permission !== 'granted';
  $('#permBanner').style.display = need ? 'block' : 'none';
}
function askPermission() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(updatePermBanner);
}
$('#permBtn').addEventListener('click', askPermission);

function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}
document.addEventListener('click', unlockAudio, { once: true });

// ---------- Avvio ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
setInterval(tick, 1000);
tick();
