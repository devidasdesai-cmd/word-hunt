const socket = io();

// Parse URL params
const params = new URLSearchParams(window.location.search);
const roomCode = params.get('room');
let playerId = params.get('pid'); // let — may be reassigned if server issues a new id

if (!roomCode || !playerId) {
  window.location.href = '/';
}

let state = null;

// ─── DOM refs ────────────────────────────────────────
const roomCodeDisplay = document.getElementById('room-code-display');
const redRemaining = document.getElementById('red-remaining');
const blueRemaining = document.getElementById('blue-remaining');
const turnDot = document.getElementById('turn-dot');
const turnText = document.getElementById('turn-text');
const actionBar = document.getElementById('action-bar');
const board = document.getElementById('board');
const logEl = document.getElementById('log');
const redPlayers = document.getElementById('red-players');
const bluePlayers = document.getElementById('blue-players');
const specPlayers = document.getElementById('spec-players');
const specSection = document.getElementById('spectators-section');
const headerRight = document.getElementById('header-right');
const winnerOverlay = document.getElementById('winner-overlay');
const winnerTitle = document.getElementById('winner-title');
const winnerSub = document.getElementById('winner-sub');
const winnerIcon = document.getElementById('winner-icon');
const mobilePlayers = document.getElementById('mobile-players');

// ─── Copy invite link ────────────────────────────────
document.getElementById('copy-link-btn').addEventListener('click', () => {
  const url = `${window.location.origin}/?join=${roomCode}`;
  navigator.clipboard.writeText(url).catch(() => {});
  const btn = document.getElementById('copy-link-btn');
  btn.style.color = '#27ae60';
  setTimeout(() => btn.style.color = '', 1500);
});

// ─── Join room on load ───────────────────────────────
socket.emit('join-room', {
  roomCode,
  playerId,
  name: localStorage.getItem('wordrush-name') || 'Player',
});

socket.on('room-joined', ({ playerId: assignedId }) => {
  // The server may assign a new id if our original was lost during navigation.
  // Keep the client in sync so "★" and role checks stay correct.
  if (assignedId && assignedId !== playerId) playerId = assignedId;
});

socket.on('game-state', (s) => {
  state = s;
  render();
});

socket.on('error', ({ message }) => {
  alert(message);
});

// ─── Render ──────────────────────────────────────────
function render() {
  if (!state) return;

  roomCodeDisplay.textContent = state.roomCode;

  // Score
  const redLeft = state.cards.filter(c => c.color === 'red' && !c.revealed).length;
  const blueLeft = state.cards.filter(c => c.color === 'blue' && !c.revealed).length;
  redRemaining.textContent = redLeft;
  blueRemaining.textContent = blueLeft;

  // Turn indicator
  if (state.phase !== 'lobby' && state.phase !== 'ended') {
    turnDot.className = `turn-dot ${state.currentTeam}`;
    const teamName = state.currentTeam === 'red' ? 'Red' : 'Blue';
    const phaseLabel = state.phase === 'spymaster-clue' ? 'Giving Clue' : 'Guessing';
    turnText.textContent = `${teamName} — ${phaseLabel}`;
  } else if (state.phase === 'ended') {
    turnDot.className = 'turn-dot';
    turnText.textContent = 'Game Over';
  } else {
    turnDot.className = 'turn-dot';
    turnText.textContent = 'Lobby';
  }

  renderHeaderRight();
  renderPlayers();
  renderMobilePlayers();
  renderBoard();
  renderActionBar();
  renderLog();
  renderOverlay();
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

// ─── Header right: role badge + spymaster controls ───
function renderHeaderRight() {
  headerRight.innerHTML = '';

  const isSpymaster = state.myRole === 'spymaster';
  const inGame = state.phase !== 'lobby' && state.phase !== 'ended';

  // Role badge
  if (state.myTeam && state.myRole) {
    const badge = document.createElement('div');
    badge.className = 'my-role-bar';
    const teamColor = state.myTeam === 'red' ? '#e74c3c' : '#3498db';
    badge.innerHTML = `<span style="color:${teamColor}">${cap(state.myTeam)}</span> <span>${cap(state.myRole)}</span>`;
    headerRight.appendChild(badge);
  }

  // Spymaster controls during an active game
  if (isSpymaster && inGame) {
    const controls = document.createElement('div');
    controls.className = 'spy-controls';

    const newBtn = document.createElement('button');
    newBtn.className = 'spy-btn spy-btn-new';
    newBtn.title = 'Start a new game';
    newBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg> New Game`;
    newBtn.addEventListener('click', () => {
      if (confirm('Start a new game? This will end the current game for everyone.')) {
        socket.emit('new-game');
      }
    });

    const exitBtn = document.createElement('button');
    exitBtn.className = 'spy-btn spy-btn-exit';
    exitBtn.title = 'Leave this room';
    exitBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Exit`;
    exitBtn.addEventListener('click', () => {
      window.location.href = '/';
    });

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
    const roleBadge = p.role ? `<span class="role-badge">${p.role === 'spymaster' ? 'Spy' : 'Op'}</span>` : '';
    chip.innerHTML = `${roleBadge}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(p.name)}${p.id === playerId ? ' ★' : ''}</span>`;

    if (p.team === 'red') redPlayers.appendChild(chip);
    else if (p.team === 'blue') bluePlayers.appendChild(chip);
    else {
      specPlayers.appendChild(chip);
      hasSpec = true;
    }
  });

  specSection.style.display = hasSpec ? '' : 'none';
}

// ─── Mobile players strip ────────────────────────────
function renderMobilePlayers() {
  mobilePlayers.innerHTML = '';
  if (state.phase === 'lobby') {
    mobilePlayers.style.display = 'none';
    return;
  }
  mobilePlayers.style.display = '';

  ['red', 'blue'].forEach(team => {
    const teamPlayers = state.players.filter(p => p.team === team);
    if (!teamPlayers.length) return;

    const group = document.createElement('div');
    group.className = `mob-team mob-team-${team}`;

    teamPlayers.forEach(p => {
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
  state.cards.forEach(card => {
    const el = document.createElement('div');
    el.className = 'card';

    if (card.revealed) {
      el.classList.add('revealed', `revealed-${card.color}`);
    } else {
      if (card.color) {
        el.classList.add(`hint-${card.color}`);
        const dot = document.createElement('div');
        dot.className = 'color-dot';
        dot.style.background = dotColor(card.color);
        el.appendChild(dot);
      }

      if (state.phase === 'guessing' &&
          state.myTeam === state.currentTeam &&
          state.myRole === 'operative') {
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
  return color === 'red' ? '#e74c3c'
       : color === 'blue' ? '#3498db'
       : color === 'assassin' ? '#555'
       : '#666';
}

// ─── Action bar ──────────────────────────────────────
function renderActionBar() {
  actionBar.innerHTML = '';

  // Unassigned player during an active game: show operative join buttons
  const inActiveGame = state.phase !== 'lobby' && state.phase !== 'ended';
  if (inActiveGame && !state.myTeam) {
    renderMidGameJoin();
    return;
  }

  if (state.phase === 'lobby') {
    renderLobbyActions();
  } else if (state.phase === 'spymaster-clue') {
    if (state.myRole === 'spymaster' && state.myTeam === state.currentTeam) {
      renderClueForm();
    } else {
      const msg = document.createElement('div');
      msg.className = 'waiting-msg';
      const teamName = state.currentTeam === 'red' ? 'Red' : 'Blue';
      msg.textContent = `Waiting for ${teamName} spymaster to give a clue…`;
      actionBar.appendChild(msg);
    }
  } else if (state.phase === 'guessing') {
    renderGuessingBar();
  }
}

function renderLobbyActions() {
  const wrap = document.createElement('div');
  wrap.className = 'lobby-actions';

  const myTeam = state.myTeam;
  const myRole = state.myRole;

  function makeBtn(label, sublabel, teamVal, roleVal, cssClass) {
    const btn = document.createElement('button');
    btn.className = `team-pick-btn ${cssClass}`;
    if (myTeam === teamVal && myRole === roleVal) btn.classList.add('active');
    btn.innerHTML = `${label}<span class="role-label">${sublabel}</span>`;
    btn.addEventListener('click', () => {
      socket.emit('set-team', { team: teamVal, role: roleVal });
    });
    return btn;
  }

  wrap.appendChild(makeBtn('Red', 'Operative', 'red', 'operative', 'red-op'));
  wrap.appendChild(makeBtn('Red', 'Spymaster', 'red', 'spymaster', 'red-sp'));
  wrap.appendChild(makeBtn('Blue', 'Operative', 'blue', 'operative', 'blue-op'));
  wrap.appendChild(makeBtn('Blue', 'Spymaster', 'blue', 'spymaster', 'blue-sp'));

  const startBtn = document.createElement('button');
  startBtn.className = 'start-btn';
  startBtn.textContent = 'Start Game';
  startBtn.addEventListener('click', () => socket.emit('start-game'));
  wrap.appendChild(startBtn);

  actionBar.appendChild(wrap);
}

function renderMidGameJoin() {
  const wrap = document.createElement('div');
  wrap.className = 'lobby-actions';

  const label = document.createElement('span');
  label.className = 'waiting-msg';
  label.textContent = 'Join as operative:';
  wrap.appendChild(label);

  ['red', 'blue'].forEach(team => {
    const btn = document.createElement('button');
    btn.className = `team-pick-btn ${team}-op`;
    btn.innerHTML = `${cap(team)}<span class="role-label">Operative</span>`;
    btn.addEventListener('click', () => {
      socket.emit('set-team', { team, role: 'operative' });
    });
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
  countInput.value = '';

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

  const clueDisp = document.createElement('div');
  clueDisp.className = 'clue-display';

  const teamColor = state.currentTeam === 'red' ? '#e74c3c' : '#3498db';

  if (state.clue) {
    const word = document.createElement('span');
    word.className = 'clue-word-display';
    word.style.color = teamColor;
    word.textContent = state.clue.word;

    const count = document.createElement('span');
    count.className = 'clue-count-display';
    count.textContent = state.clue.count === 0 ? '∞' : state.clue.count;

    clueDisp.appendChild(word);
    clueDisp.appendChild(count);
  }

  const guessesLeft = document.createElement('span');
  guessesLeft.className = 'guesses-left';
  const gl = state.guessesLeft === Infinity ? '∞' : state.guessesLeft;
  guessesLeft.textContent = `${gl} guess${gl !== 1 ? 'es' : ''} left`;

  bar.appendChild(clueDisp);
  bar.appendChild(guessesLeft);

  if (state.myTeam === state.currentTeam && state.myRole === 'operative') {
    const endBtn = document.createElement('button');
    endBtn.className = 'end-turn-btn';
    endBtn.textContent = 'End Turn';
    endBtn.addEventListener('click', () => socket.emit('end-turn'));
    bar.appendChild(endBtn);
  } else if (state.myTeam !== state.currentTeam || !state.myTeam) {
    const waitMsg = document.createElement('span');
    waitMsg.className = 'waiting-msg';
    const teamName = state.currentTeam === 'red' ? 'Red' : 'Blue';
    waitMsg.textContent = `${teamName} team is guessing…`;
    bar.appendChild(waitMsg);
  }

  actionBar.appendChild(bar);
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

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
