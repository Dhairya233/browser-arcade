"""Captures the screen footage used by the demo video.

Every clip is a real run of the real pages, driven with a visible mouse pointer. Nothing is sped up
or edited inside a clip. Names are fixed demo names. Online clips use a local PeerJS signalling
server (see tools/media/README or docs/media/README.md); the pages and WebRTC code are the real ones.

    python3 tools/media/capture.py landing sh_local got_local online stills
"""
import json, os, re, subprocess, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from recorder import Recorder, CURSOR_JS, click_el, glide
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.environ.get('MEDIA_CACHE', os.path.join(ROOT, '.media-cache'))
CLIPS = os.path.join(CACHE, 'clips')
STILLS = os.path.join(ROOT, 'docs', 'media', 'screens')
BASE = os.environ.get('MEDIA_BASE', 'http://127.0.0.1:8780')
SIGNAL = os.environ.get('MEDIA_SIGNAL', 'host:127.0.0.1,port:9000')   # local PeerJS server for online clips
INIT_PEER = "window.ARCADE_PEER_OPTIONS = {host:'127.0.0.1', port:9000, secure:false, path:'/', debug:0};"
NAMES = ['Asha', 'Ben', 'Chen']
FLAGS = ['--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection']
DESK = {'width': 1920, 'height': 1080}
os.makedirs(CLIPS, exist_ok=True); os.makedirs(STILLS, exist_ok=True)


def pause(pg, s): pg.wait_for_timeout(int(s * 1000))


def in_map(pg, k, sel='#mapInner .hit'):
    """k-th station circle that sits fully inside the visible map frame."""
    els = pg.locator(sel); good = []
    for i in range(els.count()):
        bb = els.nth(i).bounding_box()
        if bb and 190 < bb['x'] < 1400 and 290 < bb['y'] < 850: good.append(els.nth(i))
    return good[k % len(good)]


def new_ctx(b, w=1920, h=1080, online=False, mobile=False, cursor=True):
    kw = dict(viewport={'width': w, 'height': h})
    if mobile: kw.update(device_scale_factor=3, has_touch=True, is_mobile=True)
    ctx = b.new_context(**kw)
    if online: ctx.add_init_script(INIT_PEER)
    if not mobile and cursor: ctx.add_init_script(CURSOR_JS)
    return ctx


def meta(name, dur, extra=None):
    p = os.path.join(CLIPS, 'clips.json')
    d = json.load(open(p)) if os.path.exists(p) else {}
    d[name] = dict(dur=round(dur, 3), **(extra or {}))
    json.dump(d, open(p, 'w'), indent=1)


# ---------------------------------------------------------------- landing
def landing(b):
    pg = new_ctx(b).new_page(); pg.goto(BASE + '/'); pause(pg, 0.8)
    r = Recorder(pg, CLIPS, 'landing'); r.start(); pause(pg, 1.6)
    glide(pg, 700, 760); pause(pg, 0.5)
    glide(pg, 1240, 700); pause(pg, 0.9)
    click_el(pg, pg.locator("a:has-text('Pass and play')").first)
    pause(pg, 0.9); r.stop(); meta('landing', r.save(os.path.join(CLIPS, 'landing.mp4')))


# ---------------------------------------------------------------- shadow hunt, one screen
def sh_play_to_round(pg, rounds, record_click=True):
    """Plays real turns until `rounds` full rounds are done, using the page's own controls."""
    n = 0
    while n < rounds * 3:
        pg.locator("button:has-text(\"I'm ready. Show my move\")").dispatch_event('click'); pause(pg, 0.15)
        pg.locator('circle.stationDot.reachable').last.dispatch_event('click')
        pg.wait_for_selector('.modeBtn', timeout=5000); pg.locator('.modeBtn').first.click(); pause(pg, 0.25); n += 1


def sh_local(b):
    ctx = new_ctx(b); pg = ctx.new_page()
    pg.goto(BASE + '/games/shadow-hunt/#local'); pause(pg, 0.8)
    r = Recorder(pg, CLIPS, 'sh_local'); r.start(); pause(pg, 1.2)
    glide(pg, 960, 275); pause(pg, 0.3); pg.select_option('select >> nth=0', '3'); pause(pg, 0.5)
    inputs = pg.locator('input:visible')
    for i, n in enumerate(NAMES):
        click_el(pg, inputs.nth(i), 0.1); pg.keyboard.press('Control+A'); pg.keyboard.type(n, delay=60)
    pause(pg, 0.5)
    click_el(pg, pg.get_by_role('button', name='Start game')); pause(pg, 0.8)
    for i, idx in enumerate([3, 9, 17]):
        click_el(pg, pg.locator("button:has-text(\"I'm ready. Pick my start\")")); pause(pg, 0.5)
        click_el(pg, in_map(pg, idx)); pause(pg, 0.6)
        click_el(pg, pg.locator('text=Confirm this starting station').first); pause(pg, 0.5)
    click_el(pg, pg.locator('text=Begin Game')); pause(pg, 0.9)
    click_el(pg, pg.locator("text=I'm ready. Show my move")); pause(pg, 1.6)     # the Phantom's own screen
    reach = pg.locator('circle.stationDot.reachable')
    pg.locator('circle.stationDot.reachable').nth(1).dispatch_event('click'); pause(pg, 0.8)
    click_el(pg, pg.locator('.modeBtn').first); pause(pg, 1.6)
    pg.screenshot(path=os.path.join(CACHE, 'sh_local_pass.png'))                  # the pass-the-device screen
    r.stop(); meta('sh_local', r.save(os.path.join(CLIPS, 'sh_local.mp4')))


# ---------------------------------------------------------------- game of trades, one screen
def got_setup(pg):
    pg.click('[data-action=setNumPlayers]:has-text("3")')
    for i, n in enumerate(NAMES): pg.fill('input[placeholder="Player %d name"]' % (i + 1), n)


def got_local(b):
    pg = new_ctx(b).new_page(); pg.goto(BASE + '/games/game-of-trades/#local'); pause(pg, 0.8)
    r = Recorder(pg, CLIPS, 'got_local'); r.start(); pause(pg, 1.0)
    click_el(pg, pg.locator('[data-action=setNumPlayers]:has-text("3")'))
    for i, n in enumerate(NAMES):
        click_el(pg, pg.locator('input[placeholder="Player %d name"]' % (i + 1)), 0.1); pg.keyboard.type(n, delay=60)
    pause(pg, 0.4); click_el(pg, pg.locator('[data-action=startGame]')); pause(pg, 0.8)
    placed = 0
    for _ in range(80):
        if pg.locator('[data-action=rollDice]').count(): break
        if pg.locator('[data-action=continuePass]').count():
            click_el(pg, pg.locator('[data-action=continuePass]')); pause(pg, 0.5); continue
        for act in ('clickVertexSettlement', 'clickEdge'):
            loc = pg.locator('[data-action=%s]' % act)
            if loc.count():
                loc.first.scroll_into_view_if_needed(); click_el(pg, loc.first); pause(pg, 0.5); placed += 1; break
        if placed == 2 or placed == 4: pause(pg, 0.4)
        if placed >= 2 and os.environ.get('GOT_SHORT'): break
    pause(pg, 0.6)
    if pg.locator('[data-action=rollDice]').count():
        click_el(pg, pg.locator('[data-action=rollDice]')); pause(pg, 2.0)
    r.stop(); meta('got_local', r.save(os.path.join(CLIPS, 'got_local.mp4')))


# ---------------------------------------------------------------- online, three real browser contexts
def online(b):
    ctxs = [new_ctx(b, 960, 1080, online=True) for _ in range(3)]
    H, A, B = [c.new_page() for c in ctxs]
    for pg, who in ((H, 'host'), (A, 'a'), (B, 'b')): pg.goto(BASE + '/games/shadow-hunt/'); pause(pg, 0.4)
    recs = {k: Recorder(pg, CLIPS, 'on_' + k) for k, pg in (('h', H), ('a', A), ('b', B))}
    for r in recs.values(): r.start()
    t0 = time.time()
    marks = {}
    def mark(n): marks[n] = time.time() - t0
    click_el(H, H.locator('text=Play online with friends')); pause(H, 0.4)
    click_el(H, H.locator("button:has-text('Create a room')")); pause(H, 0.3)
    click_el(H, H.locator('#crName')); H.keyboard.type(NAMES[0], delay=60)
    click_el(H, H.locator('text=Create and enter lobby'))
    H.wait_for_selector('#lobbyScreen.active', timeout=25000); pause(H, 0.8)
    code = H.inner_text('#lobbyCode').strip(); mark('lobby')
    for pg, nm in ((A, NAMES[1]), (B, NAMES[2])):
        click_el(pg, pg.locator('text=Play online with friends')); pause(pg, 0.3)
        click_el(pg, pg.locator("button:has-text('Join a room')")); pause(pg, 0.3)
        click_el(pg, pg.locator('#jrName')); pg.keyboard.type(nm, delay=60)
        click_el(pg, pg.locator('#jrCode')); pg.keyboard.type(code, delay=90)
        click_el(pg, pg.locator("button:has-text('Join lobby')"))
        pg.wait_for_selector('#lobbyScreen.active', timeout=25000); pause(pg, 0.5)
    pause(H, 1.2); mark('joined')
    click_el(H, H.locator('#lobbyStartBtn'))
    for pg in (H, A, B): pg.wait_for_selector('#gameScreen.active', timeout=15000)
    mark('started')
    picks = {id(H): 4, id(A): 11, id(B): 18}
    for pg in (H, A, B):
        pg.wait_for_selector('text=pick your starting station', timeout=15000)
        click_el(pg, in_map(pg, picks[id(pg)])); pause(pg, 0.4)
        click_el(pg, pg.locator('text=Confirm this starting station').first); pause(pg, 0.4)
    try:
        for pg in (H, A, B): pg.wait_for_selector("#roundBadge:has-text('Round 1')", timeout=15000)
    except Exception:
        for i, pg in enumerate((H, A, B)): pg.screenshot(path=os.path.join(CACHE, 'fail_%d.png' % i))
        raise
    pause(H, 1.5); mark('playing')
    pages = {'h': H, 'a': A, 'b': B}
    phantom = [k for k, pg in pages.items() if pg.locator('text.pieceIcon', has_text='P').count()][0]
    others = [k for k in pages if k != phantom]
    mark('phantom_visible'); pause(H, 3.0)
    # the phantom moves, everyone's log updates, only the phantom's own screen keeps the piece
    ph = pages[phantom]
    ph.locator('circle.stationDot.reachable').nth(1).dispatch_event('click'); pause(ph, 0.5)
    click_el(ph, ph.locator('.modeBtn').first); pause(ph, 2.5); mark('moved')
    at_move = {k: pages[k].locator('text.pieceIcon', has_text='P').count() for k in pages}
    # a few real detective turns
    for _ in range(3):
        for k, pg in pages.items():
            if pg.locator('circle.stationDot.reachable').count():
                pg.locator('circle.stationDot.reachable').last.dispatch_event('click'); pause(pg, 0.4)
                click_el(pg, pg.locator('.modeBtn').first); pause(pg, 1.2)
    mark('turns')
    # refresh a detective mid game, as the spec asks for real two-device footage, here it is a scripted reload
    ok = at_move
    t_end = time.time()
    for r in recs.values(): r.stop()
    ts0 = min(r.frames[0][0] for r in recs.values()); ts1 = max(r.frames[-1][0] for r in recs.values())
    durs = {}
    for k, r in recs.items(): durs[k] = r.save(os.path.join(CLIPS, 'on_%s.mp4' % k), t0=ts0, t1=ts1)
    marks = {k: round(v, 2) for k, v in marks.items()}
    meta('online', max(durs.values()), dict(phantom=phantom, others=others, code=code, wall_marks=marks, ts0=ts0,
         phantom_piece_absent_elsewhere=ok))
    print('online', phantom, durs, marks, ok)


# ---------------------------------------------------------------- still images and phone footage
def sh_started(pg, picks=(3, 9, 17), phones=False):
    pg.goto(BASE + '/games/shadow-hunt/#local'); pause(pg, 0.6)
    pg.select_option('select >> nth=0', '3')
    ins = pg.locator('input:visible')
    for i, n in enumerate(NAMES): ins.nth(i).fill(n)
    pg.get_by_role('button', name='Start game').click()
    for idx in picks:
        pg.locator("button:has-text(\"I'm ready. Pick my start\")").dispatch_event('click'); pause(pg, 0.2)
        pg.locator('#mapInner .hit').nth(idx).dispatch_event('click'); pause(pg, 0.1)
        pg.locator('text=Confirm this starting station').first.dispatch_event('click'); pause(pg, 0.2)
    pg.locator('text=Begin Game').dispatch_event('click'); pause(pg, 0.3)


def got_started(pg):
    pg.goto(BASE + '/games/game-of-trades/#local'); pause(pg, 0.6)
    pg.click('[data-action=setNumPlayers]:has-text("3")')
    for i, n in enumerate(NAMES): pg.fill('input[placeholder="Player %d name"]' % (i + 1), n)
    pg.click('[data-action=startGame]')
    for _ in range(80):
        if pg.locator('[data-action=rollDice]').count(): break
        if pg.locator('[data-action=continuePass]').count(): pg.click('[data-action=continuePass]'); continue
        for act in ('clickVertexSettlement', 'clickEdge'):
            if pg.locator('[data-action=%s]' % act).count(): pg.locator('[data-action=%s]' % act).first.dispatch_event('click'); break


def stills(b):
    S = lambda n: os.path.join(STILLS, n)
    pg = new_ctx(b, cursor=False).new_page(); pg.goto(BASE + '/'); pause(pg, 0.8); pg.screenshot(path=S('landing.png'))
    pg = new_ctx(b, cursor=False).new_page(); sh_started(pg)
    pg.locator("text=I'm ready. Show my move").dispatch_event('click'); pause(pg, 0.5); pg.screenshot(path=S('shadow-hunt-board.png'))
    # play three full rounds with real controls, then look at the map on the detectives' turn
    pg.locator('circle.stationDot.reachable').first.dispatch_event('click'); pg.wait_for_selector('.modeBtn'); pg.locator('.modeBtn').first.click()
    for _ in range(6):
        pg.locator("button:has-text(\"I'm ready. Show my move\")").dispatch_event('click'); pause(pg, 0.2)
        if not pg.locator('circle.stationDot.reachable').count():
            print('no reachable station:', pg.inner_text('#turnBanner')); pg.screenshot(path=S('_debug.png')); break
        pg.locator('circle.stationDot.reachable').first.dispatch_event('click'); pg.wait_for_selector('.modeBtn'); pg.locator('.modeBtn').first.click(); pause(pg, 0.2)
    pg.locator("button:has-text(\"I'm ready. Show my move\")").dispatch_event('click'); pause(pg, 0.6)
    pg.screenshot(path=S('shadow-hunt-reveal.png')); print('round', pg.inner_text('body')[:300].replace('\n', ' | '))
    pg = new_ctx(b, cursor=False).new_page(); got_started(pg); pg.click('[data-action=rollDice]'); pause(pg, 0.5); pg.screenshot(path=S('game-of-trades-board.png'))
    for game, lobby in (('shadow-hunt', 'sh'), ('game-of-trades', 'got')):
        pg = new_ctx(b, 1280, 900, online=True, cursor=False).new_page(); pg.goto(BASE + '/games/%s/' % game)
        if lobby == 'sh':
            pg.click('text=Play online with friends'); pg.click("button:has-text('Create a room')"); pg.fill('#crName', NAMES[0]); pg.click('text=Create and enter lobby'); pg.wait_for_selector('#lobbyScreen.active')
        else:
            pg.click('[data-action=goOnline]'); pg.fill('.online-name', NAMES[0]); pg.click('[data-action=createRoom]'); pg.wait_for_selector('.room-code')
        pause(pg, 0.8); pg.screenshot(path=S('%s-lobby.png' % game))
    ph = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = b.new_context(**ph).new_page(); sh_started(pg); pg.locator("text=I'm ready. Show my move").dispatch_event('click'); pause(pg, 0.5); pg.screenshot(path=S('shadow-hunt-mobile.png'))
    pg = b.new_context(**ph).new_page(); got_started(pg); pg.click('[data-action=rollDice]'); pause(pg, 0.5); pg.screenshot(path=S('game-of-trades-mobile.png'))


def phones(b):
    ph = dict(viewport={'width': 360, 'height': 640}, device_scale_factor=3, has_touch=True, is_mobile=True)
    def rec(pg, name):
        r = Recorder(pg, CLIPS, name, shots=True); r.start(); return r
    def done(r, name): r.stop(); meta(name, r.save(os.path.join(CLIPS, name + '.mp4')))
    pg = b.new_context(**ph).new_page(); pg.goto(BASE + '/'); pause(pg, 0.8)
    r = rec(pg, 'm_land'); r.wait(2.4)
    for _ in range(10): pg.mouse.wheel(0, 60); r.wait(0.2)
    r.wait(1.8); done(r, 'm_land')
    pg = b.new_context(**ph).new_page(); sh_started(pg)
    r = rec(pg, 'm_sh'); r.wait(1.6)
    pg.locator("text=I'm ready. Show my move").tap(); r.wait(2.6)
    pg.locator('circle.stationDot.reachable').nth(1).dispatch_event('click'); r.wait(1.8); pg.locator('.modeBtn').first.tap(); r.wait(3.0)
    done(r, 'm_sh')
    pg = b.new_context(**ph).new_page(); got_started(pg)
    r = rec(pg, 'm_got'); r.wait(2.2); pg.locator('[data-action=rollDice]').tap(); r.wait(4.0)
    done(r, 'm_got')


if __name__ == '__main__':
    scenes = sys.argv[1:] or ['landing', 'sh_local', 'got_local', 'online']
    with sync_playwright() as p:
        b = p.chromium.launch(args=FLAGS)
        for s in scenes:
            print('scene', s, flush=True); globals()[s](b)
        b.close()
