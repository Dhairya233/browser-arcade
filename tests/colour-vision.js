// Colour-vision simulation (Machado, Oliveira & Fernandes 2009, full severity) and CIEDE2000 colour distance,
// used by colour-vision.test.js to check that colour is never the only way to tell things apart.
const M = {
  none: [[1,0,0],[0,1,0],[0,0,1]],
  protan: [[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]],
  deutan: [[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]],
  tritan: [[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]],
};
const hex = h => [1,3,5].map(i => parseInt(h.slice(i, i+2), 16) / 255);
const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const gam = c => { c = Math.min(1, Math.max(0, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1/2.4) - 0.055; };
export function simulate(h, kind) {
  const l = hex(h).map(lin), m = M[kind];
  return m.map(r => gam(r[0]*l[0] + r[1]*l[1] + r[2]*l[2]));
}
function lab(rgb) {
  const [r, g, b] = rgb.map(lin);
  const X = (0.4124564*r + 0.3575761*g + 0.1804375*b) / 0.95047, Y = 0.2126729*r + 0.7151522*g + 0.0721750*b, Z = (0.0193339*r + 0.1191920*g + 0.9503041*b) / 1.08883;
  const f = t => t > 216/24389 ? Math.cbrt(t) : (24389/27*t + 16) / 116;
  return [116*f(Y) - 16, 500*(f(X) - f(Y)), 200*(f(Y) - f(Z))];
}
export function de2000(c1, c2) {
  const [L1,a1,b1] = c1, [L2,a2,b2] = c2, rad = d => d*Math.PI/180, deg = r => r*180/Math.PI;
  const C1 = Math.hypot(a1,b1), C2 = Math.hypot(a2,b2), Cm = (C1+C2)/2;
  const G = 0.5*(1 - Math.sqrt(Cm**7/(Cm**7 + 25**7)));
  const a1p = (1+G)*a1, a2p = (1+G)*a2, C1p = Math.hypot(a1p,b1), C2p = Math.hypot(a2p,b2);
  const h = (b,a) => (b===0 && a===0) ? 0 : (deg(Math.atan2(b,a)) + 360) % 360;
  const h1p = h(b1,a1p), h2p = h(b2,a2p);
  const dLp = L2-L1, dCp = C2p-C1p;
  let dhp = 0;
  if (C1p*C2p !== 0) { dhp = h2p-h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2*Math.sqrt(C1p*C2p)*Math.sin(rad(dhp/2));
  const Lpm = (L1+L2)/2, Cpm = (C1p+C2p)/2;
  let hpm = h1p + h2p;
  if (C1p*C2p === 0) hpm = h1p + h2p; else if (Math.abs(h1p-h2p) <= 180) hpm = (h1p+h2p)/2; else hpm = (h1p+h2p+(h1p+h2p < 360 ? 360 : -360))/2;
  const T = 1 - 0.17*Math.cos(rad(hpm-30)) + 0.24*Math.cos(rad(2*hpm)) + 0.32*Math.cos(rad(3*hpm+6)) - 0.20*Math.cos(rad(4*hpm-63));
  const dTheta = 30*Math.exp(-(((hpm-275)/25)**2));
  const Rc = 2*Math.sqrt(Cpm**7/(Cpm**7 + 25**7));
  const Sl = 1 + 0.015*(Lpm-50)**2/Math.sqrt(20 + (Lpm-50)**2), Sc = 1 + 0.045*Cpm, Sh = 1 + 0.015*Cpm*T;
  const Rt = -Math.sin(rad(2*dTheta))*Rc;
  return Math.sqrt((dLp/Sl)**2 + (dCp/Sc)**2 + (dHp/Sh)**2 + Rt*(dCp/Sc)*(dHp/Sh));
}
export const KINDS = ['none', 'protan', 'deutan', 'tritan'];
export const deltaE = (a, b, kind) => de2000(lab(simulate(a, kind)), lab(simulate(b, kind)));
// every pair in a named set, with its distance under each kind of vision
export function pairs(set) {
  const names = Object.keys(set), out = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const row = { a: names[i], b: names[j] };
    KINDS.forEach(k => { row[k] = deltaE(set[names[i]], set[names[j]], k); });
    out.push(row);
  }
  return out;
}
