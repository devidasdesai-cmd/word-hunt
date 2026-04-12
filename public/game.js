const socket = io();

const params = new URLSearchParams(window.location.search);
const roomCode = params.get('room');
let playerId = params.get('pid');

if (!roomCode || !playerId) window.location.href = '/';

let state = null;
let peekMode = false;       // client-only: waiting for card click to peek
let peekResults = {};       // cardId → { color, expires }
let timerInterval = null;   // setInterval handle for countdown

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

// ─── Copy invite link ────────────────────────────────
document.getElementById('copy-link-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(`${window.location.origin}/?join=${roomCode}`).catch(() => {});
  const btn = document.getElementById('copy-link-btn');
  btn.style.color = '#27ae60';
  setTimeout(() => btn.style.color = '', 1500);
});

// ─── Socket events ───────────────────────────────────
socket.emit('join-room', {
  roomCode,
  playerId,
  name: localStorage.getItem('wordrush-name') || 'Player',
});

socket.on('room-joined', ({ playerId: assignedId }) => {
  if (assignedId && assignedId !== playerId) playerId = assignedId;
});

socket.on('game-state', (s) => {
  state = s;
  // Exit peek mode if it's no longer our turn / guessing phase
  if (peekMode && (s.phase !== 'guessing' || s.myTeam !== s.currentTeam)) {
    peekMode = false;
    document.body.classList.remove('peek-mode');
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

function roleLabel(role) {
  if (role === 'spymaster') return 'Pathfinder';
  if (role === 'operative') return 'Seeker';
  return cap(role);
}
function roleBadgeShort(role) {
  return role === 'spymaster' ? 'Pathfinder' : 'Seeker';
}

// ─── Main render ─────────────────────────────────────
function render() {
  if (!state) return;

  roomCodeDisplay.textContent = state.roomCode;

  const redLeft  = state.cards.filter(c => c.color === 'red'  && !c.revealed).length;
  const blueLeft = state.cards.filter(c => c.color === 'blue' && !c.revealed).length;
  redRemaining.textContent  = redLeft;
  blueRemaining.textContent = blueLeft;

  // Turn indicator
  if (state.phase !== 'lobby' && state.phase !== 'ended') {
    turnDot.className = `turn-dot ${state.currentTeam}`;
    const team  = state.currentTeam === 'red' ? 'Red' : 'Blue';
    const phase = state.phase === 'captain-clue' ? 'Pathfinder Clue' : 'Guessing';
    turnText.textContent = `${team} — ${phase}`;
  } else if (state.phase === 'ended') {
    turnDot.className = 'turn-dot';
    turnText.textContent = 'Game Over';
  } else {
    turnDot.className = 'turn-dot';
    turnText.textContent = state.rapidMode ? 'Lobby — Rapid Mode' : 'Lobby';
  }

  renderHeaderRight();
  renderPlayers();
  renderMobilePlayers();
  renderBoard();
  renderActionBar();
  renderTimer();
  renderLog();
  renderOverlay();
}

// ─── Header right ─────────────────────────────────────
function renderHeaderRight() {
  headerRight.innerHTML = '';

  const isCaptain = state.myRole === 'spymaster';
  const inGame    = state.phase !== 'lobby' && state.phase !== 'ended';

  if (state.myTeam && state.myRole) {
    const badge = document.createElement('div');
    badge.className = 'my-role-bar';
    const color = state.myTeam === 'red' ? '#e74c3c' : '#3498db';
    badge.innerHTML = `<span style="color:${color}">${cap(state.myTeam)}</span> <span>${roleLabel(state.myRole)}</span>`;
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
function renderPlayers() {
  redPlayers.innerHTML = '';
  bluePlayers.innerHTML = '';
  specPlayers.innerHTML = '';
  let hasSpec = false;

  state.players.forEach(p => {
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
    const players = state.players.filter(p => p.team === team);
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
function renderBoard() {
  board.innerHTML = '';
  const isScoutTurn = state.phase === 'guessing' &&
                      state.myTeam === state.currentTeam &&
                      state.myRole === 'operative';

  state.cards.forEach(card => {
    const el = document.createElement('div');
    el.className = 'card';

    if (card.revealed) {
      el.classList.add('revealed', `revealed-${card.color}`);
    } else {
      // Captain hints
      if (card.color) {
        el.classList.add(`hint-${card.color}`);
        const dot = document.createElement('div');
        dot.className = 'color-dot';
        dot.style.background = dotColor(card.color);
        el.appendChild(dot);
      }

      // Peek result overlay (private to this client)
      const peek = peekResults[card.id];
      if (peek) {
        el.classList.add(`peek-${peek.isSafe ? 'safe' : 'danger'}`);
        const overlay = document.createElement('div');
        overlay.className = 'peek-overlay';
        overlay.textContent = peek.isSafe ? 'SAFE' : peekColorLabel(peek.color);
        el.appendChild(overlay);
      }

      if (peekMode && isScoutTurn) {
        // In peek mode: clicks peek, not guess
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

    board.appendChild(el);
  });
}

function dotColor(color) {
  return color === 'red' ? '#e74c3c' : color === 'blue' ? '#3498db' :
         color === 'assassin' ? '#555' : '#666';
}

function peekColorLabel(color) {
  return color === 'assassin' ? 'DANGER' :
         color === 'neutral'  ? 'NEUTRAL' :
         color === 'red'      ? 'RED' : 'BLUE';
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
    } else {
      const msg = document.createElement('div');
      msg.className = 'waiting-msg';
      const team = state.currentTeam === 'red' ? 'Red' : 'Blue';
      msg.textContent = `Waiting for ${team} Pathfinder to give a clue…`;
      actionBar.appendChild(msg);
    }
  } else if (state.phase === 'guessing') {
    renderGuessingBar();
  }
}

function renderLobbyActions() {
  const wrap = document.createElement('div');
  wrap.className = 'lobby-actions';

  const { myTeam, myRole } = state;

  function makeBtn(label, sublabel, teamVal, roleVal, cssClass) {
    const btn = document.createElement('button');
    btn.className = `team-pick-btn ${cssClass}`;
    if (myTeam === teamVal && myRole === roleVal) btn.classList.add('active');
    btn.innerHTML = `${label}<span class="role-label">${sublabel}</span>`;
    btn.addEventListener('click', () => socket.emit('set-team', { team: teamVal, role: roleVal }));
    return btn;
  }

  wrap.appendChild(makeBtn('Red',  'Seeker',      'red',  'operative', 'red-op'));
  wrap.appendChild(makeBtn('Red',  'Pathfinder',  'red',  'spymaster', 'red-sp'));
  wrap.appendChild(makeBtn('Blue', 'Seeker',      'blue', 'operative', 'blue-op'));
  wrap.appendChild(makeBtn('Blue', 'Pathfinder',  'blue', 'spymaster', 'blue-sp'));

  const startBtn = document.createElement('button');
  startBtn.className = 'start-btn';
  startBtn.textContent = 'Start Game';
  startBtn.addEventListener('click', () => socket.emit('start-game'));
  wrap.appendChild(startBtn);

  // Rapid mode toggle
  const rapidToggle = document.createElement('button');
  rapidToggle.className = `rapid-toggle${state.rapidMode ? ' active' : ''}`;
  rapidToggle.title = 'Enable 60-second timer per guessing turn';
  rapidToggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Rapid${state.rapidMode ? ' ON' : ' OFF'}`;
  rapidToggle.addEventListener('click', () => socket.emit('set-rapid-mode', { enabled: !state.rapidMode }));
  wrap.appendChild(rapidToggle);

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
    btn.innerHTML = `${cap(team)}<span class="role-label">Seeker</span>`;
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
  const bar = document.createElement('div');
  bar.className = 'status-bar';

  const teamColor = state.currentTeam === 'red' ? '#e74c3c' : '#3498db';
  const isMyTurn  = state.myTeam === state.currentTeam && state.myRole === 'operative';
  const pu        = state.powerups?.[state.currentTeam];

  // Clue display
  if (state.clue) {
    const clueDisp = document.createElement('div');
    clueDisp.className = 'clue-display';

    const word = document.createElement('span');
    word.className = 'clue-word-display';
    word.style.color = teamColor;
    word.textContent = state.clue.word;

    const count = document.createElement('span');
    count.className = 'clue-count-display';
    count.textContent = state.clue.count === 0 ? '∞' : state.clue.count;

    clueDisp.appendChild(word);
    clueDisp.appendChild(count);
    bar.appendChild(clueDisp);
  }

  // Guesses left
  const gl = state.guessesLeft === Infinity ? '∞' : state.guessesLeft;
  const guessesEl = document.createElement('span');
  guessesEl.className = 'guesses-left';
  guessesEl.textContent = `${gl} guess${gl !== 1 ? 'es' : ''} left`;
  bar.appendChild(guessesEl);

  if (isMyTurn) {
    // ── Power-ups ──────────────────────────────────
    if (pu) {
      const puRow = document.createElement('div');
      puRow.className = 'powerup-row';

      // Peek button
      const peekBtn = document.createElement('button');
      peekBtn.className = `powerup-btn peek-btn${peekMode ? ' active' : ''}${pu.peek <= 0 ? ' used' : ''}`;
      peekBtn.disabled = pu.peek <= 0;
      peekBtn.title = 'Peek at one card to see if it is safe';
      peekBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Peek${pu.peek <= 0 ? ' (used)' : ''}`;
      peekBtn.addEventListener('click', () => {
        peekMode = !peekMode;
        document.body.classList.toggle('peek-mode', peekMode);
        renderBoard(); // refresh clickable state
      });
      puRow.appendChild(peekBtn);

      // Shield button
      const shieldBtn = document.createElement('button');
      const shieldActive = pu.shieldActive;
      shieldBtn.className = `powerup-btn shield-btn${shieldActive ? ' active' : ''}${pu.shield <= 0 && !shieldActive ? ' used' : ''}`;
      shieldBtn.disabled = pu.shield <= 0 && !shieldActive;
      shieldBtn.title = 'Activate shield to block one bad guess';
      shieldBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Shield${pu.shield <= 0 && !shieldActive ? ' (used)' : shieldActive ? ' (on)' : ''}`;
      shieldBtn.addEventListener('click', () => socket.emit('activate-shield'));
      puRow.appendChild(shieldBtn);

      bar.appendChild(puRow);
    }

    // End turn button
    const endBtn = document.createElement('button');
    endBtn.className = 'end-turn-btn';
    endBtn.textContent = 'End Turn';
    endBtn.addEventListener('click', () => socket.emit('end-turn'));
    bar.appendChild(endBtn);
  } else {
    const waitMsg = document.createElement('span');
    waitMsg.className = 'waiting-msg';
    const team = state.currentTeam === 'red' ? 'Red' : 'Blue';
    waitMsg.textContent = `${team} team is guessing…`;
    bar.appendChild(waitMsg);
  }

  // Shield-active banner
  if (pu?.shieldActive) {
    const shieldBanner = document.createElement('div');
    shieldBanner.className = 'shield-banner';
    shieldBanner.textContent = 'Shield active — next bad guess will be blocked';
    actionBar.appendChild(shieldBanner);
  }

  actionBar.appendChild(bar);
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
  if (state.phase === 'ended' && state.winner) {
    winnerOverlay.style.display = 'flex';
    const isRed = state.winner === 'red';
    winnerIcon.textContent = isRed ? '🔴' : '🔵';
    winnerTitle.textContent = `${cap(state.winner)} Team Wins!`;
    winnerTitle.style.color = isRed ? '#e74c3c' : '#3498db';
    winnerSub.textContent = 'Great game. Ready for another round?';
    document.getElementById('new-game-btn').onclick = () => {
      socket.emit('new-game');
      winnerOverlay.style.display = 'none';
    };
  } else {
    winnerOverlay.style.display = 'none';
  }
}
