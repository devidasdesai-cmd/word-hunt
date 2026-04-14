const socket = io();

const params = new URLSearchParams(window.location.search);
const roomCode = params.get('room');
let playerId = params.get('pid');

if (!roomCode || !playerId) window.location.href = '/';

let state = null;
let peekMode = false;  // client-only: waiting for card click to peek
let peekResults = {};       // cardId → { color, expires }
let timerInterval = null;   // setInterval handle for countdown
let abyssAnimating = false; // delay winner overlay until abyss animation finishes
const definitionCache = {}; // word → definition string

// ─── DOM refs ────────────────────────────────────────
const roomCodeDisplay  = document.getElementById('room-code-display');
const redRemaining     = document.getElementById('red-remaining');
const blueRemaining    = document.getElementById('blue-remaining');
const turnDot          = document.getElementById('turn-dot');
const turnText         = document.getElementById('turn-text');
const actionBar        = document.getElementById('action-bar');
const board            = document.getElementById('board');
const logEl            = document.getElementById('log');
const redPlayers       = document.getElementById('red-players');
const bluePlayers      = document.getElementById('blue-players');
const specPlayers      = document.getElementById('spec-players');
const specSection      = document.getElementById('spectators-section');
const headerRight      = document.getElementById('header-right');
const winnerOverlay    = document.getElementById('winner-overlay');
const winnerTitle      = document.getElementById('winner-title');
const winnerSub        = document.getElementById('winner-sub');
const winnerIcon       = document.getElementById('winner-icon');
const mobilePlayers    = document.getElementById('mobile-players');
const settingsOverlay  = document.getElementById('settings-overlay');

// ─── Settings overlay ────────────────────────────────
document.getElementById('settings-overlay-close').addEventListener('click', closeSettingsOverlay);
settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) closeSettingsOverlay(); });

function openSettingsOverlay() {
  refreshSettingsOverlayBody();
  settingsOverlay.style.display = 'flex';
  renderActionBar(); // update button's .open class
}

function closeSettingsOverlay() {
  settingsOverlay.style.display = 'none';
  renderActionBar(); // remove button's .open class
}

function refreshSettingsOverlayBody() {
  const body = document.getElementById('settings-overlay-body');
  if (!body || !state) return;
  body.innerHTML = '';
  body.appendChild(buildSettingsContent());
}

// ─── Copy invite link ────────────────────────────────
document.getElementById('copy-link-btn').addEventListener('click', () => {
  const text = `${window.location.origin}/?join=${roomCode}`;
  const btn  = document.getElementById('copy-link-btn');

  function onSuccess() {
    btn.style.color = '#27ae60';
    setTimeout(() => btn.style.color = '', 1500);
  }

  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); onSuccess(); } catch (_) {}
    document.body.removeChild(ta);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(fallback);
  } else {
    fallback();
  }
});

// ─── Socket events ───────────────────────────────────
// Re-emit join-room on every (re)connect so server-side closure variables
// (currentRoom, currentPlayerId) are always set — fixes powerups/actions
// silently failing after any socket reconnection.
socket.on('connect', () => {
  socket.emit('join-room', {
    roomCode,
    playerId,
    name: localStorage.getItem('wordhunt-name') || localStorage.getItem('wordrush-name') || 'Player',
  });
});

socket.on('room-joined', ({ playerId: assignedId }) => {
  if (assignedId && assignedId !== playerId) playerId = assignedId;
});

socket.on('game-state', (s) => {
  // Detect new log entries before overwriting state
  const prevFirst = state ? (state.log[0] || '') : '';
  const newFirst  = s.log[0] || '';

  // Exit peek mode if it's no longer our turn / guessing phase
  if (peekMode && (s.phase !== 'guessing' || s.myTeam !== s.currentTeam)) {
    peekMode = false;
    document.body.classList.remove('peek-mode');
  }

  state = s;

  if (newFirst && newFirst !== prevFirst) {
    if (newFirst.includes('found the Treasure')) showEventAnim('treasure', s.currentTeam);
    if (newFirst.includes('The Abyss')) {
      showEventAnim('abyss', s.currentTeam);
      abyssAnimating = true;
      setTimeout(() => { abyssAnimating = false; render(); }, 3000);
    }
  }

  render();
});

socket.on('peek-result', ({ cardId, color, isSafe }) => {
  peekMode = false;
  document.body.classList.remove('peek-mode');
  // Store result; it fades after 3s
  peekResults[cardId] = { color, isSafe, expires: Date.now() + 3000 };
  renderBoard();
  setTimeout(() => {
    delete peekResults[cardId];
    renderBoard();
  }, 3000);
});

socket.on('error', ({ message }) => alert(message));

// ─── Helpers ─────────────────────────────────────────
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Maps internal team identifiers to guild names
function teamLabel(team) { return team === 'red' ? 'Dawn' : 'Dusk'; }

function roleLabel(role) {
  if (role === 'spymaster') return 'Pathfinder';
  if (role === 'operative') return 'Seeker';
  return cap(role);
}
function roleBadgeShort(role) {
  return role === 'spymaster' ? 'Pathfinder' : 'Seeker';
}

// ─── Role selection overlay ───────────────────────────
const roleOverlay = document.getElementById('role-overlay');
const roleGrid    = document.getElementById('role-grid');

function renderRoleSelect() {
  roleGrid.innerHTML = '';

  const OPTIONS = [
    { team: 'red',  role: 'spymaster', css: 'role-btn-red-sp',  name: 'Pathfinder', desc: 'Holds the treasure map' },
    { team: 'blue', role: 'spymaster', css: 'role-btn-blue-sp', name: 'Pathfinder', desc: 'Holds the treasure map' },
    { team: 'red',  role: 'operative', css: 'role-btn-red-op',  name: 'Seeker',     desc: 'Hunts for treasure' },
    { team: 'blue', role: 'operative', css: 'role-btn-blue-op', name: 'Seeker',     desc: 'Hunts for treasure' },
  ];

  OPTIONS.forEach(opt => {
    const slotTaken = opt.role === 'spymaster' &&
      state.players.some(p => p.team === opt.team && p.role === 'spymaster');

    const btn = document.createElement('button');
    btn.className = `role-btn ${opt.css}${slotTaken ? ' role-btn-taken' : ''}`;
    btn.disabled = slotTaken;
    btn.innerHTML =
      `<span class="role-btn-team">${teamLabel(opt.team)} Guild</span>` +
      `<span class="role-btn-name">${opt.name}</span>` +
      `<span class="role-btn-desc">${slotTaken ? 'Already taken' : opt.desc}</span>`;
    if (!slotTaken) {
      btn.addEventListener('click', () => {
        socket.emit('set-team', { team: opt.team, role: opt.role });
      });
    }
    roleGrid.appendChild(btn);
  });
}

// ─── Main render ─────────────────────────────────────
function render() {
  if (!state) return;

  // Show role-select overlay when in lobby and no role picked yet
  if (state.phase === 'lobby' && !state.myTeam) {
    roleOverlay.style.display = 'flex';
    renderRoleSelect();
  } else {
    roleOverlay.style.display = 'none';
  }

  roomCodeDisplay.textContent = state.roomCode;

  const scores = state.scores || { red: 0, blue: 0 };
  redRemaining.textContent  = scores.red;
  blueRemaining.textContent = scores.blue;

  // Turn indicator
  if (state.phase !== 'lobby' && state.phase !== 'ended') {
    turnDot.className = `turn-dot ${state.currentTeam}`;
    const phase = state.phase === 'captain-clue' ? 'Pathfinder Charts' : 'On the Hunt';
    turnText.textContent = `${teamLabel(state.currentTeam)} — ${phase}`;
  } else if (state.phase === 'ended') {
    turnDot.className = 'turn-dot';
    turnText.textContent = state.winner === 'tie' ? 'Draw' : 'Game Over';
  } else {
    turnDot.className = 'turn-dot';
    turnText.textContent = state.rapidMode ? 'Awaiting — Rapid' : 'Awaiting Expedition';
  }

  renderHeaderRight();
  renderPlayers();
  renderMobilePlayers();
  renderBoard();
  renderActionBar();
  renderTimer();
  renderLog();
  renderOverlay();

  // Apply/remove colorblind mode class
  document.body.classList.toggle('cb-mode', !!state.colorBlindMode);

  // Keep settings overlay content fresh while it's open
  if (settingsOverlay.style.display !== 'none') refreshSettingsOverlayBody();
}

// ─── Header right ─────────────────────────────────────
function renderHeaderRight() {
  headerRight.innerHTML = '';

  const isCaptain = state.myRole === 'spymaster';
  const inGame    = state.phase !== 'lobby' && state.phase !== 'ended';

  // Icon buttons group — theme toggle + settings gear
  const iconGroup = document.createElement('div');
  iconGroup.className = 'header-icon-group';

  const sunSvg  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
  const moonSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

  const themeBtn = document.createElement('button');
  themeBtn.className = 'theme-toggle';
  themeBtn.title = 'Toggle dark/light mode';
  themeBtn.setAttribute('aria-label', 'Toggle theme');
  themeBtn.innerHTML = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark' ? sunSvg : moonSvg;
  themeBtn.addEventListener('click', () => {
    const next = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('wordhunt-theme', next);
    themeBtn.innerHTML = next === 'dark' ? sunSvg : moonSvg;
  });

  const gearBtn = document.createElement('button');
  gearBtn.className = 'settings-header-gear';
  gearBtn.title = 'Game Settings';
  gearBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  gearBtn.addEventListener('click', openSettingsOverlay);

  iconGroup.appendChild(themeBtn);
  iconGroup.appendChild(gearBtn);
  headerRight.appendChild(iconGroup);

  if (state.myTeam && state.myRole) {
    const badge = document.createElement('div');
    badge.className = 'my-role-bar';
    const teamColor = state.myTeam === 'red' ? 'var(--red-bright)' : 'var(--blue-bright)';
    badge.innerHTML =
      `<span class="role-bar-team" style="color:${teamColor}">${teamLabel(state.myTeam)}</span>` +
      `<span class="role-bar-divider">·</span>` +
      `<span class="role-bar-role">${roleLabel(state.myRole)}</span>`;
    headerRight.appendChild(badge);
  }

  if (isCaptain && inGame) {
    const controls = document.createElement('div');
    controls.className = 'spy-controls';

    const newBtn = document.createElement('button');
    newBtn.className = 'spy-btn spy-btn-new';
    newBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg> New Game`;
    newBtn.addEventListener('click', () => {
      if (confirm('Start a new game? This ends the current game for everyone.')) socket.emit('new-game');
    });

    const exitBtn = document.createElement('button');
    exitBtn.className = 'spy-btn spy-btn-exit';
    exitBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Exit`;
    exitBtn.addEventListener('click', () => window.location.href = '/');

    controls.appendChild(newBtn);
    controls.appendChild(exitBtn);
    headerRight.appendChild(controls);
  }
}

// ─── Side panel players ──────────────────────────────
// Sort within each team: spymaster (Pathfinder) first, then operatives (Seekers)
function sortByRole(players) {
  return [...players].sort((a, b) => {
    if (a.role === 'spymaster' && b.role !== 'spymaster') return -1;
    if (b.role === 'spymaster' && a.role !== 'spymaster') return 1;
    return 0;
  });
}

function renderPlayers() {
  redPlayers.innerHTML = '';
  bluePlayers.innerHTML = '';
  specPlayers.innerHTML = '';
  let hasSpec = false;

  const redSorted  = sortByRole(state.players.filter(p => p.team === 'red'));
  const blueSorted = sortByRole(state.players.filter(p => p.team === 'blue'));
  const unassigned = state.players.filter(p => !p.team);

  [...redSorted, ...blueSorted, ...unassigned].forEach(p => {
    const chip = document.createElement('div');
    chip.className = `player-chip${p.role === 'spymaster' ? ' spymaster' : ''}`;
    const badge = p.role ? `<span class="role-badge">${roleBadgeShort(p.role)}</span>` : '';
    chip.innerHTML = `${badge}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(p.name)}${p.id === playerId ? ' ★' : ''}</span>`;

    if (p.team === 'red') redPlayers.appendChild(chip);
    else if (p.team === 'blue') bluePlayers.appendChild(chip);
    else { specPlayers.appendChild(chip); hasSpec = true; }
  });

  specSection.style.display = hasSpec ? '' : 'none';
}

// ─── Mobile players strip ────────────────────────────
function renderMobilePlayers() {
  mobilePlayers.innerHTML = '';
  if (state.phase === 'lobby') { mobilePlayers.style.display = 'none'; return; }
  mobilePlayers.style.display = '';

  ['red', 'blue'].forEach(team => {
    const players = sortByRole(state.players.filter(p => p.team === team));
    if (!players.length) return;
    const group = document.createElement('div');
    group.className = `mob-team mob-team-${team}`;
    players.forEach(p => {
      const chip = document.createElement('span');
      chip.className = `mob-chip${p.role === 'spymaster' ? ' mob-spy' : ''}`;
      chip.textContent = p.name + (p.id === playerId ? ' ★' : '');
      group.appendChild(chip);
    });
    mobilePlayers.appendChild(group);
  });
}

// ─── Board ───────────────────────────────────────────
// 3-4-5-4-3 hexagonal layout (19 cards total)
const HEX_ROWS = [3, 4, 5, 4, 3];

function renderBoard() {
  board.innerHTML = '';
  const isScoutTurn = state.phase === 'guessing' &&
                      state.myTeam === state.currentTeam &&
                      state.myRole === 'operative';

  let cardIndex = 0;
  HEX_ROWS.forEach(size => {
    const row = document.createElement('div');
    row.className = `hex-row hex-row-${size}`;

    for (let i = 0; i < size; i++) {
      const card = state.cards[cardIndex++];
      if (!card) continue;

      const el = document.createElement('div');
      el.className = 'card';

      if (card.revealed) {
        el.classList.add('revealed', `revealed-${card.color}`);
      } else {
        // Spymaster color hints
        if (card.color) {
          el.classList.add(`hint-${card.color}`);
          const dot = document.createElement('div');
          dot.className = 'color-dot';
          dot.style.background = dotColor(card.color);
          el.appendChild(dot);

          // Subtle emoji marker on treasure and abyss tiles for Pathfinders
          if (state.myRole === 'spymaster' && (card.color === 'treasure' || card.color === 'abyss')) {
            const emojiEl = document.createElement('div');
            emojiEl.className = 'card-tile-emoji';
            emojiEl.textContent = card.color === 'treasure' ? '💰' : '🌀';
            el.appendChild(emojiEl);
          }
        }

        // Peek result overlay (private to this client)
        const peek = peekResults[card.id];
        if (peek) {
          el.classList.add(`peek-${peek.isSafe ? 'safe' : 'danger'}`);
          const overlay = document.createElement('div');
          overlay.className = 'peek-overlay';
          overlay.textContent = peek.isSafe ? 'SAFE' : 'UNSAFE';
          el.appendChild(overlay);
        }

        if (peekMode && isScoutTurn) {
          el.classList.add('clickable', 'peekable');
          el.addEventListener('click', () => {
            socket.emit('use-peek', { cardId: card.id });
          });
        } else if (isScoutTurn && !peekMode) {
          el.classList.add('clickable');
          el.addEventListener('click', () => {
            socket.emit('guess-card', { cardId: card.id });
          });
        }
      }

      const wordEl = document.createElement('div');
      wordEl.className = 'card-word';
      wordEl.textContent = card.word;
      el.appendChild(wordEl);

      // Definition lookup: pathfinders can hover any unrevealed card
      if (state.definitionLookup && state.myRole === 'spymaster' && !card.revealed) {
        el.classList.add('has-definition');
        el.addEventListener('mouseenter', (e) => {
          showWordTooltip(card.word, e.clientX, e.clientY);
        });
        el.addEventListener('mousemove', (e) => {
          positionTooltip(document.getElementById('word-tooltip'), e.clientX, e.clientY);
        });
        el.addEventListener('mouseleave', hideWordTooltip);
      }

      row.appendChild(el);
    }

    board.appendChild(row);
  });
}

function dotColor(color) {
  if (color === 'red')      return '#e74c3c';
  if (color === 'blue')     return '#3498db';
  if (color === 'abyss')    return '#2c0a3e';
  if (color === 'treasure') return '#f0c040';
  return '#555';
}

function peekColorLabel(color) {
  if (color === 'abyss')    return 'ABYSS';
  if (color === 'neutral')  return 'NEUTRAL';
  if (color === 'treasure') return 'TREASURE';
  if (color === 'red')      return 'RED';
  return 'BLUE';
}

// ─── Action bar ──────────────────────────────────────
function renderActionBar() {
  actionBar.innerHTML = '';

  const inActiveGame = state.phase !== 'lobby' && state.phase !== 'ended';
  if (inActiveGame && !state.myTeam) { renderMidGameJoin(); return; }

  if (state.phase === 'lobby') {
    renderLobbyActions();
  } else if (state.phase === 'captain-clue') {
    if (state.myRole === 'spymaster' && state.myTeam === state.currentTeam) {
      renderClueForm();
    }
  } else if (state.phase === 'guessing') {
    renderGuessingBar();
  }
}

function buildSettingsRow(label, desc, active, onClick, disabled) {
  // Use a real <button> so clicks are reliably captured in the overlay context
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-inline-row';

  if (disabled) {
    row.disabled = true;
    row.title = 'Can only be changed in the lobby';
  } else {
    row.addEventListener('click', onClick);
  }

  const grp = document.createElement('div');
  grp.className = 'settings-inline-label-group';
  const lbl = document.createElement('div');
  lbl.className = 'settings-inline-label';
  lbl.textContent = label;
  const dsc = document.createElement('div');
  dsc.className = 'settings-inline-desc';
  dsc.textContent = desc;
  grp.appendChild(lbl);
  grp.appendChild(dsc);
  row.appendChild(grp);

  const sw = document.createElement('div');
  sw.className = `toggle-switch${active ? ' on' : ''}`;
  sw.style.flexShrink = '0';
  sw.style.pointerEvents = 'none'; // let clicks pass through to the button
  const knob = document.createElement('div');
  knob.className = 'toggle-knob';
  sw.appendChild(knob);
  row.appendChild(sw);
  return row;
}

function buildSettingsContent() {
  const panel = document.createElement('div');
  panel.className = 'settings-inline';

  const inLobby = state.phase === 'lobby';

  // ── Rapid Mode ───────────────────────────────────
  const rapidRow = buildSettingsRow(
    'Rapid Mode',
    inLobby ? 'Sets a turn timer for each guessing phase' : 'Sets a turn timer for each guessing phase · Lobby only',
    state.rapidMode,
    () => socket.emit('set-rapid-mode', { enabled: !state.rapidMode, duration: state.rapidDuration || 60 }),
    !inLobby
  );

  if (state.rapidMode) {
    // Embed duration input inline between label group and toggle switch
    const durInput = document.createElement('input');
    durInput.type = 'number';
    durInput.className = 'duration-input settings-dur-inline';
    durInput.value = state.rapidDuration || 60;
    durInput.min = 15;
    durInput.max = 300;
    durInput.step = 5;
    durInput.title = 'Seconds per turn';
    durInput.addEventListener('click', e => e.stopPropagation());
    durInput.addEventListener('mousedown', e => e.stopPropagation());
    durInput.addEventListener('change', () => {
      const dur = Math.max(15, Math.min(300, parseInt(durInput.value) || 60));
      durInput.value = dur;
      socket.emit('set-rapid-mode', { enabled: true, duration: dur });
    });
    // Insert before the toggle switch (last child of the row)
    rapidRow.insertBefore(durInput, rapidRow.lastChild);
  }

  panel.appendChild(rapidRow);

  const hr1 = document.createElement('div');
  hr1.className = 'settings-inline-hr';
  panel.appendChild(hr1);

  // ── Word Definitions ─────────────────────────────
  panel.appendChild(buildSettingsRow(
    'Word Definitions',
    inLobby ? 'Pathfinders can hover words to see their meaning' : 'Pathfinders can hover words to see their meaning · Lobby only',
    state.definitionLookup,
    () => socket.emit('set-definition-mode', { enabled: !state.definitionLookup }),
    !inLobby
  ));

  const hr2 = document.createElement('div');
  hr2.className = 'settings-inline-hr';
  panel.appendChild(hr2);

  // ── Power-ups ────────────────────────────────────
  panel.appendChild(buildSettingsRow(
    'Power-ups',
    'Seekers can use Peek and Shield relics during play',
    state.powerupsEnabled !== false,
    () => {
      const next = !(state.powerupsEnabled !== false);
      // Optimistic update: reflect immediately, server confirms
      if (state) state.powerupsEnabled = next;
      refreshSettingsOverlayBody();
      socket.emit('set-powerups-mode', { enabled: next });
    }
  ));

  const hr3 = document.createElement('div');
  hr3.className = 'settings-inline-hr';
  panel.appendChild(hr3);

  // ── Color Blind Mode ─────────────────────────────
  panel.appendChild(buildSettingsRow(
    'Color Blind Mode',
    'Replaces red with orange and abyss with teal for clearer distinction',
    !!state.colorBlindMode,
    () => {
      const next = !state.colorBlindMode;
      // Apply immediately to the page (no round-trip needed for visual effect)
      document.body.classList.toggle('cb-mode', next);
      if (state) state.colorBlindMode = next;
      refreshSettingsOverlayBody();
      socket.emit('set-colorblind-mode', { enabled: next });
    }
  ));

  return panel;
}

function renderLobbyActions() {
  const wrap = document.createElement('div');
  wrap.className = 'lobby-actions';

  const startBtn = document.createElement('button');
  startBtn.className = 'start-btn';
  startBtn.textContent = 'Begin Expedition';
  startBtn.addEventListener('click', () => socket.emit('start-game'));
  wrap.appendChild(startBtn);

  const settOpen = settingsOverlay.style.display !== 'none';
  const settBtn  = document.createElement('button');
  settBtn.className = `settings-toggle-btn${settOpen ? ' open' : ''}`;
  settBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Game Settings`;
  settBtn.addEventListener('click', openSettingsOverlay);
  wrap.appendChild(settBtn);

  actionBar.appendChild(wrap);
}

function renderMidGameJoin() {
  const wrap = document.createElement('div');
  wrap.className = 'lobby-actions';

  const label = document.createElement('span');
  label.className = 'waiting-msg';
  label.textContent = 'Join as Seeker:';
  wrap.appendChild(label);

  ['red', 'blue'].forEach(team => {
    const btn = document.createElement('button');
    btn.className = `team-pick-btn ${team}-op`;
    btn.innerHTML = `${teamLabel(team)} <span class="role-label">Seeker</span>`;
    btn.addEventListener('click', () => socket.emit('set-team', { team, role: 'operative' }));
    wrap.appendChild(btn);
  });

  actionBar.appendChild(wrap);
}

function renderClueForm() {
  const form = document.createElement('div');
  form.className = 'clue-form';

  const teamColor = state.currentTeam === 'red' ? '#e74c3c' : '#3498db';

  const label = document.createElement('span');
  label.className = 'clue-label';
  label.style.color = teamColor;
  label.textContent = 'Your Clue:';

  const wordInput = document.createElement('input');
  wordInput.type = 'text';
  wordInput.className = 'clue-word-input';
  wordInput.placeholder = 'One word…';
  wordInput.maxLength = 30;
  wordInput.autocomplete = 'off';
  wordInput.addEventListener('input', () => {
    wordInput.value = wordInput.value.replace(/\s/g, '').toUpperCase();
  });

  const countInput = document.createElement('input');
  countInput.type = 'number';
  countInput.className = 'clue-count-input';
  countInput.placeholder = '#';
  countInput.min = 0;
  countInput.max = 9;
  countInput.inputMode = 'numeric';

  const giveBtn = document.createElement('button');
  giveBtn.className = 'give-clue-btn';
  giveBtn.textContent = 'Give Clue';

  function submit() {
    const w = wordInput.value.trim();
    const n = countInput.value;
    if (!w || n === '') return;
    socket.emit('give-clue', { word: w, count: parseInt(n) });
  }

  giveBtn.addEventListener('click', submit);
  countInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  wordInput.addEventListener('keydown', e => { if (e.key === 'Enter') countInput.focus(); });

  form.appendChild(label);
  form.appendChild(wordInput);
  form.appendChild(countInput);
  form.appendChild(giveBtn);
  actionBar.appendChild(form);
  wordInput.focus();
}

function renderGuessingBar() {
  const wrap = document.createElement('div');
  wrap.className = 'guessing-layout';

  const teamColor = state.currentTeam === 'red' ? '#e74c3c' : '#3498db';
  const isMyTurn  = state.myTeam === state.currentTeam && state.myRole === 'operative';
  const pu        = state.powerups?.[state.currentTeam];
  const puEnabled = state.powerupsEnabled !== false;

  // ── Row 1: clue display ──
  if (state.clue) {
    const clueDisp = document.createElement('div');
    clueDisp.className = 'clue-display';
    const word = document.createElement('span');
    word.className = 'clue-word-display';
    word.style.color = teamColor;
    word.textContent = state.clue.word;
    const count = document.createElement('span');
    count.className = 'clue-count-display';
    count.textContent = state.clue.count === 0 ? '' : `for ${state.clue.count}`;
    clueDisp.appendChild(word);
    if (state.clue.count !== 0) clueDisp.appendChild(count);
    wrap.appendChild(clueDisp);
  }

  // ── Row 2: relics + end-turn ──
  if (isMyTurn) {
    const controlsRow = document.createElement('div');
    controlsRow.className = 'guessing-controls';

    if (pu && puEnabled) {
      const relicRow = document.createElement('div');
      relicRow.className = 'relic-row';

      // Peek relic
      const peekSpent = pu.peek <= 0;
      const peekCard  = document.createElement('div');
      peekCard.className = `relic-card relic-peek${peekMode ? ' relic-active' : ''}${peekSpent ? ' relic-spent' : ''}`;
      peekCard.title = 'Reveal a tile\'s nature before committing';
      peekCard.innerHTML = `
        <div class="relic-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </div>
        <span class="relic-name">Peek</span>`;
      if (!peekSpent) {
        peekCard.addEventListener('click', () => {
          peekMode = !peekMode;
          document.body.classList.toggle('peek-mode', peekMode);
          renderActionBar();
          renderBoard();
        });
      }
      relicRow.appendChild(peekCard);

      // Shield relic
      const shieldSpent = pu.shield <= 0 && !pu.shieldActive;
      const shieldCard  = document.createElement('div');
      shieldCard.className = `relic-card relic-shield${pu.shieldActive ? ' relic-active' : ''}${shieldSpent ? ' relic-spent' : ''}`;
      shieldCard.title = 'Block one bad guess from costing a turn';
      shieldCard.innerHTML = `
        <div class="relic-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <span class="relic-name">Shield</span>`;
      if (!shieldSpent) {
        shieldCard.addEventListener('click', () => socket.emit('activate-shield'));
      }
      relicRow.appendChild(shieldCard);

      controlsRow.appendChild(relicRow);
    }

    const endBtn = document.createElement('button');
    endBtn.className = 'end-turn-btn';
    endBtn.textContent = 'Take a Nap';
    endBtn.addEventListener('click', () => socket.emit('end-turn'));
    controlsRow.appendChild(endBtn);

    wrap.appendChild(controlsRow);

    // ── Row 3: active hint text ──
    const peekActive   = pu && puEnabled && peekMode;
    const shieldActive = pu && puEnabled && pu.shieldActive;
    if (peekActive || shieldActive) {
      const hint = document.createElement('div');
      hint.className = 'relic-active-hint';
      hint.textContent = peekActive
        ? 'Peek active — select a tile to reveal its nature'
        : 'Shield active — your next wrong guess won\'t end the turn';
      wrap.appendChild(hint);
    }
  }

  actionBar.appendChild(wrap);
}

// ─── Timer ───────────────────────────────────────────
function renderTimer() {
  // Clear previous interval
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  let timerEl = document.getElementById('rapid-timer');
  if (!timerEl) {
    timerEl = document.createElement('div');
    timerEl.id = 'rapid-timer';
    timerEl.className = 'rapid-timer';
    // Insert just above the board
    board.parentElement.insertBefore(timerEl, board);
  }

  if (state.phase !== 'guessing' || !state.rapidMode || !state.timerEnd) {
    timerEl.style.display = 'none';
    return;
  }

  function tick() {
    const secs = Math.max(0, Math.ceil((state.timerEnd - Date.now()) / 1000));
    timerEl.textContent = `${secs}s`;
    timerEl.className = `rapid-timer${secs <= 10 ? ' urgent' : ''}`;
    timerEl.style.display = '';
    if (secs <= 0) { clearInterval(timerInterval); timerInterval = null; }
  }

  tick();
  timerInterval = setInterval(tick, 250);
}

// ─── Log ────────────────────────────────────────────
function renderLog() {
  logEl.innerHTML = '';
  (state.log || []).forEach(entry => {
    const el = document.createElement('div');
    el.className = 'log-entry';
    el.textContent = entry;
    logEl.appendChild(el);
  });
}

// ─── Winner overlay ──────────────────────────────────
function renderOverlay() {
  if (state.phase === 'ended' && !abyssAnimating) {
    winnerOverlay.style.display = 'flex';
    const scores = state.scores || { red: 0, blue: 0 };
    const scoreStr = `Red: ${scores.red} pts  ·  Blue: ${scores.blue} pts`;

    if (state.winner === 'tie') {
      winnerIcon.textContent = '🤝';
      winnerTitle.textContent = "It's a Tie!";
      winnerTitle.style.color = '#f0c040';
      winnerSub.textContent = scoreStr;
    } else {
      const isRed = state.winner === 'red';
      winnerIcon.textContent = isRed ? '🔴' : '🔵';
      winnerTitle.textContent = `${cap(state.winner)} Team Wins!`;
      winnerTitle.style.color = isRed ? '#e74c3c' : '#3498db';
      winnerSub.textContent = scoreStr;
    }

    document.getElementById('new-game-btn').onclick = () => {
      socket.emit('new-game');
      winnerOverlay.style.display = 'none';
    };
  } else {
    winnerOverlay.style.display = 'none';
  }
}

// ─── Event Animations ────────────────────────────
function showEventAnim(type, team) {
  const el  = document.getElementById(`${type}-anim`);
  const sub = document.getElementById(`${type}-anim-sub`);
  if (!el || !sub) return;

  sub.textContent = type === 'treasure'
    ? `${teamLabel(team)} Guild claims the prize!`
    : `${teamLabel(team)} Guild falls into the void…`;

  el.classList.remove('visible');
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add('visible');

  clearTimeout(el._animTimer);
  el._animTimer = setTimeout(() => el.classList.remove('visible'), 5000);
}

// ─── Definition Lookup ───────────────────────────
async function fetchDefinition(word) {
  const key = word.toLowerCase();
  if (definitionCache[key] !== undefined) return definitionCache[key];
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`);
    if (!res.ok) { definitionCache[key] = null; return null; }
    const data = await res.json();
    const entry = data[0];
    const meaning = entry.meanings[0];
    const def = meaning.definitions[0];
    const text = `${meaning.partOfSpeech}: ${def.definition}`;
    definitionCache[key] = text;
    return text;
  } catch {
    definitionCache[key] = null;
    return null;
  }
}

function showWordTooltip(word, x, y) {
  const tip = document.getElementById('word-tooltip');
  if (!tip) return;
  tip.textContent = 'Loading…';
  tip.classList.add('visible');
  positionTooltip(tip, x, y);
  fetchDefinition(word).then(def => {
    if (!tip.classList.contains('visible')) return;
    tip.textContent = def || 'No definition found.';
    positionTooltip(tip, x, y);
  });
}

function hideWordTooltip() {
  const tip = document.getElementById('word-tooltip');
  if (tip) tip.classList.remove('visible');
}

function positionTooltip(tip, x, y) {
  const margin = 12;
  tip.style.left = '0';
  tip.style.top  = '0';
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = x + margin;
  let top  = y - th / 2;
  if (left + tw > window.innerWidth - margin) left = x - tw - margin;
  if (top < margin) top = margin;
  if (top + th > window.innerHeight - margin) top = window.innerHeight - th - margin;
  tip.style.left = `${left}px`;
  tip.style.top  = `${top}px`;
}

