'use strict';
const $ = s => document.querySelector(s);
const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const LS = 'motivatore.v1';
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const LN = NATIVE
  ? ((window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || window.Capacitor.registerPlugin('LocalNotifications'))
  : null;
const NV = NATIVE
  ? ((window.Capacitor.Plugins && window.Capacitor.Plugins.AndroidReminder) || window.Capacitor.registerPlugin('AndroidReminder'))
  : null;

const DEFAULTS = {
  routines: [],
  done: {},
  settings: { vib: true, sound: true, msg: true, full: true, notif: true, lead: 60, grace: 30, dark: false }
};

// ---------- Livelli di escalation ----------
// frac: soglia come frazione dell'anticipo; every: secondi tra notifiche; fullscreen: overlay
const LEVELS = [
  { frac: 1.00, every: 15 * 60, vol: 0.10, freq: 440, beeps: 1, vib: [200],                         color: '#0f172a' },
  { frac: 0.67, every: 10 * 60, vol: 0.20, freq: 520, beeps: 2, vib: [200, 100, 200],               color: '#1e3a8a' },
  { frac: 0.42, every:  5 * 60, vol: 0.40, freq: 620, beeps: 3, vib: [300, 100, 300, 100, 300],    color: '#92400e' },
  { frac: 0.17, every:  2 * 60, vol: 0.65, freq: 740, beeps: 4, vib: [500, 100, 500, 100, 500],    color: '#ea580c', fullscreen: true },
  { frac: 0.00, every:     30,  vol: 1.00, freq: 880, beeps: 6, vib: [800, 100, 800, 100, 800, 100, 800], color: '#dc2626', fullscreen: true }
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
applyTheme();
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
function applyTheme() {
  const dark = !!state.settings.dark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#11131b' : '#f6f7fb';
}
function save() {
  try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {}
  if (NATIVE) nativeScheduleSoon();
}

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
  // Nell'app Android le notifiche vere sono programmate dal sistema: qui scatta solo la simulazione
  if (NATIVE && !sim) return;
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
    requireInteraction: level >= 3, vibrate: LEVELS[level].vib, icon: 'icon-192.png'
  };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) reg.showNotification(`${o.name} · livello ${level + 1}/5`, opts);
    else new Notification(`${o.name} · livello ${level + 1}/5`, opts);
  } catch (e) {}
}
async function closeNotifications() {
  if (NATIVE) { try { await LN.removeAllDeliveredNotifications(); } catch (e) {} return; }
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
const settingsDialog = $('#settingsDialog');
const settingsButton = $('#settingsOpen');
function openSettings() {
  if (settingsDialog.open) return;
  settingsButton.setAttribute('aria-expanded', 'true');
  if (typeof settingsDialog.showModal === 'function') {
    settingsDialog.showModal();
  } else {
    settingsDialog.classList.add('settings-fallback');
    settingsDialog.setAttribute('open', '');
    settingsDialog.setAttribute('aria-modal', 'true');
    $('#settingsClose').focus();
  }
}
function closeSettings() {
  if (settingsDialog.classList.contains('settings-fallback')) {
    settingsDialog.classList.remove('settings-fallback');
    settingsDialog.removeAttribute('open');
    settingsDialog.removeAttribute('aria-modal');
  } else {
    if (!settingsDialog.open) return;
    settingsDialog.close();
  }
  settingsButton.setAttribute('aria-expanded', 'false');
  settingsButton.focus();
}
settingsButton.addEventListener('click', openSettings);
$('#settingsClose').addEventListener('click', closeSettings);
settingsDialog.addEventListener('close', () => settingsButton.setAttribute('aria-expanded', 'false'));
settingsDialog.addEventListener('click', e => {
  if (e.target === settingsDialog) closeSettings();
});
document.addEventListener('click', e => {
  if (settingsDialog.classList.contains('settings-fallback')
      && !settingsDialog.contains(e.target) && !settingsButton.contains(e.target)) closeSettings();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && settingsDialog.classList.contains('settings-fallback')) closeSettings();
});

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

function render() { renderList(); renderToday(); renderCalendar(); renderSettings(); }

$('#rDays').innerHTML = DAYS.map((d, i) =>
  `<label><input type="checkbox" value="${i}" ${i < 5 ? 'checked' : ''}> ${d}</label>`).join('');

$('#rAdd').addEventListener('click', () => {
  const name = $('#rName').value.trim(), time = $('#rTime').value;
  const days = [...document.querySelectorAll('#rDays input:checked')].map(i => Number(i.value));
  const error = $('#rError');
  if (!name || !time || !days.length) {
    error.textContent = !name ? 'Inserisci il nome della routine.'
      : !time ? 'Scegli un orario per la routine.'
        : 'Seleziona almeno un giorno.';
    error.hidden = false;
    (!name ? $('#rName') : !time ? $('#rTime') : $('#rDays input')).focus();
    return;
  }
  error.hidden = true;
  state.routines.push({ id: Date.now().toString(36), name, time, days });
  save(); $('#rName').value = ''; render();
});
$('#rName').addEventListener('input', () => { $('#rError').hidden = true; });
$('#rTime').addEventListener('input', () => { $('#rError').hidden = true; });
$('#rDays').addEventListener('change', () => { $('#rError').hidden = true; });

// ---------- Impostazioni ----------
const BOOLS = { sVib: 'vib', sSound: 'sound', sMsg: 'msg', sFull: 'full', sNotif: 'notif' };
function renderSettings() {
  $('#sDark').checked = !!state.settings.dark;
  for (const [id, k] of Object.entries(BOOLS)) $('#' + id).checked = !!state.settings[k];
  $('#sLead').value = state.settings.lead;
  $('#sGrace').value = state.settings.grace;
  updatePermBanner();
}
$('#sDark').addEventListener('change', e => {
  state.settings.dark = e.currentTarget.checked;
  applyTheme();
  save();
});
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
  if (NATIVE) { nativeBanner(); return; }
  const need = state.settings.notif && 'Notification' in window && Notification.permission !== 'granted';
  $('#permBanner').style.display = need ? 'flex' : 'none';
}
function askPermission() {
  if (NATIVE) { nativeAsk(); return; }
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

// ---------- Calendario ----------
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
let calMonth = new Date(); calMonth.setDate(1); calMonth.setHours(0, 0, 0, 0);
let calSel = dateKey(new Date());

const keyToDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

function routinesOn(date) {
  const wd = weekday(date), k = dateKey(date);
  return state.routines
    .filter(r => r.days.includes(wd))
    .map(r => ({ r, key: k + '|' + r.id, done: !!state.done[k + '|' + r.id] }))
    .sort((a, b) => a.r.time.localeCompare(b.r.time));
}

function statusOf(item, dateK, todayK) {
  if (item.done) return 'ok';
  if (dateK < todayK) return 'miss';
  if (dateK === todayK) {
    const [h, m] = item.r.time.split(':').map(Number), now = new Date();
    return now.getHours() * 60 + now.getMinutes() > h * 60 + m ? 'late' : 'todo';
  }
  return 'todo';
}

function renderCalendar() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $('#calTitle').textContent = `${MONTHS[m]} ${y}`;
  const todayK = dateKey(new Date());
  const offset = weekday(new Date(y, m, 1)), dim = new Date(y, m + 1, 0).getDate();
  let html = DAYS.map(d => `<div class="cal-h">${d}</div>`).join('');
  for (let i = 0; i < offset; i++) html += '<div></div>';
  for (let d = 1; d <= dim; d++) {
    const date = new Date(y, m, d), k = dateKey(date);
    const dots = routinesOn(date).slice(0, 3).map(it => {
      const s = statusOf(it, k, todayK);
      return `<i class="dot ${s === 'ok' ? 'ok' : s === 'miss' ? 'miss' : ''}"></i>`;
    }).join('');
    const cls = ['cal-d', k === todayK ? 'today' : '', k === calSel ? 'sel' : '', k < todayK ? 'past' : ''].join(' ');
    html += `<button class="${cls}" data-date="${k}" aria-label="${d} ${MONTHS[m]}"><span>${d}</span><span class="dots">${dots}</span></button>`;
  }
  $('#calGrid').innerHTML = html;
  renderCalDetail();
}

function renderCalDetail() {
  const date = keyToDate(calSel), todayK = dateKey(new Date());
  const label = date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const items = routinesOn(date);
  const TAGS = { ok: ['ok', 'confermata'], miss: ['miss', 'saltata'], late: ['wait', 'in ritardo'], todo: ['', 'in programma'] };
  const body = items.length
    ? items.map(it => {
        const [c, t] = TAGS[statusOf(it, calSel, todayK)];
        return `<div class="item"><div><strong>${esc(it.r.name)}</strong> <span class="mut">${esc(it.r.time)}</span> <span class="tag ${c}">${t}</span></div></div>`;
      }).join('')
    : '<div class="mut">Nessuna routine in questo giorno.</div>';
  $('#calDetail').innerHTML = `<h4>${esc(label)}</h4>${body}`;
}

$('#calGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-date]');
  if (!b) return;
  calSel = b.dataset.date; renderCalendar();
});
$('#calPrev').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); });
$('#calNext').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); });
$('#calToday').addEventListener('click', () => {
  const n = new Date(); calMonth = new Date(n.getFullYear(), n.getMonth(), 1); calSel = dateKey(n); renderCalendar();
});

// ---------- Installazione PWA ----------
let deferredInstall = null;
const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
if (!standalone && !NATIVE) {
  $('#installBox').style.display = 'block';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $('#installHint').textContent = ios
    ? 'Su iPhone/iPad: apri la pagina in Safari, tocca Condividi e scegli «Aggiungi alla schermata Home».'
    : 'Se il pulsante non compare: menu ⋮ del browser → «Installa app» o «Aggiungi a schermata Home». Serve la pagina in HTTPS.';
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredInstall = e; $('#installBtn').style.display = 'inline-block';
});
$('#installBtn').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch (e) {}
  deferredInstall = null; $('#installBtn').style.display = 'none';
});
window.addEventListener('appinstalled', () => { $('#installBox').style.display = 'none'; });

// ---------- Android nativo: allarmi programmati dal sistema ----------
const HORIZON_DAYS = 4;        // giorni programmati in anticipo (ripianificati a ogni apertura)
const MAX_ALARMS = 450;        // Android consente al massimo ~500 allarmi per app
const IMPORTANCE = [3, 3, 4, 4, 5];
const channelsDone = new Set();
let nativeTimer = null, nativeBusy = false, nativeAgain = false;

function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) & 0x7fffffff;
}

// Orari delle notifiche di una singola occorrenza: [{ at, level }]
function planOccurrence(startMs, lead, grace) {
  const out = [], last = LEVELS.length - 1;
  for (let i = 0; i <= last; i++) {
    const from = startMs - LEVELS[i].frac * lead * 60000;
    const to = i < last ? startMs - LEVELS[i + 1].frac * lead * 60000 : startMs + grace * 60000;
    for (let t = from; t < to;) {
      out.push({ at: Math.round(t), level: i });
      // ultimo livello: ogni 30 s per 10 minuti, poi ogni 2 minuti (per non superare il limite di allarmi)
      t += (i === last && t - from >= 10 * 60000) ? 120000 : LEVELS[i].every * 1000;
    }
  }
  return out;
}

async function ensureChannel(level) {
  const s = state.settings;
  const id = `motiva_l${level + 1}_v${s.vib ? 1 : 0}_s${s.sound ? 1 : 0}_h2`;
  if (!channelsDone.has(id)) {
    await LN.createChannel({
      id, name: `Livello ${level + 1}${s.vib ? '' : ' (senza vibrazione)'}${s.sound ? '' : ' (silenzioso)'}`,
      description: 'Notifiche a intensità crescente di Motiva',
      importance: IMPORTANCE[level], visibility: 1, lights: true, vibration: !!s.vib,
      sound: s.sound ? `muvt_l${level + 1}.wav` : 'muvt_silent.wav'
    });
    if (s.vib) await NV.setPattern({ channelId: id, pattern: LEVELS[level].vib });
    channelsDone.add(id);
  }
  return id;
}

function nativeScheduleSoon() {
  clearTimeout(nativeTimer);
  nativeTimer = setTimeout(nativeReschedule, 400);
}

async function nativeReschedule() {
  if (!NATIVE) return;
  if (nativeBusy) { nativeAgain = true; return; }
  nativeBusy = true;
  try {
    await NV.cancelFullScreen();
    const pending = await LN.getPending();
    if (pending.notifications && pending.notifications.length) {
      await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
    }
    const perm = await LN.checkPermissions();
    if (perm.display !== 'granted' || !state.settings.notif) return;
    let exactAllowed = false;
    try {
      exactAllowed = (await LN.checkExactNotificationSetting()).exact_alarm === 'granted';
    } catch (e) {
      console.warn('Motiva: verifica degli allarmi esatti non riuscita; userò notifiche non esatte', e);
    }

    const s = state.settings, now = Date.now(), list = [];
    for (let d = 0; d < HORIZON_DAYS; d++) {
      const day = new Date(); day.setDate(day.getDate() + d); day.setHours(0, 0, 0, 0);
      for (const r of state.routines) {
        if (!r.days.includes(weekday(day))) continue;
        const key = dateKey(day) + '|' + r.id;
        if (state.done[key]) continue;
        const [h, m] = r.time.split(':').map(Number);
        const start = new Date(day); start.setHours(h, m, 0, 0);
        for (const p of planOccurrence(start.getTime(), s.lead, s.grace)) {
          if (p.at > now + 3000) list.push({ at: p.at, level: p.level, key, name: r.name, startAt: start.getTime() });
        }
      }
    }
    list.sort((a, b) => a.at - b.at);
    list.length = Math.min(list.length, MAX_ALARMS);

    const status = await NV.getStatus();
    const useFullScreen = s.full && exactAllowed && status.fullScreenIntentAllowed;
    const used = new Set(), notifications = [], fullScreenNotifications = [];
    for (const it of list) {
      let id = hash32(it.key + '#' + it.at);
      while (used.has(id)) id = (id + 1) & 0x7fffffff;
      used.add(id);
      const channelId = await ensureChannel(it.level);
      const notification = {
        id,
        title: `${it.name} · livello ${it.level + 1}/5`,
        body: messageFor(it.name, it.level),
        isExactNotification: exactAllowed,
        isExactMandatory: exactAllowed,
        channelId,
        smallIcon: 'ic_stat_muvt', iconColor: '#6366F1',
        group: 'muvt-' + it.key, autoCancel: true,
        schedule: { at: new Date(it.at), allowWhileIdle: true },
        extra: { key: it.key }
      };
      if (useFullScreen && it.level >= 3) {
        fullScreenNotifications.push({
          id, at: it.at, level: it.level, key: it.key, name: it.name,
          startAt: it.startAt, channelId,
          title: notification.title, body: notification.body,
          vibration: s.vib ? LEVELS[it.level].vib : []
        });
      } else {
        notifications.push(notification);
      }
    }
    for (let i = 0; i < notifications.length; i += 100) {
      const result = await LN.schedule({ notifications: notifications.slice(i, i + 100) });
      if (result.warning) throw new Error(result.warning.message);
    }
    if (fullScreenNotifications.length) {
      try {
        await NV.scheduleFullScreen({ notifications: fullScreenNotifications });
      } catch (e) {
        console.warn('Motiva: notifiche full-screen non programmate; userò notifiche normali', e);
        const fallback = fullScreenNotifications.map(it => ({
          id: it.id,
          title: it.title,
          body: it.body,
          isExactNotification: exactAllowed,
          isExactMandatory: exactAllowed,
          channelId: it.channelId,
          smallIcon: 'ic_stat_muvt',
          iconColor: '#6366F1',
          group: 'muvt-' + it.key,
          autoCancel: true,
          schedule: { at: new Date(it.at), allowWhileIdle: true },
          extra: { key: it.key }
        }));
        for (let i = 0; i < fallback.length; i += 100) {
          const result = await LN.schedule({ notifications: fallback.slice(i, i + 100) });
          if (result.warning) throw new Error(result.warning.message);
        }
      }
    }
  } catch (e) {
    console.warn('Motiva: programmazione notifiche non riuscita', e);
    const box = $('#permBanner');
    box.querySelector('span').textContent = 'Non sono riuscita a programmare le notifiche. Riapri l’app e controlla i permessi.';
    box.style.display = state.settings.notif ? 'flex' : 'none';
  } finally {
    nativeBusy = false;
    if (nativeAgain) { nativeAgain = false; nativeReschedule(); }
  }
}

async function nativePermState() {
  const p = await LN.checkPermissions();
  let exact = 'unknown';
  try {
    exact = (await LN.checkExactNotificationSetting()).exact_alarm;
  } catch (e) {
    console.warn('Motiva: verifica degli allarmi esatti non riuscita', e);
  }
  return { display: p.display, exact };
}
async function nativeBanner() {
  const box = $('#permBanner');
  try {
    const [p, status] = await Promise.all([nativePermState(), NV.getStatus()]);
    const msg = p.display !== 'granted'
      ? 'Le notifiche sono disattivate: senza non posso svegliarti.'
      : p.exact !== 'granted' ? 'Consenti gli allarmi esatti, altrimenti le notifiche possono arrivare in ritardo.' : '';
    const permissionMessage = msg || (state.settings.full && !status.fullScreenIntentAllowed
      ? 'Consenti le notifiche a schermo intero per aprire Motiva nelle fasi finali.'
      : !status.batteryOptimizationIgnored
        ? 'Consenti a Motiva di funzionare in background per ridurre i ritardi delle notifiche.'
        : '');
    box.querySelector('span').textContent = permissionMessage;
    box.style.display = permissionMessage && state.settings.notif ? 'flex' : 'none';
  } catch (e) {
    console.warn('Motiva: verifica dei permessi notifiche non riuscita', e);
    box.querySelector('span').textContent = 'Impossibile verificare i permessi delle notifiche.';
    box.style.display = state.settings.notif ? 'flex' : 'none';
  }
}
async function nativeAsk() {
  try {
    const p = await nativePermState();
    if (p.display !== 'granted') {
      await LN.requestPermissions();
    } else if (p.exact !== 'granted') {
      await LN.changeExactNotificationSetting();
    } else {
      const status = await NV.getStatus();
      if (state.settings.full && !status.fullScreenIntentAllowed) {
        await NV.requestFullScreenIntentAccess();
      } else if (!status.batteryOptimizationIgnored) {
        await NV.requestBackgroundAccess();
      }
    }
  } catch (e) {
    console.warn('Motiva: richiesta dei permessi notifiche non riuscita', e);
  }
  nativeBanner(); nativeReschedule();
}
async function nativeInit() {
  try {
    const p = await LN.checkPermissions();
    if (p.display === 'prompt' || p.display === 'prompt-with-rationale') await LN.requestPermissions();
  } catch (e) {
    console.warn('Motiva: inizializzazione dei permessi notifiche non riuscita', e);
  }
  nativeBanner();
  nativeReschedule();
  nativeLaunchReminder();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { nativeBanner(); nativeReschedule(); nativeLaunchReminder(); tick(); }
  });
}

async function nativeLaunchReminder() {
  try {
    const result = await NV.takePendingFullScreenReminder();
    const reminder = result.reminder;
    if (!reminder || !reminder.key || state.done[reminder.key]) return;
    showOverlay(
      { key: reminder.key, name: reminder.name },
      Math.max(0, Math.min(LEVELS.length - 1, reminder.level)),
      (reminder.startAt - Date.now()) / 60000
    );
  } catch (e) {
    console.warn('Motiva: apertura del promemoria full-screen non riuscita', e);
  }
}

// ---------- Avvio ----------
if ('serviceWorker' in navigator && !NATIVE) navigator.serviceWorker.register('sw.js').catch(() => {});
if (NATIVE) {
  const note = $('#settingsNote');
  if (note) note.textContent = 'Le notifiche sono programmate da Android e arrivano anche con l’app chiusa. Nelle fasi finali Motiva può aprirsi a schermo intero se autorizzata. La simulazione va 60 volte più veloce.';
}
render();
setInterval(tick, 1000);
tick();
if (NATIVE) nativeInit();
