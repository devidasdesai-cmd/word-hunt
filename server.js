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

// In-memory game store
const games = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createGame(roomCode) {
  const words = getWords(25);
  // Randomly pick starting team
  const startTeam = Math.random() < 0.5 ? 'red' : 'blue';

  // Color assignment: starting team gets 9, other gets 8, 1 assassin, 7 neutral
  const colors = [];
  const startCount = 9;
  const otherCount = 8;
  const assassinCount = 1;
  const neutralCount = 7;

  for (let i = 0; i < startCount; i++) colors.push(startTeam);
  for (let i = 0; i < otherCount; i++) colors.push(startTeam === 'red' ? 'blue' : 'red');
  for (let i = 0; i < assassinCount; i++) colors.push('assassin');
  for (let i = 0; i < neutralCount; i++) colors.push('neutral');

  // Shuffle colors
  const shuffledColors = colors.sort(() => Math.random() - 0.5);

  const cards = words.map((word, i) => ({
    id: i,
    word,
    color: shuffledColors[i],
    revealed: false,
  }));

  return {
    roomCode,
    cards,
    startTeam,
    currentTeam: startTeam,
    phase: 'lobby', // lobby, spymaster-clue, guessing, ended
    players: {},
    clue: null,
    guessesLeft: 0,
    winner: null,
    log: [],
  };
}

function getPublicState(game, playerId) {
  const player = game.players[playerId];
  const isSpymaster = player && player.role === 'spymaster';

  return {
    roomCode: game.roomCode,
    phase: game.phase,
    currentTeam: game.currentTeam,
    startTeam: game.startTeam,
    clue: game.clue,
    guessesLeft: game.guessesLeft,
    winner: game.winner,
    log: game.log,
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
      color: card.revealed || isSpymaster ? card.color : null,
    })),
    myTeam: player ? player.team : null,
    myRole: player ? player.role : null,
  };
}

function broadcastState(game) {
  Object.keys(game.players).forEach(pid => {
    const socket = io.sockets.sockets.get(game.players[pid].socketId);
    if (socket) {
      socket.emit('game-state', getPublicState(game, pid));
    }
  });
}

function countRemaining(game, team) {
  return game.cards.filter(c => c.color === team && !c.revealed).length;
}

function addLog(game, msg) {
  game.log.unshift(msg);
  if (game.log.length > 50) game.log.pop();
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentPlayerId = null;

  socket.on('create-room', ({ name }) => {
    let roomCode;
    do { roomCode = generateRoomCode(); } while (games[roomCode]);

    const game = createGame(roomCode);
    const playerId = uuidv4();
    game.players[playerId] = {
      id: playerId,
      socketId: socket.id,
      name: name || 'Player',
      team: null,
      role: null,
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
    if (!game) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    let playerId = existingId;
    if (existingId && game.players[existingId]) {
      // Reconnecting
      game.players[existingId].socketId = socket.id;
    } else {
      playerId = uuidv4();
      game.players[playerId] = {
        id: playerId,
        socketId: socket.id,
        name: name || 'Player',
        team: null,
        role: null,
      };
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
    if (game.phase !== 'lobby') return;

    const player = game.players[currentPlayerId];
    player.team = team;
    player.role = role;
    broadcastState(game);
  });

  socket.on('start-game', () => {
    const game = games[currentRoom];
    if (!game) return;

    const players = Object.values(game.players);
    const hasRedSpy = players.some(p => p.team === 'red' && p.role === 'spymaster');
    const hasBlueSpy = players.some(p => p.team === 'blue' && p.role === 'spymaster');

    if (!hasRedSpy || !hasBlueSpy) {
      socket.emit('error', { message: 'Each team needs a spymaster before starting' });
      return;
    }

    game.phase = 'spymaster-clue';
    addLog(game, `Game started! ${game.startTeam === 'red' ? 'Red' : 'Blue'} goes first (${game.startTeam === 'red' ? 9 : 8} cards)`);
    broadcastState(game);
  });

  socket.on('give-clue', ({ word, count }) => {
    const game = games[currentRoom];
    if (!game) return;

    const player = game.players[currentPlayerId];
    if (!player || player.role !== 'spymaster' || player.team !== game.currentTeam) return;
    if (game.phase !== 'spymaster-clue') return;

    const clueWord = word.trim().toUpperCase();
    const clueCount = parseInt(count);
    if (!clueWord || isNaN(clueCount) || clueCount < 0 || clueCount > 9) return;

    game.clue = { word: clueWord, count: clueCount };
    game.guessesLeft = clueCount === 0 ? Infinity : clueCount + 1;
    game.phase = 'guessing';

    addLog(game, `${player.name} (${game.currentTeam}) gives clue: "${clueWord}" for ${clueCount === 0 ? '∞' : clueCount}`);
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

    card.revealed = true;
    addLog(game, `${player.name} guessed "${card.word}" — ${card.color.toUpperCase()}`);

    // Check assassin
    if (card.color === 'assassin') {
      game.winner = game.currentTeam === 'red' ? 'blue' : 'red';
      game.phase = 'ended';
      addLog(game, `Assassin! ${game.winner === 'red' ? 'Red' : 'Blue'} team wins!`);
      broadcastState(game);
      return;
    }

    // Check win
    if (countRemaining(game, 'red') === 0) {
      game.winner = 'red';
      game.phase = 'ended';
      addLog(game, 'Red team wins!');
      broadcastState(game);
      return;
    }
    if (countRemaining(game, 'blue') === 0) {
      game.winner = 'blue';
      game.phase = 'ended';
      addLog(game, 'Blue team wins!');
      broadcastState(game);
      return;
    }

    // Wrong team card or neutral = end turn
    if (card.color !== game.currentTeam) {
      switchTurn(game);
      broadcastState(game);
      return;
    }

    // Correct guess
    game.guessesLeft--;
    if (game.guessesLeft <= 0) {
      switchTurn(game);
    }

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

  socket.on('new-game', () => {
    const game = games[currentRoom];
    if (!game) return;

    const player = game.players[currentPlayerId];
    // During an active game only spymasters can force a new game; after game ends anyone can
    if (game.phase !== 'ended' && (!player || player.role !== 'spymaster')) return;

    const newGame = createGame(currentRoom);
    newGame.players = game.players;
    Object.values(newGame.players).forEach(p => { p.team = null; p.role = null; });
    newGame.phase = 'lobby';
    games[currentRoom] = newGame;

    addLog(newGame, `${player ? player.name : 'Someone'} started a new game`);
    broadcastState(newGame);
  });

  socket.on('disconnect', () => {
    if (currentRoom && games[currentRoom] && currentPlayerId) {
      // Keep player in game for reconnect; just mark as disconnected
    }
  });

  function switchTurn(game) {
    game.currentTeam = game.currentTeam === 'red' ? 'blue' : 'red';
    game.phase = 'spymaster-clue';
    game.clue = null;
    game.guessesLeft = 0;
    addLog(game, `${game.currentTeam === 'red' ? 'Red' : 'Blue'} team's turn`);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Codenames server running at http://localhost:${PORT}`);
});
