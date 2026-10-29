// Drawn board pieces and colour swatches.
//
// A player is never shown by colour alone: every swatch and every settlement or city carries the
// player's seat number, so the game stays playable for people who cannot tell two of the colours apart.

export const seatMark = idx => String(idx + 1);

const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastRatio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

// Dark or white text, whichever has the higher contrast on `hex` (WCAG contrast ratio).
const DARK = '#241a12';
export const inkOn = hex => (contrastRatio(hex, DARK) >= contrastRatio(hex, '#ffffff') ? DARK : '#ffffff');

export function swatchHTML(color, idx) {
  return `<span class="swatch" style="background:${color};color:${inkOn(color)}">${seatMark(idx)}</span>`;
}

export function settlementSVG(x, y, color, idx) {
  return `<g transform="translate(${x - 8},${y - 11})"><polygon points="0,8 0,16 16,16 16,8 8,0" fill="${color}" stroke="#241a12" stroke-width="1.5"/>`
    + `<text x="8" y="14.6" text-anchor="middle" font-size="8.5" font-weight="700" font-family="sans-serif" fill="${inkOn(color)}" style="pointer-events:none;">${seatMark(idx)}</text></g>`;
}

export function citySVG(x, y, color, idx) {
  return `<g transform="translate(${x - 11},${y - 15})"><rect x="0" y="10" width="12" height="12" fill="${color}" stroke="#241a12" stroke-width="1.5"/>`
    + `<polygon points="0,10 6,3 12,10" fill="${color}" stroke="#241a12" stroke-width="1.5"/>`
    + `<rect x="11" y="15" width="11" height="7" fill="${color}" stroke="#241a12" stroke-width="1.5"/>`
    + `<text x="6" y="20.2" text-anchor="middle" font-size="8.5" font-weight="700" font-family="sans-serif" fill="${inkOn(color)}" style="pointer-events:none;">${seatMark(idx)}</text></g>`;
}
