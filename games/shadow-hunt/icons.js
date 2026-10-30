// Drawn icons for Shadow Hunt. One 2px stroke, square caps, 20px grid. They inherit the text colour.
const P = {
  taxi: '<path d="M3 13l1.6-5h10.8L17 13v3H3zM3 13h14M6 16v2M14 16v2M8 5.5h4"/>',
  bus: '<rect x="3" y="3.5" width="14" height="12"/><path d="M3 10h14M6 15.5V18M14 15.5V18"/><path d="M6.5 6.5h7"/>',
  underground: '<circle cx="10" cy="10" r="7"/><path d="M1.5 10h17"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  minus: '<path d="M4 10h12"/>',
  fit: '<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>',
  full: '<path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5"/>',
  copy: '<rect x="7" y="7" width="10" height="10"/><path d="M13 7V3H3v10h4"/>',
  link: '<path d="M8.5 11.5l3-3M7 9L5 11a3 3 0 004.2 4.2L11 13.5M13 11l2-2A3 3 0 0010.800 4.800L9 6.500"/>',
  play: '<path d="M5 3l11 7-11 7z"/>',
  help: '<circle cx="10" cy="10" r="7.5"/><path d="M7.800 8a2.300 2.300 0 114 1.500c-.8.7-1.800 1.100-1.800 2.500M10 14.500v.5"/>',
  back: '<path d="M16 10H4M9 5l-5 5 5 5"/>',
  quit: '<path d="M4 4l12 12M16 4L4 16"/>',
  phantom: '<path d="M10 2.500l7 14H3z"/>',
  detective: '<circle cx="10" cy="7" r="3.500"/><path d="M3.500 17c.7-3.500 3.200-5 6.500-5s5.800 1.500 6.500 5"/>',
  check: '<path d="M4 10.500l4 4 8-9"/>',
};
export const icon = (name, label) =>
  `<svg class="ic" viewBox="0 0 20 20" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${P[name] || ''}</svg>`;
