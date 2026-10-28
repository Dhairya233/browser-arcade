// Connection options for PeerJS.
//
// By default the games use PeerJS's free public signalling server and its default ICE list,
// which in PeerJS 1.5.4 is one Google STUN server plus a shared public TURN relay. Both are
// free services with no guarantee, and some networks block peer-to-peer traffic regardless.
//
// To use your own servers, set window.ARCADE_PEER_OPTIONS before the game script loads:
//
//   <script>
//     window.ARCADE_PEER_OPTIONS = {
//       host: 'peer.example.com', port: 443, secure: true, path: '/',   // your PeerJS server
//       config: { iceServers: iceServersWith({ urls: 'turn:turn.example.com:3478', username: '...', credential: '...' }) }
//     };
//   </script>
//
// Setting `config` replaces PeerJS's whole default ICE list, so include a STUN server too.
// iceServersWith() does that. Credentials belong in your deployment, never in this repository.

export const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function iceServersWith(...turnServers) {
  return [...STUN_SERVERS, ...turnServers];
}

export function peerOptions(overrides) {
  const configured = (globalThis.ARCADE_PEER_OPTIONS && typeof globalThis.ARCADE_PEER_OPTIONS === 'object') ? globalThis.ARCADE_PEER_OPTIONS : {};
  return Object.assign({ debug: 1 }, configured, overrides || {});
}
