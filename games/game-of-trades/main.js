import * as Rules from './engine.js';
import {RESOURCE, COSTS, MAX_PLAYERS, hasResources} from './engine.js';
import {gameOfTradesAdapter, GAME_ACTIONS, COLOR_CHOICES} from './adapter.js';
import {createHost} from '../../shared/net/host.js';
import {createClient} from '../../shared/net/client.js';
import {createPeerJsTransport} from '../../shared/net/transport-peerjs.js';
import {peerOptions} from '../../shared/net/peer-options.js';
import {createTokenStore} from '../../shared/net/ids.js';
import {describeNetError} from '../../shared/net/protocol.js';

/* The rules live in engine.js. This file draws the game, handles input and runs the network. */

/* ============================= CONSTANTS ============================= */
const TILE_VISUAL = {
  wood:  {color:'#2f5233', icon:'🌲'},
  brick: {color:'#b5502f', icon:'🧱'},
  ore:   {color:'#7c7a78', icon:'🪨'},
  wheat: {color:'#d9a441', icon:'🌾'},
  sheep: {color:'#8fae5d', icon:'🐑'},
  desert:{color:'#ddc98b', icon:'🏜️'}
};
const DEV_LABELS = {
  knight:'⚔️ Knight',
  vp:'⭐ Victory Point',
  roadbuilding:'🛣️ Road Building',
  yearofplenty:'🌽 Year of Plenty',
  monopoly:'📈 Monopoly'
};
const COLOR_NAMES = {'#c0392b':'Red','#2c5f8a':'Blue','#ede7d9':'White','#d98a2b':'Orange','#3f6b3f':'Green','#8e44ad':'Purple','#e8d24a':'Yellow','#2f2f2f':'Black'};

/* ============================= GLOBAL UI STATE ============================= */
let state = null;
let ui = {screen:'home', sound:true, lobby:null, showRef:false};
let uiShowRules = false;
let toastMsg = null;
let audioCtx = null;
const PEER_PREFIX = 'settlers-isle-';
// To use your own PeerJS server or a TURN server, see shared/net/peer-options.js.
const net = {active:false, role:null, code:null, mySeat:null, status:'idle', lobby:null, requests:[], host:null, client:null, transport:null};
const HIDE_HELP = {
  off:'Everyone sees the tiles from the start.',
  first:'Tiles stay face-down until every player has placed their first settlement and road.',
  all:'Tiles stay face-down for all placements. Starting resources are handed out when they flip.'
};

/* ============================= UTIL ============================= */
// Questions about the current state, answered by the engine.
const isEdgeBuildable = (eid) => Rules.query.edgeBuildable(state, eid);
const isVertexBuildableSettlement = (vid) => Rules.query.settlementSpot(state, vid);
const isVertexBuildableCity = (vid) => Rules.query.citySpot(state, vid);
const calcVP = (idx, opts) => Rules.query.victoryPoints(state, idx, opts);
const bestRateFor = (idx, resource) => Rules.query.bestRate(state, idx, resource);
const validate = (seat, a, ds, p) => Rules.validateAction(state, seat, a, ds, p);

// Ask the engine to run one action, then show its toasts and play its sounds.
function applyGameAction(a, ds, p){
  const res = Rules.applyAction(state, a, ds, p);
  state = res.state;
  res.events.forEach(ev=>{ if(ev.type==='toast') toast(ev.msg); else playSound(ev.sound); });
}

function createGame(numPlayers, playersInput, opts){
  state = Rules.createGame(numPlayers, playersInput, opts);
  ui.screen='game';
  ui.wasHidden = state.tilesHidden;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function toast(msg){
  toastMsg = msg;
  render();
  setTimeout(()=>{ if(toastMsg===msg){ toastMsg=null; render(); } }, 2200);
}
function playSound(type){
  if(!ui.sound) return;
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    const freqs = {dice:220, build:440, robber:150, trade:330, pass:520, win:660};
    o.frequency.value = freqs[type]||300;
    g.gain.value = 0.06;
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+0.28);
    o.stop(audioCtx.currentTime+0.3);
  }catch(e){}
}
function otherPlayerIndices(){
  return state.players.map((_,i)=>i).filter(i=>i!==state.currentPlayerIdx);
}
function costStr(cost){
  return Object.entries(cost).map(([r,n])=>`${n}${RESOURCE[r].icon}`).join(' ');
}
function viewerIdx(){ return net.active ? net.mySeat : (state.deviceHolder!=null ? state.deviceHolder : state.currentPlayerIdx); }
function iAmCurrent(){ return viewerIdx()===state.currentPlayerIdx; }
function cardCount(p){ return p.handCount!=null ? p.handCount : Object.values(p.resources).reduce((a,b)=>a+b,0); }
function cleanName(n){ return String(n||'').replace(/[<>&"'`]/g,'').trim().slice(0,16); }

/* ============================= GAME CREATION ============================= */
/* ============================= PERSISTENCE (single slot, this device only) ============================= */
function getSavedSummary(){
  try{
    const raw = localStorage.getItem('si_game');
    if(!raw) return null;
    const s = JSON.parse(raw);
    return {players: s.players.map(p=>p.name), phase: s.phase};
  }catch(e){ return null; }
}
function persistGame(){
  if(net.active) return;
  try{ localStorage.setItem('si_game', JSON.stringify(state)); }catch(e){}
}
function loadSavedGame(){
  try{
    const raw = localStorage.getItem('si_game');
    if(!raw) return false;
    state = JSON.parse(raw);
    state.deviceHolder = null;
    ui.screen='game';
    return true;
  }catch(e){ return false; }
}
function deleteSavedGame(){
  try{ localStorage.removeItem('si_game'); }catch(e){}
}

/* ============================= REQUIRED VIEWER (pass-screen gate) ============================= */
function requiredViewer(){
  if(state.phase==='gameover') return null;
  if(state.pendingTrade && state.pendingTrade.status==='pending') return state.pendingTrade.toIdx;
  if(state.phase==='setup') return state.setup.order[state.setup.step];
  if(state.uiMode==='discard') return state.turn.discardQueue[0];
  return state.currentPlayerIdx;
}
function passContext(idx){
  if(state.pendingTrade && state.pendingTrade.status==='pending') return `${state.players[state.pendingTrade.fromIdx].name} wants to trade with you.`;
  if(state.phase==='setup'){
    const isSecond = state.setup.step >= state.numPlayers;
    return `Place your ${isSecond?'second':'first'} settlement and a connecting road.`;
  }
  if(state.uiMode==='discard') return `You have too many cards — time to discard half.`;
  return `It's your turn to roll and build!`;
}

/* ============================= RENDER: HOME / LOBBY ============================= */
function renderHome(){
  const summary = getSavedSummary();
  return `
  <div class="home">
    <div class="hero-emblem">🎲</div>
    <h1>Settlers' Isle</h1>
    <p class="tagline">A trading &amp; building game for 3–4 players. Share one screen and pass it around, or host a room and play from your own devices.</p>
    <div class="home-actions">
      <button class="btn btn-primary btn-lg" data-action="goOnline">🌐 Play Online</button>
      ${summary ? `<button class="btn btn-accent btn-lg" data-action="continueGame">Continue Game</button>` : ''}
      <button class="btn btn-ghost btn-lg" data-action="goLobby">New Local Game</button>
      <button class="btn btn-ghost" data-action="toggleRules">How to Play</button>
    </div>
    ${summary ? `
    <section class="saved-rooms">
      <p>Game in progress: <b>${summary.players.map(escapeHtml).join(', ')}</b>${summary.phase==='gameover'?' — finished':''}</p>
      <p class="muted">Starting a new game will replace this one.</p>
      <button class="btn btn-sm btn-danger" data-action="deleteSavedGame">Delete this game</button>
    </section>` : ''}
  </div>`;
}
function ensureLobby(){
  if(!ui.lobby){
    ui.lobby = {numPlayers:4, hide:'off', players: COLOR_CHOICES.map(c=>({name:'', color:c, password:''}))};
  }
}
function renderLobby(){
  ensureLobby();
  const L = ui.lobby;
  return `
  <div class="lobby">
    <h1>New Game</h1>
    <div class="lobby-count">
      <span>Players</span>
      <div class="segmented">
        ${Array.from({length:MAX_PLAYERS-2},(_,i)=>i+3).map(n=>`<button class="seg ${L.numPlayers===n?'active':''}" data-action="setNumPlayers" data-n="${n}">${n}</button>`).join('')}
      </div>
    </div>
    <p class="muted lobby-hint">Add a password for a player if you want to stop others peeking at their cards when the device is passed to them. Leave it blank to skip that.</p>
    <div class="lobby-players">
      ${L.players.slice(0,L.numPlayers).map((p,i)=>`
        <div class="player-row">
          <span class="swatch" style="background:${p.color}"></span>
          <input type="text" class="name-input" placeholder="Player ${i+1} name" value="${escapeHtml(p.name)}" data-i="${i}" />
          <input type="password" class="pin-input" placeholder="Password (optional)" value="${escapeHtml(p.password||'')}" data-i="${i}" autocomplete="new-password" />
          <div class="color-picker">
            ${COLOR_CHOICES.map(c=>`<button class="color-dot ${p.color===c?'sel':''}" style="background:${c}" data-action="setColor" data-i="${i}" data-color="${c}" title="${COLOR_NAMES[c]}"></button>`).join('')}
          </div>
        </div>`).join('')}
    </div>
    ${hideModeControl(L.hide||'off', true)}
    <div class="lobby-buttons">
      <button class="btn btn-ghost" data-action="goHome">Back</button>
      <button class="btn btn-primary btn-lg" data-action="startGame">Start Game</button>
    </div>
  </div>`;
}

/* ============================= RENDER: PASS SCREEN / GAME OVER ============================= */
function renderPassScreen(idx){
  const p = state.players[idx];
  const needsPass = !!(p.password && p.password.length>0);
  if(needsPass && ui.passFor!==idx){ ui.passInput=''; ui.passFor=idx; ui.passError=false; }
  return `
  <div class="pass-screen" style="--pc:${p.color}">
    <div class="pass-card" style="--pc:${p.color}">
      <div class="pass-swatch" style="background:${p.color}"></div>
      <h2>Pass the device to</h2>
      <div class="pass-name">${escapeHtml(p.name)}</div>
      <p class="pass-msg">${passContext(idx)}</p>
      ${needsPass ? `
        <input type="password" class="pass-pin-input" placeholder="Enter your password" value="${escapeHtml(ui.passInput||'')}" data-i="${idx}" autofocus />
        ${ui.passError ? `<p class="pass-error">Wrong password — try again.</p>` : ''}
        <button class="btn btn-primary btn-lg" data-action="submitPassInput" data-i="${idx}">Continue</button>
      ` : `
        <button class="btn btn-primary btn-lg" data-action="continuePass" data-i="${idx}">I'm ${escapeHtml(p.name)} — Continue</button>
      `}
    </div>
  </div>`;
}
function renderGameOver(){
  const w = state.players[state.winner];
  const ranked = state.players.map((p,i)=>({p,i,vp:calcVP(i,{includeHidden:true})})).sort((a,b)=>b.vp-a.vp);
  return `
  <div class="gameover">
    <h1>🏆 ${escapeHtml(w.name)} wins!</h1>
    <p>with ${calcVP(state.winner,{includeHidden:true})} victory points</p>
    <div class="final-scores">
      ${ranked.map(({p,vp})=>`<div class="score-row"><span class="swatch" style="background:${p.color}"></span>${escapeHtml(p.name)} — ${vp} VP</div>`).join('')}
    </div>
    <button class="btn btn-primary btn-lg" data-action="goHome">Back to Home</button>
  </div>`;
}

/* ============================= RENDER: BOARD SVG ============================= */
function findVertex(id){ return state.board.vertices.find(v=>v.id===id); }
function settlementSVG(x,y,color){
  return `<g transform="translate(${x-8},${y-11})"><polygon points="0,8 0,16 16,16 16,8 8,0" fill="${color}" stroke="#241a12" stroke-width="1.5"/></g>`;
}
function citySVG(x,y,color){
  return `<g transform="translate(${x-11},${y-15})"><rect x="0" y="10" width="12" height="12" fill="${color}" stroke="#241a12" stroke-width="1.5"/><polygon points="0,10 6,3 12,10" fill="${color}" stroke="#241a12" stroke-width="1.5"/><rect x="11" y="15" width="11" height="7" fill="${color}" stroke="#241a12" stroke-width="1.5"/></g>`;
}
function renderTile(t){
  const pts = t.corners.map(cid=>{ const v=findVertex(cid); return `${v.x},${v.y}`; }).join(' ');
  if(state.tilesHidden){
    return `<g class="tile"><polygon points="${pts}" fill="#5a4630" stroke="#241a12" stroke-width="2"/><polygon points="${pts}" fill="none" stroke="#f1e6c8" stroke-opacity=".25" stroke-width="1.5" transform="translate(${t.x} ${t.y}) scale(.82) translate(${-t.x} ${-t.y})"/><text x="${t.x}" y="${t.y+11}" text-anchor="middle" font-family="Cinzel,serif" font-size="32" fill="#f1e6c8" opacity=".55" style="pointer-events:none;">?</text></g>`;
  }
  const key = t.resource===null ? 'desert' : t.resource;
  const info = TILE_VISUAL[key];
  const reveal = Date.now()<(ui.revealUntil||0);
  let s = `<g class="tile${reveal?' reveal':''}" ${reveal?`style="animation-delay:${state.board.tiles.indexOf(t)*40}ms"`:''}>`;
  const clickable = iAmCurrent() && state.uiMode==='move-robber' && !t.hasRobber;
  s += `<polygon points="${pts}" fill="${info.color}" stroke="#241a12" stroke-width="2" ${clickable?`data-action="clickTile" data-tile-id="${t.id}" class="hit"`:''}/>`;
  s += `<text x="${t.x}" y="${t.y-18}" class="tile-icon" text-anchor="middle" style="pointer-events:none;">${info.icon}</text>`;
  if(t.number){
    const pipCount = 6-Math.abs(7-t.number);
    const isHot = (t.number===6||t.number===8);
    s += `<circle cx="${t.x}" cy="${t.y+16}" r="15" fill="#f1e6c8" stroke="#241a12" stroke-width="1.5" style="pointer-events:none;"/>`;
    s += `<text x="${t.x}" y="${t.y+21}" text-anchor="middle" class="tile-number ${isHot?'hot':''}" style="pointer-events:none;">${t.number}</text>`;
    s += `<text x="${t.x}" y="${t.y+29}" text-anchor="middle" class="tile-pips ${isHot?'hot':''}" style="pointer-events:none;">${'●'.repeat(pipCount)}</text>`;
  }
  if(t.hasRobber){
    s += `<ellipse cx="${t.x}" cy="${t.y+2}" rx="9" ry="13" fill="#1a1310" opacity="0.88" style="pointer-events:none;"/><circle cx="${t.x}" cy="${t.y-10}" r="6.5" fill="#1a1310" opacity="0.88" style="pointer-events:none;"/>`;
  }
  s += '</g>';
  return s;
}
function renderPort(e){
  const v1=findVertex(e.v1), v2=findVertex(e.v2);
  const mx=(v1.x+v2.x)/2, my=(v1.y+v2.y)/2;
  const len = Math.sqrt(mx*mx+my*my)||1;
  const px = mx+mx/len*28, py = my+my/len*28;
  const label = e.portType==='any' ? '3:1' : `${RESOURCE[e.portType].icon}2:1`;
  return `<line x1="${mx}" y1="${my}" x2="${px}" y2="${py}" stroke="#2f6e6b" stroke-width="2" stroke-dasharray="3,3" style="pointer-events:none;"/>
  <circle cx="${px}" cy="${py}" r="17" fill="#2f6e6b" stroke="#f1e6c8" stroke-width="2" style="pointer-events:none;"/>
  <text x="${px}" y="${py+4}" text-anchor="middle" class="port-label" style="pointer-events:none;">${label}</text>`;
}
function renderEdge(e){
  const v1=findVertex(e.v1), v2=findVertex(e.v2);
  let s='';
  const buildable = e.road==null && iAmCurrent() && isEdgeBuildable(e.id);
  if(e.road!=null){
    const color = state.players[e.road].color;
    s += `<line x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" stroke="${color}" stroke-width="7" stroke-linecap="round" style="pointer-events:none;"/>`;
  } else if(buildable){
    s += `<line x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" stroke="transparent" stroke-width="20" data-action="clickEdge" data-edge-id="${e.id}" class="hit"/>`;
    s += `<line x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" stroke="#f1e6c8" stroke-width="5" stroke-linecap="round" class="pulse" style="pointer-events:none;"/>`;
  }
  return s;
}
function renderVertex(v){
  let s='';
  const canSettle = !v.building && iAmCurrent() && isVertexBuildableSettlement(v.id);
  const canCity = v.building && iAmCurrent() && isVertexBuildableCity(v.id);
  if(v.building){
    const color = state.players[v.building.playerIdx].color;
    s += v.building.type==='settlement' ? settlementSVG(v.x,v.y,color) : citySVG(v.x,v.y,color);
    if(canCity){
      s += `<circle cx="${v.x}" cy="${v.y}" r="14" fill="transparent" stroke="#d9a441" stroke-width="3" class="pulse hit" data-action="clickVertexCity" data-vertex-id="${v.id}"/>`;
    }
  } else if(canSettle){
    s += `<circle cx="${v.x}" cy="${v.y}" r="11" fill="#f1e6c8" stroke="#d9a441" stroke-width="2.5" class="pulse hit" data-action="clickVertexSettlement" data-vertex-id="${v.id}"/>`;
  } else {
    s += `<circle cx="${v.x}" cy="${v.y}" r="3.5" fill="#241a12" opacity="0.18" style="pointer-events:none;"/>`;
  }
  return s;
}
function renderBoardSVG(){
  const b = state.board;
  const xs = b.vertices.map(v=>v.x), ys = b.vertices.map(v=>v.y);
  const pad=42;
  const minX=Math.min(...xs)-pad, maxX=Math.max(...xs)+pad;
  const minY=Math.min(...ys)-pad, maxY=Math.max(...ys)+pad;
  const w=maxX-minX, h=maxY-minY;
  let s = `<svg viewBox="${minX} ${minY} ${w} ${h}" class="board-svg" xmlns="http://www.w3.org/2000/svg">`;
  b.tiles.forEach(t=>{ s+=renderTile(t); });
  b.edges.filter(e=>e.isPortEdge).forEach(e=>{ s+=renderPort(e); });
  b.edges.forEach(e=>{ s+=renderEdge(e); });
  b.vertices.forEach(v=>{ s+=renderVertex(v); });
  s += '</svg>';
  return s;
}

/* ============================= RENDER: HAND / PANELS ============================= */
function renderResourceRow(p){
  return `<div class="resource-row">
    ${Object.keys(RESOURCE).map(r=>`<div class="res-chip"><span class="res-icon">${RESOURCE[r].icon}</span><span>${p.resources[r]}</span></div>`).join('')}
  </div>`;
}
function renderDevCard(c, playable){
  if(c.type==='vp') return `<div class="devcard vp-card">${DEV_LABELS.vp} (hidden)</div>`;
  const enabled = playable && iAmCurrent() && state.phase==='turn' && !state.turn.devCardPlayedThisTurn && (state.uiMode==='idle');
  return `<div class="devcard">${DEV_LABELS[c.type]}${enabled?`<button class="btn btn-sm" data-action="playDevCard" data-card-id="${c.id}" data-card-type="${c.type}">Play</button>`:''}</div>`;
}
function renderSetupPanel(){
  const p = state.players[viewerIdx()];
  const mine = iAmCurrent();
  const hint = !mine ? `Waiting for ${escapeHtml(state.players[state.currentPlayerIdx].name)} to place…`
    : (state.setup.subphase==='settlement' ? 'Tap a highlighted point on the board to place a settlement.' : 'Now tap a highlighted road to connect it.');
  return `<div class="panel">
    <h3 style="color:${p.color}">${escapeHtml(p.name)}</h3>
    ${renderResourceRow(p)}
    <p class="muted">${hint}</p>
    ${state.tilesHidden ? `<p class="muted">🙈 The tiles are hidden — ${state.hideMode==='first'?'they flip once everyone has placed a first settlement':'they flip when setup is complete'}.</p>` : ''}
  </div>`;
}
const BANNER_TEXT = {
  'build-road':'Choose where to build your road.',
  'build-settlement':'Choose where to build your settlement.',
  'build-city':'Choose one of your settlements to upgrade.',
  'move-robber':'Choose a tile to move the robber to.'
};
function renderBanner(){
  let msg=null, showCancel=false;
  const actor = requiredViewer();
  if(net.active && actor!=null && actor!==net.mySeat){
    const w = state.players[actor].name;
    msg = (state.pendingTrade&&state.pendingTrade.status==='pending') ? `Waiting for ${w} to answer a trade…`
        : state.uiMode==='discard' ? `Waiting for ${w} to discard…`
        : state.phase==='setup' ? `${w} is placing${state.tilesHidden?' blind':''}…` : `Waiting for ${w}…`;
    if(state.online && !state.online.connected[actor]) msg += ' (offline)';
  } else if(state.phase==='setup'){
    msg = (state.setup.subphase==='settlement' ? `${state.players[state.currentPlayerIdx].name}, place a settlement.` : 'Now connect it with a road.') + (state.tilesHidden?' 🙈':'');
  } else if(BANNER_TEXT[state.uiMode]){
    msg = BANNER_TEXT[state.uiMode];
    showCancel = state.uiMode==='build-road' || state.uiMode==='build-settlement' || state.uiMode==='build-city';
  }
  if(!msg) return '';
  return `<div class="board-banner">${escapeHtml(msg)}${showCancel?` <button class="link-btn" data-action="cancelBuild">Cancel</button>`:''}</div>`;
}
function renderHandPanel(){
  const p = state.players[viewerIdx()];
  const idleFree = state.uiMode==='idle' && iAmCurrent() && !(state.pendingTrade&&state.pendingTrade.status==='pending');
  const canRoll = !state.turn.rolled && idleFree;
  const canBuildRoad = state.turn.rolled && idleFree && p.pieces.road>0 && hasResources(p, COSTS.road);
  const canBuildSettlement = state.turn.rolled && idleFree && p.pieces.settlement>0 && hasResources(p, COSTS.settlement);
  const canBuildCity = state.turn.rolled && idleFree && p.pieces.city>0 && hasResources(p, COSTS.city);
  const canBuyDev = state.turn.rolled && idleFree && state.devDeck.length>0 && hasResources(p, COSTS.dev);
  const canTrade = state.turn.rolled && idleFree;
  const canEnd = state.turn.rolled && idleFree;
  return `
  <div class="panel hand-panel">
    <div class="dice-row">
      ${state.turn.dice ? `<div class="die">${state.turn.dice[0]}</div><div class="die">${state.turn.dice[1]}</div>` : '<div class="die-placeholder">🎲 🎲</div>'}
      <button class="btn ${canRoll?'btn-primary':'btn-disabled'}" data-action="rollDice" ${canRoll?'':'disabled'}>Roll Dice</button>
    </div>
    ${renderResourceRow(p)}
    <div class="devcards-row">
      ${(p.devCards.length===0 && p.newDevCards.length===0) ? '<span class="muted">No development cards</span>' : ''}
      ${p.devCards.map(c=>renderDevCard(c,true)).join('')}
      ${p.newDevCards.map(c=>renderDevCard(c,false)).join('')}
    </div>
    <div class="actions-grid">
      <button class="btn ${canBuildRoad?'':'btn-disabled'}" data-action="startBuildRoad" ${canBuildRoad?'':'disabled'}>🛤️ Road (${costStr(COSTS.road)})</button>
      <button class="btn ${canBuildSettlement?'':'btn-disabled'}" data-action="startBuildSettlement" ${canBuildSettlement?'':'disabled'}>🏠 Settlement</button>
      <button class="btn ${canBuildCity?'':'btn-disabled'}" data-action="startBuildCity" ${canBuildCity?'':'disabled'}>🏛️ City</button>
      <button class="btn ${canBuyDev?'':'btn-disabled'}" data-action="buyDevCard" ${canBuyDev?'':'disabled'}>🃏 Dev Card</button>
      <button class="btn ${canTrade?'':'btn-disabled'}" data-action="openTradeChooser" ${canTrade?'':'disabled'}>🔁 Trade</button>
      <button class="btn btn-accent ${canEnd?'':'btn-disabled'}" data-action="endTurn" ${canEnd?'':'disabled'}>✅ End Turn</button>
    </div>
  </div>`;
}
function renderPlayersStrip(){
  return `<div class="players-strip">
    ${state.players.map((p,i)=>{
      const cards = cardCount(p);
      const vp = calcVP(i, {includeHidden:false});
      const isCurrent = i===state.currentPlayerIdx;
      return `<div class="player-chip ${isCurrent?'current':''}" style="--pc:${p.color}">
        <span class="swatch" style="background:${p.color}"></span>
        <span>${escapeHtml(p.name)}</span>
        ${state.online?`<span class="conn ${state.online.connected[i]?'on':''}"></span>`:''}<span class="pc-stat">🏆${vp}</span>
        <span class="pc-stat">🎴${cards}</span>
        ${p.knightsPlayed>0?`<span class="pc-stat">⚔️${p.knightsPlayed}</span>`:''}
        ${state.longestRoadHolder===i?`<span class="pc-badge" title="Longest Road">🛤️</span>`:''}
        ${state.largestArmyHolder===i?`<span class="pc-badge" title="Largest Army">⚔️</span>`:''}
      </div>`;
    }).join('')}
  </div>`;
}
function renderLog(){
  return `<div class="log-panel">
    <div class="log-title">Game Log</div>
    <div class="log-entries">${state.log.slice(-14).slice().reverse().map(l=>`<div class="log-entry">${l}</div>`).join('')}</div>
  </div>`;
}

/* ============================= RENDER: OVERLAYS ============================= */
function renderTradeChooserOverlay(){
  return `<div class="overlay-backdrop">
    <div class="overlay-card">
      <h3>Trade</h3>
      <button class="btn btn-block" data-action="setUiMode" data-mode="trade-bank">⚓ Trade with Bank / Port</button>
      <button class="btn btn-block" data-action="setUiMode" data-mode="trade-build">🤝 Trade with a Player</button>
      <button class="btn btn-ghost" data-action="setUiMode" data-mode="idle">Cancel</button>
    </div>
  </div>`;
}
function renderBankTradeOverlay(){
  const p = state.players[state.currentPlayerIdx];
  ui.bank = ui.bank || {give:'wood', get:'brick', qty:1};
  const rate = bestRateFor(state.currentPlayerIdx, ui.bank.give);
  const totalGive = rate*ui.bank.qty;
  const affordable = ui.bank.give!==ui.bank.get && p.resources[ui.bank.give]>=totalGive && state.bank[ui.bank.get]>=ui.bank.qty;
  return `<div class="overlay-backdrop">
    <div class="overlay-card">
      <h3>Trade with Bank</h3>
      <div class="trade-row">
        <label>Give</label>
        <select data-action="setBankGive">${Object.keys(RESOURCE).map(r=>`<option value="${r}" ${ui.bank.give===r?'selected':''}>${RESOURCE[r].icon} ${RESOURCE[r].label} — you have ${p.resources[r]}</option>`).join('')}</select>
      </div>
      <div class="rate-note">Your rate for this resource: ${rate}:1</div>
      <div class="trade-row">
        <label>Receive</label>
        <select data-action="setBankGet">${Object.keys(RESOURCE).map(r=>`<option value="${r}" ${ui.bank.get===r?'selected':''}>${RESOURCE[r].icon} ${RESOURCE[r].label} — bank has ${state.bank[r]}</option>`).join('')}</select>
      </div>
      <div class="qty-stepper"><span>Amount</span><button data-action="bankQty" data-d="-1">−</button><span>${ui.bank.qty}</span><button data-action="bankQty" data-d="1">+</button></div>
      <p>You give <b>${totalGive} ${RESOURCE[ui.bank.give].label}</b> to receive <b>${ui.bank.qty} ${RESOURCE[ui.bank.get].label}</b>.</p>
      <button class="btn btn-primary ${affordable?'':'btn-disabled'}" ${affordable?'':'disabled'} data-action="confirmBankTrade">Confirm Trade</button>
      <button class="btn btn-ghost" data-action="setUiMode" data-mode="idle">Cancel</button>
    </div>
  </div>`;
}
function renderStepper(bucket, res, max){
  const val = (ui[bucket] && ui[bucket][res]) || 0;
  return `<div class="stepper-row"><span class="res-icon">${RESOURCE[res].icon}</span><button data-action="stepTrade" data-bucket="${bucket}" data-res="${res}" data-d="-1">−</button><span>${val}</span><button data-action="stepTrade" data-bucket="${bucket}" data-res="${res}" data-d="1">+</button></div>`;
}
function renderTradeBuildOverlay(){
  ui.tradeGive = ui.tradeGive || {};
  ui.tradeGet = ui.tradeGet || {};
  if(ui.tradeTarget==null) ui.tradeTarget = otherPlayerIndices()[0];
  const p = state.players[state.currentPlayerIdx];
  const giveTotal = Object.values(ui.tradeGive).reduce((a,b)=>a+b,0);
  const getTotal = Object.values(ui.tradeGet).reduce((a,b)=>a+b,0);
  const canSend = giveTotal>0 && getTotal>0 && hasResources(p, ui.tradeGive);
  return `<div class="overlay-backdrop">
    <div class="overlay-card">
      <h3>Propose a Trade</h3>
      <div class="trade-cols">
        <div><h4>You give</h4>${Object.keys(RESOURCE).map(r=>renderStepper('tradeGive',r,p.resources[r])).join('')}</div>
        <div><h4>You get</h4>${Object.keys(RESOURCE).map(r=>renderStepper('tradeGet',r,19)).join('')}</div>
      </div>
      <div class="trade-row">
        <label>With</label>
        <select data-action="setTradeTarget">${otherPlayerIndices().map(i=>`<option value="${i}" ${ui.tradeTarget===i?'selected':''}>${escapeHtml(state.players[i].name)}</option>`).join('')}</select>
      </div>
      <button class="btn btn-primary ${canSend?'':'btn-disabled'}" ${canSend?'':'disabled'} data-action="sendTrade">Propose Trade</button>
      <button class="btn btn-ghost" data-action="setUiMode" data-mode="idle">Cancel</button>
    </div>
  </div>`;
}
function renderTradeResponseOverlay(){
  const t = state.pendingTrade;
  const from = state.players[t.fromIdx], to = state.players[t.toIdx];
  const giveStr = Object.entries(t.give).map(([r,n])=>`${n} ${RESOURCE[r].icon}`).join(' ');
  const getStr = Object.entries(t.get).map(([r,n])=>`${n} ${RESOURCE[r].icon}`).join(' ');
  const canAccept = hasResources(to, t.get);
  return `<div class="overlay-backdrop">
    <div class="overlay-card">
      <h3>${escapeHtml(from.name)} proposes a trade</h3>
      <p>They give you: <b>${giveStr||'nothing'}</b></p>
      <p>They want from you: <b>${getStr||'nothing'}</b></p>
      ${!canAccept?'<p class="muted">You do not have enough to accept this.</p>':''}
      <div class="lobby-buttons">
        <button class="btn btn-primary ${canAccept?'':'btn-disabled'}" ${canAccept?'':'disabled'} data-action="respondTrade" data-accept="1">Accept</button>
        <button class="btn btn-ghost" data-action="respondTrade" data-accept="0">Decline</button>
      </div>
    </div>
  </div>`;
}
function renderDiscardOverlay(){
  const idx = state.turn.discardQueue[0];
  const p = state.players[idx];
  const total = Object.values(p.resources).reduce((a,b)=>a+b,0);
  const required = Math.floor(total/2);
  if(!ui.discard || ui.discardFor!==idx){ ui.discard={}; ui.discardFor=idx; }
  const selected = Object.values(ui.discard).reduce((a,b)=>a+b,0);
  return `<div class="overlay-backdrop">
    <div class="overlay-card">
      <h3>${escapeHtml(p.name)} must discard ${required} card${required===1?'':'s'}</h3>
      ${Object.keys(RESOURCE).map(r=>{
        const val = ui.discard[r]||0;
        return `<div class="stepper-row"><span class="res-icon">${RESOURCE[r].icon}</span><button data-action="stepDiscard" data-res="${r}" data-d="-1">−</button><span>${val} / ${p.resources[r]}</span><button data-action="stepDiscard" data-res="${r}" data-d="1">+</button></div>`;
      }).join('')}
      <p>Selected: ${selected} / ${required}</p>
      <button class="btn btn-primary ${selected===required?'':'btn-disabled'}" ${selected===required?'':'disabled'} data-action="doConfirmDiscard">Discard</button>
    </div>
  </div>`;
}
function renderChooseVictimOverlay(){
  return `<div class="overlay-backdrop"><div class="overlay-card">
    <h3>Choose a player to steal from</h3>
    ${state.pendingSteal.candidates.map(i=>`<button class="btn btn-block" style="border-color:${state.players[i].color}" data-action="chooseVictim" data-i="${i}">${escapeHtml(state.players[i].name)}</button>`).join('')}
  </div></div>`;
}
function renderMonopolyOverlay(){
  return `<div class="overlay-backdrop"><div class="overlay-card">
    <h3>Monopoly — choose a resource</h3>
    <p class="muted">Collect every card of that type from all other players.</p>
    <div class="res-pick-grid">${Object.keys(RESOURCE).map(r=>`<button class="btn" data-action="resolveMonopolyAction" data-res="${r}">${RESOURCE[r].icon} ${RESOURCE[r].label}</button>`).join('')}</div>
  </div></div>`;
}
function renderYoPOverlay(){
  ui.yop = ui.yop||[];
  return `<div class="overlay-backdrop"><div class="overlay-card">
    <h3>Year of Plenty</h3>
    <p>Choose 2 resources to take from the bank for free.</p>
    <p>Picked: ${ui.yop.map(r=>RESOURCE[r].icon).join(' ')||'none yet'} (${ui.yop.length}/2)</p>
    <div class="res-pick-grid">${Object.keys(RESOURCE).map(r=>`<button class="btn" ${ui.yop.length>=2?'disabled':''} data-action="pickYoP" data-res="${r}">${RESOURCE[r].icon} ${RESOURCE[r].label}</button>`).join('')}</div>
    ${ui.yop.length===2?`<button class="btn btn-primary btn-block" data-action="confirmYoPAction">Confirm</button>`:''}
    <button class="btn btn-ghost" data-action="resetYoP">Reset</button>
  </div></div>`;
}
function renderRefOverlay(){
  return `<div class="overlay-backdrop">
    <div class="overlay-card">
      <h3>Quick Reference</h3>
      <table class="ref-table">
        <tr><td>🛤️ Road</td><td>${costStr(COSTS.road)}</td></tr>
        <tr><td>🏠 Settlement</td><td>${costStr(COSTS.settlement)}</td></tr>
        <tr><td>🏛️ City</td><td>${costStr(COSTS.city)}</td></tr>
        <tr><td>🃏 Dev Card</td><td>${costStr(COSTS.dev)}</td></tr>
      </table>
      <p class="muted">Bank trade: 4:1 normally, 3:1 at any harbor (⚓), 2:1 at a matching resource harbor.</p>
      <p class="muted">First to 10 victory points wins. Longest Road and Largest Army are each worth 2 points.</p>
      <button class="btn btn-ghost" data-action="toggleRef">Close</button>
    </div>
  </div>`;
}
function rulesSection(title, body){
  return `<details class="rules-section"><summary>${title}</summary><p>${body}</p></details>`;
}
function renderRulesModal(){
  return `<div class="overlay-backdrop">
    <div class="overlay-card rules-card">
      <div class="rules-header"><h2>How to Play</h2><button class="icon-btn" data-action="toggleRules">✕</button></div>
      <div class="rules-body">
        ${rulesSection('🎯 Goal','Be the first to reach 10 victory points. You earn points from settlements and cities, from holding the Longest Road or Largest Army, and from Victory Point cards.')}
        ${rulesSection('🗺️ The Board','The isle is 19 hexagon tiles, each producing one resource: 🌲 Lumber, 🧱 Brick, 🪨 Ore, 🌾 Grain, or 🐑 Wool. The desert produces nothing. Every tile has a number from 2–12; when the dice match it, everyone with a settlement or city touching that tile collects.')}
        ${rulesSection('🏗️ Setup','Taking turns, each player places two settlements and two connecting roads. Your second settlement immediately hands you one of each resource it touches — that becomes your starting hand.')}
        ${rulesSection('🎲 Your Turn','Roll two dice to produce resources for everyone. Then, in any order, you may trade, build, and buy development cards before ending your turn. You must roll before building or trading.')}
        ${rulesSection('🏠 Building','A road costs '+costStr(COSTS.road)+' and must extend from one of your roads or settlements. A settlement costs '+costStr(COSTS.settlement)+', must connect to one of your roads, and needs at least two empty intersections between it and any other settlement. A city costs '+costStr(COSTS.city)+' and upgrades one of your settlements to collect double.')}
        ${rulesSection('🦹 The Robber','Rolling a 7 moves the robber: anyone holding more than 7 cards discards half (rounded down), then you move the robber to any tile — blocking its production — and steal one random card from a player touching it.')}
        ${rulesSection('🔁 Trading','Propose a trade with another player for anything you both agree to. Or trade with the bank at 4 of one resource for 1 of another — build a settlement on a harbor for a better rate, 3:1 for any resource or 2:1 for that harbor\u2019s specific resource.')}
        ${rulesSection('🃏 Development Cards','Cost '+costStr(COSTS.dev)+' each. Knight moves the robber and steals a card, and counts toward Largest Army. Road Building gives 2 free roads. Year of Plenty gives you any 2 resources from the bank. Monopoly takes every card of one resource from all other players. Victory Point cards are worth 1 point automatically and stay hidden until you choose to reveal them by winning.')}
        ${rulesSection('🏆 Longest Road &amp; Largest Army','The first player to build an unbroken chain of 5+ roads holds Longest Road (2 points) until someone builds a longer one. The first to play 3+ Knights holds Largest Army (2 points) until someone plays more.')}
        ${rulesSection('🙈 Hidden Tiles (optional)','When enabled in the lobby, tiles start face-down so settlements are placed blind. They flip once everyone has placed their first settlement, or after all of setup, depending on the option chosen. In the second case the starting resources are handed out at the flip.')}
        ${rulesSection('🌐 Online Rooms','One player hosts a room and shares the 5-letter code; up to 4 players join from their own devices. The host\u2019s browser runs the game, so the host needs to keep the tab open. If you get disconnected, rejoin with the same code and name.')}
        ${rulesSection('🙈 Playing Fair','Only look at your own resources and development cards. When you are done with your turn, pass the device to the next player before they look at the screen.')}
      </div>
    </div>
  </div>`;
}

/* ============================= RENDER: MAIN GAME ============================= */
function renderLeaveOverlay(){
  return `<div class="overlay-backdrop"><div class="overlay-card">
    <h3>Leave the game?</h3>
    <p class="muted">${net.role==='host'?'You are the host — leaving closes the room for everyone.':'You can rejoin later from Play Online with the same code and name. In a different tab or browser the host has to approve it.'}</p>
    <button class="btn btn-danger btn-block" data-action="confirmLeave">Leave</button>
    <button class="btn btn-block" data-action="cancelLeave">Stay</button>
  </div></div>`;
}
function renderOverlays(){
  let s='';
  const me = iAmCurrent();
  if(me && state.uiMode==='trade-choose') s+=renderTradeChooserOverlay();
  if(me && state.uiMode==='trade-bank') s+=renderBankTradeOverlay();
  if(me && state.uiMode==='trade-build') s+=renderTradeBuildOverlay();
  if(state.pendingTrade && state.pendingTrade.status==='pending' && viewerIdx()===state.pendingTrade.toIdx) s+=renderTradeResponseOverlay();
  if(state.uiMode==='discard' && viewerIdx()===state.turn.discardQueue[0]) s+=renderDiscardOverlay();
  if(me && state.uiMode==='choose-victim') s+=renderChooseVictimOverlay();
  if(me && state.uiMode==='monopoly-pick') s+=renderMonopolyOverlay();
  if(me && state.uiMode==='yearofplenty-pick') s+=renderYoPOverlay();
  if(ui.showRef) s+=renderRefOverlay();
  if(ui.leaveAsk) s+=renderLeaveOverlay();
  if(net.role==='client' && net.status==='reconnecting') s+=`<div class="overlay-backdrop"><div class="overlay-card"><h3>Connection lost</h3><p>Trying to reconnect to the host…</p><button class="btn btn-block" data-action="leaveRoom">Leave room</button></div></div>`;
  return s;
}
function renderGame(){
  const p = state.players[state.currentPlayerIdx];
  const isSetup = state.phase==='setup';
  return `
  <div class="game-shell">
    <div class="top-bar">
      <span class="turn-indicator" style="--pc:${p.color}"><span class="dot"></span>${escapeHtml(p.name)}'s turn</span>
      ${net.active?`<span class="room-chip" data-action="copyCode" title="Room code">🌐 ${net.code}</span>`:''}
      <div class="top-actions">
        <button class="icon-btn" data-action="toggleRef" title="Cheat sheet">📋</button>
        <button class="icon-btn" data-action="toggleRules" title="Rules">❓</button>
        <button class="icon-btn" data-action="toggleSound" title="Sound">${ui.sound?'🔊':'🔇'}</button>
        <button class="icon-btn" data-action="goHome" title="Save &amp; exit">🏠</button>
      </div>
    </div>
    <div class="board-area">
      ${renderBoardSVG()}
      ${renderBanner()}
    </div>
    <div class="side-panel">
      ${isSetup ? renderSetupPanel() : renderHandPanel()}
      ${renderPlayersStrip()}
      ${renderLog()}
    </div>
  </div>
  ${renderOverlays()}
  ${toastMsg ? `<div class="toast">${escapeHtml(toastMsg)}</div>` : ''}
  `;
}

/* ============================= TOP-LEVEL RENDER ============================= */
function render(){
  const app = document.getElementById('app');
  let html='';
  if(state){
    if(ui.wasHidden && !state.tilesHidden){ ui.revealUntil = Date.now()+1600; setTimeout(()=>toast('🗺️ The tiles are revealed!'),50); }
    ui.wasHidden = !!state.tilesHidden;
  }
  if(ui.screen==='lobby'){
    html = renderLobby();
  } else if(ui.screen==='online-menu'){
    html = renderOnlineMenu();
  } else if(ui.screen==='online-room' && net.active){
    html = renderOnlineRoom();
  } else if(ui.screen==='home' || !state){
    html = renderHome();
  } else {
    const needed = requiredViewer();
    if(!net.active && needed!=null && state.deviceHolder!==needed){
      html = renderPassScreen(needed);
    } else if(state.phase==='gameover'){
      html = renderGameOver();
    } else {
      html = renderGame();
    }
  }
  if(uiShowRules) html += renderRulesModal();
  html += renderSeatRequests();
  app.innerHTML = html;
  bindEvents();
  if(state) persistGame();
}

/* ============================= RENDER: ONLINE ============================= */
function hideModeControl(cur, editable){
  const opts=[['off','Visible'],['first','Reveal after 1st round'],['all','Reveal after setup']];
  return `<div class="hide-opt"><div class="hide-title">🙈 Tiles while placing settlements</div>
    <div class="segmented seg-wrap">${opts.map(([k,l])=>`<button class="seg ${cur===k?'active':''}" ${editable?`data-action="setHideMode" data-m="${k}"`:'disabled'}>${l}</button>`).join('')}</div>
    <p class="lobby-hint" style="text-align:left;margin:.5em 0 0">${HIDE_HELP[cur]}</p></div>`;
}
function ensureOnline(){
  if(!ui.online){ let nm=''; try{ nm=localStorage.getItem('si_name')||''; }catch(e){} ui.online={name:nm, code:'', error:''}; }
}
function renderOnlineMenu(){
  ensureOnline(); const O=ui.online;
  return `<div class="lobby">
    <h1>Play Online</h1>
    <p class="lobby-hint">Everyone plays on their own device. One person hosts a room and shares the code.</p>
    <div class="player-row"><input type="text" class="name-input online-name" placeholder="Your name" maxlength="16" value="${escapeHtml(O.name)}" /></div>
    ${O.error?`<p class="pass-error" style="text-align:center">${escapeHtml(O.error)}</p>`:''}
    <div class="online-block"><button class="btn btn-primary btn-lg btn-block" style="margin:0;text-align:center" data-action="createRoom">🏰 Host a new room</button></div>
    <p class="lobby-hint" style="margin:0">— or join a friend —</p>
    <div class="online-block"><input type="text" class="name-input online-code" placeholder="CODE" maxlength="5" value="${escapeHtml(O.code)}" autocapitalize="characters" /><button class="btn btn-accent" data-action="joinRoom">Join</button></div>
    ${net.status==='connecting'?'<p class="lobby-hint">Connecting… this can take up to a few tries if the network is slow. Tap Back to cancel.</p>':''}
    ${net.status==='pending'?'<p class="lobby-hint">The host has to approve you taking this seat. Waiting for their answer… Tap Back to cancel.</p>':''}
    <div class="lobby-buttons"><button class="btn btn-ghost" data-action="goHome">Back</button></div>
  </div>`;
}
function renderOnlineRoom(){
  const host = net.role==='host';
  const players = (net.lobby&&net.lobby.players)||[];
  const hide = (net.lobby&&net.lobby.hide)||'off';
  const link = /^https?:/.test(location.protocol);
  return `<div class="lobby">
    <h1>Room</h1>
    <div class="room-code" data-action="copyCode" title="Tap to copy">${net.code}</div>
    <p class="lobby-hint">Friends choose <b>Play Online → Join</b> and enter this code. ${link?'<button class="link-btn" data-action="copyLink">Copy invite link</button>':''}</p>
    <div class="lobby-players">
      ${players.map((p,i)=>`<div class="player-row"><span class="swatch" style="background:${p.color}"></span>
        <b style="flex:1;color:var(--ink)">${escapeHtml(p.name)}${i===net.mySeat?' (you)':''}${i===0?' 👑':''}</b>
        ${i===net.mySeat?`<div class="color-picker">${COLOR_CHOICES.map(c=>`<button class="color-dot ${p.color===c?'sel':''}" style="background:${c}" data-action="setOnlineColor" data-color="${c}" title="${COLOR_NAMES[c]}"></button>`).join('')}</div>`:''}
        <span class="conn ${p.on?'on':''}"></span></div>`).join('')}
    </div>
    ${hideModeControl(hide, host)}
    <div class="lobby-buttons">
      <button class="btn btn-ghost" data-action="leaveRoom">Leave</button>
      ${host ? `<button class="btn btn-primary btn-lg ${players.length<3?'btn-disabled':''}" ${players.length<3?'disabled':''} data-action="startOnlineGame">${players.length<3?`Need ${3-players.length} more`:`Start (${players.length} players)`}</button>` : `<span class="lobby-hint">Waiting for the host to start…</span>`}
    </div>
  </div>`;
}

/* ============================= ACTIONS ============================= */
function setColorAction(i, color){
  const L = ui.lobby;
  const otherIdx = L.players.findIndex((pl,idx)=> idx<L.numPlayers && idx!==i && pl.color===color);
  if(otherIdx>=0){ const tmp=L.players[otherIdx].color; L.players[otherIdx].color=L.players[i].color; L.players[i].color=tmp; }
  else { L.players[i].color = color; }
}
function startGameAction(){
  const L = ui.lobby;
  const players = L.players.slice(0,L.numPlayers).map((pl,i)=>({
    name: (pl.name||'').trim() ? escapeHtml(pl.name.trim()) : `Player ${i+1}`,
    color: pl.color,
    password: (pl.password||'').trim()
  }));
  createGame(L.numPlayers, players, {hideMode:L.hide||'off'});
  ui.lobby = null;
}
function submitPassInputAction(idx){
  const p = state.players[idx];
  if((ui.passInput||'')===p.password){
    state.deviceHolder = idx;
    ui.passInput=''; ui.passFor=null; ui.passError=false;
    playSound('pass');
  } else {
    ui.passError = true;
    ui.passInput = '';
  }
}
function stepTradeAction(bucket, res, d){
  ui[bucket] = ui[bucket]||{};
  const cur = ui[bucket][res]||0;
  ui[bucket][res] = Math.max(0, Math.min(9, cur + (+d)));
}
function bankQtyAction(d){
  ui.bank = ui.bank||{give:'wood',get:'brick',qty:1};
  ui.bank.qty = Math.max(1, Math.min(4, ui.bank.qty + d));
}
function stepDiscardAction(res, d){
  const idx = state.turn.discardQueue[0];
  const p = state.players[idx];
  ui.discard = ui.discard||{};
  const cur = ui.discard[res]||0;
  ui.discard[res] = Math.max(0, Math.min(p.resources[res], cur+(+d)));
}
function pickYoPAction(r){
  ui.yop = ui.yop||[];
  if(ui.yop.length<2) ui.yop.push(r);
}

/* ---- game actions: run on the host (or locally in pass-and-play) ---- */
function collectPayload(a){
  if(a==='sendTrade') return {give:ui.tradeGive||{}, get:ui.tradeGet||{}, target:ui.tradeTarget};
  if(a==='confirmBankTrade'){ const b=ui.bank||{give:'wood',get:'brick',qty:1}; return {give:b.give,get:b.get,qty:b.qty}; }
  if(a==='doConfirmDiscard') return {discard:ui.discard||{}};
  if(a==='confirmYoPAction') return {picks:ui.yop||[]};
  return {};
}
function afterPayload(a){
  if(a==='sendTrade'){ ui.tradeGive=null; ui.tradeGet=null; ui.tradeTarget=null; }
  if(a==='confirmBankTrade') ui.bank=null;
  if(a==='doConfirmDiscard'){ ui.discard=null; ui.discardFor=null; }
  if(a==='confirmYoPAction') ui.yop=null;
}
function handleAction(action, ds){
  if(GAME_ACTIONS.has(action)){
    const p = collectPayload(action);
    if(action==='setUiMode' && ds.mode==='trade-build'){ ui.tradeGive={}; ui.tradeGet={}; ui.tradeTarget=otherPlayerIndices()[0]; }
    afterPayload(action);
    const d = Object.assign({}, ds);
    if(net.active) sendOnlineAction({a:action, ds:d, p});     // the host decides; our screen updates when it answers
    else applyGameAction(action, d, p);
    render(); return;
  }
  switch(action){
    case 'goLobby': ui.screen='lobby'; ui.lobby=null; break;
    case 'goHome':
      if(net.active && state && state.phase!=='gameover'){ ui.leaveAsk=true; break; }
      if(net.active) leaveOnline();
      ui.screen='home'; state=null; break;
    case 'confirmLeave': ui.leaveAsk=false; leaveOnline(); break;
    case 'cancelLeave': ui.leaveAsk=false; break;
    case 'leaveRoom': leaveOnline(); break;
    case 'toggleRules': uiShowRules = !uiShowRules; break;
    case 'continueGame': loadSavedGame(); break;
    case 'deleteSavedGame': deleteSavedGame(); break;
    case 'setNumPlayers': ensureLobby(); ui.lobby.numPlayers = +ds.n; break;
    case 'setColor': setColorAction(+ds.i, ds.color); break;
    case 'startGame': startGameAction(); break;
    case 'continuePass': state.deviceHolder = +ds.i; playSound('pass'); break;
    case 'submitPassInput': submitPassInputAction(+ds.i); break;
    case 'stepTrade': stepTradeAction(ds.bucket, ds.res, ds.d); break;
    case 'bankQty': bankQtyAction(+ds.d); break;
    case 'stepDiscard': stepDiscardAction(ds.res, ds.d); break;
    case 'pickYoP': pickYoPAction(ds.res); break;
    case 'resetYoP': ui.yop=[]; break;
    case 'toggleRef': ui.showRef = !ui.showRef; break;
    case 'toggleSound':
      ui.sound = !ui.sound;
      try{ localStorage.setItem('si_sound', ui.sound?'1':'0'); }catch(e){}
      break;
    case 'goOnline': ensureOnline(); ui.online.error=''; ui.screen='online-menu'; break;
    case 'createRoom': ensureOnline(); saveName(); createRoom(ui.online.name); break;
    case 'joinRoom':
      ensureOnline();
      if(ui.online.code.trim().length<5){ ui.online.error='Enter the 5-character room code.'; break; }
      saveName(); joinRoom(ui.online.code.trim().toUpperCase(), ui.online.name); break;
    case 'setOnlineColor': if(net.role==='host') net.host.setColor(ds.color); else if(net.client) net.client.pref(ds.color); break;
    case 'setHideMode':
      if(net.role==='host'){ net.host.setSetting('hideMode', ds.m); } else if(ui.lobby){ ui.lobby.hide=ds.m; }
      break;
    case 'startOnlineGame': startOnlineGame(); break;
    case 'approveSeat': if(net.host) net.host.approve(+ds.id); break;
    case 'denySeat': if(net.host) net.host.deny(+ds.id); break;
    case 'copyCode': if(navigator.clipboard) navigator.clipboard.writeText(net.code).then(()=>toast('Room code copied')).catch(()=>{}); break;
    case 'copyLink': if(navigator.clipboard) navigator.clipboard.writeText(location.href.split('#')[0]+'#join='+net.code).then(()=>toast('Invite link copied')).catch(()=>{}); break;
  }
  render();
}

/* ============================= ONLINE (shared netcode in shared/net/) ============================= */
const tokens = createTokenStore('game-of-trades');
function saveName(){ try{ localStorage.setItem('si_name', ui.online.name); }catch(e){} }
function resetNet(){
  Object.assign(net,{active:false,role:null,code:null,mySeat:null,status:'idle',lobby:null,requests:[],host:null,client:null,transport:null});
}
// Close whatever is open. Detach first so late callbacks from the old room are ignored.
function stopNet(){
  const {host, client, transport} = net;
  net.host = null; net.client = null; net.transport = null;
  if(host) host.close();
  if(client) client.leave();
  if(transport && transport.dispose) setTimeout(()=>transport.dispose(), 300);
}
function netFail(msg){
  stopNet(); resetNet(); state=null; ui.leaveAsk=false; ensureOnline(); ui.online.error=msg; ui.screen='online-menu'; render();
}
function leaveOnline(){ stopNet(); resetNet(); state=null; ui.screen='home'; }
function peerReady(){
  if(typeof Peer==='undefined'){ ensureOnline(); ui.online.error=describeNetError({type:'no-peerjs'}); return false; }
  return true;
}
function makeTransport(){ return createPeerJsTransport({Peer, options:peerOptions(), prefix:PEER_PREFIX}); }
function deliver(events){ (events||[]).forEach(ev=>{ if(ev.type==='toast') toast(ev.msg); else if(ev.type==='sound') playSound(ev.sound); }); }
function showView(view, online, you){ state=view; state.online=online; net.mySeat=you; ui.screen='game'; }

function sendOnlineAction(action){
  if(net.role==='host') net.host.act(action);
  else if(!net.client || !net.client.act(action)) toast('Not connected to the room.');
}
function startOnlineGame(){
  if(!net.host || !net.host.startGame()) toast('You need at least 3 players.');
}
function renderSeatRequests(){
  const reqs = (net.role==='host' && net.requests) || [];
  if(!reqs.length) return '';
  return `<div class="seat-requests">${reqs.map(r=>`<div class="seat-request"><span><b>${escapeHtml(r.name)}</b> wants to take over <b>${escapeHtml(r.seatName)}</b>'s seat. Only allow this if you know who it is.</span><button class="btn btn-sm btn-primary" data-action="approveSeat" data-id="${r.id}">Allow</button><button class="btn btn-sm btn-ghost" data-action="denySeat" data-id="${r.id}">Deny</button></div>`).join('')}</div>`;
}

/* ---- host ---- */
async function createRoom(name){
  if(!peerReady()) return;
  stopNet(); resetNet();
  net.active=true; net.role='host'; net.status='connecting'; net.mySeat=0;
  net.transport = makeTransport();
  const host = createHost({transport:net.transport, game:gameOfTradesAdapter, name:cleanName(name)||'Player 1', onUpdate:snap=>hostUpdate(host, snap)});
  net.host = host;
  render();
  try{
    const code = await host.start();
    if(net.host!==host) return;
    net.code=code; net.status='connected'; ui.screen='online-room'; render();
  }catch(err){ if(net.host===host) netFail(describeNetError(err)); }
}
function hostUpdate(host, snap){
  if(net.host!==host) return;
  net.lobby = {players:snap.seats, hide:snap.settings.hideMode};
  net.requests = snap.requests;
  if(snap.phase==='playing') showView(snap.view, snap.online, 0);
  deliver(snap.events);
  render();
}

/* ---- player ---- */
function joinRoom(code,name){
  if(!peerReady()) return;
  stopNet(); resetNet();
  net.active=true; net.role='client'; net.code=code; net.status='connecting';
  net.transport = makeTransport();
  const client = createClient({
    transport:net.transport, code, name:cleanName(name), token:tokens.getOrCreate(code),
    onStatus:(st,detail)=>clientStatus(client, st, detail),
    onLobby:m=>{ if(net.client!==client) return; net.lobby={players:m.seats, hide:m.settings.hideMode}; net.mySeat=m.you; ui.screen='online-room'; render(); },
    onState:m=>{ if(net.client!==client) return; showView(m.view, m.online, m.you); deliver(m.events); render(); }
  });
  net.client = client;
  client.connect();
  render();
}
function clientStatus(client, st, detail){
  if(net.client!==client) return;
  net.status = st;
  if(st==='host-left') return netFail('The host left or lost their connection, so this game cannot continue. Ask them to host a new room.');
  if(st==='closed') return netFail('The host closed the room.');
  if(st==='rejected' || st==='failed') return netFail(detail);
  render();
}

function bindEvents(){
  const app = document.getElementById('app');
  app.onclick = (e)=>{
    if(e.target.tagName==='SELECT' || e.target.tagName==='OPTION') return;
    if(e.target.classList.contains('overlay-backdrop')){
      if(uiShowRules){ uiShowRules=false; render(); return; }
      if(state && ['trade-choose','trade-bank','trade-build'].includes(state.uiMode) && iAmCurrent()){ handleAction('setUiMode',{mode:'idle'}); return; }
      if(ui.showRef){ ui.showRef=false; render(); return; }
      return;
    }
    const el = e.target.closest('[data-action]');
    if(!el || el.tagName==='SELECT') return;
    handleAction(el.dataset.action, el.dataset);
  };
  app.onchange = (e)=>{
    const el = e.target;
    if(el.dataset.action==='setBankGive'){ ui.bank=ui.bank||{give:'wood',get:'brick',qty:1}; ui.bank.give=el.value; render(); }
    else if(el.dataset.action==='setBankGet'){ ui.bank=ui.bank||{give:'wood',get:'brick',qty:1}; ui.bank.get=el.value; render(); }
    else if(el.dataset.action==='setTradeTarget'){ ui.tradeTarget=+el.value; render(); }
  };
  app.oninput = (e)=>{
    if(e.target.classList.contains('name-input') && e.target.dataset.i!==undefined){
      ensureLobby();
      ui.lobby.players[+e.target.dataset.i].name = e.target.value;
    } else if(e.target.classList.contains('pin-input')){
      ensureLobby();
      ui.lobby.players[+e.target.dataset.i].password = e.target.value;
    } else if(e.target.classList.contains('online-name')){
      ensureOnline(); ui.online.name = e.target.value;
    } else if(e.target.classList.contains('online-code')){
      ensureOnline(); e.target.value = e.target.value.toUpperCase(); ui.online.code = e.target.value;
    } else if(e.target.classList.contains('pass-pin-input')){
      ui.passInput = e.target.value;
      ui.passError = false;
    }
  };
  app.onkeydown = (e)=>{
    if(e.key==='Enter' && e.target.classList.contains('pass-pin-input')){
      submitPassInputAction(+e.target.dataset.i);
      render();
    }
  };
}

/* ============================= INIT ============================= */
function init(){
  try{ ui.sound = localStorage.getItem('si_sound')!=='0'; }catch(e){ ui.sound=true; }
  const jm = location.hash.match(/join=([A-Za-z0-9]{5})/);
  if(jm){ ensureOnline(); ui.online.code=jm[1].toUpperCase(); ui.screen='online-menu'; }
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden && net.client) net.client.nudge();
  });
  render();
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
