// Game of Trades rules engine.
//
// Pure game logic: no DOM, no network, no sound, no storage. The renderer and the
// netcode call into this file; this file never calls back into them.
//
//   createGame(numPlayers, players, opts, rng)   -> state
//   applyAction(state, action, ds, payload, rng) -> { state, events }
//   validate(state, seat, action, ds, payload)   -> boolean
//
// The caller's state is never modified: applyAction works on a copy and returns it.
// `events` lists what the player should be told: {type:'toast', msg} and {type:'sound', sound}.
// `rng` is any function returning a number in [0, 1); it defaults to Math.random.
//
// The rule functions below read a module-level `state`. That variable only exists while
// one engine call is running (it is set on entry and restored on exit), so nothing outside
// this file can see or change it.

let state = null;
let events = [];
let rnd = Math.random;

function notify(msg){ events.push({type:'toast', msg}); }
function sound(type){ events.push({type:'sound', sound:type}); }

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(rnd()*(i+1));
    const tmp = arr[i]; arr[i]=arr[j]; arr[j]=tmp;
  }
  return arr;
}

const RESOURCE = {
  wood:  {label:'Lumber', color:'#3f6b3f'},
  brick: {label:'Brick', color:'#b5502f'},
  ore:   {label:'Ore', color:'#8a8782'},
  wheat: {label:'Grain', color:'#d9a441'},
  sheep: {label:'Wool', color:'#9dbd6f'}
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

const MAX_PLAYERS = 8;
const HEX_SIZE = 58;

function log(msg){
  state.log.push(msg);
  if(state.log.length>60) state.log.shift();
}
function V(id){ return state.board.vertices.find(v=>v.id===id); }
function E(id){ return state.board.edges.find(e=>e.id===id); }
function T(id){ return state.board.tiles.find(t=>t.id===id); }

function hasResources(p, cost){
  return Object.keys(cost).every(r=> p.resources[r] >= cost[r]);
}
function payResources(p, cost){
  Object.keys(cost).forEach(r=>{ p.resources[r]-=cost[r]; state.bank[r]+=cost[r]; });
}

function removeDevCard(p, cardId){
  p.devCards = p.devCards.filter(c=>c.id!==cardId);
}

function isRes(r){ return Object.prototype.hasOwnProperty.call(RESOURCE, r); }

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
  log('The tiles are revealed!');
  sound('dice');
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
  if(p.pieces.settlement<=0){ notify('No settlements left.'); return; }
  if(!isSetup){
    if(!hasResources(p, COSTS.settlement)){ notify('Not enough resources.'); return; }
    payResources(p, COSTS.settlement);
  }
  V(vid).building = {playerIdx: state.currentPlayerIdx, type:'settlement'};
  p.pieces.settlement--;
  sound('build');
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
  if(p.pieces.road<=0){ notify('No roads left.'); return; }
  if(!isSetup && !freeRoad){
    if(!hasResources(p, COSTS.road)){ notify('Not enough resources.'); return; }
    payResources(p, COSTS.road);
  }
  E(eid).road = state.currentPlayerIdx;
  p.pieces.road--;
  sound('build');
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
  if(p.pieces.city<=0){ notify('No cities left.'); return; }
  if(!hasResources(p, COSTS.city)){ notify('Not enough resources.'); return; }
  payResources(p, COSTS.city);
  v.building.type='city';
  p.pieces.city--; p.pieces.settlement++;
  sound('build');
  log(`${p.name} built a city.`);
  checkWin();
  state.uiMode='idle';
}
function buyDevCard(){
  const p = state.players[state.currentPlayerIdx];
  if(state.devDeck.length===0){ notify('No development cards left.'); return; }
  if(!hasResources(p, COSTS.dev)){ notify('Not enough resources.'); return; }
  payResources(p, COSTS.dev);
  const card = state.devDeck.pop();
  if(card.type==='vp'){ p.devCards.push(card); }
  else { p.newDevCards.push(card); }
  log(`${p.name} bought a development card.`);
  sound('build');
  checkWin();
}

/* ============================= DICE & ROBBER ============================= */
function rollDice(){
  if(state.turn.rolled) return;
  const d1 = 1+Math.floor(rnd()*6), d2 = 1+Math.floor(rnd()*6);
  state.turn.dice = [d1,d2];
  state.turn.rolled = true;
  const total = d1+d2;
  sound('dice');
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
  sound('robber');
  if(candidates.size===0){ state.uiMode='idle'; }
  else if(candidates.size===1){ stealFrom([...candidates][0]); state.uiMode='idle'; }
  else { state.pendingSteal={candidates:[...candidates]}; state.uiMode='choose-victim'; }
}
function stealFrom(victimIdx){
  const victim = state.players[victimIdx];
  const pool = [];
  Object.keys(victim.resources).forEach(r=>{ for(let i=0;i<victim.resources[r];i++) pool.push(r); });
  if(pool.length===0) return;
  const res = pool[Math.floor(rnd()*pool.length)];
  victim.resources[res]--;
  state.players[state.currentPlayerIdx].resources[res]++;
  log(`${state.players[state.currentPlayerIdx].name} stole a card from ${victim.name}.`);
}

/* ============================= DEV CARD PLAY ============================= */
function canPlayDevCard(){
  if(state.turn.devCardPlayedThisTurn){ notify("You've already played a development card this turn."); return false; }
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
  if(Object.keys(give).length===0 || Object.keys(get).length===0){ notify('Add resources to both sides.'); return; }
  if(!hasResources(p, give)){ notify('You do not have those resources.'); return; }
  state.pendingTrade = {fromIdx: state.currentPlayerIdx, toIdx: targetIdx, give, get, status:'pending'};
  sound('trade');
}
function respondTrade(accept){
  const t = state.pendingTrade;
  const from = state.players[t.fromIdx], to = state.players[t.toIdx];
  if(accept){
    if(!hasResources(to, t.get)){ notify("You don't have those resources."); state.pendingTrade=null; return; }
    Object.keys(t.give).forEach(r=>{ from.resources[r]-=t.give[r]; to.resources[r]+=t.give[r]; });
    Object.keys(t.get).forEach(r=>{ to.resources[r]-=t.get[r]; from.resources[r]+=t.get[r]; });
    log(`${from.name} and ${to.name} made a trade.`);
    sound('trade');
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
  if(giveResource===getResource){ notify('Choose two different resources.'); return; }
  if(p.resources[giveResource]<giveAmount){ notify('Not enough resources.'); return; }
  if(state.bank[getResource]<getAmount){ notify('The bank is out of that resource.'); return; }
  p.resources[giveResource]-=giveAmount; state.bank[giveResource]+=giveAmount;
  p.resources[getResource]+=getAmount; state.bank[getResource]-=getAmount;
  log(`${p.name} traded ${giveAmount} ${RESOURCE[giveResource].label} for ${getAmount} ${RESOURCE[getResource].label} with the bank.`);
  sound('trade');
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
  // The title needs a road of at least 5, and goes to the single longest one.
  // A holder who is still tied for longest keeps it. If the holder lost it and others tie, nobody has it.
  const longest = Math.max(0, ...state.players.map(p=>p.roadLen));
  const leaders = longest>=5 ? state.players.map((p,i)=>i).filter(i=>state.players[i].roadLen===longest) : [];
  let holder = null;
  if(leaders.includes(state.longestRoadHolder)) holder = state.longestRoadHolder;
  else if(leaders.length===1) holder = leaders[0];
  if(holder!==state.longestRoadHolder){
    state.longestRoadHolder = holder;
    if(holder!=null) log(`${state.players[holder].name} takes the Longest Road!`);
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
      sound('win');
      log(`${p.name} wins with ${vp} victory points!`);
    }
  });
}

/* ============================= TURN FLOW ============================= */
function endTurn(){
  if(!state.turn.rolled){ notify('Roll the dice first.'); return; }
  const p = state.players[state.currentPlayerIdx];
  p.devCards.push(...p.newDevCards);
  p.newDevCards = [];
  state.currentPlayerIdx = (state.currentPlayerIdx+1) % state.numPlayers;
  state.turn = {rolled:false, dice:null, devCardPlayedThisTurn:false, discardQueue:[], freeRoads:0};
  state.uiMode='idle';
  log(`${p.name} ended their turn.`);
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

function cleanBag(o){
  const out={}; Object.keys(o||{}).forEach(r=>{ const n=Math.floor(+o[r]); if(isRes(r) && n>0) out[r]=Math.min(n,19); });
  return out;
}

function validate(seat,a,ds,p){
  if(seat==null) return true;               // pass-and-play: the UI already gates everything
  const hasVertex=id=>typeof id==='string' && state.board.vertices.some(v=>v.id===id);
  const hasEdge=id=>typeof id==='string' && state.board.edges.some(e=>e.id===id);
  const hasTile=id=>typeof id==='string' && state.board.tiles.some(t=>t.id===id);
  const S=state, pt=!!(S.pendingTrade&&S.pendingTrade.status==='pending');
  if(S.phase==='gameover') return false;
  if(a==='respondTrade') return pt && S.pendingTrade.toIdx===seat;
  if(a==='cancelTrade') return pt && S.pendingTrade.fromIdx===seat;
  if(pt) return false;
  if(a==='doConfirmDiscard') return S.uiMode==='discard' && S.turn.discardQueue[0]===seat;
  if(S.uiMode==='discard' || seat!==S.currentPlayerIdx) return false;
  const turn=S.phase==='turn', idle=S.uiMode==='idle', rolled=S.turn.rolled;
  switch(a){
    case 'rollDice': return turn && idle && !rolled;
    case 'startBuildRoad': case 'startBuildSettlement': case 'startBuildCity': case 'buyDevCard': case 'openTradeChooser': case 'endTurn': return turn && idle && rolled;
    case 'playDevCard': return turn && idle;
    case 'cancelBuild': return ['build-road','build-settlement','build-city'].includes(S.uiMode);
    case 'clickVertexSettlement': return hasVertex(ds.vertexId) && isVertexBuildableSettlement(ds.vertexId);
    case 'clickVertexCity': return hasVertex(ds.vertexId) && isVertexBuildableCity(ds.vertexId);
    case 'clickEdge': return hasEdge(ds.edgeId) && isEdgeBuildable(ds.edgeId);
    case 'clickTile': return S.uiMode==='move-robber' && hasTile(ds.tileId);
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
    case 'cancelTrade': log(`${state.players[state.pendingTrade.fromIdx].name} withdrew their trade offer.`); state.pendingTrade=null; break;
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

/* ============================= GAME CREATION ============================= */
function newState(numPlayers, playersInput, opts){
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
  return {
    numPlayers, players, board, hideMode, tilesHidden: hideMode!=='off',
    bank:{wood:bankAmt,brick:bankAmt,ore:bankAmt,wheat:bankAmt,sheep:bankAmt},
    devDeck: buildDevDeck(large),
    currentPlayerIdx:0,
    phase:'setup',
    setup:{order, step:0, subphase:'settlement', pendingVertex:null, deferred:[]},
    turn:{rolled:false, dice:null, devCardPlayedThisTurn:false, discardQueue:[], freeRoads:0},
    longestRoadHolder:null, largestArmyHolder:null, winner:null,
    log:[`Welcome! ${players.map(p=>p.name).join(', ')} are out to trade their way across the island.`],
    pendingTrade:null, pendingSteal:null,
    uiMode:'idle', deviceHolder:null
  };
}

/* ============================= PUBLIC API ============================= */
// Run fn with `s` installed as the working state, then put everything back.
function withState(s, random, fn){
  const prev = [state, events, rnd];
  state = s; events = []; rnd = random || Math.random;
  try{ return fn(); } finally { [state, events, rnd] = prev; }
}

export function createGame(numPlayers, playersInput, opts, rng){
  return withState(null, rng, ()=> newState(numPlayers, playersInput, opts));
}

export function applyAction(inputState, a, ds, p, rng){
  const copy = structuredClone(inputState);
  return withState(copy, rng, ()=>{
    applyGameAction(a, ds||{}, p||{});
    return {state: copy, events};
  });
}

export function validateAction(s, seat, a, ds, p){
  return withState(s, null, ()=> validate(seat, a, ds||{}, p||{}));
}

// Read-only questions the renderer asks about a state.
export const query = {
  edgeBuildable:  (s, eid) => withState(s, null, ()=> isEdgeBuildable(eid)),
  settlementSpot: (s, vid) => withState(s, null, ()=> isVertexBuildableSettlement(vid)),
  citySpot:       (s, vid) => withState(s, null, ()=> isVertexBuildableCity(vid)),
  victoryPoints:  (s, idx, opts) => withState(s, null, ()=> calcVP(idx, opts)),
  bestRate:       (s, idx, resource) => withState(s, null, ()=> bestRateFor(idx, resource)),
  longestRoad:    (s, idx) => withState(s, null, ()=> longestRoadForPlayer(idx)),
};

export { RESOURCE, COSTS, MAX_PLAYERS, HEX_SIZE, isRes, hasResources };
