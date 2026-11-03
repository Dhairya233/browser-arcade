import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulate, de2000, deltaE, pairs, KINDS } from './colour-vision.js';
import { TRANSPORT_LOOK, ringKind, ringDashAttr, innerRingSVG } from '../games/shadow-hunt/look.js';
import { COLORS } from '../games/shadow-hunt/engine.js';
import { COLOR_CHOICES } from '../games/game-of-trades/adapter.js';
import { settlementSVG, citySVG, swatchHTML, seatMark, inkOn, contrastRatio } from '../games/game-of-trades/pieces.js';

// Colours closer than this (CIEDE2000, after simulating colour-blindness) cannot be relied on alone.
const TOO_CLOSE = 10;

/* ---------- the measuring tools themselves ---------- */

test('CIEDE2000 matches the published reference values (Sharma, Wu and Dalal, 2005)', () => {
  const cases = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0000],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [56, -27, -3], 31.9030],
    [[50, 2.5, 0], [58, 24, 15], 19.4535],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
  ];
  for (const [a, b, want] of cases) assert.ok(Math.abs(de2000(a, b) - want) < 0.001, `${a} vs ${b}: ${de2000(a, b)} not ${want}`);
});

test('colour-blindness simulation keeps greys grey and changes saturated colours', () => {
  for (const k of KINDS) {
    const [r, g, b] = simulate('#808080', k);
    assert.ok(Math.abs(r - g) < 0.01 && Math.abs(g - b) < 0.01, k);
  }
  assert.ok(deltaE('#e53935', '#43a047', 'none') > 30, 'red and green differ a lot for most people');
  assert.ok(deltaE('#e53935', '#43a047', 'deutan') < deltaE('#e53935', '#43a047', 'none') / 2, 'and much less with red-green colour blindness');
});

/* ---------- Shadow Hunt: transport ---------- */

const transportColours = Object.fromEntries(Object.entries(TRANSPORT_LOOK).map(([k, v]) => [k, v.color]));
const css = readFileSync(new URL('../games/shadow-hunt/style.css', import.meta.url), 'utf8');
const cssVar = name => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)[1].toLowerCase();

test('transport colours in the style sheet are the ones look.js describes', () => {
  assert.equal(cssVar('taxi'), TRANSPORT_LOOK.taxi.color);
  assert.equal(cssVar('bus'), TRANSPORT_LOOK.bus.color);
  assert.equal(cssVar('tube'), TRANSPORT_LOOK.underground.color);
});

test('transport lines differ by dash and thickness as well as colour', () => {
  const rule = kind => new RegExp(`\\.edge\\.${kind}\\{([^}]*)\\}`).exec(css)[1];
  const width = kind => +/stroke-width:\s*([\d.]+)/.exec(rule(kind))[1];
  assert.ok(!/dasharray/.test(rule('taxi')) && !/dasharray/.test(rule('underground')));
  assert.match(rule('bus'), /stroke-dasharray/);
  assert.ok(width('underground') > width('bus') && width('bus') > width('taxi'), 'thicker the further it goes');
});

test('station rings differ by shape as well as colour', () => {
  const kinds = ['taxi', 'bus', 'underground'];
  const shape = k => ringDashAttr(k) + '|' + innerRingSVG(10, 10, k, '#000');
  assert.equal(new Set(kinds.map(shape)).size, 3, 'three different ring shapes');
  assert.equal(ringDashAttr('taxi'), '');
  assert.match(ringDashAttr('bus'), /stroke-dasharray/);
  assert.match(innerRingSVG(10, 10, 'underground', '#000'), /<circle/);
  assert.equal(innerRingSVG(10, 10, 'bus', '#000'), '');
  assert.equal(ringKind(['taxi', 'bus', 'underground']), 'underground');
  assert.equal(ringKind(['taxi', 'bus']), 'bus');
  assert.equal(ringKind(['taxi']), 'taxi');
});

test('every pair of transport colours that is hard to tell apart for someone is backed by a shape cue', () => {
  const cue = k => [TRANSPORT_LOOK[k].dash, TRANSPORT_LOOK[k].ring].join('|');
  for (const row of pairs(transportColours)) {
    const weak = KINDS.filter(k => row[k] < TOO_CLOSE);
    if (weak.length) assert.notEqual(cue(row.a), cue(row.b), `${row.a} and ${row.b} are close for ${weak.join(', ')} vision`);
  }
  // the cues must be there for every pair anyway, not only the ones that happen to be close today
  const names = Object.keys(TRANSPORT_LOOK);
  assert.equal(new Set(names.map(cue)).size, names.length);
});

/* ---------- Shadow Hunt: players ---------- */

test('detective colours are all distinct for normal vision; confusable ones are told apart by number on the piece', () => {
  const det = Object.fromEntries(COLORS.map((c, i) => [`detective ${i + 1}`, c]));
  for (const row of pairs(det)) assert.ok(row.none >= TOO_CLOSE, `${row.a}/${row.b}: ${row.none.toFixed(1)}`);
  const main = readFileSync(new URL('../games/shadow-hunt/main.js', import.meta.url), 'utf8');
  assert.match(main, /class="pieceIcon">\$\{p\.isPhantom\?'P':\(G\.players\.filter\(pl=>!pl\.isPhantom\)\.indexOf\(p\)\+1\)\}/, 'pieces carry a number or P');
  assert.match(main, /class="dot num" style="background:\$\{p\.color\}">\$\{i\}</, 'the side panel repeats the number next to the colour');
});

/* ---------- Game of Trades: players ---------- */

test('Game of Trades: all 8 player colours are distinct for normal vision', () => {
  const set = Object.fromEntries(COLOR_CHOICES.map((c, i) => [`seat colour ${i + 1}`, c]));
  for (const row of pairs(set)) assert.ok(row.none >= TOO_CLOSE, `${row.a}/${row.b}: ${row.none.toFixed(1)}`);
});

test('Game of Trades: every colour is paired with a seat number on swatches, settlements and cities', () => {
  const seen = new Set();
  COLOR_CHOICES.forEach((c, i) => {
    const n = seatMark(i);
    seen.add(n);
    assert.ok(swatchHTML(c, i).includes(`>${n}</span>`), 'swatch ' + n);
    assert.ok(settlementSVG(0, 0, c, i).includes(`>${n}</text>`), 'settlement ' + n);
    assert.ok(citySVG(0, 0, c, i).includes(`>${n}</text>`), 'city ' + n);
  });
  assert.equal(seen.size, COLOR_CHOICES.length, 'every seat has its own number');
});

test('Game of Trades: the number is readable on every player colour (contrast at least 4.5 to 1)', () => {
  for (const c of COLOR_CHOICES) assert.ok(contrastRatio(c, inkOn(c)) >= 4.5, `${c}: ${contrastRatio(c, inkOn(c)).toFixed(1)}`);
});
