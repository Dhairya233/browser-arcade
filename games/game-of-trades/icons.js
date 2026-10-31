// Drawn icons for Game of Trades. One 2px stroke, square caps, 20px grid. They inherit the text colour.
const P = {
  wood: '<path d="M10 2l5 7h-3l4 6H4l4-6H5z"/><path d="M10 15v3"/>',
  brick: '<path d="M2 5h16v10H2zM2 10h16M8 5v5M13 10v5"/>',
  ore: '<path d="M1 16L7 5l4 7 2-3 6 7z"/>',
  wheat: '<path d="M10 18V5M10 8C7 7 6 5 6 3c3 0 4 2 4 5zM10 8c3-1 4-3 4-5-3 0-4 2-4 5zM10 13c-3-1-4-3-4-5M10 13c3-1 4-3 4-5"/>',
  sheep: '<path d="M5 8a3 3 0 015-2 3 3 0 015 2 3 3 0 01-1 5H6a3 3 0 01-1-5zM7 13v4M13 13v4"/>',
  desert: '<path d="M2 16h16M6 16a4 4 0 018 0M10 3v3M4 6l2 2M16 6l-2 2"/>',
  dice: '<path d="M3 3h14v14H3zM7 7h.1M13 7h.1M10 10h.1M7 13h.1M13 13h.1"/>',
  road: '<path d="M6 18L8 2M14 18l-2-16M10 4v2M10 9v2M10 14v2"/>',
  settlement: '<path d="M3 9l7-6 7 6v8H3zM8 17v-5h4v5"/>',
  city: '<path d="M2 17V9l4-3 4 3v8M10 17V5l4-3 4 3v12M2 17h16"/>',
  devcard: '<path d="M5 2h10v16H5zM8 7h4M8 11h4"/>',
  trade: '<path d="M3 7h13l-3-3M17 13H4l3 3"/>',
  person: '<circle cx="10" cy="6.5" r="3.5"/><path d="M3.5 17c.7-3.5 3.2-5 6.5-5s5.8 1.5 6.5 5"/>',
  anchor: '<path d="M10 3v13M6 7h8M3 12a7 7 0 0014 0"/>',
  trophy: '<path d="M6 3h8v5a4 4 0 01-8 0zM6 5H3v2a3 3 0 003 3M14 5h3v2a3 3 0 01-3 3M10 12v3M7 17h6"/>',
  cards: '<path d="M3 5h9v12H3zM7 3h9v12"/>',
  knight: '<path d="M5 15L15 5M12 3h5v5M4 12l4 4M3 17l2-2"/>',
  list: '<path d="M4 3h12v14H4zM7 7h6M7 10h6M7 13h4"/>',
  help: '<circle cx="10" cy="10" r="7.5"/><path d="M7.8 8a2.3 2.3 0 114 1.500c-.8.7-1.8 1.1-1.8 2.500M10 14.500v.5"/>',
  soundOn: '<path d="M3 8h3l4-3v10l-4-3H3zM13 7a4 4 0 010 6"/>',
  soundOff: '<path d="M3 8h3l4-3v10l-4-3H3zM13 8l4 4M17 8l-4 4"/>',
  home: '<path d="M3 9l7-6 7 6M5 8v9h10V8"/>',
  close: '<path d="M4 4l12 12M16 4L4 16"/>',
  copy: '<rect x="7" y="7" width="10" height="10"/><path d="M13 7V3H3v10h4"/>',
  link: '<path d="M8.5 11.500l3-3M7 9L5 11a3 3 0 004.2 4.200L11 13.500M13 11l2-2A3 3 0 0010.8 4.800L9 6.5"/>',
  play: '<path d="M5 3l11 7-11 7z"/>',
  back: '<path d="M16 10H4M9 5l-5 5 5 5"/>',
  check: '<path d="M4 10.500l4 4 8-9"/>',
  hidden: '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zM10 8a2 2 0 100 4 2 2 0 000-4zM3 17L17 3"/>',
  robber: '<ellipse cx="10" cy="12" rx="5" ry="6"/><circle cx="10" cy="5" r="3"/>',
};
export const RES_NAMES = ['wood', 'brick', 'ore', 'wheat', 'sheep'];
export const icon = (name, label) =>
  `<svg class="ic" viewBox="0 0 20 20" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${P[name] || ''}</svg>`;
// The same glyph placed inside a board SVG, centred on (x, y), `size` units wide.
export const glyphAt = (name, x, y, size, color) =>
  `<g transform="translate(${x - size / 2} ${y - size / 2}) scale(${size / 20})" fill="none" stroke="${color}" stroke-width="${(2 * 20 / size).toFixed(2)}" stroke-linecap="square" stroke-linejoin="miter" style="pointer-events:none;">${P[name] || ''}</g>`;
// A six-sided die face with its pips.
const PIPS = { 1: [[10, 10]], 2: [[6, 6], [14, 14]], 3: [[6, 6], [10, 10], [14, 14]], 4: [[6, 6], [14, 6], [6, 14], [14, 14]], 5: [[6, 6], [14, 6], [10, 10], [6, 14], [14, 14]], 6: [[6, 5], [14, 5], [6, 10], [14, 10], [6, 15], [14, 15]] };
export const dieSVG = n =>
  `<svg class="die" viewBox="0 0 20 20" role="img" aria-label="${n}"><rect x="1" y="1" width="18" height="18" fill="#fff" stroke="#1E2B33" stroke-width="2"/>${(PIPS[n] || []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.7" fill="#1E2B33"/>`).join('')}</svg>`;
