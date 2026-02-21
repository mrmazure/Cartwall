/**
 * RadioTools – CartWall  |  app.js
 * Consolidated single-file application
 *
 * Sections:
 *  1. Constants & Utilities
 *  2. Layout
 *  3. Audio Engine
 *  4. File Utilities
 *  5. Context Menu
 *  6. Palette Config (Save / Load)
 *  7. Contrôle à distance (PeerJS)
 *  8. Bootstrap / Main
 */

'use strict';

/* =============================================================
   1. CONSTANTS & UTILITIES
   ============================================================= */

const NB_CARTS = 25;
const FADE_MS = 500;
const GAP = 10;

/** Swatch palette for cart color picker */
const SWATCHES = [
  '#374151', // default grey
  '#164e63', // cyan-dark
  '#1e3a5f', // blue-dark
  '#312e81', // indigo-dark
  '#4c1d95', // violet-dark
  '#701a75', // fuchsia-dark
  '#7f1d1d', // red-dark
  '#78350f', // amber-dark
  '#14532d', // green-dark
  '#134e4a', // teal-dark
  // lighter accents
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
];

/** Cart accent colours for left-border highlight */
const ACCENT_COLORS = {
  '#164e63': '#06b6d4',
  '#1e3a5f': '#3b82f6',
  '#312e81': '#818cf8',
  '#4c1d95': '#a78bfa',
  '#701a75': '#e879f9',
  '#7f1d1d': '#f87171',
  '#78350f': '#fbbf24',
  '#14532d': '#34d399',
  '#134e4a': '#2dd4bf',
  '#10b981': '#10b981',
  '#3b82f6': '#3b82f6',
  '#8b5cf6': '#8b5cf6',
  '#f59e0b': '#f59e0b',
  '#ef4444': '#ef4444',
  '#ec4899': '#ec4899',
};

/**
 * Convert seconds to M:SS string
 * @param {number} s
 * @returns {string}
 */
function formatTime(s) {
  if (!isFinite(s)) return '--:--';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/* =============================================================
   2. LAYOUT
   ============================================================= */

function resizeCarts() {
  const header = document.querySelector('header');
  const gridEl = document.getElementById('grid');
  const rows = 5;
  const available = window.innerHeight - header.offsetHeight - (rows + 1) * GAP;
  const h = Math.max(80, Math.floor(available / rows));
  document.documentElement.style.setProperty('--cart-h', `${h}px`);
}

window.addEventListener('resize', resizeCarts);

/* =============================================================
   3. AUDIO ENGINE
   ============================================================= */

/**
 * Fade audio element in over `ms` milliseconds.
 * @param {HTMLAudioElement} el
 * @param {number} [ms]
 */
function fadeIn(el, ms = FADE_MS) {
  el.volume = 0;
  const step = 50 / ms;
  const id = setInterval(() => {
    if (el.volume + step >= 1) {
      el.volume = 1;
      clearInterval(id);
    } else {
      el.volume += step;
    }
  }, 50);
}

/**
 * Fade audio element out over `ms` milliseconds, then call `cb`.
 * @param {HTMLAudioElement} el
 * @param {number} [ms]
 * @param {Function} [cb]
 */
function fadeOut(el, ms = FADE_MS, cb) {
  const step = 50 / ms;
  const id = setInterval(() => {
    if (el.volume - step <= 0) {
      el.volume = 0;
      clearInterval(id);
      cb && cb();
    } else {
      el.volume -= step;
    }
  }, 50);
}

/**
 * Play, pause or reset a cart on click.
 * @param {HTMLElement} cartEl
 */
function playPauseOrReset(cartEl) {
  const audio = cartEl.audio;
  const mixMode = document.getElementById('mixMode').checked;
  const resetOn2nd = document.getElementById('secondModeCheckbox').checked;

  if (audio.paused) {
    if (!mixMode) stopAllExcept(cartEl);
    fadeIn(audio);
    audio.play();
    cartEl.classList.add('playing');
    trackProgress(cartEl);
    broadcastCartAction(cartEl.dataset.idx, 'play');
  } else if (resetOn2nd) {
    broadcastCartAction(cartEl.dataset.idx, 'stop');
    fadeOut(audio, FADE_MS, () => {
      audio.pause();
      audio.currentTime = 0;
      cartEl.classList.remove('playing', 'blinking');
      resetProgress(cartEl);
      // Broadcast final reset state so slave sees 0% and full duration
      const dur = audio.duration || 0;
      broadcastState(cartEl.dataset.idx, false, 0, dur ? formatTime(dur) : '', cartEl.style.background || '');
    });
  } else {
    fadeOut(audio, FADE_MS, () => {
      audio.pause();
      cartEl.classList.remove('playing', 'blinking');
    });
    broadcastCartAction(cartEl.dataset.idx, 'pause');
  }
}

/**
 * Stop (fade out) all playing carts except the given one.
 * @param {HTMLElement} [except]
 */
function stopAllExcept(except) {
  const resetOn2nd = document.getElementById('secondModeCheckbox').checked;
  document.querySelectorAll('.cart.playing').forEach(c => {
    if (c !== except) {
      fadeOut(c.audio, FADE_MS, () => {
        c.audio.pause();
        if (resetOn2nd) {
          c.audio.currentTime = 0;
          resetProgress(c);
        }
        c.classList.remove('playing', 'blinking');
      });
    }
  });
}

/** Stop and reset all playing carts. */
function stopAll() {
  document.querySelectorAll('.cart.playing').forEach(c => {
    const dur = c.audio.duration || 0;
    fadeOut(c.audio, FADE_MS, () => {
      c.audio.pause();
      c.audio.currentTime = 0;
      c.classList.remove('playing', 'blinking');
      resetProgress(c);
      broadcastState(+c.dataset.idx, false, 0, dur ? formatTime(dur) : '', c.style.background || '');
    });
  });
  broadcastCartAction(-1, 'stopAll');
}

/**
 * Track progress of a playing cart via rAF.
 * @param {HTMLElement} cartEl
 */
function trackProgress(cartEl) {
  const audio = cartEl.audio;
  const progEl = cartEl.querySelector('.progress');
  const timeEl = cartEl.querySelector('.time');
  let lastBroadcastMs = 0;

  function tick() {
    if (audio.paused) return;
    const dur = audio.duration || 0;
    const rem = dur - audio.currentTime;
    if (dur) {
      const pct = (audio.currentTime / dur * 100).toFixed(2);
      progEl.style.width = pct + '%';
      const timeText = '-' + formatTime(rem);
      timeEl.textContent = timeText;
      cartEl.classList.toggle('blinking', rem <= 5);

      // Broadcast at most every 100ms
      const now = Date.now();
      if (now - lastBroadcastMs >= 100) {
        lastBroadcastMs = now;
        broadcastState(
          cartEl.dataset.idx,
          true,
          parseFloat(pct),
          timeText,
          cartEl.style.background || ''
        );
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/**
 * Reset progress bar and time display of a cart.
 * @param {HTMLElement} cartEl
 */
function resetProgress(cartEl) {
  cartEl.querySelector('.progress').style.width = '0%';
  const dur = cartEl.audio.duration || 0;
  cartEl.querySelector('.time').textContent = dur ? formatTime(dur) : '';
}

/* =============================================================
   4. FILE UTILITIES
   ============================================================= */

/**
 * Open the hidden file picker and call `cb` with the selected File.
 * @param {function(File):void} cb
 */
function pickFile(cb) {
  const picker = document.getElementById('filePicker');
  picker.value = '';
  picker.onchange = () => {
    const f = picker.files[0];
    if (f) cb(f);
  };
  picker.click();
}

/**
 * Assign an audio file to a cart element.
 * @param {HTMLElement} cartEl
 * @param {File} file
 */
function assignFile(cartEl, file) {
  cartEl.file = file;
  cartEl.classList.remove('empty');
  if (cartEl.objectURL) URL.revokeObjectURL(cartEl.objectURL);
  cartEl.objectURL = URL.createObjectURL(file);
  cartEl.audio.src = cartEl.objectURL;
  cartEl.audio.onloadedmetadata = () => {
    const name = file.name.replace(/\.[^.]+$/, ''); // strip extension
    cartEl.querySelector('.label').textContent = name;
    cartEl.querySelector('.time').textContent = formatTime(cartEl.audio.duration);
    broadcastCartMeta(cartEl); // sync label, color, duration to slaves
  };
}

/**
 * Clear a cart: stop audio, remove file reference, reset UI.
 * @param {HTMLElement} cartEl
 */
function clearCart(cartEl) {
  if (cartEl.objectURL) URL.revokeObjectURL(cartEl.objectURL);
  delete cartEl.file;
  cartEl.audio.pause();
  cartEl.audio.src = '';
  cartEl.objectURL = null;
  cartEl.classList.remove('playing', 'blinking', 'loop');
  cartEl.classList.add('empty');
  const idx = +cartEl.dataset.idx;
  cartEl.querySelector('.label').textContent = `Cartouche ${idx + 1}`;
  cartEl.querySelector('.time').textContent = '';
  cartEl.querySelector('.progress').style.width = '0%';
  cartEl.style.background = '';
}

/** Clear all carts after user confirmation. */
function clearAllFiles() {
  if (confirm('Confirmer la suppression de tous les fichiers et couleurs ?')) {
    document.querySelectorAll('.cart').forEach(clearCart);
  }
}

/* =============================================================
   5. CONTEXT MENU
   ============================================================= */

function buildContextMenu(cartEl) {
  const menu = document.getElementById('ctxMenu');
  menu.innerHTML = '';

  // Swatch row
  const swatchRow = document.createElement('div');
  swatchRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;';
  SWATCHES.forEach(hex => {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = hex;
    sw.title = hex;
    sw.onclick = () => {
      if (cartEl) {
        cartEl.style.background = hex;
        broadcastCartMeta(cartEl); // sync color change live
      }
      hideCtxMenu();
    };
    swatchRow.appendChild(sw);
  });
  menu.appendChild(swatchRow);

  // Add file button
  const btnFile = document.createElement('button');
  btnFile.textContent = '🎵 Ajouter un fichier…';
  btnFile.onclick = () => {
    if (cartEl) pickFile(f => assignFile(cartEl, f));
    hideCtxMenu();
  };
  menu.appendChild(btnFile);

  // Rename label
  const btnRename = document.createElement('button');
  btnRename.textContent = '✏️ Renommer…';
  btnRename.onclick = () => {
    if (cartEl) {
      const current = cartEl.querySelector('.label').textContent;
      const next = prompt('Nouveau nom :', current);
      if (next !== null && next.trim()) {
        cartEl.querySelector('.label').textContent = next.trim();
        broadcastCartMeta(cartEl); // sync label change live
      }
    }
    hideCtxMenu();
  };
  menu.appendChild(btnRename);

  // Clear cart
  const btnClear = document.createElement('button');
  btnClear.textContent = '🗑 Vider la cartouche';
  btnClear.onclick = () => {
    if (cartEl) clearCart(cartEl);
    hideCtxMenu();
  };
  menu.appendChild(btnClear);

  // Loop toggle
  const isLoop = cartEl && cartEl.audio.loop;
  const btnLoop = document.createElement('button');
  btnLoop.textContent = isLoop ? '🔁 Désactiver boucle' : '🔁 Activer boucle';
  if (isLoop) btnLoop.classList.add('active');
  btnLoop.onclick = () => {
    if (cartEl) {
      cartEl.audio.loop = !cartEl.audio.loop;
      cartEl.classList.toggle('loop', cartEl.audio.loop);
    }
    hideCtxMenu();
  };
  menu.appendChild(btnLoop);
}

function showCtxMenu(x, y, cartEl) {
  const menu = document.getElementById('ctxMenu');
  menu._target = cartEl;
  buildContextMenu(cartEl);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.bottom = 'auto';
  menu.style.display = 'flex';
  menu.style.flexDirection = 'column';

  // Clamp to viewport
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
  });
}

function showCtxMenuMobile(cartEl) {
  const menu = document.getElementById('ctxMenu');
  menu._target = cartEl;
  buildContextMenu(cartEl);
  menu.style.left = '0';
  menu.style.right = '0';
  menu.style.bottom = '0';
  menu.style.top = 'auto';
  menu.style.width = '100%';
  menu.style.display = 'flex';
  menu.style.flexDirection = 'column';
}

function hideCtxMenu() {
  const menu = document.getElementById('ctxMenu');
  menu.style.display = 'none';
  delete menu._target;
}

document.addEventListener('click', e => {
  const menu = document.getElementById('ctxMenu');
  if (menu && !menu.contains(e.target)) hideCtxMenu();
});

/* =============================================================
   6. PALETTE CONFIG  (Save / Load)
   ============================================================= */

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function dataURLtoBlob(dataURL) {
  const [meta, b64] = dataURL.split(',');
  const mime = meta.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Serialize the current palette to a downloadable JSON file. */
async function saveConfig() {
  const carts = Array.from(document.querySelectorAll('.cart'));
  const data = [];

  for (const c of carts) {
    let dataUrl = null;
    if (c.file) dataUrl = await readFileAsDataURL(c.file);
    data.push({
      background: c.style.background || '',
      label: c.querySelector('.label').textContent,
      loop: c.audio.loop,
      dataUrl,
    });
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cartwall-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

/** Load a saved palette JSON file. */
function loadConfig(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data) || data.length !== NB_CARTS) throw new Error('invalid');
      const carts = document.querySelectorAll('.cart');
      for (let i = 0; i < data.length; i++) {
        const el = carts[i];
        const cfg = data[i];
        el.style.background = cfg.background || '';
        el.querySelector('.label').textContent = cfg.label || `Cartouche ${i + 1}`;
        if (cfg.dataUrl) {
          const blob = dataURLtoBlob(cfg.dataUrl);
          const f = new File([blob], cfg.label, { type: blob.type });
          assignFile(el, f);
        } else {
          clearCart(el);
          el.querySelector('.label').textContent = cfg.label || `Cartouche ${i + 1}`;
        }
        el.audio.loop = !!cfg.loop;
        el.classList.toggle('loop', !!cfg.loop);
      }
    } catch {
      alert(`Fichier invalide — attendu un JSON de ${NB_CARTS} cartouches.`);
    }
  };
  reader.readAsText(file);
}

/* =============================================================
   7. CONTRÔLE À DISTANCE (PeerJS)
   ============================================================= */

let peer = null;   // our Peer instance
let hostConn = null;   // client → host connection
let clientConns = [];     // host → clients connections
let isHost = false;
let isClient = false;

/**
 * Generate a random room ID.
 * @returns {string}
 */
function randomRoomId() {
  return 'cw-' + Math.random().toString(36).slice(2, 9);
}

/**
 * Build a snapshot of the current palette (labels, colors) – no audio data.
 * @returns {Array}
 */
function buildPaletteSnapshot() {
  return Array.from(document.querySelectorAll('.cart')).map(c => ({
    idx: +c.dataset.idx,
    label: c.querySelector('.label').textContent,
    background: c.style.background || '',
    hasFile: !!c.file,
    loop: c.audio.loop,
    empty: c.classList.contains('empty'),
  }));
}

/**
 * Apply a palette snapshot received from host (client-side).
 * @param {Array} snapshot
 */
function applyPaletteSnapshot(snapshot) {
  const carts = document.querySelectorAll('.cart');
  snapshot.forEach(cfg => {
    const el = carts[cfg.idx];
    if (!el) return;
    el.querySelector('.label').textContent = cfg.label;
    el.style.background = cfg.background;
    el.classList.toggle('empty', cfg.empty);
    el.classList.toggle('loop', cfg.loop);
  });
}

/**
 * Broadcast cart metadata (label, color, state) to all clients.
 * Called after file assignment, rename, or color change.
 * @param {HTMLElement} cartEl
 */
function broadcastCartMeta(cartEl) {
  if (!isHost || clientConns.length === 0) return;
  const dur = cartEl.audio.duration || 0;
  const msg = {
    type: 'cartMeta',
    idx: +cartEl.dataset.idx,
    label: cartEl.querySelector('.label').textContent,
    background: cartEl.style.background || '',
    empty: cartEl.classList.contains('empty'),
    loop: cartEl.audio.loop,
    timeText: dur ? formatTime(dur) : '',
  };
  clientConns.forEach(conn => { if (conn.open) conn.send(msg); });
}

/**
 * Broadcast a cart action (play/pause/stop) to all connected clients (remotes).
 * @param {number|string} idx   Cart index or -1 for stopAll
 * @param {string}        action  'play'|'pause'|'stop'|'stopAll'
 */
function broadcastCartAction(idx, action) {
  if (!isHost) return;
  const msg = { type: 'action', idx, action };
  clientConns.forEach(conn => {
    if (conn.open) conn.send(msg);
  });
}

/**
 * Broadcast the visual state of a cart (playing, progress, time, color) to clients.
 * @param {number|string} idx
 * @param {boolean} playing
 * @param {number}  progress   Percentage 0-100
 * @param {string}  timeText   Formatted time string
 * @param {string}  background Cart background color
 */
function broadcastState(idx, playing, progress, timeText, background) {
  if (!isHost || clientConns.length === 0) return;
  const msg = { type: 'state', idx, playing, progress, timeText, background };
  clientConns.forEach(conn => {
    if (conn.open) conn.send(msg);
  });
}

/**
 * Handle a message received by the HOST from a client.
 * @param {object} msg
 */
function onHostReceive(msg) {
  if (msg.type === 'cartClick') {
    const carts = document.querySelectorAll('.cart');
    const cartEl = carts[msg.idx];
    if (cartEl && cartEl.audio.src) playPauseOrReset(cartEl);
    return;
  }
  if (msg.type === 'setting') {
    // Slave toggled Mix or 2nd-click mode — apply on master
    const el = document.getElementById(msg.key);
    if (el) {
      el.checked = msg.value;
      el.dispatchEvent(new Event('change'));
    }
    // Re-broadcast to other clients
    clientConns.forEach(conn => {
      if (conn.open) conn.send(msg);
    });
  }
}

/**
 * Handle a message received by the CLIENT from the host.
 * @param {object} msg
 */
function onClientReceive(msg) {
  const carts = document.querySelectorAll('.cart');

  if (msg.type === 'palette') {
    applyPaletteSnapshot(msg.snapshot);
    // Also apply toggle states if sent
    if (msg.mixMode !== undefined) {
      const el = document.getElementById('mixMode');
      if (el) el.checked = msg.mixMode;
    }
    if (msg.secondMode !== undefined) {
      const el = document.getElementById('secondModeCheckbox');
      if (el) el.checked = msg.secondMode;
    }
    // Close the modal silently
    document.getElementById('collabOverlay').classList.add('hidden');
    return;
  }

  if (msg.type === 'cartMeta') {
    // Live update of label, color, or file state from master
    const el = carts[msg.idx];
    if (!el) return;
    el.querySelector('.label').textContent = msg.label;
    el.style.background = msg.background;
    el.classList.toggle('empty', msg.empty);
    el.classList.toggle('loop', msg.loop);
    if (msg.timeText !== undefined) {
      const timeEl = el.querySelector('.time');
      if (timeEl) timeEl.textContent = msg.timeText;
    }
    return;
  }

  if (msg.type === 'state') {
    const el = carts[msg.idx];
    if (!el) return;
    const prog = el.querySelector('.progress');
    if (prog) prog.style.width = msg.progress + '%';
    el.classList.toggle('playing', msg.playing);
    // Update time display
    if (msg.timeText !== undefined) {
      const timeEl = el.querySelector('.time');
      if (timeEl) timeEl.textContent = msg.timeText;
    }
    // Update background color
    if (msg.background !== undefined) {
      el.style.background = msg.background;
    }
    return;
  }

  if (msg.type === 'action') {
    if (msg.action === 'stopAll') {
      carts.forEach(c => {
        c.classList.remove('playing', 'blinking');
        const prog = c.querySelector('.progress');
        if (prog) prog.style.width = '0%';
      });
      return;
    }
    const el = carts[msg.idx];
    if (!el) return;
    if (msg.action === 'play') {
      el.classList.add('playing');
    } else {
      el.classList.remove('playing', 'blinking');
      if (msg.action === 'stop') {
        const prog = el.querySelector('.progress');
        if (prog) prog.style.width = '0%';
      }
    }
    return;
  }

  if (msg.type === 'setting') {
    // Host broadcast a setting change
    const el = document.getElementById(msg.key);
    if (el) el.checked = msg.value;
  }
}

/**
 * Start as HOST: create a PeerJS instance with the given roomId.
 * @param {string} roomId
 */
function startHost(roomId) {
  isHost = true;
  peer = new Peer(roomId, { debug: 0 });

  peer.on('open', id => {
    console.log('[Contrôle à distance] Host ready, room:', id);
  });

  peer.on('connection', conn => {
    clientConns.push(conn);
    updatePeerCount();

    conn.on('open', () => {
      // Send current palette snapshot + toggle states
      conn.send({
        type: 'palette',
        snapshot: buildPaletteSnapshot(),
        mixMode: document.getElementById('mixMode').checked,
        secondMode: document.getElementById('secondModeCheckbox').checked,
      });
    });

    conn.on('data', msg => onHostReceive(msg));

    conn.on('close', () => {
      clientConns = clientConns.filter(c => c !== conn);
      updatePeerCount();
    });

    conn.on('error', err => {
      console.warn('[Contrôle à distance] Client connection error:', err);
      clientConns = clientConns.filter(c => c !== conn);
      updatePeerCount();
    });
  });

  peer.on('error', err => {
    console.error('[Contrôle à distance] Peer error:', err);
    alert('Erreur PeerJS : ' + err.type);
  });
}

/**
 * Connect as CLIENT to an existing host peer.
 * @param {string} roomId
 */
function startClient(roomId) {
  isClient = true;
  document.body.classList.add('is-client');
  peer = new Peer({ debug: 0 });

  peer.on('open', () => {
    hostConn = peer.connect(roomId, { reliable: true });

    hostConn.on('open', () => {
      console.log('[Contrôle à distance] Connected to host:', roomId);
    });

    hostConn.on('data', msg => onClientReceive(msg));

    hostConn.on('close', () => {
      isClient = false;
      document.body.classList.remove('is-client');
      console.warn('[Contrôle à distance] Connection closed by host.');
    });

    hostConn.on('error', err => {
      console.error('[Contrôle à distance] Connection error:', err);
    });
  });

  peer.on('error', err => {
    console.error('[Contrôle à distance] Peer error:', err);
  });
}

/** Update the peer count display in the host UI. */
function updatePeerCount() {
  const n = clientConns.length;
  document.getElementById('peerCount').textContent =
    n === 0 ? '' : `Collaborateurs : ${n}`;
}

/**
 * Initialize collaboration on page load.
 * Reads ?room=ID from the URL — if found → join as client; modal closes once connected.
 */
function initCollaboration() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');
  if (!roomId) return;

  // Mark body as client immediately (hides host-only buttons via CSS)
  document.body.classList.add('is-client');
  isClient = true;

  startClient(roomId);
}

/* =============================================================
   8. BOOTSTRAP / MAIN
   ============================================================= */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Build cart grid ──────────────────────────────────── */
  const grid = document.getElementById('grid');

  for (let i = 0; i < NB_CARTS; i++) {
    const cart = document.createElement('div');
    cart.className = 'cart empty';
    cart.dataset.idx = i;
    cart.innerHTML = `
      <div class="label">Cartouche ${i + 1}</div>
      <div class="time"></div>
      <div class="progress"></div>
    `;

    // Audio element
    cart.audio = new Audio();
    cart.audio.preload = 'auto';
    cart.audio.addEventListener('ended', () => {
      cart.classList.remove('playing', 'blinking');
      resetProgress(cart);
      const dur = cart.audio.duration || 0;
      const timeText = dur ? formatTime(dur) : '';
      broadcastState(i, false, 0, timeText, cart.style.background || '');
    });

    /* Click */
    cart.addEventListener('click', () => {
      if (isClient) {
        // Clients send a signal to the host
        if (hostConn && hostConn.open) {
          hostConn.send({ type: 'cartClick', idx: i });
        }
        return;
      }
      if (cart.audio.src) {
        playPauseOrReset(cart);
      } else {
        pickFile(f => assignFile(cart, f));
      }
    });

    /* Drag & drop */
    cart.addEventListener('dragover', e => e.preventDefault());
    cart.addEventListener('drop', e => {
      e.preventDefault();
      if (isClient) return;
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('audio/')) assignFile(cart, f);
    });

    /* Right-click context menu */
    cart.addEventListener('contextmenu', e => {
      if (isClient) return;
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY, cart);
    });

    /* Long press (mobile) */
    let longPressTimer;
    cart.addEventListener('touchstart', () => {
      longPressTimer = setTimeout(() => showCtxMenuMobile(cart), 600);
    });
    ['touchend', 'touchmove', 'touchcancel'].forEach(ev =>
      cart.addEventListener(ev, () => clearTimeout(longPressTimer))
    );

    grid.appendChild(cart);
  }

  /* ── Wire header buttons ──────────────────────────────── */
  document.getElementById('stopAll').onclick = stopAll;
  document.getElementById('clearAll').onclick = clearAllFiles;
  document.getElementById('savePalette').onclick = saveConfig;
  document.getElementById('loadPalette').onclick = () =>
    document.getElementById('paletteLoader').click();
  document.getElementById('paletteLoader').onchange = loadConfig;

  /* ── Hamburger menu ───────────────────────────────────── */
  const menuToggle = document.getElementById('menuToggle');
  const controls = document.getElementById('controls');
  menuToggle.onclick = () => controls.classList.toggle('open');
  document.addEventListener('click', e => {
    if (!controls.contains(e.target) && e.target !== menuToggle) {
      controls.classList.remove('open');
    }
  });

  /* ── 2nd-click mode: reset all paused-mid-play carts ─── */
  document.getElementById('secondModeCheckbox').addEventListener('change', function () {
    if (this.checked) {
      document.querySelectorAll('.cart').forEach(c => {
        const a = c.audio;
        if (a.src && a.paused && a.currentTime > 0) {
          a.currentTime = 0;
          c.classList.remove('playing', 'blinking');
          resetProgress(c);
        }
      });
    }
    // Slave: propagate setting to host
    if (isClient && hostConn && hostConn.open) {
      hostConn.send({ type: 'setting', key: 'secondModeCheckbox', value: this.checked });
    }
  });

  /* ── Mix mode: propagate to host if slave ─────────────── */
  document.getElementById('mixMode').addEventListener('change', function () {
    if (isClient && hostConn && hostConn.open) {
      hostConn.send({ type: 'setting', key: 'mixMode', value: this.checked });
    }
  });

  /* ── Collaboration modal ──────────────────────────────── */
  const overlay = document.getElementById('collabOverlay');
  const collabBtn = document.getElementById('collabBtn');
  const collabClose = document.getElementById('collabClose');
  const startHostBtn = document.getElementById('startHostBtn');
  const hostInfo = document.getElementById('hostInfo');
  const roomIdDisp = document.getElementById('roomIdDisplay');
  const roomLinkEl = document.getElementById('roomLink');
  const copyLinkBtn = document.getElementById('copyLinkBtn');

  collabBtn.onclick = () => overlay.classList.remove('hidden');
  collabClose.onclick = () => overlay.classList.add('hidden');
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });

  startHostBtn.onclick = () => {
    if (isHost) return; // already started
    const roomId = randomRoomId();
    startHost(roomId);

    const link = `${location.origin}${location.pathname}?room=${roomId}`;
    roomIdDisp.textContent = roomId;
    roomLinkEl.value = link;
    hostInfo.classList.remove('hidden');
    startHostBtn.disabled = true;
    startHostBtn.textContent = '✅ Session active';
  };

  copyLinkBtn.onclick = () => {
    navigator.clipboard.writeText(roomLinkEl.value).then(() => {
      copyLinkBtn.textContent = '✔ Copié !';
      setTimeout(() => (copyLinkBtn.textContent = '📋 Copier'), 2000);
    });
  };

  /* ── Initial layout & collab auto-join ───────────────── */
  resizeCarts();
  initCollaboration();
});
