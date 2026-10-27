// Shadow Hunt rules engine.
//
// Pure game logic: no DOM, no network, no globals. The renderer and the netcode
// call into this file; this file never calls back into them.
//
//   buildMap(rnd)                    -> map  { stations, edges, adj }
//   newGame(names, maxRounds)        -> state
//   applyAction(state, map, action)  -> { state, handled, turnAdvanced }
//
// Actions never mutate the state you pass in: they work on a copy and return it.

export const MAPW = 1300;
export const MAPH = 950;
export const REVEAL_ROUNDS = [3, 8, 13, 18, 24];
export const COLORS = ['#e53935', '#3949ab', '#43a047', '#fb8c00', '#8e24aa', '#00acc1'];

const STATION_COUNT = 45;
const MARGIN = 70;
const MINDIST = 110;

const NAMES = ["Baker St", "Piccadilly", "Waterloo", "Camden", "Whitehall", "Soho", "Kensington", "Mayfair", "Chelsea", "Islington", "Bethnal Grn", "Hackney", "Greenwich", "Brixton", "Clapham", "Fulham", "Notting Hill", "Marylebone", "Euston", "King's Cross", "Angel", "Holborn", "Covent Gdn", "Bloomsbury", "Pimlico", "Vauxhall", "Lambeth", "Southwark", "Bermondsey", "Shoreditch", "Dalston", "Stratford", "Hampstead", "Highgate", "Wembley", "Ealing", "Richmond", "Wimbledon", "Croydon", "Bromley", "Lewisham", "Woolwich", "Barking", "Stepney", "Poplar"];

/* ---------- randomness ---------- */

// Small deterministic generator (Park-Miller). The same seed always gives the same sequence.
export function seededRand(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// Fisher-Yates, in place. `rnd` is any function returning a number in [0, 1).
export function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- the map ---------- */

// Stations are scattered with a minimum spacing, then linked by taxi (3 nearest),
// bus (neighbours 5th to 7th nearest) and five hand-listed underground lines.
export function buildMap(rnd) {
  const N = STATION_COUNT;
  const stations = [];
  let attempts = 0;
  while (stations.length < N && attempts < 20000) {
    attempts++;
    const x = MARGIN + rnd() * (MAPW - 2 * MARGIN);
    const y = MARGIN + rnd() * (MAPH - 2 * MARGIN);
    let ok = true;
    for (const s of stations) { if (Math.hypot(s.x - x, s.y - y) < MINDIST) { ok = false; break; } }
    if (ok) stations.push({ id: stations.length, x, y, name: '' });
  }
  if (stations.length < N) {
    const cols = Math.ceil(Math.sqrt(N)), cellW = (MAPW - 2 * MARGIN) / cols, cellH = (MAPH - 2 * MARGIN) / cols;
    let gi = 0;
    while (stations.length < N) {
      const cx = MARGIN + cellW * (gi % cols) + cellW / 2, cy = MARGIN + cellH * Math.floor(gi / cols) + cellH / 2;
      stations.push({ id: stations.length, x: cx + (rnd() * 30 - 15), y: cy + (rnd() * 30 - 15), name: '' });
      gi++;
    }
  }
  stations.forEach((s, i) => { s.name = NAMES[i] || ('Station ' + i); });

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const edges = [];
  const addEdge = (a, b, type) => {
    if (a === b) return;
    if (edges.find(e => ((e.a === a && e.b === b) || (e.a === b && e.b === a)) && e.type === type)) return;
    edges.push({ a, b, type });
  };
  const nearest = (s) => stations.filter(o => o.id !== s.id).map(o => ({ o, d: dist(s, o) })).sort((a, b) => a.d - b.d);
  stations.forEach((s, i) => {
    const others = nearest(s);
    for (let k = 0; k < 3; k++) addEdge(i, others[k].o.id, 'taxi');
  });
  stations.forEach((s, i) => {
    const others = nearest(s);
    for (let k = 4; k < 7; k++) if (others[k]) addEdge(i, others[k].o.id, 'bus');
  });
  const undergroundLine = (order) => { for (let i = 0; i < order.length - 1; i++) addEdge(order[i], order[i + 1], 'underground'); };
  undergroundLine([2, 18, 19, 22, 23, 10, 29, 11, 31].filter(x => x < N));
  undergroundLine([16, 6, 8, 25, 26, 37].filter(x => x < N));
  undergroundLine([33, 34, 17, 0, 21, 4, 27, 28, 40].filter(x => x < N));
  undergroundLine([35, 36, 15, 14, 13, 39, 41].filter(x => x < N));
  undergroundLine([32, 20, 9, 30, 43, 44, 42].filter(x => x < N));

  // adj[id] = [{to, type}, ...] in edge order
  const adj = stations.map(s => edges
    .filter(e => e.a === s.id || e.b === s.id)
    .map(e => ({ to: e.a === s.id ? e.b : e.a, type: e.type })));
  return { stations, edges, adj };
}

/* ---------- state ---------- */

// Player 0 is the fugitive (Mister X in the original rules); everyone else is a detective.
export function newGame(playerNames, maxRounds) {
  maxRounds = maxRounds || 24;
  const players = playerNames.map((nm, i) => ({
    name: nm, isMrX: i === 0, pos: null,
    color: i === 0 ? '#111' : COLORS[(i - 1) % COLORS.length],
    tickets: i === 0 ? { taxi: 999, bus: 999, underground: 999, black: 5, double: 2 } : { taxi: 10, bus: 8, underground: 4 },
    revealedPos: null
  }));
  return {
    players, round: 1, turn: 1,
    log: ["The game begins. Mister X slips into the crowd..."],
    mrXHistory: [], gameOver: false, winner: null,
    doubleMovePending: false, mrxVisible: false,
    startingPhase: true, startPickIdx: 0,
    maxRounds
  };
}

/* ---------- read-only helpers ---------- */

export function currentPlayer(G) { return G.players[G.turn - 1]; }
export function isRevealRound(r) { return REVEAL_ROUNDS.includes(r); }

// Moves the player at playerIdx could make right now: neighbours not blocked by a
// detective, and (for detectives) only with a ticket they still hold.
export function validMoves(G, map, playerIdx) {
  const p = G.players[playerIdx];
  if (p.pos === null || p.pos === undefined) return [];
  let opts = map.adj[p.pos];
  const occupied = G.players.filter((pl, i) => i !== playerIdx && !pl.isMrX && pl.pos !== null).map(pl => pl.pos);
  opts = opts.filter(o => !occupied.includes(o.to));
  if (!p.isMrX) { opts = opts.filter(o => p.tickets[o.type] > 0); }
  return opts;
}

// Stations the player who is currently picking a start must not choose (already taken by
// a detective). The fugitive's pick is never shown to anyone, and the fugitive sees no one's.
export function takenStartPositions(G) {
  const currentPicker = G.players[G.startPickIdx];
  return G.players.filter((pl, i) => {
    if (i >= G.startPickIdx) return false;
    if (pl.isMrX) return false;
    if (currentPicker.isMrX) return false;
    return true;
  }).map(pl => pl.pos).filter(p => p !== null);
}

/* ---------- state changes (all work on a copy) ---------- */

function addLog(G, t) { G.log.push(t); if (G.log.length > 60) G.log.shift(); }

function doMove(G, map, playerIdx, to, type, isBlack) {
  const stations = map.stations;
  const p = G.players[playerIdx];
  p.pos = to;
  if (p.isMrX) {
    if (isBlack) p.tickets.black--; else p.tickets[type]--;
    G.mrXHistory.push({ round: G.round, type: isBlack ? 'black' : type });
    if (isRevealRound(G.round)) {
      p.revealedPos = to; G.mrxVisible = true;
      addLog(G, `Round ${G.round}: Mister X travels by ${isBlack ? 'black ticket' : type}. He is spotted at ${stations[to].name}!`);
    } else {
      G.mrxVisible = false;
      addLog(G, `Round ${G.round}: Mister X travels by ${isBlack ? 'black ticket' : type}.`);
    }
    const caughtBy = G.players.find(pl => !pl.isMrX && pl.pos === to);
    if (caughtBy) { G.gameOver = true; G.winner = 'detectives'; G.mrxVisible = true; addLog(G, `🚨 Mister X walked into ${caughtBy.name}! Detectives win!`); }
  } else {
    p.tickets[type]--;
    const mrx = G.players.find(pl => pl.isMrX);
    mrx.tickets[type]++;
    addLog(G, `${p.name} travels to ${stations[to].name} by ${type}.`);
    if (mrx.pos === to) { G.gameOver = true; G.winner = 'detectives'; G.mrxVisible = true; addLog(G, `🚨 ${p.name} has captured Mister X at ${stations[to].name}! Detectives win!`); }
  }
}

function nextTurn(G, map) {
  if (G.gameOver) return;
  G.turn++;
  if (G.turn > G.players.length) { G.turn = 1; G.round++; }
  if (G.round > G.maxRounds) { G.gameOver = true; G.winner = 'mrx'; addLog(G, `🕶️ Mister X evaded capture for ${G.maxRounds} rounds. Mister X wins!`); }
  if (!G.gameOver && !currentPlayer(G).isMrX) {
    if (validMoves(G, map, G.turn - 1).length === 0) {
      addLog(G, `${currentPlayer(G).name} has no valid moves and forfeits this turn.`);
      const allStuck = G.players.every((p, i) => p.isMrX || validMoves(G, map, i).length === 0);
      if (allStuck) { G.gameOver = true; G.winner = 'mrx'; addLog(G, 'All detectives are stuck! Mister X wins!'); return; }
      nextTurn(G, map);
    }
  }
}

// Apply one action. Returns:
//   state        the new state (the input is left untouched)
//   handled      false if the action name was not recognised
//   turnAdvanced true when play passed on (or the game ended), so a pass-and-play
//                screen can show the next "hand the device over" gate
// Note: this does not check WHO is acting or whether the move is legal. The network
// layer is responsible for that before calling in (see the netcode phase).
export function applyAction(G, map, action) {
  if (action.cmd === 'startPick') {
    const s = structuredClone(G);
    const { playerIdx, pos } = action;
    if (s.players[playerIdx]) s.players[playerIdx].pos = pos;
    if (s.players.every(p => p.pos !== null)) {
      s.startingPhase = false;
      delete s.startPickIdx;
    }
    return { state: s, handled: true, turnAdvanced: false };
  }
  if (action.cmd === 'startDouble') {
    const s = structuredClone(G);
    s.doubleMovePending = true;
    return { state: s, handled: true, turnAdvanced: false };
  }
  if (action.cmd === 'move') {
    const s = structuredClone(G);
    const { playerIdx, to, type, isBlack } = action;
    const cp = s.players[playerIdx];
    doMove(s, map, playerIdx, to, type, isBlack);
    if (s.gameOver) { s.doubleFirstDone = false; s.doubleMovePending = false; return { state: s, handled: true, turnAdvanced: true }; }
    if (cp.isMrX && s.doubleMovePending && !s.doubleFirstDone) {
      s.doubleFirstDone = true; cp.tickets.double--;
      addLog(s, 'Mister X uses a Double Move ticket.');
      return { state: s, handled: true, turnAdvanced: false };
    }
    s.doubleFirstDone = false; s.doubleMovePending = false;
    nextTurn(s, map);
    return { state: s, handled: true, turnAdvanced: true };
  }
  return { state: G, handled: false, turnAdvanced: false };
}

// Pass-and-play only: the player whose turn it is to pick chooses `pos`, then the
// picker advances. When everyone has picked, the setup phase ends.
export function pickStartLocal(G, pos) {
  const s = structuredClone(G);
  s.players[s.startPickIdx].pos = pos;
  s.startPickIdx++;
  if (s.startPickIdx >= s.players.length) {
    s.startingPhase = false;
    delete s.startPickIdx;
  }
  return s;
}

// Pass-and-play only: if a detective picked the fugitive's square, the detectives win at once.
export function checkStartCollision(G, map) {
  const mrx = G.players.find(p => p.isMrX);
  const collision = G.players.find(p => !p.isMrX && p.pos === mrx.pos);
  if (!collision) return G;
  const s = structuredClone(G);
  s.gameOver = true; s.winner = 'detectives'; s.mrxVisible = true;
  addLog(s, `🚨 ${collision.name} started on the same square as Mister X at ${map.stations[mrx.pos].name}! Detectives win!`);
  return s;
}
