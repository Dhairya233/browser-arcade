import * as Engine from './engine.js';
import { MAPW, MAPH, REVEAL_ROUNDS, COLORS } from './engine.js';

/* Rules and map generation live in engine.js. This file draws the game, handles input and runs the network. */
const rnd = Engine.seededRand(42);
const MAP = Engine.buildMap(rnd);
const { stations, edges } = MAP;
const EMOJI=["🕵️","🎭","🌉","🎸","🏛️","🎷","👑","💎","⚽","📚","🎨","🦊","⏰","🎤","🎳","🏉","🎈","🍩","🚂","🔑","👼","⚖️","🎬","📖","🌷","🎡","⛪","🍺","🏺","🧵","🎧","🏟️","🌳","🦉","🏆","🎪","🦌","🎾","🏢","🌼","🚉","⚓","🐕","🧭","🌲"];
function neighborsAny(stationId){return MAP.adj[stationId];}
function stationRingColor(id){
  const touching=edges.filter(e=>e.a===id||e.b===id).map(e=>e.type);
  if(touching.includes('underground')) return 'var(--tube)';
  if(touching.includes('bus')) return 'var(--bus)';
  return 'var(--taxi)';
}

/* ---------- game state ---------- */
let G=null;
let ME={idx:0,isHost:false,online:false,roomCode:null,name:'You'};
let NET={mode:null,db:null,doc:null,unsub:null,peer:null,conns:[],hostConn:null};
let roomData=null;
let mapFitted=false;

const newGame = Engine.newGame;
const shuffle = (a) => Engine.shuffle(a, rnd);
const currentPlayer = () => Engine.currentPlayer(G);
const validMoves = (playerIdx) => Engine.validMoves(G, MAP, playerIdx);
const takenStartPositions = () => Engine.takenStartPositions(G);

function afterTurnAdvance(){
  if(G.gameOver){ render(); persistState(); return; }
  if(!ME.online){ showPassGate(); }
  else { render(); persistState(); }
}
function showPassGate(){
  const cp=currentPlayer();
  document.getElementById('gateBox').innerHTML = `
    <h2>${cp.isMrX?"🕶️ Mister X's turn":'🔎 '+cp.name+"'s turn"}</h2>
    <p>${cp.isMrX? 'Everyone else look away. Pass the device to whoever is playing Mister X.' : 'Pass the device to '+cp.name+'.'}</p>
    <button class="primary" onclick="closeGate()">I'm ready — show my move</button>`;
  document.getElementById('gateBg').classList.add('active');
}
function closeGate(){
  document.getElementById('gateBg').classList.remove('active');
  render();
}

/* ---- Starting position selection ---- */
let startPickSelected=null;

function showStartPickGate(){
  // Show gate asking next player to pick their start
  const p=G.players[G.startPickIdx];
  startPickSelected=null;
  document.getElementById('gateBox').innerHTML=`
    <h2>${p.isMrX?'🕶️ Mister X':'🔎 '+p.name}</h2>
    <p style="color:var(--muted)">Everyone else look away.<br>${p.isMrX?'Mister X':'Detective '+p.name}, tap the button below, then secretly pick your starting station on the map.</p>
    <button class="primary" onclick="openStartPick()">I'm ready — pick my start</button>`;
  document.getElementById('gateBg').classList.add('active');
}

function openStartPick(){
  document.getElementById('gateBg').classList.remove('active');
  startPickSelected=null;
  renderStartPickMode();
}

function renderStartPickMode(){
  const p=G.players[G.startPickIdx];
  // Render the map in pick mode with no players shown
  drawMapForStartPick();
  // Show instruction in action panel
  document.getElementById('actionBody').innerHTML=`
    <div style="font-family:sans-serif">
      <div style="color:var(--gold);font-weight:bold;margin-bottom:6px">${p.isMrX?'🕶️ Mister X':'🔎 '+p.name}: pick your starting station</div>
      <div style="color:var(--muted);font-size:.85em;margin-bottom:10px">Tap any station on the map to select it. Your choice stays secret until the game begins.</div>
      <div id="startPickConfirm"></div>
    </div>`;
  document.getElementById('turnLabel').textContent = (p.isMrX?'Mister X':''+p.name)+' is choosing a start...';
  document.getElementById('roundBadge').textContent='Setup';
}

function drawMapForStartPick(){
  const takenPositions=takenStartPositions();
  let svg=`<svg viewBox="0 0 ${MAPW} ${MAPH}" xmlns="http://www.w3.org/2000/svg">`;
  svg+=`<defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fdf6e3"/><stop offset="1" stop-color="#e8dcb8"/>
    </linearGradient>
    <linearGradient id="riverGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fd3ea"/><stop offset="1" stop-color="#4a90c4"/>
    </linearGradient>
  </defs>`;
  svg+=`<rect width="${MAPW}" height="${MAPH}" fill="url(#bgGrad)"/>`;
  svg+=`<ellipse cx="190" cy="170" rx="155" ry="105" fill="#7cb87c" opacity=".38"/><text x="190" y="170" font-size="22" text-anchor="middle">🌳</text>`;
  svg+=`<ellipse cx="1110" cy="210" rx="120" ry="90" fill="#7cb87c" opacity=".35"/><text x="1110" y="210" font-size="20" text-anchor="middle">🌳</text>`;
  svg+=`<ellipse cx="640" cy="840" rx="165" ry="78" fill="#7cb87c" opacity=".35"/><text x="640" y="840" font-size="20" text-anchor="middle">🌳</text>`;
  svg+=`<path d="M0,650 C220,600 380,700 620,660 C860,620 1000,700 1300,655 L1300,720 C1000,760 860,690 620,720 C380,750 220,670 0,715 Z" fill="url(#riverGrad)" opacity=".55"/>`;
  svg+=`<text x="120" y="700" font-size="20" fill="#2a5a80" font-family="sans-serif" font-style="italic">🌊 River Thames</text>`;
  edges.forEach(e=>{const a=stations[e.a],b=stations[e.b]; svg+=`<line class="edge ${e.type}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" opacity=".85"/>`;});
  stations.forEach(s=>{
    const isTaken=takenPositions.includes(s.id);
    const isSelected=startPickSelected===s.id;
    const ring=isSelected?'#e0b84a':(isTaken?'#888':stationRingColor(s.id));
    const fill=isSelected?'#fff3c0':(isTaken?'#ddd':'#fff9e6');
    const cls=isTaken?'stationDot':'stationDot reachable';
    svg+=`<circle class="${cls}" cx="${s.x}" cy="${s.y}" r="14" fill="${fill}" stroke="${ring}" stroke-width="${isSelected?4:3}" onclick="startPickClicked(${s.id})" style="cursor:${isTaken?'not-allowed':'pointer'}"/>`;
    const labelBelow=s.id%2===0;
    svg+=`<text x="${s.x}" y="${labelBelow?s.y+28:s.y-19}" font-size="13" class="stationLbl" text-anchor="middle">${EMOJI[s.id]||''} ${s.name}</text>`;
    if(isSelected){
      svg+=`<circle cx="${s.x}" cy="${s.y}" r="10" fill="var(--gold)" opacity=".7" pointer-events="none"/>`;
      svg+=`<text x="${s.x}" y="${s.y+4}" class="pieceIcon" style="font-size:11px">✓</text>`;
    }
  });
  svg+='</svg>';
  document.getElementById('mapInner').innerHTML=svg;
  if(!mapFitted){ mapFitted=true; zoomMap(0,true); } else { applyZoom(); }
}

function startPickClicked(id){
  const takenPositions=takenStartPositions();
  if(takenPositions.includes(id)) return;
  startPickSelected=id;
  const p=G.players[G.startPickIdx];
  document.getElementById('startPickConfirm').innerHTML=`
    <div style="margin-bottom:8px">Selected: <b style="color:var(--gold)">${stations[id].name}</b></div>
    <button class="primary" onclick="confirmStartPosition()">Confirm this starting station</button>`;
  drawMapForStartPick();
}

function confirmStartPosition(){
  if(startPickSelected===null) return;
  if(ME.online){
    // For online: send pick to host, then show a waiting screen
    requestAction({cmd:'startPick', playerIdx:G.startPickIdx, pos:startPickSelected});
    startPickSelected=null;
    document.getElementById('actionBody').innerHTML=`<div style="font-family:sans-serif;color:var(--muted)">✅ Starting position chosen! Waiting for others to pick...</div>`;
    document.getElementById('mapInner').innerHTML='';
    return;
  }
  G=Engine.pickStartLocal(G,startPickSelected);
  startPickSelected=null;
  if(!G.startingPhase){
    // All players have picked — start the game properly
    // Show a reveal gate
    showStartRevealGate();
  } else {
    // Next player picks
    showStartPickGate();
  }
}

function showStartRevealGate(){
  document.getElementById('gateBox').innerHTML=`
    <h2>🎮 All set!</h2>
    <p style="color:var(--muted)">Everyone has secretly chosen their starting station.<br>The game is about to begin — starting positions will only be visible to their own player.</p>
    <button class="primary" onclick="beginGameFromStartPick()">Begin Game</button>`;
  document.getElementById('gateBg').classList.add('active');
}

function beginGameFromStartPick(){
  document.getElementById('gateBg').classList.remove('active');
  // Check if any detective accidentally chose MrX's starting square
  G=Engine.checkStartCollision(G,MAP);
  if(G.gameOver){
    render();
    return;
  }
  // Now show the normal first-turn pass gate
  showPassGate();
}

function showOnlineStartPick(){
  // For online play: show the map so this player can pick their start
  const myPlayer=G.players.find(p=>p.name===ME.name);
  if(!myPlayer || myPlayer.pos!==null){ render(); return; }
  G.startPickIdx=G.players.indexOf(myPlayer);
  startPickSelected=null;
  renderStartPickMode();
  document.getElementById('actionBody').innerHTML=`
    <div style="font-family:sans-serif">
      <div style="color:var(--gold);font-weight:bold;margin-bottom:6px">Pick your starting station</div>
      <div style="color:var(--muted);font-size:.85em;margin-bottom:10px">Tap any station on the map. Your choice stays secret until the game begins.</div>
      <div id="startPickConfirm"></div>
    </div>`;
}

/* ---------- networking ---------- */
async function getDB(){
  if(NET.db) return NET.db;
  if(!window.claude || !window.claude.use){ return null; }
  try{ const db = await window.claude.use('db'); return db; }catch(e){ return null; }
}
async function ensureTransport(){
  if(NET.mode) return NET.mode;
  const db=await getDB();
  if(db){ NET.mode='claudedb'; NET.db=db; }
  else { NET.mode='peer'; }
  return NET.mode;
}
const NO_NET_MSG='Could not reach the online relay — check your internet connection and reload the page.';

function handleRoomSnapshot(data){
  if(!data) return;
  ME.idx=data.players.findIndex(p=>p.name===ME.name);
  if(data.phase==='playing' && data.game){
    if(ME.online){
      handleRoomSnapshotOnline(data);
    } else {
      G=data.game;
      show('gameScreen');
      render();
    }
  } else {
    document.getElementById('lobbyCode').textContent = ME.roomCode;
    document.getElementById('lobbyStartBtn').style.display = ME.isHost?'inline-block':'none';
    document.getElementById('lobbyHostSettings').style.display = ME.isHost?'block':'none';
    document.getElementById('lobbyPlayers').innerHTML = data.players.map((p,i)=>
      `<div class="playerRow"><div class="dot" style="background:${i===0?'#111':COLORS[(i-1)%COLORS.length]}"></div><span style="font-family:sans-serif">${p.name}${p.isHost?' (host)':''}</span></div>`).join('');
    show('lobbyScreen');
  }
}

/* --- claude.ai db transport --- */
function subscribeClaudeDB(doc){
  NET.doc=doc;
  if(NET.unsub) NET.unsub();
  NET.unsub=doc.onSnapshot(snap=>{ if(snap.exists) handleRoomSnapshot(snap.data()); }, err=>console.error(err));
}
function pushGameStateClaudeDB(){
  if(!NET.doc) return;
  NET.doc.get().then(snap=>{
    const data=snap.data();
    data.game=G;
    NET.doc.set(data);
  });
}

/* --- serverless peer-to-peer transport (works for a downloaded/self-hosted copy too) --- */
function createRoomPeer(name,code){
  return new Promise((resolve,reject)=>{
    if(typeof Peer==='undefined'){ reject(new Error('no-peerjs')); return; }
    const peer=new Peer('sy-'+code);
    peer.on('open',()=>{
      NET.peer=peer; NET.conns=[]; ME.isHost=true; ME.online=true; ME.roomCode=code; ME.name=name;
      roomData={code,phase:'lobby',players:[{name,isHost:true}],game:null,createdAt:Date.now()};
      peer.on('connection',conn=>{
        NET.conns.push(conn);
        conn.on('data',msg=>handleHostMessage(conn,msg));
        conn.on('close',()=>{ NET.conns=NET.conns.filter(c=>c!==conn); });
        conn.on('open',()=>{ conn.send({t:'state',data:roomData}); });
      });
      resolve();
    });
    peer.on('error',err=>{ reject(err); });
  });
}
function joinRoomPeer(name,code){
  return new Promise((resolve,reject)=>{
    if(typeof Peer==='undefined'){ reject(new Error('no-peerjs')); return; }
    const peer=new Peer();
    let settled=false;
    peer.on('open',()=>{
      const conn=peer.connect('sy-'+code,{reliable:true});
      const timeout=setTimeout(()=>{ if(!settled){settled=true; try{peer.destroy();}catch(e){} reject(new Error('timeout'));} },9000);
      conn.on('open',()=>{
        if(settled) return; settled=true; clearTimeout(timeout);
        NET.peer=peer; NET.hostConn=conn; ME.isHost=false; ME.online=true; ME.roomCode=code; ME.name=name;
        conn.send({t:'join',name});
        conn.on('data',msg=>{ if(msg && msg.t==='state') handleRoomSnapshot(msg.data); });
        resolve();
      });
      conn.on('error',e=>{ if(!settled){settled=true; clearTimeout(timeout); reject(e);} });
    });
    peer.on('error',err=>{ if(!settled){settled=true; reject(err);} });
  });
}
function handleHostMessage(conn,msg){
  if(!msg) return;
  if(msg.t==='join'){
    if(!roomData.players.find(p=>p._connId===conn.peer)){
      roomData.players.push({name:msg.name||'Player',isHost:false,_connId:conn.peer});
    }
    broadcastState();
  } else if(msg.t==='action'){
    performAction(msg.action);
  }
}
function broadcastState(){
  handleRoomSnapshot(roomData);
  NET.conns.forEach(c=>{ try{ c.send({t:'state',data:roomData}); }catch(e){} });
}
function sendActionToHost(action){
  if(NET.hostConn){ try{ NET.hostConn.send({t:'action',action}); }catch(e){} }
}
function persistState(){
  if(NET.mode==='claudedb'){ pushGameStateClaudeDB(); }
  else if(NET.mode==='peer' && ME.isHost && roomData){
    roomData.game=G;
    NET.conns.forEach(c=>{ try{ c.send({t:'state',data:roomData}); }catch(e){} });
  }
}
function teardownNet(){
  if(NET.unsub){ try{NET.unsub();}catch(e){} }
  if(NET.peer){ try{NET.peer.destroy();}catch(e){} }
  NET={mode:null,db:null,doc:null,unsub:null,peer:null,conns:[],hostConn:null};
  roomData=null; ME.online=false; ME.isHost=false; ME.idx=0;
  mapFitted=false;
}
function leaveRoom(){ teardownNet(); show('titleScreen'); }
function quitGame(){ teardownNet(); G=null; show('titleScreen'); }

/* Room UI actions */
function genCode(){document.getElementById('crCode').value=Math.random().toString(36).substring(2,7).toUpperCase();}
genCode();

async function createRoom(){
  const name=document.getElementById('crName').value.trim()||'Host';
  let code=(document.getElementById('crCode').value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!code) code=Math.random().toString(36).substring(2,7).toUpperCase();
  document.getElementById('crMsg').textContent='Connecting…';
  const mode=await ensureTransport();
  if(mode==='claudedb'){
    try{
      ME.online=true; ME.roomCode=code; ME.isHost=true; ME.name=name;
      const doc=NET.db.doc('rooms/'+code);
      await doc.set({code,phase:'lobby',players:[{name,isHost:true}],game:null,createdAt:Date.now()});
      subscribeClaudeDB(doc);
      document.getElementById('crMsg').textContent='';
      show('lobbyScreen');
    }catch(e){ document.getElementById('crMsg').textContent=NO_NET_MSG; }
  } else {
    try{
      await createRoomPeer(name,code);
      document.getElementById('crMsg').textContent='';
      show('lobbyScreen');
      handleRoomSnapshot(roomData);
    }catch(e){
      document.getElementById('crMsg').textContent = (e && e.type==='unavailable-id') ? 'That room code is taken — tap 🎲 for a new one.' : NO_NET_MSG;
    }
  }
}
async function joinRoom(){
  const name=document.getElementById('jrName').value.trim()||'Player';
  const code=(document.getElementById('jrCode').value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!code){ document.getElementById('jrMsg').textContent='Enter a room password.'; return; }
  document.getElementById('jrMsg').textContent='Connecting…';
  const mode=await ensureTransport();
  if(mode==='claudedb'){
    try{
      const doc=NET.db.doc('rooms/'+code);
      let snap; try{ snap=await doc.get(); }catch(e){}
      if(!snap || !snap.exists){document.getElementById('jrMsg').textContent='Room not found. Check the password.';return;}
      const data=snap.data();
      if(data.phase!=='lobby'){document.getElementById('jrMsg').textContent='That game already started.';return;}
      data.players.push({name,isHost:false});
      await doc.set(data);
      ME.online=true; ME.roomCode=code; ME.isHost=false; ME.name=name;
      subscribeClaudeDB(doc);
      document.getElementById('jrMsg').textContent='';
      show('lobbyScreen');
    }catch(e){ document.getElementById('jrMsg').textContent=NO_NET_MSG; }
  } else {
    try{
      await joinRoomPeer(name,code);
      document.getElementById('jrMsg').textContent='';
      show('lobbyScreen');
    }catch(e){
      document.getElementById('jrMsg').textContent = 'Room not found, or the host disconnected. Check the password and that the host\'s game is still open.';
    }
  }
}
async function hostStartGame(){
  mapFitted=false;
  const maxRounds=+document.getElementById('lobbyMaxRounds').value||24;
  if(NET.mode==='claudedb'){
    const doc=NET.db.doc('rooms/'+ME.roomCode);
    const snap=await doc.get(); const data=snap.data();
    if(data.players.length<3){alert('Need at least 3 players (1 Mister X + 2 detectives).');return;}
    const names=shuffle(data.players.map(p=>p.name));
    data.players=names.map(n=>({name:n,isHost:n===data.players.find(p=>p.isHost).name}));
    const game=newGame(names, maxRounds);
    data.phase='playing'; data.game=game;
    await doc.set(data);
  } else if(NET.mode==='peer'){
    if(roomData.players.length<3){ alert('Need at least 3 players (1 Mister X + 2 detectives).'); return; }
    const hostName=roomData.players.find(p=>p.isHost).name;
    const names=shuffle(roomData.players.map(p=>p.name));
    roomData.players=names.map(n=>({name:n,isHost:n===hostName}));
    const game=newGame(names, maxRounds);
    roomData.phase='playing'; roomData.game=game;
    broadcastState();
  }
}
/* For online play: each client picks their own starting position */
function handleRoomSnapshotOnline(data){
  if(!data || !data.game) return;
  G=data.game;
  show('gameScreen');
  if(G.startingPhase){
    const myPlayer=G.players.find(p=>p.name===ME.name);
    if(myPlayer && myPlayer.pos===null){
      // This player still needs to pick
      G.startPickIdx=G.players.indexOf(myPlayer);
      showOnlineStartPick();
    } else {
      // Already picked — show waiting message
      document.getElementById('roundBadge').textContent='Setup';
      document.getElementById('turnLabel').textContent='Waiting for others to choose...';
      const picked=G.players.filter(p=>p.pos!==null).length;
      document.getElementById('actionBody').innerHTML=`<div style="font-family:sans-serif;color:var(--muted)">✅ Your starting position is set.<br>${picked} / ${G.players.length} players have chosen. Waiting...</div>`;
      drawMapForStartPick();
    }
  } else {
    render();
  }
}

/* Local setup */
function buildLocalRoster(){
  const n=+document.getElementById('localCount').value;
  let html='';
  for(let i=0;i<n;i++){
    html+=`<div class="playerRow"><div class="dot" style="background:${i===0?'#111':COLORS[(i-1)%COLORS.length]}"></div><input style="flex:1" id="lp${i}" placeholder="${i===0?'Mister X player name':'Detective '+i+' name'}" value="${i===0?'Mister X':'Detective '+i}"></div>`;
  }
  document.getElementById('localRoster').innerHTML=html;
}
buildLocalRoster();

function startLocalGame(){
  const n=+document.getElementById('localCount').value;
  const names=[]; for(let i=0;i<n;i++) names.push(document.getElementById('lp'+i).value||('Player '+i));
  const maxRounds=+document.getElementById('localMaxRounds').value||24;
  ME.online=false; ME.idx=null;
  mapFitted=false;
  G=newGame(names, maxRounds);
  show('gameScreen');
  showStartPickGate();
}

/* ---------- action requests ---------- */
function requestAction(action){
  if(ME.online && NET.mode==='peer' && !ME.isHost){ sendActionToHost(action); return; }
  performAction(action);
}
function performAction(action){
  if(!G) return;
  const res=Engine.applyAction(G,MAP,action);
  if(!res.handled) return;
  G=res.state;
  if(res.turnAdvanced){ afterTurnAdvance(); return; }
  render();
  persistState();
}

/* ---------- rendering ---------- */
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
function openHowTo(){
  document.getElementById('modalContent').innerHTML=`<h2>📖 How to Play</h2>
  <div class="htpGrid">
    <div class="htpCard"><div class="htpIcon">🕵️</div><h4>Goal</h4><p>One secret player is <b>Mister X</b>. Everyone else is a detective trying to catch him.</p></div>
    <div class="htpCard"><div class="htpIcon">🗺️</div><h4>The Map</h4><p>Stations link by taxi, bus & underground. Use the ➕➖⤢ buttons to zoom, or drag to pan.</p></div>
    <div class="htpCard"><div class="htpIcon">🎫</div><h4>Tickets</h4><p>Every move spends a ticket. A detective's used ticket is handed straight to Mister X!</p></div>
    <div class="htpCard"><div class="htpIcon">🕶️</div><h4>Mister X's Secrets</h4><p><b>Black</b> tickets hide which transport he used. <b>Double</b> tickets let him move twice in one turn.</p></div>
    <div class="htpCard"><div class="htpIcon">👁️</div><h4>Visibility</h4><p>Mister X is invisible — except on reveal rounds (${REVEAL_ROUNDS.join(', ')}), when he's spotted for that one round only, then vanishes again.</p></div>
    <div class="htpCard"><div class="htpIcon">🔄</div><h4>Turn Order</h4><p>Mister X moves first each round, then every detective moves once, in order.</p></div>
    <div class="htpCard"><div class="htpIcon">📱</div><h4>Same Device</h4><p>Playing on one device? You'll pass it between turns so nobody peeks at Mister X's secret moves.</p></div>
    <div class="htpCard"><div class="htpIcon">🏆</div><h4>Winning</h4><p>Detectives win by landing exactly on Mister X. He wins by surviving all the rounds, or stranding everyone.</p></div>
  </div>
  <div class="legendRow">
    <span class="legItem"><span class="legSwatch" style="background:var(--taxi)"></span>🚕 Taxi — short hops</span>
    <span class="legItem"><span class="legSwatch" style="background:var(--bus)"></span>🚌 Bus — medium hops</span>
    <span class="legItem"><span class="legSwatch" style="background:var(--tube)"></span>🚇 Underground — long jumps</span>
  </div>
  <p style="text-align:center;margin-top:16px"><button onclick="closeModal()">Got it 👍</button></p>`;
  document.getElementById('modalBg').classList.add('active');
}
function closeModal(){document.getElementById('modalBg').classList.remove('active');}

/* Fullscreen */
function toggleFullscreen(){
  if(!document.fullscreenElement){ (document.documentElement.requestFullscreen||function(){}).call(document.documentElement).catch(()=>{}); }
  else { document.exitFullscreen(); }
}
document.addEventListener('fullscreenchange',()=>{
  const btn=document.getElementById('fsBtn');
  if(btn) btn.textContent = document.fullscreenElement? '⤢ Exit Full Screen':'⛶ Full Screen';
  if(G){ setTimeout(()=>zoomMap(0,true),150); }
});
window.addEventListener('resize',()=>{ if(G) zoomMap(0,true); });

let selectedTarget=null, mapScale=1;
function render(){
  if(!G) return;
  if(G.startingPhase){ renderStartPickMode(); return; }
  document.getElementById('roundBadge').textContent='Round '+Math.min(G.round,G.maxRounds)+' / '+G.maxRounds;
  const cp = G.gameOver ? (G.players[0]) : currentPlayer();
  const myTurn = ME.online ? (ME.idx===G.turn-1) : true;
  document.getElementById('turnLabel').textContent = G.gameOver? '' : (cp.isMrX?'Mister X is moving...':cp.name+"'s turn");

  const mrx=G.players.find(p=>p.isMrX);
  const lastReveal=[...G.mrXHistory].reverse();
  let lastKnown = mrx.revealedPos!=null ? stations[mrx.revealedPos].name : 'Unknown';
  let mrxHtml = `<div style="font-family:sans-serif">${G.mrxVisible?'<span class="badge reveal">SPOTTED NOW</span> ':''}Last known station: <b>${lastKnown}</b></div>`;
  mrxHtml += `<div class="tickets">Recent tickets: ${lastReveal.slice(0,5).map(h=>h.type).join(', ')||'—'}</div>`;
  const iAmMrX = ME.online ? (G.players[ME.idx] && G.players[ME.idx].isMrX) : cp.isMrX;
  if(iAmMrX || G.gameOver){
    mrxHtml += `<div class="tickets">Black:<span>${mrx.tickets.black}</span>Double:<span>${mrx.tickets.double}</span></div>`;
  }
  document.getElementById('mrxPanel').innerHTML=mrxHtml;

  document.getElementById('detPanel').innerHTML = G.players.filter(p=>!p.isMrX).map(p=>
    `<div class="playerRow"><div class="dot" style="background:${p.color}"></div><div style="font-family:sans-serif;flex:1"><b>${p.name}</b><div class="tickets">🚕${p.tickets.taxi} 🚌${p.tickets.bus} 🚇${p.tickets.underground}</div></div></div>`).join('');

  document.getElementById('log').innerHTML = [...G.log].reverse().map(l=>`<div>${l}</div>`).join('');

  drawMap((!G.gameOver && myTurn) ? cp : null);

  if(G.gameOver){
    document.getElementById('actionBody').innerHTML = `<div style="font-family:sans-serif;text-align:center;padding:10px"><div style="font-size:2em;margin-bottom:8px">${G.winner==='mrx'?'🕶️':'🚨'}</div><b style="font-size:1.1em">${G.winner==='mrx'?'Mister X wins!':'Detectives win!'}</b><br><div style="color:var(--muted);font-size:.85em;margin:6px 0">${G.log[G.log.length-1]||''}</div><button style="margin-top:10px" onclick="quitGame()">Back to menu</button></div>`;
  } else {
    renderActionPanel(myTurn);
  }
}

function drawMap(activePlayer){
  const showMrX = G.gameOver || G.mrxVisible || (activePlayer && activePlayer.isMrX);
  let svg=`<svg viewBox="0 0 ${MAPW} ${MAPH}" xmlns="http://www.w3.org/2000/svg">`;
  svg+=`<defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fdf6e3"/><stop offset="1" stop-color="#e8dcb8"/>
    </linearGradient>
    <linearGradient id="riverGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fd3ea"/><stop offset="1" stop-color="#4a90c4"/>
    </linearGradient>
    <filter id="glowRed" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;
  svg+=`<rect width="${MAPW}" height="${MAPH}" fill="url(#bgGrad)"/>`;
  svg+=`<ellipse cx="190" cy="170" rx="155" ry="105" fill="#7cb87c" opacity=".38"/><text x="190" y="170" font-size="22" text-anchor="middle">🌳</text>`;
  svg+=`<ellipse cx="1110" cy="210" rx="120" ry="90" fill="#7cb87c" opacity=".35"/><text x="1110" y="210" font-size="20" text-anchor="middle">🌳</text>`;
  svg+=`<ellipse cx="640" cy="840" rx="165" ry="78" fill="#7cb87c" opacity=".35"/><text x="640" y="840" font-size="20" text-anchor="middle">🌳</text>`;
  svg+=`<path d="M0,650 C220,600 380,700 620,660 C860,620 1000,700 1300,655 L1300,720 C1000,760 860,690 620,720 C380,750 220,670 0,715 Z" fill="url(#riverGrad)" opacity=".55"/>`;
  svg+=`<text x="120" y="700" font-size="20" fill="#2a5a80" font-family="sans-serif" font-style="italic">🌊 River Thames</text>`;
  edges.forEach(e=>{const a=stations[e.a],b=stations[e.b]; svg+=`<line class="edge ${e.type}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" opacity=".85"/>`;});
  const reach = (activePlayer && !G.gameOver) ? validMoves(G.players.indexOf(activePlayer)).map(o=>o.to) : [];
  stations.forEach(s=>{
    const isReach=reach.includes(s.id);
    const ring=stationRingColor(s.id);
    svg+=`<circle class="stationDot ${isReach?'reachable':''}" cx="${s.x}" cy="${s.y}" r="14" fill="#fff9e6" stroke="${ring}" onclick="stationClicked(${s.id})"/>`;
    const labelBelow = s.id%2===0;
    svg+=`<text x="${s.x}" y="${labelBelow?s.y+28:s.y-19}" font-size="13" class="stationLbl" text-anchor="middle">${EMOJI[s.id]||''} ${s.name}</text>`;
  });
  G.players.forEach((p,i)=>{
    if(p.isMrX && !showMrX) return;
    if(p.pos===null || p.pos===undefined) return;
    const s=stations[p.pos];
    const offset=(i%3-1)*12;
    const glow = (p.isMrX && G.mrxVisible) ? ' filter="url(#glowRed)"' : '';
    svg+=`<circle cx="${s.x+offset}" cy="${s.y}" r="12" fill="${p.color}" stroke="#fff" stroke-width="2"${glow}/>`;
    svg+=`<text x="${s.x+offset}" y="${s.y+4}" class="pieceIcon">${p.isMrX?'X':(G.players.filter(pl=>!pl.isMrX).indexOf(p)+1)}</text>`;
  });
  svg+='</svg>';
  document.getElementById('mapInner').innerHTML=svg;
  if(!mapFitted){ mapFitted=true; zoomMap(0,true); } else { applyZoom(); }
}
function zoomMap(factor,fit){
  const box=document.getElementById('mapBox');
  if(fit){ mapScale = Math.max(box.clientWidth/MAPW, 0.35); }
  else { mapScale = Math.min(2.5, Math.max(0.3, mapScale*factor)); }
  applyZoom();
}
function applyZoom(){
  const inner=document.getElementById('mapInner');
  if(!inner) return;
  inner.style.transform='scale('+mapScale+')';
  inner.style.width=MAPW+'px';
  inner.style.height=MAPH+'px';
}

function renderActionPanel(myTurn){
  const cp=currentPlayer();
  if(G.gameOver) return;
  if(!myTurn){ document.getElementById('actionBody').innerHTML='<div style="font-family:sans-serif;color:var(--muted)">Waiting for '+cp.name+'...</div>'; return; }
  let html='';
  if(cp.isMrX){
    html+=`<div style="font-family:sans-serif;font-size:.85em;color:var(--muted);margin-bottom:8px">Tap a highlighted station on the map, then choose how you traveled.</div>`;
    if(cp.tickets.double>0 && !G.doubleMovePending){
      html+=`<button class="small" onclick="startDouble()">Use Double Move ticket</button>`;
    }
  }
  html+=`<div id="modeChooser"></div><div id="confirmArea"></div>`;
  document.getElementById('actionBody').innerHTML=html;
}
function startDouble(){ requestAction({cmd:'startDouble'}); }

function stationClicked(id){
  if(G.gameOver) return;
  if(G.startingPhase) return;
  const myTurn = ME.online ? (ME.idx===G.turn-1) : true;
  if(!myTurn) return;
  const cp=currentPlayer();
  const idx=G.players.indexOf(cp);
  const moves=validMoves(idx);
  const opt=moves.find(o=>o.to===id);
  if(!opt) return;
  selectedTarget=id;
  const types=[...new Set(moves.filter(o=>o.to===id).map(o=>o.type))];
  let html=`<div style="font-family:sans-serif;margin:8px 0">Travel to <b>${stations[id].name}</b> by:</div><div class="row">`;
  types.forEach(t=>{ html+=`<button class="modeBtn" onclick="chooseType('${t}')">${t}</button>`; });
  if(cp.isMrX) html+=`<button class="modeBtn" onclick="chooseType('${types[0]}',true)">black ticket</button>`;
  html+='</div>';
  document.getElementById('modeChooser').innerHTML=html;
  document.getElementById('confirmArea').innerHTML='';
}
function chooseType(type,isBlack){
  const cp=currentPlayer(); const idx=G.players.indexOf(cp);
  if(isBlack && cp.tickets.black<=0) return;
  if(!isBlack && cp.isMrX===false && cp.tickets[type]<=0) return;
  requestAction({cmd:'move',playerIdx:idx,to:selectedTarget,type,isBlack:!!isBlack});
  selectedTarget=null;
}

/* Inline onclick/onchange attributes look these up on window. */
Object.assign(window, {
  beginGameFromStartPick,
  buildLocalRoster,
  chooseType,
  closeGate,
  closeModal,
  confirmStartPosition,
  createRoom,
  genCode,
  hostStartGame,
  joinRoom,
  leaveRoom,
  openHowTo,
  openStartPick,
  quitGame,
  show,
  startDouble,
  startLocalGame,
  startPickClicked,
  stationClicked,
  toggleFullscreen,
  zoomMap
});
