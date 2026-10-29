// How the three kinds of transport are told apart on screen.
//
// Colour is never the only cue. Lines differ in dash and thickness (see .edge.* in style.css),
// and a station's ring differs in shape: solid for taxi only, dashed for a bus stop, doubled for the
// underground. The colours here must match the --taxi, --bus and --tube variables in style.css.

export const TRANSPORT_LOOK = {
  taxi:        { color: '#f2c14e', dash: null,  ring: 'single' },
  bus:         { color: '#4caf50', dash: '5 3', ring: 'dashed' },
  underground: { color: '#e53935', dash: null,  ring: 'double' },
};

// A station is drawn by the best transport that touches it: underground, then bus, then taxi.
export function ringKind(types) {
  if (types.includes('underground')) return 'underground';
  if (types.includes('bus')) return 'bus';
  return 'taxi';
}

// SVG attribute for a station ring's dash, and the extra inner ring that marks the underground.
export const ringDashAttr = kind => (TRANSPORT_LOOK[kind].dash ? ` stroke-dasharray="${TRANSPORT_LOOK[kind].dash}"` : '');
export const innerRingSVG = (x, y, kind, color) => (TRANSPORT_LOOK[kind].ring === 'double'
  ? `<circle cx="${x}" cy="${y}" r="8.5" fill="none" stroke="${color}" stroke-width="2" pointer-events="none"/>` : '');
