import * as Engine from './engine.js';
import { MAPW, MAPH, REVEAL_ROUNDS, COLORS } from './engine.js';
import { MAP, shadowHuntAdapter } from './adapter.js';
import { ringKind, ringDashAttr, innerRingSVG } from './look.js';
import { createHost } from '../../shared/net/host.js';
import { createClient } from '../../shared/net/client.js';
import { createPeerJsTransport } from '../../shared/net/transport-peerjs.js';
import { peerOptions } from '../../shared/net/peer-options.js';
import { createTokenStore } from '../../shared/net/ids.js';
import { cleanName, describeNetError } from '../../shared/net/protocol.js';

/* Rules live in engine.js, who-may-see-what in adapter.js, the network in shared/net/. This file draws the game and handles input. */
const { stations, edges } = MAP;
const EMOJI=["🕵️","🎭","🌉","🎸","🏛️","🎷","👑","💎","⚽","📚","🎨","🦊","⏰","🎤","🎳","🏉","🎈","🍩","🚂","🔑","👼","⚖️","🎬","📖","🌷","🎡","⛪","🍺","🏺","🧵","🎧","🏟️","🌳","🦉","🏆","🎪","🦌","🎾","🏢","🌼","🚉","⚓","🐕","🧭","🌲"];
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
    <h2>${cp.isPhantom?"🕶️ The Phantom's turn":'🔎 '+esc(cp.name)+"'s turn"}</h2>
    <p>${cp.isPhantom? 'Everyone else look away. Pass the device to whoever is playing The Phantom.' : 'Pass the device to '+esc(cp.name)+'.'}</p>
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
    <h2>${p.isPhantom?'🕶️ The Phantom':'🔎 '+esc(p.name)}</h2>
    <p style="color:var(--muted)">Everyone else look away.<br>${p.isPhantom?'The Phantom':'Detective '+esc(p.name)}, tap the button below, then secretly pick your starting station on the map.</p>
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
      <div style="color:var(--gold);font-weight:bold;margin-bottom:6px">${p.isPhantom?'🕶️ The Phantom':'🔎 '+esc(p.name)}: pick your starting station</div>
      <div style="color:var(--muted);font-size:.85em;margin-bottom:10px">Tap any station on the map to select it. Your choice stays secret until the game begins.</div>
      <div id="startPickConfirm"></div>
    </div>`;
  document.getElementById('turnLabel').textContent = (p.isPhantom?'The Phantom':''+p.name)+' is choosing a start...';
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
    const kind=stationKind(s.id);
    svg+=`<circle class="${cls}" cx="${s.x}" cy="${s.y}" r="14" fill="${fill}" stroke="${ring}" stroke-width="${isSelected?4:3}"${ringDashAttr(kind)} onclick="startPickClicked(${s.id})" style="cursor:${isTaken?'not-allowed':'pointer'}"/>`;
    svg+=innerRingSVG(s.x,s.y,kind,ring);
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
    // Online: ask the host. Our screen changes when its answer arrives.
    requestAction({cmd:'startPick', pos:startPickSelected});
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
function showSeatRequests(reqs){
  document.getElementById('seatRequests').innerHTML=(reqs||[]).map(r=>
    `<div class="seatRequest"><span><b>${esc(r.name)}</b> wants to take over <b>${esc(r.seatName)}</b>'s seat. Only allow this if you know who it is.</span><button class="small primary" onclick="approveSeat(${+r.id})">Allow</button><button class="small" onclick="denySeat(${+r.id})">Deny</button></div>`).join('');
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
  showSeatRequests([]); setBanner('');
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
  if(snap.phase==='playing') onOnlineState(snap.view,snap.online);
  else renderLobby(snap.seats,snap.settings.maxRounds,true,snap.code);
}
function setRounds(){ if(NET.host) NET.host.setSetting('maxRounds',+document.getElementById('lobbyMaxRounds').value); }
function hostStartGame(){
  if(!NET.host || !NET.host.startGame()) alert('Need at least 3 players (1 Phantom + 2 detectives).');
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
  if(st==='connecting') msg.textContent='Connecting…';
  else if(st==='pending') msg.textContent='The host has to approve you taking this seat. Waiting for their answer…';
  else if(st==='connected'){ msg.textContent=''; setBanner(''); }
  else if(st==='reconnecting') setBanner('Connection lost. Reconnecting…');
  else if(st==='host-left') netFail('The host left or lost their connection, so this game cannot continue.','joinRoomScreen','jrMsg');
  else if(st==='closed') netFail('The host closed the room.','joinRoomScreen','jrMsg');
  else if(st==='rejected' || st==='failed') netFail(detail,'joinRoomScreen','jrMsg');
}
document.addEventListener('visibilitychange',()=>{ if(!document.hidden && NET.client) NET.client.nudge(); });

/* ---- lobby ---- */
function renderLobby(seats,maxRounds,isHost,code){
  document.getElementById('lobbyCode').textContent=code;
  document.getElementById('lobbyStartBtn').style.display=isHost?'inline-block':'none';
  document.getElementById('lobbyHostSettings').style.display=isHost?'block':'none';
  document.getElementById('lobbyMaxRounds').value=String(maxRounds);
  document.getElementById('lobbyPlayers').innerHTML=seats.map((p,i)=>
    `<div class="playerRow"><div class="dot" style="background:${p.on?'#43a047':'#777'}"></div><span style="font-family:sans-serif">${esc(p.name)}${i===0?' (host)':''}${p.on?'':' (offline)'}</span></div>`).join('');
  show('lobbyScreen');
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
  document.getElementById('turnLabel').textContent='Waiting for others to choose...';
  const picked=G.players.filter(p=>p.picked).length;
  document.getElementById('actionBody').innerHTML=`<div style="font-family:sans-serif;color:var(--muted)">✅ Your starting position is set.<br>${picked} / ${G.players.length} players have chosen. Waiting...</div>`;
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
    html+=`<div class="playerRow"><div class="dot num" style="background:${i===0?'#111':COLORS[(i-1)%COLORS.length]}">${i===0?'P':i}</div><input style="flex:1" id="lp${i}" placeholder="${i===0?'Phantom player name':'Detective '+i+' name'}" value="${i===0?'The Phantom':'Detective '+i}"></div>`;
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
  document.getElementById('modalContent').innerHTML=`<h2>📖 How to Play</h2>
  <div class="htpGrid">
    <div class="htpCard"><div class="htpIcon">🕵️</div><h4>Goal</h4><p>One secret player is <b>The Phantom</b>. Everyone else is a detective trying to catch him.</p></div>
    <div class="htpCard"><div class="htpIcon">🗺️</div><h4>The Map</h4><p>Stations link by taxi, bus & underground. Use the ➕➖⤢ buttons to zoom, or drag to pan.</p></div>
    <div class="htpCard"><div class="htpIcon">🎫</div><h4>Tickets</h4><p>Every move spends a ticket. A detective's used ticket is handed straight to The Phantom!</p></div>
    <div class="htpCard"><div class="htpIcon">🕶️</div><h4>The Phantom's Secrets</h4><p><b>Black</b> tickets hide which transport he used. <b>Double</b> tickets let him move twice in one turn.</p></div>
    <div class="htpCard"><div class="htpIcon">👁️</div><h4>Visibility</h4><p>The Phantom is invisible — except on reveal rounds (${REVEAL_ROUNDS.join(', ')}), when he's spotted for that one round only, then vanishes again.</p></div>
    <div class="htpCard"><div class="htpIcon">🔄</div><h4>Turn Order</h4><p>The Phantom moves first each round, then every detective moves once, in order.</p></div>
    <div class="htpCard"><div class="htpIcon">📱</div><h4>Same Device</h4><p>Playing on one device? You'll pass it between turns so nobody peeks at The Phantom's secret moves.</p></div>
    <div class="htpCard"><div class="htpIcon">🏆</div><h4>Winning</h4><p>Detectives win by landing exactly on The Phantom. He wins by surviving all the rounds, or stranding everyone.</p></div>
  </div>
  <div class="legendRow">
    <span class="legItem"><span class="legSwatch taxi"></span>🚕 Taxi — short hops (plain ring)</span>
    <span class="legItem"><span class="legSwatch bus"></span>🚌 Bus — medium hops (dashed ring)</span>
    <span class="legItem"><span class="legSwatch underground"></span>🚇 Underground — long jumps (double ring)</span>
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
  document.getElementById('turnLabel').textContent = G.gameOver? '' : (cp.isPhantom?'The Phantom is moving...':cp.name+"'s turn");

  const phantom=G.players.find(p=>p.isPhantom);
  const lastReveal=[...G.phantomHistory].reverse();
  let lastKnown = phantom.revealedPos!=null ? stations[phantom.revealedPos].name : 'Unknown';
  let phantomHtml = `<div style="font-family:sans-serif">${G.phantomVisible?'<span class="badge reveal">SPOTTED NOW</span> ':''}Last known station: <b>${lastKnown}</b></div>`;
  phantomHtml += `<div class="tickets">Recent tickets: ${lastReveal.slice(0,5).map(h=>h.type).join(', ')||'—'}</div>`;
  const iAmPhantom = ME.online ? (G.players[ME.idx] && G.players[ME.idx].isPhantom) : cp.isPhantom;
  if(iAmPhantom || G.gameOver){
    phantomHtml += `<div class="tickets">Black:<span>${phantom.tickets.black}</span>Double:<span>${phantom.tickets.double}</span></div>`;
  }
  document.getElementById('phantomPanel').innerHTML=phantomHtml;

  const offline=i=>ONLINE && ME.online && ONLINE.connected && ONLINE.connected[G.seatOf[i]]===false;
  document.getElementById('detPanel').innerHTML = G.players.map((p,i)=>p.isPhantom?'':
    `<div class="playerRow"><div class="dot num" style="background:${p.color}">${i}</div><div style="font-family:sans-serif;flex:1"><b>${esc(p.name)}</b>${offline(i)?' <span style="color:var(--muted)">(offline)</span>':''}<div class="tickets">🚕${p.tickets.taxi} 🚌${p.tickets.bus} 🚇${p.tickets.underground}</div></div></div>`).join('');

  document.getElementById('log').innerHTML = [...G.log].reverse().map(l=>`<div>${esc(l)}</div>`).join('');

  drawMap((!G.gameOver && myTurn) ? cp : null);

  if(G.gameOver){
    document.getElementById('actionBody').innerHTML = `<div style="font-family:sans-serif;text-align:center;padding:10px"><div style="font-size:2em;margin-bottom:8px">${G.winner==='phantom'?'🕶️':'🚨'}</div><b style="font-size:1.1em">${G.winner==='phantom'?'The Phantom wins!':'Detectives win!'}</b><br><div style="color:var(--muted);font-size:.85em;margin:6px 0">${esc(G.log[G.log.length-1]||'')}</div><button style="margin-top:10px" onclick="quitGame()">Back to menu</button></div>`;
  } else {
    renderActionPanel(myTurn);
  }
}

function drawMap(activePlayer){
  const showPhantom = G.gameOver || G.phantomVisible || (activePlayer && activePlayer.isPhantom);
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
    const kind=stationKind(s.id);
    svg+=`<circle class="stationDot ${isReach?'reachable':''}" cx="${s.x}" cy="${s.y}" r="14" fill="#fff9e6" stroke="${ring}"${ringDashAttr(kind)} onclick="stationClicked(${s.id})"/>`;
    svg+=innerRingSVG(s.x,s.y,kind,ring);
    const labelBelow = s.id%2===0;
    svg+=`<text x="${s.x}" y="${labelBelow?s.y+28:s.y-19}" font-size="13" class="stationLbl" text-anchor="middle">${EMOJI[s.id]||''} ${s.name}</text>`;
  });
  G.players.forEach((p,i)=>{
    if(p.isPhantom && !showPhantom && !(ME.online && i===ME.idx)) return;
    if(p.pos===null || p.pos===undefined) return;
    const s=stations[p.pos];
    const offset=(i%3-1)*12;
    const glow = (p.isPhantom && G.phantomVisible) ? ' filter="url(#glowRed)"' : '';
    svg+=`<circle cx="${s.x+offset}" cy="${s.y}" r="12" fill="${p.color}" stroke="#fff" stroke-width="2"${glow}/>`;
    svg+=`<text x="${s.x+offset}" y="${s.y+4}" class="pieceIcon">${p.isPhantom?'P':(G.players.filter(pl=>!pl.isPhantom).indexOf(p)+1)}</text>`;
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
  if(!myTurn){ document.getElementById('actionBody').innerHTML='<div style="font-family:sans-serif;color:var(--muted)">Waiting for '+esc(cp.name)+'...</div>'; return; }
  let html='';
  if(cp.isPhantom){
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
  if(cp.isPhantom) html+=`<button class="modeBtn" onclick="chooseType('${types[0]}',true)">black ticket</button>`;
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
