# Third-party notices

## Included in this repository

### PeerJS 1.5.4
- File: `vendor/peerjs.min.js`, the official `dist/peerjs.min.js` from the npm package `peerjs@1.5.4`, unmodified.
- Licence: MIT. Copyright (c) 2015 Michelle Bu and Eric Zhang. The full text is in `vendor/LICENSE-peerjs`.
- The file embeds the names and email addresses of upstream contributors, as published by the PeerJS project. It is kept byte-for-byte as released.

### IBM Plex Sans, Plex Sans Condensed and Plex Mono
- Files: `shared/ui/fonts/*.woff2`, Latin subsets as packaged by Fontsource, unmodified. Used by the arcade landing page.
- Licence: SIL Open Font License 1.1, copyright IBM Corp. The licence text is in `shared/ui/fonts/LICENSE-IBM-Plex-OFL.txt`.

## Loaded at run time (not included in this repository)

### Fonts: Cinzel and Inter (Game of Trades)
- Loaded from Google Fonts when the page opens, so the visitor's browser contacts Google to fetch them.
- Both are licensed under the SIL Open Font License 1.1.

## External services used by online play

- **PeerJS cloud signalling server** (`0.peerjs.com`): introduces players to the host's browser. It sees room codes and network addresses used to set up the connection. Game data does not pass through it.
- **STUN and TURN servers**: PeerJS's defaults are Google's public STUN server and a free public TURN relay run by the PeerJS project. When a direct connection is impossible, game data can be relayed through the TURN server. These are free community services with no uptime guarantee. To use your own, see `shared/net/peer-options.js`.
