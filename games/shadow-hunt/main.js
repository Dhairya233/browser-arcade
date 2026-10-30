import * as Engine from './engine.js';
import { MAPW, MAPH, REVEAL_ROUNDS, COLORS } from './engine.js';
import { MAP, shadowHuntAdapter } from './adapter.js';
import { ringKind, ringDashAttr, innerRingSVG } from './look.js';
import { icon } from './icons.js';
import { createHost } from '../../shared/net/host.js';
import { createClient } from '../../shared/net/client.js';
import { createPeerJsTransport } from '../../shared/net/transport-peerjs.js';
import { peerOptions } from '../../shared/net/peer-options.js';
import { createTokenStore } from '../../shared/net/ids.js';
import { cleanName, describeNetError } from '../../shared/net/protocol.js';

/* Rules live in engine.js, who-may-see-what in adapter.js, the network in shared/net/. This file draws the game and handles input. */
const { stations, edges } = MAP;
function neighborsAny(stationId){return MAP.adj[stationId];}
const RING_VAR={taxi:'var(--taxi)',bus:'var(--bus)',underground:'var(--tube)'};
function stationKind(id){ return ringKind(edges.filter(e=>e.a===id||e.b===id).map(e=>e.type)); }
function stationRingColor(id){ return RING_VAR[stationKind(id)]; }

/* ---------- game state ---------- */
let G=null;
let ME={idx:0,isHost:false,online:false,roomCode:null};   // idx: which game player (0 = The Phantom) is on this screen
let mapFitted=false;

// Names come from other people's keyboards. Anything put into innerHTML goes through esc().
function esc(t){ return String(t).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

const newGame = Engine.newGame;
const currentPlayer = () => Engine.currentPlayer(G);
const validMoves = (playerIdx) => Engine.validMoves(G, MAP, playerIdx);
const takenStartPositions = () => Engine.takenStartPositions(G);

// Pass-and-play only: online, the host's answer arrives as a new view (see onOnlineState).
function afterTurnAdvance(){
  if(G.gameOver){ render(); return; }
  showPassGate();
}
function showPassGate(){
  const cp=currentPlayer();
  document.getElementById('gateBox').innerHTML = `
    <span class="stamp">Pass the device</span>
    <h2>${cp.isPhantom?"The Phantom's turn":esc(cp.name)+"'s turn"}</h2>
    <p>${cp.isPhantom? 'Everyone else look away. Pass the device to whoever is playing The Phantom.' : 'Pass the device to '+esc(cp.name)+'.'}</p>
    <button class="btn solid" onclick="closeGate()">I'm ready. Show my move</button>`;
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
    <span class="stamp">Secret pick</span>
    <h2>${p.isPhantom?'The Phantom':esc(p.name)}</h2>
    <p style="color:var(--muted)">Everyone else look away.<br>${p.isPhantom?'The Phantom':'Detective '+esc(p.name)}, tap the button below, then secretly pick your starting station on the map.</p>
    <button class="btn solid" onclick="openStartPick()">I'm ready. Pick my start</button>`;
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
    <div>
      <div style="color:var(--amber);font-weight:600;margin-bottom:6px">${p.isPhantom?'The Phantom':esc(p.name)}: pick your starting station</div>
      <div class="muted" style="margin-bottom:10px">Tap any station on the map to select it. Your choice stays secret until the game begins.</div>
      <div id="startPickConfirm"></div>
    </div>`;
  setTurn(false,'Setup',(p.isPhantom?'The Phantom':p.name)+' is choosing a start station');
  document.getElementById('roundBadge').textContent='Setup';
}


// The chart behind the stations: graticule, parks and the river, all drawn, none of it clickable.
function mapBackdrop(){
  let s=`<defs><filter id="glowRed" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <pattern id="grat" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="#2b4256" stroke-width="1"/></pattern></defs>`;
  s+=`<rect width="${MAPW}" height="${MAPH}" fill="#1c2d3b"/><rect width="${MAPW}" height="${MAPH}" fill="url(#grat)"/>`;
  s+=`<path d="M0,650 C220,600 380,700 620,660 C860,620 1000,700 1300,655 L1300,720 C1000,760 860,690 620,720 C380,750 220,670 0,715 Z" fill="#27465c"/>`;
  s+=`<text x="120" y="700" font-size="18" fill="#8FB3C7" font-family="Plex Sans,sans-serif" font-style="italic">River Thames</text>`;
  [[190,170,155,105],[1110,210,120,90],[640,840,165,78]].forEach(([x,y,rx,ry])=>{
    s+=`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#24473a" stroke="#3b6b58" stroke-width="2" stroke-dasharray="2 6"/><text x="${x}" y="${y}" font-size="14" fill="#8FB3C7" text-anchor="middle" font-family="Plex Sans,sans-serif" letter-spacing="2">PARK</text>`;
  });
  return s;
}

function drawMapForStartPick(){
  const takenPositions=takenStartPositions();
  let svg=`<svg viewBox="0 0 ${MAPW} ${MAPH}" xmlns="http://www.w3.org/2000/svg">`;
  svg+=mapBackdrop();
  edges.forEach(e=>{const a=stations[e.a],b=stations[e.b]; svg+=`<line class="edge ${e.type}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" opacity=".85"/>`;});
  stations.forEach(s=>{
    const isTaken=takenPositions.includes(s.id);
    const isSelected=startPickSelected===s.id;
    const ring=isSelected?'#F2A93B':(isTaken?'#5d6f7a':stationRingColor(s.id));
    const fill=isSelected?'#5a4515':(isTaken?'#2b3a45':'#14202b');
    const cls=isTaken?'stationDot':'stationDot reachable';
    const kind=stationKind(s.id);
    svg+=`<circle class="${cls}" cx="${s.x}" cy="${s.y}" r="14" fill="${fill}" stroke="${ring}" stroke-width="${isSelected?4:3}"${ringDashAttr(kind)} onclick="startPickClicked(${s.id})" style="cursor:${isTaken?'not-allowed':'pointer'}"/>`;
    svg+=innerRingSVG(s.x,s.y,kind,ring);
    if(!isTaken) svg+=`<circle class="hit" cx="${s.x}" cy="${s.y}" r="${hitRadius()}" onclick="startPickClicked(${s.id})"/>`;
    const labelBelow=s.id%2===0;
    svg+=`<text x="${s.x}" y="${labelBelow?s.y+28:s.y-19}" font-size="13" class="stationLbl" text-anchor="middle">${s.name}</text>`;
    if(isSelected){
      svg+=`<circle cx="${s.x}" cy="${s.y}" r="10" fill="#F2A93B" opacity=".9" pointer-events="none"/>`;
      svg+=`<text x="${s.x}" y="${s.y+4}" class="pieceIcon" style="font-size:11px;fill:#14202b">OK</text>`;
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
    <div style="margin-bottom:8px">Selected: <b style="color:var(--amber)">${stations[id].name}</b></div>
    <button class="btn solid" onclick="confirmStartPosition()">Confirm this starting station</button>`;
  drawMapForStartPick();
}

function confirmStartPosition(){
  if(startPickSelected===null) return;
  if(ME.online){
    // Online: ask the host. Our screen changes when its answer arrives.
    requestAction({cmd:'startPick', pos:startPickSelected});
    startPickSelected=null;
    document.getElementById('actionBody').innerHTML=`<div class="muted">${icon('check')} Starting position chosen. Waiting for the others to pick…</div>`;
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
    <span class="stamp">Ready</span>
    <h2>All set</h2>
    <p>Everyone has secretly chosen a starting station. The game is about to begin, and each starting position is visible only to its own player.</p>
    <button class="btn solid" onclick="beginGameFromStartPick()">Begin Game</button>`;
  document.getElementById('gateBg').classList.add('active');
}

function beginGameFromStartPick(){
  document.getElementById('gateBg').classList.remove('active');
  // Check if any detective accidentally chose Phantom's starting square
  G=Engine.checkStartCollision(G,MAP);
  if(G.gameOver){
    render();
    return;
  }
  // Now show the normal first-turn pass gate
  showPassGate();
}

/* ---------- online play (shared netcode in shared/net/) ---------- */
const PEER_PREFIX='shadow-hunt-';
const tokens=createTokenStore('shadow-hunt');
let NET={host:null,client:null,transport:null};
let ONLINE=null;            // who is connected right now, from the host
let pickingStart=false;     // the start-pick screen is open on this device
let bannerTimer=null;

function setBanner(text){
  const el=document.getElementById('netBanner');
  el.textContent=text; el.style.display=text?'block':'none';
}
function flashBanner(text){
  setBanner(text); clearTimeout(bannerTimer);
  bannerTimer=setTimeout(()=>setBanner(''),3500);
}
// Connection state shown in the title block: a filled circle is good, a hollow diamond is trouble, a filled diamond is lost.
function setConn(kind,text){
  const el=document.getElementById('connState');
  if(!kind){ el.hidden=true; el.textContent=''; el.className='conn'; return; }
  el.hidden=false; el.className='conn '+kind; el.textContent=text;
}
function setTurn(mine,label,text){
  const el=document.getElementById('turnBanner');
  el.className='turnbanner'+(mine?' mine':'');
  el.innerHTML=`<span class="stamp">${esc(label)}</span><span>${esc(text)}</span>`;
}
function showSeatRequests(reqs){
  document.getElementById('seatRequests').innerHTML=(reqs||[]).map(r=>
    `<div class="seatRequest"><span><b>${esc(r.name)}</b> wants to take over <b>${esc(r.seatName)}</b>'s seat. Only allow this if you know who it is.</span><button class="btn solid small" onclick="approveSeat(${+r.id})">Allow</button><button class="btn small" onclick="denySeat(${+r.id})">Deny</button></div>`).join('');
}
function approveSeat(id){ if(NET.host) NET.host.approve(id); }
function denySeat(id){ if(NET.host) NET.host.deny(id); }

// Close whatever is open. Detach first so late callbacks from the old room are ignored.
function stopNet(){
  const {host,client,transport}=NET;
  NET={host:null,client:null,transport:null};
  if(host) host.close();
  if(client) client.leave();
  if(transport && transport.dispose) setTimeout(()=>transport.dispose(),300);
  ME.online=false; ME.isHost=false; ME.idx=0; ME.roomCode=null;
  ONLINE=null; pickingStart=false; mapFitted=false;
  showSeatRequests([]); setBanner(''); setConn(null);
}
function leaveRoom(){ stopNet(); show('titleScreen'); }
function quitGame(){ stopNet(); G=null; show('titleScreen'); }
function netFail(msg,screenId,msgId){
  stopNet(); G=null; show(screenId); document.getElementById(msgId).textContent=msg;
}
function peerReady(msgId){
  if(typeof Peer==='undefined'){ document.getElementById(msgId).textContent=describeNetError({type:'no-peerjs'}); return false; }
  return true;
}
function makeTransport(){ return createPeerJsTransport({Peer,options:peerOptions(),prefix:PEER_PREFIX}); }

/* ---- host ---- */
async function createRoom(){
  if(!peerReady('crMsg')) return;
  stopNet();
  const name=cleanName(document.getElementById('crName').value)||'Host';
  document.getElementById('crMsg').textContent='Connecting…';
  NET.transport=makeTransport();
  const host=createHost({transport:NET.transport,game:shadowHuntAdapter,name,onUpdate:snap=>hostUpdate(host,snap)});
  NET.host=host;
  try{
    await host.start();
    if(NET.host===host) document.getElementById('crMsg').textContent='';
  }catch(err){ if(NET.host===host) netFail(describeNetError(err),'createRoomScreen','crMsg'); }
}
function hostUpdate(host,snap){
  if(NET.host!==host) return;
  ME.online=true; ME.isHost=true; ME.roomCode=snap.code;
  showSeatRequests(snap.requests);
  setConn('ok','Hosting room '+snap.code);
  if(snap.phase==='playing') onOnlineState(snap.view,snap.online);
  else renderLobby(snap.seats,snap.settings.maxRounds,true,snap.code);
}
function setRounds(){ if(NET.host) NET.host.setSetting('maxRounds',+document.getElementById('lobbyMaxRounds').value); }
function hostStartGame(){
  if(!NET.host || !NET.host.startGame()){ const m=document.getElementById('lobbyMsg'); m.style.color=''; m.textContent='You need at least 3 players (1 Phantom and 2 detectives) before you can start.'; }
}

/* ---- player ---- */
function joinRoom(){
  const code=(document.getElementById('jrCode').value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!code){ document.getElementById('jrMsg').textContent='Enter the room code.'; return; }
  if(!peerReady('jrMsg')) return;
  stopNet();
  const name=cleanName(document.getElementById('jrName').value)||'Player';
  document.getElementById('jrMsg').textContent='Connecting…';
  NET.transport=makeTransport();
  const client=createClient({
    transport:NET.transport,code,name,token:tokens.getOrCreate(code),
    onStatus:(st,detail)=>clientStatus(client,st,detail),
    onLobby:m=>{ if(NET.client!==client) return; ME.online=true; ME.isHost=false; ME.roomCode=code; renderLobby(m.seats,m.settings.maxRounds,false,code); },
    onState:m=>{ if(NET.client!==client) return; ME.online=true; ME.isHost=false; ME.roomCode=code; onOnlineState(m.view,m.online); },
    onNack:()=>{ if(NET.client===client) moveRejected(); }
  });
  NET.client=client;
  client.connect();
}
function clientStatus(client,st,detail){
  if(NET.client!==client) return;
  const msg=document.getElementById('jrMsg');
  if(st==='connecting'){ msg.textContent='Connecting…'; setConn('warn','Connecting'); }
  else if(st==='pending'){ msg.textContent='The host has to approve you taking this seat. Waiting for their answer…'; setConn('warn','Waiting for host'); }
  else if(st==='connected'){ msg.textContent=''; setBanner(''); setConn('ok','Connected, room '+ME.roomCode); }
  else if(st==='reconnecting'){ setBanner('Connection lost. Reconnecting…'); setConn('warn','Reconnecting'); }
  else if(st==='host-left'){ netFail('The host left or lost their connection, so this game cannot continue.','joinRoomScreen','jrMsg'); setConn('bad','Host left'); }
  else if(st==='closed'){ netFail('The host closed the room.','joinRoomScreen','jrMsg'); setConn('bad','Room closed'); }
  else if(st==='rejected' || st==='failed'){ netFail(detail,'joinRoomScreen','jrMsg'); setConn('bad','Not connected'); }
}
document.addEventListener('visibilitychange',()=>{ if(!document.hidden && NET.client) NET.client.nudge(); });

/* ---- lobby ---- */
function renderLobby(seats,maxRounds,isHost,code){
  document.getElementById('lobbyCode').textContent=code;
  document.getElementById('lobbyStartBtn').hidden=!isHost;
  document.getElementById('lobbyHostSettings').hidden=!isHost;
  document.getElementById('lobbyMaxRounds').value=String(maxRounds);
  const n=seats.length;
  document.getElementById('lobbyHint').textContent=isHost
    ? (n<3?`Waiting for players. ${n} of 3 needed so far. Send them the invite link or the code.`:`${n} players here. Start when everyone has joined. Keep this tab open while you play.`)
    : 'You are in. The host starts the game once everyone has joined.';
  document.getElementById('lobbyPlayers').innerHTML=seats.map((p,i)=>
    `<li><span class="dot num" style="background:${p.on?'#2f6b52':'#4a5a63'}"><span class="sr-only">${p.on?'Online':'Offline'}</span></span><span>${esc(p.name)}${i===0?' (host)':''}</span><span class="state">${p.on?'Connected':'Offline'}</span></li>`).join('')
    +(n<3?`<li class="empty">Open seat${n<2?'s':''}: this game needs at least 3 players (1 Phantom and 2 detectives).</li>`:'');
  document.getElementById('lobbyMsg').textContent='';
  show('lobbyScreen');
}
function roomLink(){
  const u=new URL(location.href); u.search=''; u.hash=''; u.searchParams.set('room',ME.roomCode||''); return u.toString();
}
async function copyRoom(what){
  const text=what==='link'?roomLink():String(ME.roomCode||'');
  const msg=document.getElementById('lobbyMsg');
  try{ await navigator.clipboard.writeText(text); msg.textContent=what==='link'?'Invite link copied.':'Room code copied.'; msg.style.color='var(--night-mute)'; }
  catch(e){ msg.style.color=''; msg.textContent='Copying is blocked here. Select and copy it yourself: '+text; }
}

/* ---- in a game ---- */
// Every update from the host arrives here as this seat's own view of the game.
function onOnlineState(view,online){
  G=view; ME.idx=view.me; if(online) ONLINE=online;
  show('gameScreen');
  if(!G.startingPhase){ pickingStart=false; render(); return; }
  if(!G.players[ME.idx].picked){
    if(!pickingStart){ pickingStart=true; startPickSelected=null; renderStartPickMode(); }
    return;
  }
  pickingStart=false;
  document.getElementById('roundBadge').textContent='Setup';
  setTurn(false,'Setup','Waiting for the others to choose');
  const picked=G.players.filter(p=>p.picked).length;
  document.getElementById('actionBody').innerHTML=`<div class="muted">${icon('check')} Your starting position is set.<br>${picked} of ${G.players.length} players have chosen. Waiting…</div>`;
  drawMapForStartPick();
}
function moveRejected(){
  flashBanner('That was not accepted. Please try again.');
  if(G && G.startingPhase){ pickingStart=false; onOnlineState(G); } else if(G) render();
}

/* Local setup */
function buildLocalRoster(){
  const n=+document.getElementById('localCount').value;
  let html='';
  for(let i=0;i<n;i++){
    html+=`<div class="playerRow"><div class="dot num${i===0?' sq':''}" style="background:${i===0?'#111':COLORS[(i-1)%COLORS.length]}"><span style="${i===0?'transform:rotate(-45deg)':''}">${i===0?'P':i}</span></div><input aria-label="${i===0?'Phantom player name':'Detective '+i+' name'}" id="lp${i}" maxlength="20" placeholder="${i===0?'Phantom player name':'Detective '+i+' name'}" value="${i===0?'The Phantom':'Detective '+i}"></div>`;
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
  if(!ME.online){ performAction(action); return; }
  if(NET.host){ if(!NET.host.act(action).ok) moveRejected(); }
  else if(!NET.client || !NET.client.act(action)) flashBanner('Not connected to the room.');
}
// Pass-and-play only.
function performAction(action){
  if(!G) return;
  const res=Engine.applyAction(G,MAP,action);
  if(!res.handled) return;
  G=res.state;
  if(res.turnAdvanced){ afterTurnAdvance(); return; }
  render();
}

/* ---------- rendering ---------- */
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
function openHowTo(){
  document.getElementById('modalContent').innerHTML=`<h2>How to play</h2>
  <div class="htpGrid">
    <div class="htpCard"><div class="htpNum">01</div><h4>Goal</h4><p>One secret player is <b>The Phantom</b>. Everyone else is a detective trying to catch him.</p></div>
    <div class="htpCard"><div class="htpNum">02</div><h4>The Map</h4><p>Stations link by taxi, bus & underground. Use the plus, minus and fit buttons to zoom, pinch on a touch screen, and drag to pan.</p></div>
    <div class="htpCard"><div class="htpNum">03</div><h4>Tickets</h4><p>Every move spends a ticket. A detective's used ticket is handed straight to The Phantom!</p></div>
    <div class="htpCard"><div class="htpNum">04</div><h4>The Phantom's Secrets</h4><p><b>Black</b> tickets hide which transport he used. <b>Double</b> tickets let him move twice in one turn.</p></div>
    <div class="htpCard"><div class="htpNum">05</div><h4>Visibility</h4><p>The Phantom is invisible, except on reveal rounds (${REVEAL_ROUNDS.join(', ')}), when he is spotted for that one round only, then vanishes again.</p></div>
    <div class="htpCard"><div class="htpNum">06</div><h4>Turn Order</h4><p>The Phantom moves first each round, then every detective moves once, in order.</p></div>
    <div class="htpCard"><div class="htpNum">07</div><h4>Same Device</h4><p>Playing on one device? You'll pass it between turns so nobody peeks at The Phantom's secret moves.</p></div>
    <div class="htpCard"><div class="htpNum">08</div><h4>Winning</h4><p>Detectives win by landing exactly on The Phantom. He wins by surviving all the rounds, or stranding everyone.</p></div>
  </div>
  <div class="legendRow">
    <span class="legItem"><span class="legSwatch taxi"></span>Taxi: short hops (plain ring)</span>
    <span class="legItem"><span class="legSwatch bus"></span>Bus: medium hops (dashed ring)</span>
    <span class="legItem"><span class="legSwatch underground"></span>Underground: long jumps (double ring)</span>
  </div>
  <p style="text-align:center;margin-top:16px"><button class="btn solid" onclick="closeModal()">Got it</button></p>`;
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
  if(btn) btn.querySelector('span').textContent = document.fullscreenElement? 'Exit full screen':'Full screen';
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
  if(G.gameOver) setTurn(false,'Game over',G.winner==='phantom'?'The Phantom wins':'The detectives win');
  else if(ME.online) setTurn(myTurn,myTurn?'Your turn':'Waiting',myTurn?(cp.isPhantom?'You are The Phantom. Pick a station and a ticket.':'Pick a station and a ticket.'):(cp.isPhantom?'The Phantom is moving':cp.name+' is moving'));
  else setTurn(true,cp.isPhantom?'The Phantom':'Detective',cp.isPhantom?'Your turn. Choose a station and a ticket.':cp.name+', your turn. Choose a station and a ticket.');

  const phantom=G.players.find(p=>p.isPhantom);
  const lastReveal=[...G.phantomHistory].reverse();
  let lastKnown = phantom.revealedPos!=null ? stations[phantom.revealedPos].name : 'Unknown';
  let phantomHtml = `<div>${G.phantomVisible?'<span class="badge reveal">Spotted now</span> ':''}Last known station: <b>${lastKnown}</b></div>`;
  phantomHtml += `<div class="tickets">Recent tickets: ${lastReveal.slice(0,5).map(h=>h.type).join(', ')||'none yet'}</div>`;
  const iAmPhantom = ME.online ? (G.players[ME.idx] && G.players[ME.idx].isPhantom) : cp.isPhantom;
  if(iAmPhantom || G.gameOver){
    phantomHtml += `<div class="tickets">Black<span>${phantom.tickets.black}</span>Double<span>${phantom.tickets.double}</span></div>`;
  }
  document.getElementById('phantomPanel').innerHTML=phantomHtml;

  const offline=i=>ONLINE && ME.online && ONLINE.connected && ONLINE.connected[G.seatOf[i]]===false;
  document.getElementById('detPanel').innerHTML = G.players.map((p,i)=>p.isPhantom?'':
    `<div class="playerRow"><div class="dot num" style="background:${p.color}">${i}</div><div style="flex:1"><b>${esc(p.name)}</b>${offline(i)?' <span class="muted">(offline)</span>':''}<div class="tickets"><span title="Taxi tickets">${icon('taxi','Taxi')}${p.tickets.taxi}</span><span title="Bus tickets">${icon('bus','Bus')}${p.tickets.bus}</span><span title="Underground tickets">${icon('underground','Underground')}${p.tickets.underground}</span></div></div></div>`).join('');

  document.getElementById('log').innerHTML = [...G.log].reverse().map(l=>`<div>${esc(l)}</div>`).join('');

  drawMap((!G.gameOver && myTurn) ? cp : null);

  if(G.gameOver){
    document.getElementById('actionBody').innerHTML = `<div><span class="stamp">Game over</span><div style="font:700 var(--t-xl)/1.1 var(--f-title);margin:8px 0">${G.winner==='phantom'?'The Phantom wins':'The detectives win'}</div><div class="muted" style="margin:6px 0">${esc(G.log[G.log.length-1]||'')}</div><button class="btn" onclick="quitGame()">Back to menu</button></div>`;
  } else {
    renderActionPanel(myTurn);
  }
}

function drawMap(activePlayer){
  const showPhantom = G.gameOver || G.phantomVisible || (activePlayer && activePlayer.isPhantom);
  let svg=`<svg viewBox="0 0 ${MAPW} ${MAPH}" xmlns="http://www.w3.org/2000/svg">`;
  svg+=mapBackdrop();
  edges.forEach(e=>{const a=stations[e.a],b=stations[e.b]; svg+=`<line class="edge ${e.type}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" opacity=".85"/>`;});
  const reach = (activePlayer && !G.gameOver) ? validMoves(G.players.indexOf(activePlayer)).map(o=>o.to) : [];
  stations.forEach(s=>{
    const isReach=reach.includes(s.id);
    const ring=stationRingColor(s.id);
    const kind=stationKind(s.id);
    svg+=`<circle class="stationDot ${isReach?'reachable':''}" cx="${s.x}" cy="${s.y}" r="14" fill="#14202b" stroke="${ring}"${ringDashAttr(kind)} onclick="stationClicked(${s.id})"/>`;
    svg+=innerRingSVG(s.x,s.y,kind,ring);
    if(isReach) svg+=`<circle class="reachRing" cx="${s.x}" cy="${s.y}" r="19"/>`;
    svg+=`<circle class="hit" cx="${s.x}" cy="${s.y}" r="${hitRadius()}" onclick="stationClicked(${s.id})"/>`;
    const labelBelow = s.id%2===0;
    svg+=`<text x="${s.x}" y="${labelBelow?s.y+28:s.y-19}" font-size="13" class="stationLbl" text-anchor="middle">${s.name}</text>`;
  });
  G.players.forEach((p,i)=>{
    if(p.isPhantom && !showPhantom && !(ME.online && i===ME.idx)) return;
    if(p.pos===null || p.pos===undefined) return;
    const s=stations[p.pos];
    const offset=(i%3-1)*12;
    const glow = (p.isPhantom && G.phantomVisible) ? ' filter="url(#glowRed)"' : '';
    const px=s.x+offset;
    svg+=p.isPhantom
      ? `<path d="M${px},${s.y-16} L${px+15},${s.y+11} L${px-15},${s.y+11} Z" fill="#14202b" stroke="#E8EDF0" stroke-width="3"${glow}/>`
      : `<circle cx="${px}" cy="${s.y}" r="12" fill="${p.color}" stroke="#fff" stroke-width="2"${glow}/>`;
    svg+=`<text x="${px}" y="${s.y+(p.isPhantom?8:4)}" class="pieceIcon">${p.isPhantom?'P':(G.players.filter(pl=>!pl.isPhantom).indexOf(p)+1)}</text>`;
  });
  svg+='</svg>';
  document.getElementById('mapInner').innerHTML=svg;
  if(!mapFitted){ mapFitted=true; zoomMap(0,true); } else { applyZoom(); }
}
// Station tap areas stay at least 44 screen pixels wide however far the map is zoomed out.
function hitRadius(){ return Math.max(22,Math.ceil(22/Math.max(mapScale,.1))); }
function updateHits(){ document.querySelectorAll('#mapInner .hit').forEach(c=>c.setAttribute('r',hitRadius())); }
function zoomMap(factor,fit){
  const box=document.getElementById('mapBox');
  if(fit){ mapScale = Math.max(box.clientWidth/MAPW, box.clientWidth<700?0.55:0.35); box.scrollLeft=0; box.scrollTop=0; }
  else { mapScale = Math.min(2.5, Math.max(0.3, mapScale*factor)); }
  applyZoom();
}
function applyZoom(){
  const inner=document.getElementById('mapInner');
  if(!inner) return;
  inner.style.transform='scale('+mapScale+')';
  inner.style.width=MAPW+'px';
  inner.style.height=MAPH+'px';
  updateHits();
}

function renderActionPanel(myTurn){
  const cp=currentPlayer();
  if(G.gameOver) return;
  if(!myTurn){ document.getElementById('actionBody').innerHTML='<div class="muted">Waiting for '+esc(cp.name)+'…</div>'; return; }
  let html='';
  if(cp.isPhantom){
    html+=`<div class="muted" style="margin-bottom:8px">Tap a station with a pulsing ring on the map, then choose how you traveled.</div>`;
    if(cp.tickets.double>0 && !G.doubleMovePending){
      html+=`<button class="btn small" onclick="startDouble()">Use Double Move ticket</button>`;
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
  let html=`<div style="margin:8px 0">Travel to <b>${stations[id].name}</b> by:</div><div class="row" style="margin-top:0">`;
  types.forEach(t=>{ html+=`<button class="modeBtn" onclick="chooseType('${t}')">${icon(t)}${t}</button>`; });
  if(cp.isPhantom) html+=`<button class="modeBtn" onclick="chooseType('${types[0]}',true)">${icon('phantom')}Black ticket</button>`;
  html+='</div>';
  document.getElementById('modeChooser').innerHTML=html;
  document.getElementById('confirmArea').innerHTML='';
}
function chooseType(type,isBlack){
  const cp=currentPlayer(); const idx=G.players.indexOf(cp);
  if(isBlack && cp.tickets.black<=0) return;
  if(!isBlack && cp.isPhantom===false && cp.tickets[type]<=0) return;
  requestAction({cmd:'move',playerIdx:idx,to:selectedTarget,type,isBlack:!!isBlack});
  selectedTarget=null;
}

/* Inline onclick/onchange attributes look these up on window. */
Object.assign(window, {
  beginGameFromStartPick,
  buildLocalRoster,
  approveSeat,
  chooseType,
  closeGate,
  closeModal,
  confirmStartPosition,
  copyRoom,
  createRoom,
  denySeat,
  hostStartGame,
  joinRoom,
  leaveRoom,
  openHowTo,
  openStartPick,
  quitGame,
  setRounds,
  show,
  startDouble,
  startLocalGame,
  startPickClicked,
  stationClicked,
  toggleFullscreen,
  zoomMap
});

/* Two-finger pinch zooms the map around the point between the fingers. */
(function(){
  const box=document.getElementById('mapBox'); let d0=0,s0=1;
  const dist=e=>Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
  box.addEventListener('touchstart',e=>{ if(e.touches.length===2){ d0=dist(e); s0=mapScale; } },{passive:true});
  box.addEventListener('touchmove',e=>{
    if(e.touches.length!==2||!d0) return;
    e.preventDefault();
    const r=box.getBoundingClientRect(), cx=(e.touches[0].clientX+e.touches[1].clientX)/2-r.left, cy=(e.touches[0].clientY+e.touches[1].clientY)/2-r.top;
    const mx=(box.scrollLeft+cx)/mapScale, my=(box.scrollTop+cy)/mapScale;
    mapScale=Math.min(2.5,Math.max(.3,s0*dist(e)/d0)); applyZoom();
    box.scrollLeft=mx*mapScale-cx; box.scrollTop=my*mapScale-cy;
  },{passive:false});
  box.addEventListener('touchend',()=>{ d0=0; },{passive:true});
})();

/* An invite link (?room=CODE) opens the join screen with the code filled in. */
(function(){
  const code=(new URLSearchParams(location.search).get('room')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
  if(!code) return;
  document.getElementById('jrCode').value=code;
  show('joinRoomScreen');
  document.getElementById('jrName').focus();
})();
