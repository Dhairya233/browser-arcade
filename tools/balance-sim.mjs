// Balance sanity check for Shadow Hunt. Plays many bot games on the real rules engine and reports
// how often each side wins. It only reports; it changes nothing.
//
//   node tools/balance-sim.mjs [gamesPerCell]        (default 1000)
//
// Two kinds of bots:
//   random   picks any legal move.
//   careful  detectives walk toward the fugitive's last revealed station; the fugitive walks away from the
//            nearest detective, uses a double move when one is close, and spends black tickets when pressed.
// Neither is a strong player, so read the numbers as a rough guide to the rules, not to human play.

import * as E from '../games/shadow-hunt/engine.js';
import { MAP } from '../games/shadow-hunt/adapter.js';

function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

// distance in hops between every pair of stations, any transport
const dist = MAP.stations.map(() => new Array(MAP.stations.length).fill(Infinity));
MAP.stations.forEach(s => {
  const q = [s.id]; dist[s.id][s.id] = 0;
  for (let i = 0; i < q.length; i++) for (const o of MAP.adj[q[i]]) if (dist[s.id][o.to] === Infinity) { dist[s.id][o.to] = dist[s.id][q[i]] + 1; q.push(o.to); }
});

function chooseMove(g, idx, kind, r) {
  const moves = E.validMoves(g, MAP, idx);
  if (!moves.length) return null;
  if (kind === 'random') return pick(moves, r);
  const me = g.players[idx];
  if (me.isPhantom) {
    const dets = g.players.filter(p => !p.isPhantom).map(p => p.pos);
    const score = o => Math.min(...dets.map(d => dist[o.to][d]));
    const best = Math.max(...moves.map(score));
    return pick(moves.filter(o => score(o) === best), r);
  }
  const target = g.players[0].revealedPos;
  if (target === null) return pick(moves, r);
  const best = Math.min(...moves.map(o => dist[o.to][target]));
  return pick(moves.filter(o => dist[o.to][target] === best), r);
}

function playGame(n, rounds, detKind, phKind, seed) {
  const r = lcg(seed);
  let g = E.newGame(Array.from({ length: n }, (_, i) => 'P' + i), rounds);
  const used = new Set();
  for (let i = 0; i < n; i++) {
    let pos; do { pos = Math.floor(r() * MAP.stations.length); } while (i > 0 && used.has(pos) && [...used].slice(1).includes(pos));
    if (i > 0) used.add(pos);
    g = E.applyAction(g, MAP, { cmd: 'startPick', playerIdx: i, pos }).state;
  }
  g = E.checkStartCollision(g, MAP);
  let guard = 0;
  while (!g.gameOver && guard++ < 2000) {
    const idx = g.turn - 1, kind = idx === 0 ? phKind : detKind;
    if (idx === 0 && phKind === 'careful' && g.players[0].tickets.double > 0 && !g.doubleMovePending) {
      const near = Math.min(...g.players.filter(p => !p.isPhantom).map(p => dist[g.players[0].pos][p.pos]));
      if (near <= 2) g = E.applyAction(g, MAP, { cmd: 'startDouble' }).state;
    }
    const m = chooseMove(g, idx, kind, r);
    if (!m) break;
    let black = false;
    if (idx === 0 && g.players[0].tickets.black > 0) {
      const near = Math.min(...g.players.filter(p => !p.isPhantom).map(p => dist[g.players[0].pos][p.pos]));
      black = phKind === 'random' ? r() < 0.25 : near <= 3 && E.isRevealRound(g.round) === false;
    }
    g = E.applyAction(g, MAP, { cmd: 'move', playerIdx: idx, to: m.to, type: m.type, isBlack: black }).state;
  }
  return g;
}

const games = +process.argv[2] || 1000;
const pct = (a, b) => (100 * a / b).toFixed(1).padStart(5) + '%';

function table(title, detKind, phKind) {
  console.log(`\n${title}  (${games} games per row; detective win rate / average rounds played)`);
  console.log('players  ' + [12, 18, 24, 30].map(r => `${r} rounds`.padEnd(18)).join(''));
  for (const n of [3, 4, 5, 6]) {
    let line = String(n).padEnd(9);
    for (const rounds of [12, 18, 24, 30]) {
      let det = 0, played = 0;
      for (let k = 0; k < games; k++) {
        const g = playGame(n, rounds, detKind, phKind, 1000 * n + 7 * rounds + k + 1);
        if (g.winner === 'detectives') det++;
        played += Math.min(g.round, rounds);
      }
      line += `${pct(det, games)} / ${(played / games).toFixed(1)}`.padEnd(18);
    }
    console.log(line);
  }
}

table('Random detectives vs random fugitive', 'random', 'random');
table('Careful detectives vs random fugitive', 'careful', 'random');
table('Random detectives vs careful fugitive', 'random', 'careful');
table('Careful detectives vs careful fugitive', 'careful', 'careful');
