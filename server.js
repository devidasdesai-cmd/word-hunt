const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { getWords } = require('./words');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const games = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createGame(roomCode) {
  const words = getWords(19);
  const startTeam = Math.random() < 0.5 ? 'red' : 'blue';

  // 6 red, 6 blue, 5 neutral, 1 abyss, 1 treasure = 19
  const colors = [];
  for (let i = 0; i < 6; i++) colors.push('red');
  for (let i = 0; i < 6; i++) colors.push('blue');
  colors.push('abyss');
  colors.push('treasure');
  for (let i = 0; i < 5; i++) colors.push('neutral');
  colors.sort(() => Math.random() - 0.5);

  const cards = words.map((word, i) => ({
    id: i,
    word,
    color: colors[i],
    revealed: false,
  }));

  return {
    roomCode,
    cards,
    startTeam,
    currentTeam: startTeam,
    phase: 'lobby', // lobby | captain-clue | guessing | ended
    players: {},
    clue: null,
    guessesLeft: 0,
    winner: null,
    log: [],
    scores: { red: 0, blue: 0 },
    treasureTeam: null,
    roundCorrect: 0,
    powerups: {
      red:  { peek: 1, shield: 1, shieldActive: false },
      blue: { peek: 1, shield: 1, shieldActive: false },
    },
    rapidMode: false,
    timerEnd: null,
    _timer: null,
  };
}

function getPublicState(game, playerId) {
  const player = game.players[playerId];
  const isCaptain = player && player.role === 'spymaster';

  return {
    roomCode: game.roomCode,
    phase: game.phase,
    currentTeam: game.currentTeam,
    startTeam: game.startTeam,
    clue: game.clue,
    guessesLeft: game.guessesLeft,
    winner: game.winner,
    log: game.log,
    scores: game.scores,
    treasureTeam: game.treasureTeam,
    powerups: game.powerups,
    rapidMode: game.rapidMode,
    timerEnd: game.timerEnd,
    players: Object.values(game.players).map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      role: p.role,
    })),
    cards: game.cards.map(card => ({
      id: card.id,
      word: card.word,
      revealed: card.revealed,
      color: card.revealed || isCaptain ? card.color : null,
    })),
    myTeam: player ? player.team : null,
    myRole: player ? player.role : null,
  };
}

function broadcastState(game) {
  Object.keys(game.players).forEach(pid => {
    const sock = io.sockets.sockets.get(game.players[pid].socketId);
    if (sock) sock.emit('game-state', getPublicState(game, pid));
  });
}

function countRemaining(game, team) {
  return game.cards.filter(c => c.color === team && !c.revealed).length;
}

function addLog(game, msg) {
  game.log.unshift(msg);
  if (game.log.length > 50) game.log.pop();
}

// ─── Timer helpers ────────────────────────────────────
function clearGameTimer(game) {
  if (game._timer) { clearTimeout(game._timer); game._timer = null; }
  game.timerEnd = null;
}

function startRapidTimer(game) {
  clearGameTimer(game);
  game.timerEnd = Date.now() + 60000;
  game._timer = setTimeout(() => {
    // Guard: ensure this is still the same active game
    if (games[game.roomCode] !== game || game.phase !== 'guessing') return;
    addLog(game, "Time's up! Turn passes automatically.");
    switchTurn(game);
    broadcastState(game);
  }, 60000);
}

// ─── Turn switching (module-scope so timer can call it) ───
function switchTurn(game) {
  clearGameTimer(game);
  // Reset shield and round counter for the team that just played
  game.powerups[game.currentTeam].shieldActive = false;
  game.roundCorrect = 0;
  game.currentTeam = game.currentTeam === 'red' ? 'blue' : 'red';
  game.phase = 'captain-clue';
  game.clue = null;
  game.guessesLeft = 0;
  addLog(game, `${game.currentTeam === 'red' ? 'Red' : 'Blue'} team's turn`);
}

// ─── Socket handlers ──────────────────────────────────
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentPlayerId = null;

  socket.on('create-room', ({ name }) => {
    let roomCode;
    do { roomCode = generateRoomCode(); } while (games[roomCode]);

    const game = createGame(roomCode);
    const playerId = uuidv4();
    game.players[playerId] = {
      id: playerId, socketId: socket.id,
      name: name || 'Player', team: null, role: null,
    };
    games[roomCode] = game;
    currentRoom = roomCode;
    currentPlayerId = playerId;
    socket.join(roomCode);

    socket.emit('room-joined', { roomCode, playerId });
    broadcastState(game);
  });

  socket.on('join-room', ({ roomCode, name, playerId: existingId }) => {
    const game = games[roomCode];
    if (!game) { socket.emit('error', { message: 'Room not found' }); return; }

    let playerId = existingId;
    if (existingId && game.players[existingId]) {
      // Reconnect (e.g. page navigation) — cancel any pending disconnect timer
      if (game.players[existingId]._leaveTimer) {
        clearTimeout(game.players[existingId]._leaveTimer);
        delete game.players[existingId]._leaveTimer;
      }
      game.players[existingId].socketId = socket.id;
    } else {
      playerId = uuidv4();
      game.players[playerId] = {
        id: playerId, socketId: socket.id,
        name: name || 'Player', team: null, role: null,
      };
      addLog(game, `${name || 'Player'} joined the game`);
    }

    currentRoom = roomCode;
    currentPlayerId = playerId;
    socket.join(roomCode);
    socket.emit('room-joined', { roomCode, playerId });
    broadcastState(game);
  });

  socket.on('set-team', ({ team, role }) => {
    const game = games[currentRoom];
    if (!game || !game.players[currentPlayerId]) return;

    const player = game.players[currentPlayerId];
    if (game.phase !== 'lobby') {
      // Mid-game: only unassigned players can join, and only as scouts
      if (player.team !== null) return;
      if (role !== 'operative') return;
    }

    player.team = team;
    player.role = role;
    broadcastState(game);
  });

  socket.on('set-rapid-mode', ({ enabled }) => {
    const game = games[currentRoom];
    if (!game || game.phase !== 'lobby') return;
    game.rapidMode = !!enabled;
    broadcastState(game);
  });

  socket.on('start-game', () => {
    const game = games[currentRoom];
    if (!game) return;

    const players = Object.values(game.players);
    const hasRedCap  = players.some(p => p.team === 'red'  && p.role === 'spymaster');
    const hasBlueCap = players.some(p => p.team === 'blue' && p.role === 'spymaster');
    const hasRedSco  = players.some(p => p.team === 'red'  && p.role === 'operative');
    const hasBlueSco = players.some(p => p.team === 'blue' && p.role === 'operative');

    if (!hasRedCap || !hasRedSco || !hasBlueCap || !hasBlueSco) {
      socket.emit('error', { message: 'Both teams need a Pathfinder and at least one Seeker before the game can begin.' });
      return;
    }

    game.phase = 'captain-clue';
    addLog(game, `Game started! ${game.startTeam === 'red' ? 'Red' : 'Blue'} goes first — 6 cards each, score to win!`);
    broadcastState(game);
  });

  socket.on('give-clue', ({ word, count }) => {
    const game = games[currentRoom];
    if (!game) return;

    const player = game.players[currentPlayerId];
    if (!player || player.role !== 'spymaster' || player.team !== game.currentTeam) return;
    if (game.phase !== 'captain-clue') return;

    const clueWord = word.trim().toUpperCase();
    const clueCount = parseInt(count);
    if (!clueWord || isNaN(clueCount) || clueCount < 0 || clueCount > 9) return;

    game.clue = { word: clueWord, count: clueCount };
    game.guessesLeft = Infinity; // seekers guess freely; turn ends on wrong card or End Turn
    game.phase = 'guessing';
    game.roundCorrect = 0;

    addLog(game, `${player.name} (${game.currentTeam}) gives clue: "${clueWord}" for ${clueCount === 0 ? '∞' : clueCount}`);

    if (game.rapidMode) startRapidTimer(game);
    broadcastState(game);
  });

  socket.on('guess-card', ({ cardId }) => {
    const game = games[currentRoom];
    if (!game) return;

    const player = game.players[currentPlayerId];
    if (!player || player.role !== 'operative' || player.team !== game.currentTeam) return;
    if (game.phase !== 'guessing') return;

    const card = game.cards[cardId];
    if (!card || card.revealed) return;

    const isOwnCard = card.color === game.currentTeam;

    // ── Shield check (blocks any non-own card) ────────
    if (!isOwnCard && game.powerups[game.currentTeam].shieldActive) {
      game.powerups[game.currentTeam].shield--;
      game.powerups[game.currentTeam].shieldActive = false;
      addLog(game, `Shield activated! "${card.word}" was blocked — guess doesn't count.`);
      broadcastState(game);
      return;
    }

    // ── Reveal card ───────────────────────────────────
    card.revealed = true;
    addLog(game, `${player.name} guessed "${card.word}" — ${card.color.toUpperCase()}`);

    // ── Abyss: instant loss for guessing team ─────────
    if (card.color === 'abyss') {
      game.winner = game.currentTeam === 'red' ? 'blue' : 'red';
      game.phase = 'ended';
      clearGameTimer(game);
      addLog(game, `The Abyss! ${game.winner === 'red' ? 'Red' : 'Blue'} team wins!`);
      addLog(game, `Final scores — Red: ${game.scores.red} | Blue: ${game.scores.blue}`);
      broadcastState(game);
      return;
    }

    // ── Treasure: +1 bonus point, turn ends ───────────
    if (card.color === 'treasure') {
      game.scores[game.currentTeam]++;
      game.treasureTeam = game.currentTeam;
      addLog(game, `${player.name} found the Treasure! +1 bonus point for ${game.currentTeam === 'red' ? 'Red' : 'Blue'}!`);
      switchTurn(game);
      broadcastState(game);
      return;
    }

    // ── Own card: score a point ───────────────────────
    if (isOwnCard) {
      game.scores[game.currentTeam]++;
      game.roundCorrect++;
      if (game.roundCorrect === 3) {
        game.scores[game.currentTeam]++;
        addLog(game, `3-in-a-row bonus! +1 extra point for ${game.currentTeam === 'red' ? 'Red' : 'Blue'}!`);
      }
    }

    // ── Check natural game end (all team cards revealed) ─
    if (countRemaining(game, 'red') === 0 || countRemaining(game, 'blue') === 0) {
      const { red, blue } = game.scores;
      let winner;
      if (red > blue) winner = 'red';
      else if (blue > red) winner = 'blue';
      else winner = game.treasureTeam || 'tie';

      game.winner = winner;
      game.phase = 'ended';
      clearGameTimer(game);
      if (winner === 'tie') {
        addLog(game, `Game over — It's a tie! (${red} pts each)`);
      } else {
        addLog(game, `${winner === 'red' ? 'Red' : 'Blue'} team wins the game!`);
      }
      addLog(game, `Final scores — Red: ${red} | Blue: ${blue}`);
      broadcastState(game);
      return;
    }

    // ── Wrong card (neutral or opponent): switch turn ─
    if (!isOwnCard) {
      switchTurn(game);
      broadcastState(game);
      return;
    }

    // Correct own card — no guess cap, seeker keeps playing
    broadcastState(game);
  });

  socket.on('end-turn', () => {
    const game = games[currentRoom];
    if (!game) return;

    const player = game.players[currentPlayerId];
    if (!player || player.team !== game.currentTeam) return;
    if (game.phase !== 'guessing') return;

    addLog(game, `${player.name} ended the turn`);
    switchTurn(game);
    broadcastState(game);
  });

  // ── Power-up: Peek ────────────────────────────────
  socket.on('use-peek', ({ cardId }) => {
    const game = games[currentRoom];
    if (!game) return;

    const player = game.players[currentPlayerId];
    if (!player || player.role !== 'operative' || player.team !== game.currentTeam) return;
    if (game.phase !== 'guessing') return;
    if (game.powerups[game.currentTeam].peek <= 0) return;

    const card = game.cards[cardId];
    if (!card || card.revealed) return;

    game.powerups[game.currentTeam].peek--;
    const isSafe = card.color === game.currentTeam;
    addLog(game, `${player.name} used Peek on "${card.word}"`);

    // Respond only to the requester — nobody else sees the color
    socket.emit('peek-result', { cardId, color: card.color, isSafe });
    broadcastState(game);
  });

  // ── Power-up: Shield ──────────────────────────────
  socket.on('activate-shield', () => {
    const game = games[currentRoom];
    if (!game) return;

    const player = game.players[currentPlayerId];
    if (!player || player.role !== 'operative' || player.team !== game.currentTeam) return;
    if (game.phase !== 'guessing') return;
    if (game.powerups[game.currentTeam].shield <= 0) return;

    game.powerups[game.currentTeam].shieldActive = !game.powerups[game.currentTeam].shieldActive;
    addLog(game, `Shield ${game.powerups[game.currentTeam].shieldActive ? 'activated' : 'deactivated'} by ${player.name}`);
    broadcastState(game);
  });

  socket.on('new-game', () => {
    const game = games[currentRoom];
    if (!game) return;

    const player = game.players[currentPlayerId];
    if (game.phase !== 'ended' && (!player || player.role !== 'spymaster')) return;

    clearGameTimer(game);
    const newGame = createGame(currentRoom);
    newGame.players = game.players;
    Object.values(newGame.players).forEach(p => { p.team = null; p.role = null; });
    newGame.phase = 'lobby';
    games[currentRoom] = newGame;

    addLog(newGame, `${player ? player.name : 'Someone'} started a new game`);
    broadcastState(newGame);
  });

  socket.on('disconnect', () => {
    const game = games[currentRoom];
    if (!game || !currentPlayerId || !game.players[currentPlayerId]) return;
    if (game.players[currentPlayerId].socketId !== socket.id) return;

    // Use a grace period before removing the player.
    // Page navigation (index → game.html) disconnects the old socket before
    // the new one reconnects, causing a false "left the game" log.
    // The timer is cancelled if the player reconnects within 5 seconds.
    const pid  = currentPlayerId;
    const room = currentRoom;
    game.players[pid]._leaveTimer = setTimeout(() => {
      const g = games[room];
      if (!g || !g.players[pid]) return;
      if (g.players[pid].socketId !== socket.id) return; // reconnected
      const pname = g.players[pid].name;
      delete g.players[pid];
      addLog(g, `${pname} left the game`);
      broadcastState(g);
    }, 5000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Word Rush server running at http://localhost:${PORT}`);
});
