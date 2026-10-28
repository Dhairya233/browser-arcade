// An in-memory stand-in for the network, used by the tests. It follows the same small interface
// as the PeerJS transport:
//
//   transport.listen(code)  -> Promise<{onConnection, close()}>   rejects {type:'unavailable-id'} if taken
//   transport.connect(code) -> Promise<conn>                      rejects {type:'not-found'} if nobody listens
//   conn: {open, send(str), close(), onMessage, onClose}
//
// Delivery is asynchronous (like a real network). `await network.flush()` waits until it settles.
// Every string a connection sends is kept in conn.sent, so tests can inspect exactly what went over the wire.

export function createMemoryNetwork() {
  const listeners = new Map();   // code -> listener
  const all = [];                // every connection ever made, both ends

  function makePair() {
    const a = endpoint(), b = endpoint();
    a.peer = b; b.peer = a;
    all.push(a, b);
    return [a, b];
  }

  function endpoint() {
    const c = {
      open: true, sent: [], onMessage: null, onClose: null, peer: null, blocked: false,
      send(str) {
        if (!c.open) throw new Error('connection closed');
        c.sent.push(str);
        const p = c.peer;
        queueMicrotask(() => { if (p.open && !c.blocked && p.onMessage) p.onMessage(str); });
      },
      close() {
        if (!c.open) return;
        c.open = false;
        const p = c.peer;
        queueMicrotask(() => { if (c.onClose) c.onClose(); if (p.open) { p.open = false; if (p.onClose) p.onClose(); } });
      },
    };
    return c;
  }

  const network = {
    all,
    flush: () => new Promise(r => setImmediate(r)),
    transport() {
      return {
        listen(code) {
          if (listeners.has(code)) return Promise.reject({ type: 'unavailable-id' });
          const l = { onConnection: null, conns: [], close() { listeners.delete(code); l.conns.forEach(c => c.close()); } };
          listeners.set(code, l);
          return Promise.resolve(l);
        },
        connect(code) {
          const l = listeners.get(code);
          if (!l) return Promise.reject({ type: 'not-found' });
          const [client, server] = makePair();
          l.conns.push(server);
          queueMicrotask(() => l.onConnection && l.onConnection(server));
          return Promise.resolve(client);
        },
      };
    },
    // Connections whose host-side end belongs to this room: what the host sent to each player.
    hostSideConns: code => (listeners.get(code) ? listeners.get(code).conns : []),
    // Simulate the network failing under a connection (no goodbye).
    sever(conn) { conn.close(); },
    // Simulate the host's tab vanishing: no "closed" message, every link just drops.
    killHost(code) {
      const l = listeners.get(code);
      if (!l) return;
      listeners.delete(code);
      l.conns.forEach(c => c.close());
    },
  };
  return network;
}
