'use strict';

/* ============================= CONSTANTS ============================= */
const RESOURCE = {
  wood:  {label:'Lumber', icon:'🌲', color:'#3f6b3f'},
  brick: {label:'Brick',  icon:'🧱', color:'#b5502f'},
  ore:   {label:'Ore',    icon:'🪨', color:'#8a8782'},
  wheat: {label:'Grain',  icon:'🌾', color:'#d9a441'},
  sheep: {label:'Wool',   icon:'🐑', color:'#9dbd6f'}
};
const TILE_VISUAL = {
  wood:  {color:'#2f5233', icon:'🌲'},
  brick: {color:'#b5502f', icon:'🧱'},
  ore:   {color:'#7c7a78', icon:'🪨'},
  wheat: {color:'#d9a441', icon:'🌾'},
  sheep: {color:'#8fae5d', icon:'🐑'},
  desert:{color:'#ddc98b', icon:'🏜️'}
};
const RESOURCE_TILE_POOL = [
  'wood','wood','wood','wood',
  'brick','brick','brick',
  'ore','ore','ore',
  'wheat','wheat','wheat','wheat',
  'sheep','sheep','sheep','sheep',
  null
];
const NUMBER_POOL = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];
// Bigger board (37 tiles) used for 5-8 player games, roughly double the standard board's
// resource/number distribution so odds stay balanced with more players around the table.
const RESOURCE_TILE_POOL_LARGE = [
  'wood','wood','wood','wood','wood','wood','wood','wood',
  'brick','brick','brick','brick','brick','brick',
  'ore','ore','ore','ore','ore','ore',
  'wheat','wheat','wheat','wheat','wheat','wheat','wheat','wheat',
  'sheep','sheep','sheep','sheep','sheep','sheep','sheep','sheep',
  null
];
const NUMBER_POOL_LARGE = [...NUMBER_POOL, ...NUMBER_POOL];
const COSTS = {
  road: {wood:1, brick:1},
  settlement: {wood:1, brick:1, wheat:1, sheep:1},
  city: {wheat:2, ore:3},
  dev: {wheat:1, sheep:1, ore:1}
};
const DEV_LABELS = {
  knight:'⚔️ Knight',
  vp:'⭐ Victory Point',
  roadbuilding:'🛣️ Road Building',
  yearofplenty:'🌽 Year of Plenty',
  monopoly:'📈 Monopoly'
};
const COLOR_CHOICES = ['#c0392b','#2c5f8a','#ede7d9','#d98a2b','#3f6b3f','#8e44ad','#e8d24a','#2f2f2f'];
const COLOR_NAMES = {'#c0392b':'Red','#2c5f8a':'Blue','#ede7d9':'White','#d98a2b':'Orange','#3f6b3f':'Green','#8e44ad':'Purple','#e8d24a':'Yellow','#2f2f2f':'Black'};
const MAX_PLAYERS = 8;
const HEX_SIZE = 58;

/* ============================= GLOBAL UI STATE ============================= */
let state = null;
let ui = {screen:'home', sound:true, lobby:null, showRef:false};
let uiShowRules = false;
let toastMsg = null;
let audioCtx = null;
const PEER_PREFIX = 'settlers-isle-';
// To use your own PeerJS server / a TURN server, set window.SI_PEER_OPTIONS before this script, e.g.
// {host:'peer.example.com', port:443, secure:true, path:'/', config:{iceServers:[{urls:'turn:...',username:'',credential:''}]}}
const PEER_OPTIONS = Object.assign({debug:1}, window.SI_PEER_OPTIONS||{});
const net = {active:false, role:null, code:null, peer:null, conn:null, mySeat:null, token:null, name:'', seats:[], hideMode:'off', started:false, actor:null, status:'idle', welcomed:false, lobby:null, rt:null};
const HIDE_HELP = {
  off:'Everyone sees the tiles from the start.',
  first:'Tiles stay face-down until every player has placed their first settlement and road.',
  all:'Tiles stay face-down for all placements. Starting resources are handed out when they flip.'
};
const GAME_ACTIONS = new Set(['rollDice','startBuildRoad','startBuildSettlement','startBuildCity','cancelBuild','clickVertexSettlement','clickVertexCity','clickEdge','clickTile','buyDevCard','playDevCard','openTradeChooser','setUiMode','sendTrade','respondTrade','confirmBankTrade','doConfirmDiscard','chooseVictim','resolveMonopolyAction','confirmYoPAction','endTurn']);

/* ============================= UTIL ============================= */
function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    const tmp = arr[i]; arr[i]=arr[j]; arr[j]=tmp;
  }
  return arr;
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function toast(msg){
  if(net.role==='host' && net.actor!=null && net.actor!==net.mySeat){ netSendTo(net.actor,{t:'toast',msg}); return; }
  toastMsg = msg;
  render();
  setTimeout(()=>{ if(toastMsg===msg){ toastMsg=null; render(); } }, 2200);
}
function playSound(type){
  if(net.role==='host' && state) state.sfx = {id:((state.sfx&&state.sfx.id)||0)+1, type};
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
function log(msg){
  state.log.push(msg);
  if(state.log.length>60) state.log.shift();
}
function V(id){ return state.board.vertices.find(v=>v.id===id); }
function E(id){ return state.board.edges.find(e=>e.id===id); }
function T(id){ return state.board.tiles.find(t=>t.id===id); }
function otherPlayerIndices(){
  return state.players.map((_,i)=>i).filter(i=>i!==state.currentPlayerIdx);
}
function hasResources(p, cost){
  return Object.keys(cost).every(r=> p.resources[r] >= cost[r]);
}
function payResources(p, cost){
  Object.keys(cost).forEach(r=>{ p.resources[r]-=cost[r]; state.bank[r]+=cost[r]; });
}
function costStr(cost){
  return Object.entries(cost).map(([r,n])=>`${n}${RESOURCE[r].icon}`).join(' ');
}
function removeDevCard(p, cardId){
  p.devCards = p.devCards.filter(c=>c.id!==cardId);
}
function viewerIdx(){ return net.active ? net.mySeat : (state.deviceHolder!=null ? state.deviceHolder : state.currentPlayerIdx); }
function iAmCurrent(){ return viewerIdx()===state.currentPlayerIdx; }
function cardCount(p){ return p.handCount!=null ? p.handCount : Object.values(p.resources).reduce((a,b)=>a+b,0); }
function isRes(r){ return Object.prototype.hasOwnProperty.call(RESOURCE, r); }
function cleanName(n){ return String(n||'').replace(/[<>&"'`]/g,'').trim().slice(0,16); }

/* ============================= BOARD GEOMETRY ============================= */
function buildBoard(numPlayers){
  const large = (numPlayers||4) > 4;
  const N = large ? 3 : 2, size = HEX_SIZE;
  const raw = [];
  for(let q=-N;q<=N;q++){
    const r1 = Math.max(-N,-q-N), r2 = Math.min(N,-q+N);
    for(let r=r1;r<=r2;r++) raw.push({q,r});
  }
  const vertexMap = new Map();
  const edgeMap = new Map();
  let vId=0, eId=0;
  const tiles = raw.map((rt,i)=>{
    const tid = 't'+i;
    const cx = size*Math.sqrt(3)*(rt.q+rt.r/2);
    const cy = size*1.5*rt.r;
    const corners = [];
    for(let k=0;k<6;k++){
      const ang = Math.PI/180*(60*k-30);
      const x = cx+size*Math.cos(ang), y = cy+size*Math.sin(ang);
      const key = Math.round(x*10)+','+Math.round(y*10);
      let v = vertexMap.get(key);
      if(!v){ v = {id:'v'+(vId++), x, y, tiles:[], building:null, port:null}; vertexMap.set(key,v); }
      v.tiles.push(tid);
      corners.push(v.id);
    }
    return {id:tid, q:rt.q, r:rt.r, x:cx, y:cy, corners, resource:null, number:null, hasRobber:false};
  });
  tiles.forEach(tile=>{
    for(let k=0;k<6;k++){
      const a = tile.corners[k], b = tile.corners[(k+1)%6];
      const key = a<b ? a+'_'+b : b+'_'+a;
      let e = edgeMap.get(key);
      if(!e){ e = {id:'e'+(eId++), v1:a, v2:b, tiles:[], road:null, isPortEdge:false, portType:null}; edgeMap.set(key,e); }
      e.tiles.push(tile.id);
    }
  });
  const vertices = Array.from(vertexMap.values());
  const edges = Array.from(edgeMap.values());
  const vById = {}; vertices.forEach(v=>vById[v.id]=v);
  const tileAdj = {}; tiles.forEach(t=>tileAdj[t.id]=[]);
  edges.forEach(e=>{ if(e.tiles.length===2){ const [a,b]=e.tiles; tileAdj[a].push(b); tileAdj[b].push(a); } });

  const pool = shuffle([...(large ? RESOURCE_TILE_POOL_LARGE : RESOURCE_TILE_POOL)]);
  tiles.forEach((t,i)=>{ t.resource = pool[i]; });

  function violates(numbers){
    let ni=0;
    const numOf = {};
    tiles.forEach(t=>{ if(t.resource){ numOf[t.id]=numbers[ni++]; } });
    for(const t of tiles){
      const n = numOf[t.id];
      if(n===6||n===8){
        for(const adjId of tileAdj[t.id]){ if(numOf[adjId]===6||numOf[adjId]===8) return true; }
      }
    }
    return false;
  }
  let numbers, attempts=0;
  const numberPool = large ? NUMBER_POOL_LARGE : NUMBER_POOL;
  do{ numbers = shuffle([...numberPool]); attempts++; } while(attempts<300 && violates(numbers));
  let ni=0;
  tiles.forEach(t=>{
    if(t.resource){ t.number = numbers[ni++]; }
    else { t.number = null; t.hasRobber = true; }
  });

  const boundary = edges.filter(e=>e.tiles.length===1);
  boundary.sort((a,b)=>{
    const va1=vById[a.v1], va2=vById[a.v2], vb1=vById[b.v1], vb2=vById[b.v2];
    const angA = Math.atan2((va1.y+va2.y)/2, (va1.x+va2.x)/2);
    const angB = Math.atan2((vb1.y+vb2.y)/2, (vb1.x+vb2.x)/2);
    return angA-angB;
  });
  const portTypes = large
    ? shuffle(['any','any','any','any','any','any','wood','wood','brick','brick','ore','ore','wheat','wheat'])
    : shuffle(['any','any','any','any','wood','brick','ore','wheat','sheep']);
  const numPorts = large ? 14 : 9;
  for(let i=0;i<numPorts;i++){
    const idx = Math.floor(i*(boundary.length/numPorts)) % boundary.length;
    const e = boundary[idx];
    e.isPortEdge = true; e.portType = portTypes[i];
    vById[e.v1].port = portTypes[i]; vById[e.v2].port = portTypes[i];
  }
  return {tiles, vertices, edges};
}

function vertexEdges(vid){ return state.board.edges.filter(e=>e.v1===vid||e.v2===vid); }
function vertexNeighbors(vid){ return vertexEdges(vid).map(e=> e.v1===vid?e.v2:e.v1); }

function canPlaceSettlement(playerIdx, vid, isSetup){
  const v = V(vid);
  if(v.building) return false;
  if(vertexNeighbors(vid).some(n=>V(n).building)) return false;
  if(isSetup) return true;
  return vertexEdges(vid).some(e=>e.road===playerIdx);
}
function canPlaceRoad(playerIdx, eid, restrictToVertex){
  const e = E(eid);
  if(e.road!=null) return false;
  if(restrictToVertex) return e.v1===restrictToVertex || e.v2===restrictToVertex;
  const touches = (vid)=>{
    const v = V(vid);
    if(v.building && v.building.playerIdx===playerIdx) return true;
    return vertexEdges(vid).some(x=>x.road===playerIdx);
  };
  return touches(e.v1) || touches(e.v2);
}
function isEdgeBuildable(eid){
  if(state.phase==='setup'){
    if(state.setup.subphase!=='road') return false;
    return canPlaceRoad(state.currentPlayerIdx, eid, state.setup.pendingVertex);
  }
  if(state.uiMode!=='build-road') return false;
  return canPlaceRoad(state.currentPlayerIdx, eid, null);
}
function isVertexBuildableSettlement(vid){
  if(state.phase==='setup'){
    return state.setup.subphase==='settlement' && canPlaceSettlement(state.currentPlayerIdx, vid, true);
  }
  if(state.uiMode!=='build-settlement') return false;
  return canPlaceSettlement(state.currentPlayerIdx, vid, false);
}
function isVertexBuildableCity(vid){
  if(state.uiMode!=='build-city') return false;
  const v = V(vid);
  return !!(v.building && v.building.type==='settlement' && v.building.playerIdx===state.currentPlayerIdx);
}

/* ============================= DEV DECK ============================= */
function buildDevDeck(large){
  const mult = large ? 2 : 1;
  const deck = []; let id=0;
  for(let i=0;i<14*mult;i++) deck.push({id:'d'+(id++), type:'knight'});
  for(let i=0;i<5;i++) deck.push({id:'d'+(id++), type:'vp'});
  for(let i=0;i<2*mult;i++) deck.push({id:'d'+(id++), type:'roadbuilding'});
  for(let i=0;i<2*mult;i++) deck.push({id:'d'+(id++), type:'yearofplenty'});
  for(let i=0;i<2*mult;i++) deck.push({id:'d'+(id++), type:'monopoly'});
  return shuffle(deck);
}

/* ============================= GAME CREATION ============================= */
function createGame(numPlayers, playersInput, opts){
  opts = opts||{};
  const hideMode = opts.hideMode||'off';
  const large = numPlayers > 4;
  const board = buildBoard(numPlayers);
  const players = playersInput.map((pin,i)=>({
    idx:i, name:pin.name, color:pin.color, password: pin.password||'',
    resources:{wood:0,brick:0,ore:0,wheat:0,sheep:0},
    devCards:[], newDevCards:[], knightsPlayed:0,
    pieces:{settlement:5, city:4, road:15}
  }));
  const order = [...Array(numPlayers).keys(), ...[...Array(numPlayers).keys()].reverse()];
  const bankAmt = large ? 24 : 19;
  state = {
    numPlayers, players, board, hideMode, tilesHidden: hideMode!=='off',
    bank:{wood:bankAmt,brick:bankAmt,ore:bankAmt,wheat:bankAmt,sheep:bankAmt},
    devDeck: buildDevDeck(large),
    currentPlayerIdx:0,
    phase:'setup',
    setup:{order, step:0, subphase:'settlement', pendingVertex:null, deferred:[]},
    turn:{rolled:false, dice:null, devCardPlayedThisTurn:false, discardQueue:[], freeRoads:0},
    longestRoadHolder:null, largestArmyHolder:null, winner:null,
    log:[`Welcome! ${players.map(p=>p.name).join(', ')} are settling the isle.`],
    pendingTrade:null, pendingSteal:null,
    uiMode:'idle', deviceHolder:null
  };
  ui.screen='game';
  ui.wasHidden = state.tilesHidden;
}

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

/* ============================= SETUP PHASE ============================= */
function grantInitialResources(player, vid){
  V(vid).tiles.forEach(tid=>{
    const t = T(tid);
    if(t.resource){ player.resources[t.resource]++; state.bank[t.resource]--; }
  });
  log(`${player.name} collects their starting resources.`);
}
function revealTiles(){
  state.tilesHidden = false;
  log('🗺️ The tiles are revealed!');
  playSound('dice');
  (state.setup.deferred||[]).forEach(d=>grantInitialResources(state.players[d.p], d.vid));
  state.setup.deferred = [];
}
function advanceSetup(){
  state.setup.subphase='settlement';
  state.setup.pendingVertex=null;
  state.setup.step++;
  if(state.tilesHidden && (state.setup.step>=state.setup.order.length || (state.hideMode==='first' && state.setup.step===state.numPlayers))) revealTiles();
  if(state.setup.step>=state.setup.order.length){
    state.phase='turn';
    state.currentPlayerIdx = state.setup.order[state.setup.order.length-1];
    state.uiMode='idle';
    state.turn={rolled:false, dice:null, devCardPlayedThisTurn:false, discardQueue:[], freeRoads:0};
    log('Setup complete! The game begins.');
  } else {
    state.currentPlayerIdx = state.setup.order[state.setup.step];
  }
}

/* ============================= BUILDING ============================= */
function buildSettlement(vid){
  const isSetup = state.phase==='setup';
  if(isSetup && state.setup.subphase!=='settlement') return;
  const p = state.players[state.currentPlayerIdx];
  if(!canPlaceSettlement(state.currentPlayerIdx, vid, isSetup)) return;
  if(p.pieces.settlement<=0){ toast('No settlements left.'); return; }
  if(!isSetup){
    if(!hasResources(p, COSTS.settlement)){ toast('Not enough resources.'); return; }
    payResources(p, COSTS.settlement);
  }
  V(vid).building = {playerIdx: state.currentPlayerIdx, type:'settlement'};
  p.pieces.settlement--;
  playSound('build');
  log(`${p.name} built a settlement.`);
  if(isSetup){
    const isSecond = state.setup.step >= state.numPlayers;
    state.setup.pendingVertex = vid;
    state.setup.subphase='road';
    if(isSecond){
      if(state.tilesHidden){ state.setup.deferred.push({p:state.currentPlayerIdx, vid}); }
      else grantInitialResources(p, vid);
    }
  } else {
    updateLongestRoad();
    checkWin();
  }
}
function buildRoad(eid){
  const isSetup = state.phase==='setup';
  if(isSetup && state.setup.subphase!=='road') return;
  const p = state.players[state.currentPlayerIdx];
  const freeRoad = state.turn.freeRoads>0;
  const restrict = isSetup ? state.setup.pendingVertex : null;
  if(!canPlaceRoad(state.currentPlayerIdx, eid, restrict)) return;
  if(p.pieces.road<=0){ toast('No roads left.'); return; }
  if(!isSetup && !freeRoad){
    if(!hasResources(p, COSTS.road)){ toast('Not enough resources.'); return; }
    payResources(p, COSTS.road);
  }
  E(eid).road = state.currentPlayerIdx;
  p.pieces.road--;
  playSound('build');
  log(`${p.name} built a road.`);
  if(isSetup){
    advanceSetup();
  } else {
    if(freeRoad) state.turn.freeRoads--;
    updateLongestRoad();
    checkWin();
    state.uiMode = state.turn.freeRoads>0 ? 'build-road' : 'idle';
  }
}
function buildCity(vid){
  const p = state.players[state.currentPlayerIdx];
  const v = V(vid);
  if(!isVertexBuildableCity(vid)) return;
  if(p.pieces.city<=0){ toast('No cities left.'); return; }
  if(!hasResources(p, COSTS.city)){ toast('Not enough resources.'); return; }
  payResources(p, COSTS.city);
  v.building.type='city';
  p.pieces.city--; p.pieces.settlement++;
  playSound('build');
  log(`${p.name} built a city.`);
  checkWin();
  state.uiMode='idle';
}
function buyDevCard(){
  const p = state.players[state.currentPlayerIdx];
  if(state.devDeck.length===0){ toast('No development cards left.'); return; }
  if(!hasResources(p, COSTS.dev)){ toast('Not enough resources.'); return; }
  payResources(p, COSTS.dev);
  const card = state.devDeck.pop();
  if(card.type==='vp'){ p.devCards.push(card); }
  else { p.newDevCards.push(card); }
  log(`${p.name} bought a development card.`);
  playSound('build');
  checkWin();
}

/* ============================= DICE & ROBBER ============================= */
function rollDice(){
  if(state.turn.rolled) return;
  const d1 = 1+Math.floor(Math.random()*6), d2 = 1+Math.floor(Math.random()*6);
  state.turn.dice = [d1,d2];
  state.turn.rolled = true;
  const total = d1+d2;
  playSound('dice');
  log(`${state.players[state.currentPlayerIdx].name} rolled a ${total}.`);
  if(total===7) handleSeven();
  else distributeResources(total);
}
function distributeResources(rollValue){
  const claims = {wood:[],brick:[],ore:[],wheat:[],sheep:[]};
  state.board.tiles.forEach(t=>{
    if(t.number===rollValue && !t.hasRobber && t.resource){
      t.corners.forEach(vid=>{
        const v = V(vid);
        if(v.building){ const amt = v.building.type==='city'?2:1; claims[t.resource].push({p:v.building.playerIdx, amt}); }
      });
    }
  });
  const gains = {};
  Object.keys(claims).forEach(res=>{
    const list = claims[res];
    if(list.length===0) return;
    const total = list.reduce((s,c)=>s+c.amt,0);
    const uniq = new Set(list.map(c=>c.p));
    if(total<=state.bank[res]){
      list.forEach(c=>{
        state.players[c.p].resources[res]+=c.amt;
        gains[c.p]=gains[c.p]||{}; gains[c.p][res]=(gains[c.p][res]||0)+c.amt;
      });
      state.bank[res]-=total;
    } else if(uniq.size===1){
      const pIdx=[...uniq][0];
      const give=Math.min(total, state.bank[res]);
      state.players[pIdx].resources[res]+=give;
      state.bank[res]-=give;
      gains[pIdx]=gains[pIdx]||{}; gains[pIdx][res]=(gains[pIdx][res]||0)+give;
    } else {
      log(`Not enough ${RESOURCE[res].label} left in the bank — no one collects it this round.`);
    }
  });
  Object.keys(gains).forEach(pIdx=>{
    const p = state.players[pIdx];
    const parts = Object.entries(gains[pIdx]).map(([r,n])=>`${n} ${RESOURCE[r].label}`).join(', ');
    log(`${p.name} collects ${parts}.`);
  });
  if(Object.keys(gains).length===0) log('No one collects resources this roll.');
}
function handleSeven(){
  const queue = [];
  state.players.forEach((p,i)=>{
    const total = Object.values(p.resources).reduce((a,b)=>a+b,0);
    if(total>7) queue.push(i);
  });
  state.turn.discardQueue = queue;
  state.uiMode = queue.length>0 ? 'discard' : 'move-robber';
}
function confirmDiscard(playerIdx, obj){
  const p = state.players[playerIdx];
  const total = Object.values(p.resources).reduce((a,b)=>a+b,0);
  const required = Math.floor(total/2);
  const sum = Object.values(obj).reduce((a,b)=>a+b,0);
  if(sum!==required) return;
  if(Object.keys(obj).some(r=>!isRes(r) || !(obj[r]>=0) || obj[r]>p.resources[r])) return;
  Object.keys(obj).forEach(res=>{ p.resources[res]-=obj[res]; state.bank[res]+=obj[res]; });
  log(`${p.name} discarded ${required} card${required===1?'':'s'}.`);
  state.turn.discardQueue.shift();
  state.uiMode = state.turn.discardQueue.length>0 ? 'discard' : 'move-robber';
}
function moveRobberTo(tileId){
  const cur = state.board.tiles.find(t=>t.hasRobber);
  if(cur && cur.id===tileId) return;
  state.board.tiles.forEach(t=>{ t.hasRobber = (t.id===tileId); });
  const t = T(tileId);
  const candidates = new Set();
  t.corners.forEach(vid=>{
    const v = V(vid);
    if(v.building && v.building.playerIdx!==state.currentPlayerIdx){
      const total = Object.values(state.players[v.building.playerIdx].resources).reduce((a,b)=>a+b,0);
      if(total>0) candidates.add(v.building.playerIdx);
    }
  });
  log(`${state.players[state.currentPlayerIdx].name} moved the robber.`);
  playSound('robber');
  if(candidates.size===0){ state.uiMode='idle'; }
  else if(candidates.size===1){ stealFrom([...candidates][0]); state.uiMode='idle'; }
  else { state.pendingSteal={candidates:[...candidates]}; state.uiMode='choose-victim'; }
}
function stealFrom(victimIdx){
  const victim = state.players[victimIdx];
  const pool = [];
  Object.keys(victim.resources).forEach(r=>{ for(let i=0;i<victim.resources[r];i++) pool.push(r); });
  if(pool.length===0) return;
  const res = pool[Math.floor(Math.random()*pool.length)];
  victim.resources[res]--;
  state.players[state.currentPlayerIdx].resources[res]++;
  log(`${state.players[state.currentPlayerIdx].name} stole a card from ${victim.name}.`);
}

/* ============================= DEV CARD PLAY ============================= */
function canPlayDevCard(){
  if(state.turn.devCardPlayedThisTurn){ toast("You've already played a development card this turn."); return false; }
  return true;
}
function playKnight(cardId){
  if(!canPlayDevCard()) return;
  const p = state.players[state.currentPlayerIdx];
  removeDevCard(p, cardId);
  p.knightsPlayed++;
  state.turn.devCardPlayedThisTurn = true;
  updateLargestArmy();
  checkWin();
  log(`${p.name} played a Knight.`);
  state.uiMode='move-robber';
}
function playRoadBuilding(cardId){
  if(!canPlayDevCard()) return;
  const p = state.players[state.currentPlayerIdx];
  removeDevCard(p, cardId);
  state.turn.devCardPlayedThisTurn = true;
  state.turn.freeRoads = 2;
  state.uiMode='build-road';
  log(`${p.name} played Road Building.`);
}
function resolveMonopoly(resource){
  const p = state.players[state.currentPlayerIdx];
  let total=0;
  state.players.forEach((op,i)=>{
    if(i!==state.currentPlayerIdx){ total+=op.resources[resource]; p.resources[resource]+=op.resources[resource]; op.resources[resource]=0; }
  });
  log(`${p.name} played Monopoly on ${RESOURCE[resource].label} and collected ${total} card${total===1?'':'s'}.`);
  state.uiMode='idle';
}
function confirmYearOfPlenty(picks){
  const p = state.players[state.currentPlayerIdx];
  picks.forEach(r=>{ if(state.bank[r]>0){ p.resources[r]++; state.bank[r]--; } });
  log(`${p.name} played Year of Plenty.`);
  state.uiMode='idle';
}

/* ============================= TRADING ============================= */
function proposeTrade(giveObj, getObj, targetIdx){
  const p = state.players[state.currentPlayerIdx];
  const give={}, get={};
  Object.keys(RESOURCE).forEach(r=>{ if(giveObj[r]>0) give[r]=giveObj[r]; if(getObj[r]>0) get[r]=getObj[r]; });
  if(Object.keys(give).length===0 || Object.keys(get).length===0){ toast('Add resources to both sides.'); return; }
  if(!hasResources(p, give)){ toast('You do not have those resources.'); return; }
  state.pendingTrade = {fromIdx: state.currentPlayerIdx, toIdx: targetIdx, give, get, status:'pending'};
  playSound('trade');
}
function respondTrade(accept){
  const t = state.pendingTrade;
  const from = state.players[t.fromIdx], to = state.players[t.toIdx];
  if(accept){
    if(!hasResources(to, t.get)){ toast("You don't have those resources."); state.pendingTrade=null; return; }
    Object.keys(t.give).forEach(r=>{ from.resources[r]-=t.give[r]; to.resources[r]+=t.give[r]; });
    Object.keys(t.get).forEach(r=>{ to.resources[r]-=t.get[r]; from.resources[r]+=t.get[r]; });
    log(`${from.name} and ${to.name} made a trade.`);
    playSound('trade');
  } else {
    log(`${to.name} declined ${from.name}'s trade.`);
  }
  state.pendingTrade = null;
}
function bestRateFor(playerIdx, resource){
  const ports = state.board.vertices.filter(v=>v.building && v.building.playerIdx===playerIdx && v.port).map(v=>v.port);
  if(ports.includes(resource)) return 2;
  if(ports.includes('any')) return 3;
  return 4;
}
function bankTrade(giveResource, giveAmount, getResource, getAmount){
  const p = state.players[state.currentPlayerIdx];
  if(giveResource===getResource){ toast('Choose two different resources.'); return; }
  if(p.resources[giveResource]<giveAmount){ toast('Not enough resources.'); return; }
  if(state.bank[getResource]<getAmount){ toast('The bank is out of that resource.'); return; }
  p.resources[giveResource]-=giveAmount; state.bank[giveResource]+=giveAmount;
  p.resources[getResource]+=getAmount; state.bank[getResource]-=getAmount;
  log(`${p.name} traded ${giveAmount} ${RESOURCE[giveResource].label} for ${getAmount} ${RESOURCE[getResource].label} with the bank.`);
  playSound('trade');
}

/* ============================= LONGEST ROAD / LARGEST ARMY / WIN ============================= */
function longestRoadForPlayer(playerIdx){
  const playerEdges = state.board.edges.filter(e=>e.road===playerIdx);
  if(playerEdges.length===0) return 0;
  const vmap = {};
  playerEdges.forEach(e=>{ (vmap[e.v1]=vmap[e.v1]||[]).push(e); (vmap[e.v2]=vmap[e.v2]||[]).push(e); });
  function isBlocked(vid){ const v=V(vid); return !!(v.building && v.building.playerIdx!==playerIdx); }
  function dfs(vid, visited){
    let best = visited.size;
    for(const e of (vmap[vid]||[])){
      if(visited.has(e.id)) continue;
      const nxt = e.v1===vid ? e.v2 : e.v1;
      visited.add(e.id);
      best = Math.max(best, visited.size);
      if(!isBlocked(nxt)) best = Math.max(best, dfs(nxt, visited));
      visited.delete(e.id);
    }
    return best;
  }
  let best=0;
  Object.keys(vmap).forEach(vid=>{ best = Math.max(best, dfs(vid, new Set())); });
  return best;
}
function updateLongestRoad(){
  state.players.forEach((p,i)=>{ p.roadLen = longestRoadForPlayer(i); });
  let holder = state.longestRoadHolder;
  if(holder!=null && state.players[holder].roadLen<5) holder=null;
  let bestIdx = holder, bestLen = holder!=null ? state.players[holder].roadLen : 0;
  state.players.forEach((p,i)=>{ if(p.roadLen>=5 && p.roadLen>bestLen){ bestLen=p.roadLen; bestIdx=i; } });
  if(bestIdx!==state.longestRoadHolder){
    state.longestRoadHolder = bestIdx;
    if(bestIdx!=null) log(`${state.players[bestIdx].name} takes the Longest Road!`);
  }
}
function updateLargestArmy(){
  let holder = state.largestArmyHolder;
  if(holder!=null && state.players[holder].knightsPlayed<3) holder=null;
  let bestIdx = holder, bestCount = holder!=null ? state.players[holder].knightsPlayed : 0;
  state.players.forEach((p,i)=>{ if(p.knightsPlayed>=3 && p.knightsPlayed>bestCount){ bestCount=p.knightsPlayed; bestIdx=i; } });
  if(bestIdx!==state.largestArmyHolder){
    state.largestArmyHolder = bestIdx;
    if(bestIdx!=null) log(`${state.players[bestIdx].name} takes the Largest Army!`);
  }
}
function calcVP(idx, opts){
  opts = opts||{};
  let vp=0;
  state.board.vertices.forEach(v=>{ if(v.building && v.building.playerIdx===idx){ vp += v.building.type==='city'?2:1; } });
  if(state.longestRoadHolder===idx) vp+=2;
  if(state.largestArmyHolder===idx) vp+=2;
  if(opts.includeHidden) vp += state.players[idx].devCards.filter(c=>c.type==='vp').length;
  return vp;
}
function checkWin(){
  if(state.phase==='gameover') return;
  state.players.forEach((p,i)=>{
    if(state.phase==='gameover') return;
    const vp = calcVP(i, {includeHidden:true});
    if(vp>=10){
      state.phase='gameover';
      state.winner=i;
      playSound('win');
      log(`🏆 ${p.name} wins with ${vp} victory points!`);
    }
  });
}

/* ============================= TURN FLOW ============================= */
function endTurn(){
  if(!state.turn.rolled){ toast('Roll the dice first.'); return; }
  const p = state.players[state.currentPlayerIdx];
  p.devCards.push(...p.newDevCards);
  p.newDevCards = [];
  state.currentPlayerIdx = (state.currentPlayerIdx+1) % state.numPlayers;
  state.turn = {rolled:false, dice:null, devCardPlayedThisTurn:false, discardQueue:[], freeRoads:0};
  state.uiMode='idle';
  log(`${p.name} ended their turn.`);
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
    <p class="muted">${net.role==='host'?'You are the host — leaving closes the room for everyone.':'You can rejoin later from Play Online with the same code and name.'}</p>
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
    if(net.role==='client' && state.sfx && state.sfx.id!==ui.lastSfx){ ui.lastSfx = state.sfx.id; playSound(state.sfx.type); }
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
    <div class="lobby-buttons"><button class="btn btn-ghost" data-action="goHome">Back</button></div>
  </div>`;
}
function renderOnlineRoom(){
  const host = net.role==='host';
  const players = host ? net.seats.map(s=>({name:s.name,color:s.color,on:!!s.connected})) : ((net.lobby&&net.lobby.players)||[]);
  const hide = host ? net.hideMode : ((net.lobby&&net.lobby.hide)||'off');
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
function playDevCardAction(cardId){
  if(!canPlayDevCard()) return;
  const p = state.players[state.currentPlayerIdx];
  const card = p.devCards.find(c=>c.id===cardId);
  if(!card) return;
  const type = card.type;
  if(type==='knight'){ playKnight(cardId); }
  else if(type==='roadbuilding'){ playRoadBuilding(cardId); }
  else if(type==='monopoly'){ removeDevCard(p,cardId); state.turn.devCardPlayedThisTurn=true; state.uiMode='monopoly-pick'; }
  else if(type==='yearofplenty'){ removeDevCard(p,cardId); state.turn.devCardPlayedThisTurn=true; state.uiMode='yearofplenty-pick'; }
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
function cleanBag(o){
  const out={}; Object.keys(o||{}).forEach(r=>{ const n=Math.floor(+o[r]); if(isRes(r) && n>0) out[r]=Math.min(n,19); });
  return out;
}
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
function validate(seat,a,ds,p){
  if(seat==null) return true;               // pass-and-play: the UI already gates everything
  const S=state, pt=!!(S.pendingTrade&&S.pendingTrade.status==='pending');
  if(S.phase==='gameover') return false;
  if(a==='respondTrade') return pt && S.pendingTrade.toIdx===seat;
  if(pt) return false;
  if(a==='doConfirmDiscard') return S.uiMode==='discard' && S.turn.discardQueue[0]===seat;
  if(S.uiMode==='discard' || seat!==S.currentPlayerIdx) return false;
  const turn=S.phase==='turn', idle=S.uiMode==='idle', rolled=S.turn.rolled;
  switch(a){
    case 'rollDice': return turn && idle && !rolled;
    case 'startBuildRoad': case 'startBuildSettlement': case 'startBuildCity': case 'buyDevCard': case 'openTradeChooser': case 'endTurn': return turn && idle && rolled;
    case 'playDevCard': return turn && idle;
    case 'cancelBuild': return ['build-road','build-settlement','build-city'].includes(S.uiMode);
    case 'clickVertexSettlement': return isVertexBuildableSettlement(ds.vertexId);
    case 'clickVertexCity': return isVertexBuildableCity(ds.vertexId);
    case 'clickEdge': return isEdgeBuildable(ds.edgeId);
    case 'clickTile': return S.uiMode==='move-robber';
    case 'setUiMode': return ['idle','trade-bank','trade-build'].includes(ds.mode) && S.uiMode.startsWith('trade');
    case 'sendTrade': return S.uiMode==='trade-build';
    case 'confirmBankTrade': return S.uiMode==='trade-bank';
    case 'chooseVictim': return S.uiMode==='choose-victim' && S.pendingSteal.candidates.includes(+ds.i);
    case 'resolveMonopolyAction': return S.uiMode==='monopoly-pick' && isRes(ds.res);
    case 'confirmYoPAction': return S.uiMode==='yearofplenty-pick' && Array.isArray(p.picks) && p.picks.length===2 && p.picks.every(isRes);
  }
  return false;
}
function applyGameAction(a, ds, p){
  switch(a){
    case 'rollDice': rollDice(); break;
    case 'startBuildRoad': state.uiMode='build-road'; break;
    case 'startBuildSettlement': state.uiMode='build-settlement'; break;
    case 'startBuildCity': state.uiMode='build-city'; break;
    case 'cancelBuild': state.turn.freeRoads=0; state.uiMode='idle'; break;
    case 'clickVertexSettlement': buildSettlement(ds.vertexId); break;
    case 'clickVertexCity': buildCity(ds.vertexId); break;
    case 'clickEdge': buildRoad(ds.edgeId); break;
    case 'clickTile': if(state.uiMode==='move-robber') moveRobberTo(ds.tileId); break;
    case 'buyDevCard': buyDevCard(); break;
    case 'playDevCard': playDevCardAction(ds.cardId); break;
    case 'openTradeChooser': state.uiMode='trade-choose'; break;
    case 'setUiMode': state.uiMode=ds.mode; if(ds.mode==='idle') state.turn.freeRoads=0; break;
    case 'sendTrade': {
      const t=+p.target;
      if(Number.isInteger(t) && t>=0 && t<state.numPlayers && t!==state.currentPlayerIdx) proposeTrade(cleanBag(p.give), cleanBag(p.get), t);
      state.uiMode='idle'; break; }
    case 'respondTrade': respondTrade(ds.accept==='1'); break;
    case 'confirmBankTrade': {
      if(!isRes(p.give)||!isRes(p.get)) break;
      const qty=Math.max(1,Math.min(4,Math.floor(+p.qty)||1));
      bankTrade(p.give, bestRateFor(state.currentPlayerIdx,p.give)*qty, p.get, qty);
      state.uiMode='idle'; break; }
    case 'doConfirmDiscard': confirmDiscard(state.turn.discardQueue[0], cleanBag(p.discard)); break;
    case 'chooseVictim': stealFrom(+ds.i); state.pendingSteal=null; state.uiMode='idle'; break;
    case 'resolveMonopolyAction': resolveMonopoly(ds.res); break;
    case 'confirmYoPAction': confirmYearOfPlenty(p.picks||[]); break;
    case 'endTurn': endTurn(); break;
  }
}

function handleAction(action, ds){
  if(GAME_ACTIONS.has(action)){
    const p = collectPayload(action);
    if(action==='setUiMode' && ds.mode==='trade-build'){ ui.tradeGive={}; ui.tradeGet={}; ui.tradeTarget=otherPlayerIndices()[0]; }
    afterPayload(action);
    const d = Object.assign({}, ds);
    if(net.role==='client'){ netSend({t:'act', a:action, ds:d, p}); }
    else if(net.role==='host'){ hostApply(net.mySeat, action, d, p); return; }
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
    case 'setOnlineColor': if(net.role==='host') hostColor(0, ds.color); else netSend({t:'color', color:ds.color}); break;
    case 'setHideMode':
      if(net.role==='host'){ net.hideMode=ds.m; hostSync(); } else if(ui.lobby){ ui.lobby.hide=ds.m; }
      break;
    case 'startOnlineGame': startOnlineGame(); break;
    case 'copyCode': if(navigator.clipboard) navigator.clipboard.writeText(net.code).then(()=>toast('Room code copied')).catch(()=>{}); break;
    case 'copyLink': if(navigator.clipboard) navigator.clipboard.writeText(location.href.split('#')[0]+'#join='+net.code).then(()=>toast('Invite link copied')).catch(()=>{}); break;
  }
  render();
}

/* ============================= ONLINE (PeerJS, host-authoritative) ============================= */
const CODE_CHARS='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function saveName(){ try{ localStorage.setItem('si_name', ui.online.name); }catch(e){} }
function myToken(){
  try{ let t=sessionStorage.getItem('si_tok'); if(!t){ t=Math.random().toString(36).slice(2)+Date.now().toString(36); sessionStorage.setItem('si_tok',t); } return t; }
  catch(e){ return net.token || (Math.random().toString(36).slice(2)); }
}
function resetNet(){
  clearTimeout(net.rt);
  Object.assign(net,{active:false,role:null,code:null,peer:null,conn:null,mySeat:null,seats:[],hideMode:'off',started:false,actor:null,status:'idle',welcomed:false,lobby:null,rt:null});
}
function netFail(msg){
  try{ if(net.peer) net.peer.destroy(); }catch(e){}
  resetNet(); state=null; ui.leaveAsk=false; ensureOnline(); ui.online.error=msg; ui.screen='online-menu'; render();
}
function leaveOnline(){
  if(net.role==='host') net.seats.forEach(s=>{ try{ s.conn && s.conn.send(JSON.stringify({t:'closed'})); }catch(e){} });
  const peer=net.peer;
  resetNet(); state=null; ui.screen='home';
  setTimeout(()=>{ try{ peer && peer.destroy(); }catch(e){} }, 150);
}
function netSend(m){
  if(net.conn && net.conn.open){ net.conn.send(JSON.stringify(m)); } else toast('Not connected to the room.');
}
function netSendTo(seat,m){
  const s=net.seats[seat]; if(s && s.conn && s.conn.open){ try{ s.conn.send(JSON.stringify(m)); }catch(e){} }
}
function peerReady(){
  if(typeof Peer==='undefined'){ ensureOnline(); ui.online.error='Online play could not load (no internet?).'; return false; }
  return true;
}
const CONNECT_TIMEOUT_MS = 12000;
const HOST_MAX_ATTEMPTS = 4;
/* ---- host ---- */
function createRoom(name){
  if(!peerReady()) return;
  resetNet(); net.active=true; net.role='host'; net.status='connecting'; net.token=myToken(); net.mySeat=0;
  net.seats=[{token:net.token, name:cleanName(name)||'Player 1', color:COLOR_CHOICES[0], conn:null, connected:true}];
  tryHost(0);
}
function tryHost(n){
  net.code = Array.from({length:5},()=>CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]).join('');
  const peer = new Peer(PEER_PREFIX+net.code, PEER_OPTIONS); net.peer=peer;
  let settled=false;
  const finish=(fn)=>{ if(settled||net.peer!==peer) return; settled=true; clearTimeout(timer); fn(); };
  const timer=setTimeout(()=>{
    finish(()=>{
      try{ peer.destroy(); }catch(e){}
      if(n<HOST_MAX_ATTEMPTS) tryHost(n+1);
      else netFail('Could not reach the matchmaking server. Check your internet connection (some firewalls/VPNs block it) and try again.');
    });
  }, CONNECT_TIMEOUT_MS);
  peer.on('open',()=>{ finish(()=>{ net.status='connected'; ui.screen='online-room'; render(); }); });
  peer.on('connection',hostOnConnection);
  peer.on('disconnected',()=>{ try{ peer.reconnect(); }catch(e){} });
  peer.on('error',err=>{
    if(net.peer!==peer || settled) return;
    if(err.type==='unavailable-id' && n<HOST_MAX_ATTEMPTS){ finish(()=>{ try{ peer.destroy(); }catch(e){} tryHost(n+1); }); return; }
    if(net.status==='connecting') finish(()=>netFail('Could not reach the matchmaking server ('+err.type+').'));
  });
}
function hostOnConnection(conn){
  conn.on('data',raw=>{
    let m; try{ m=JSON.parse(raw); }catch(e){ return; }
    if(m.t==='hello') return hostHello(conn,m);
    const s=net.seats.findIndex(x=>x.conn===conn); if(s<0) return;
    if(m.t==='act') hostApply(s, m.a, m.ds||{}, m.p||{});
    else if(m.t==='color') hostColor(s, m.color);
  });
  conn.on('close',()=>hostDrop(conn));
  conn.on('error',()=>hostDrop(conn));
}
function hostReject(conn,reason){
  try{ conn.send(JSON.stringify({t:'reject',reason})); }catch(e){}
  setTimeout(()=>{ try{ conn.close(); }catch(e){} },400);
}
function hostHello(conn,m){
  const tok=String(m.token||'').slice(0,60), nm=cleanName(m.name);
  let s=net.seats.findIndex(x=>x.token===tok);
  if(s<0){
    if(net.started){
      s=net.seats.findIndex(x=>!x.connected && x.name.toLowerCase()===nm.toLowerCase());
      if(s<0) return hostReject(conn,'That game has already started. To rejoin, use the same name as before.');
      net.seats[s].token=tok;
    } else if(net.seats.length>=MAX_PLAYERS){ return hostReject(conn,'This room is full.'); }
    else { s=net.seats.length; net.seats.push({token:tok, name:nm||('Player '+(s+1)), color:COLOR_CHOICES.find(c=>!net.seats.some(x=>x.color===c))}); }
  }
  const seat=net.seats[s];
  if(seat.conn && seat.conn!==conn){ try{ seat.conn.close(); }catch(e){} }
  seat.conn=conn; seat.connected=true;
  if(!net.started && nm) seat.name=nm;
  try{ conn.send(JSON.stringify({t:'welcome',seat:s,code:net.code})); }catch(e){}
  hostSync(); render();
}
function hostDrop(conn){
  const s=net.seats.findIndex(x=>x.conn===conn); if(s<0) return;
  if(!net.started) net.seats.splice(s,1); else { net.seats[s].conn=null; net.seats[s].connected=false; }
  hostSync(); render();
}
function hostColor(s,color){
  if(net.started || !COLOR_CHOICES.includes(color)) return;
  const o=net.seats.findIndex((x,i)=>i!==s && x.color===color);
  if(o>=0) net.seats[o].color=net.seats[s].color;
  net.seats[s].color=color; hostSync();
}
function viewFor(i){
  const v=JSON.parse(JSON.stringify(state)), over=v.phase==='gameover';
  v.players.forEach((p,j)=>{
    p.password='';
    if(j===i||over) return;
    p.handCount=Object.values(p.resources).reduce((a,b)=>a+b,0);
    p.resources={wood:0,brick:0,ore:0,wheat:0,sheep:0}; p.devCards=[]; p.newDevCards=[];
  });
  v.devDeck=v.devDeck.map(()=>0);
  if(v.tilesHidden) v.board.tiles.forEach(t=>{ t.resource=null; t.number=null; t.hasRobber=false; });
  return v;
}
function hostSync(){
  if(net.role!=='host') return;
  if(state && net.started) state.online={code:net.code, connected:net.seats.map(s=>!!s.connected)};
  net.seats.forEach((s,i)=>{
    if(!s.conn || !s.conn.open) return;
    const msg = net.started ? {t:'state', state:viewFor(i)}
      : {t:'lobby', you:i, code:net.code, hide:net.hideMode, players:net.seats.map(x=>({name:x.name,color:x.color,on:!!x.connected}))};
    try{ s.conn.send(JSON.stringify(msg)); }catch(e){}
  });
}
function hostApply(seat,a,ds,p){
  net.actor=seat;
  try{ if(GAME_ACTIONS.has(a) && validate(seat,a,ds,p)) applyGameAction(a,ds,p); }
  finally{ net.actor=null; }
  hostSync(); render();
}
function startOnlineGame(){
  if(net.seats.length<3){ toast('You need at least 3 players.'); return; }
  net.started=true;
  createGame(net.seats.length, net.seats.map(s=>({name:s.name,color:s.color,password:''})), {hideMode:net.hideMode});
  state.deviceHolder=null;
  hostSync();
}
/* ---- client ---- */
const JOIN_MAX_ATTEMPTS = 3;
function joinRoom(code,name){
  if(!peerReady()) return;
  resetNet(); net.active=true; net.role='client'; net.code=code; net.name=name; net.token=myToken(); net.status='connecting';
  tryJoin(0);
  render();
}
function tryJoin(n){
  const peer=new Peer(undefined, PEER_OPTIONS); net.peer=peer;
  let settledInitial=false;
  const finishInitial=(fn)=>{ if(settledInitial||net.peer!==peer||net.welcomed) return; settledInitial=true; clearTimeout(timer); fn(); };
  const timer=setTimeout(()=>{
    finishInitial(()=>{
      try{ peer.destroy(); }catch(e){}
      if(n<JOIN_MAX_ATTEMPTS) tryJoin(n+1);
      else netFail('Could not reach the matchmaking server. Check your internet connection (some firewalls/VPNs block it) and try again.');
    });
  }, CONNECT_TIMEOUT_MS);
  peer.on('open',()=>{ finishInitial(()=>clientConnect()); });
  peer.on('disconnected',()=>{ try{ peer.reconnect(); }catch(e){} });
  peer.on('error',err=>{
    if(net.peer!==peer) return;
    if(!net.welcomed){
      if(err.type==='peer-unavailable') finishInitial(()=>netFail('Room not found. Check the code and try again.'));
      else finishInitial(()=>{
        if(n<JOIN_MAX_ATTEMPTS){ try{ peer.destroy(); }catch(e){} tryJoin(n+1); }
        else netFail('Could not reach the matchmaking server ('+err.type+').');
      });
    } else if(err.type==='peer-unavailable'){
      scheduleReconnect();
    }
  });
}
function clientConnect(){
  const c=net.peer.connect(PEER_PREFIX+net.code,{reliable:true}); net.conn=c;
  let opened=false;
  const timer=setTimeout(()=>{
    if(opened || net.conn!==c || net.welcomed) return;
    try{ c.close(); }catch(e){}
    netFail('Could not reach the host (connection timed out). Make sure the room code is right and the host still has the room open, then try again.');
  }, CONNECT_TIMEOUT_MS);
  c.on('open',()=>{ opened=true; clearTimeout(timer); c.send(JSON.stringify({t:'hello',token:net.token,name:net.name})); });
  c.on('data',raw=>{ let m; try{ m=JSON.parse(raw); }catch(e){ return; } clientMsg(m); });
  c.on('close',()=>{ if(net.conn!==c) return; clearTimeout(timer); if(net.welcomed){ net.status='reconnecting'; render(); scheduleReconnect(); } else netFail('Could not connect to the room.'); });
  c.on('error',()=>{ if(net.conn!==c || net.welcomed) return; clearTimeout(timer); netFail('Could not connect to the room.'); });
}
function scheduleReconnect(){
  clearTimeout(net.rt);
  net.rt=setTimeout(()=>{
    if(!net.active || !net.peer || net.peer.destroyed) return;
    if(net.peer.disconnected){ try{ net.peer.reconnect(); }catch(e){} }
    clientConnect();
  },2500);
}
function clientMsg(m){
  switch(m.t){
    case 'welcome': net.mySeat=m.seat; net.welcomed=true; net.status='connected'; break;
    case 'lobby': net.lobby=m; net.mySeat=m.you; net.welcomed=true; net.status='connected'; ui.screen='online-room'; break;
    case 'state': net.welcomed=true; net.status='connected'; state=m.state; ui.screen='game'; break;
    case 'toast': toast(m.msg); return;
    case 'reject': netFail(m.reason); return;
    case 'closed': netFail('The host closed the room.'); return;
  }
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
    if(!document.hidden && net.role==='client' && net.status==='reconnecting'){ clearTimeout(net.rt); scheduleReconnect(); }
  });
  render();
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
