// PeerJS transport: WebRTC data channels, with PeerJS's public cloud as the matchmaker.
// Same small interface as transport-memory.js. `Peer` is the PeerJS constructor (loaded from vendor/).

function wrap(dc) {
  const c = {
    get open() { return dc.open; },
    onMessage: null, onClose: null,
    send: str => dc.send(str),
    close: () => { try { dc.close(); } catch (e) { /* ignore */ } },
  };
  dc.on('data', raw => { if (c.onMessage) c.onMessage(raw); });
  dc.on('close', () => { if (c.onClose) c.onClose(); });
  dc.on('error', () => { if (c.onClose) c.onClose(); });
  return c;
}

export function createPeerJsTransport({ Peer, options, prefix }) {
  let clientPeer = null;   // reused between reconnect attempts so we do not hit the signalling server every time

  function ensureClientPeer() {
    if (clientPeer && !clientPeer.destroyed) {
      if (clientPeer.disconnected) { try { clientPeer.reconnect(); } catch (e) { /* ignore */ } }
      return Promise.resolve(clientPeer);
    }
    return new Promise((resolve, reject) => {
      const peer = new Peer(undefined, options);
      let opened = false;
      peer.on('open', () => { opened = true; clientPeer = peer; resolve(peer); });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
      peer.on('error', err => { if (!opened) { try { peer.destroy(); } catch (e) { /* ignore */ } reject({ type: (err && err.type) || 'network' }); } });
    });
  }

  return {
    // Free the player-side PeerJS connection when the room is left.
    dispose() { try { clientPeer && clientPeer.destroy(); } catch (e) { /* ignore */ } clientPeer = null; },

    listen(code) {
      return new Promise((resolve, reject) => {
        if (typeof Peer === 'undefined') { reject({ type: 'no-peerjs' }); return; }
        const peer = new Peer(prefix + code, options);
        const listener = { onConnection: null, close() { try { peer.destroy(); } catch (e) { /* ignore */ } } };
        let opened = false;
        peer.on('open', () => { opened = true; resolve(listener); });
        peer.on('connection', dc => { if (listener.onConnection) listener.onConnection(wrap(dc)); });
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
        peer.on('error', err => { if (!opened) { try { peer.destroy(); } catch (e) { /* ignore */ } reject({ type: (err && err.type) || 'network' }); } });
      });
    },

    async connect(code) {
      if (typeof Peer === 'undefined') throw { type: 'no-peerjs' };
      const peer = await ensureClientPeer();
      return new Promise((resolve, reject) => {
        const dc = peer.connect(prefix + code, { reliable: true });
        let settled = false;
        const onPeerError = err => {
          if (settled) return;
          if (err && err.type === 'peer-unavailable') { settled = true; peer.off('error', onPeerError); try { dc.close(); } catch (e) { /* ignore */ } reject({ type: 'not-found' }); }
        };
        peer.on('error', onPeerError);
        dc.on('open', () => { if (settled) return; settled = true; peer.off('error', onPeerError); resolve(wrap(dc)); });
        dc.on('error', () => { if (settled) return; settled = true; peer.off('error', onPeerError); reject({ type: 'network' }); });
      });
    },
  };
}
