"""Draws title cards, lower thirds, pane tags and notes as transparent PNGs, using the site's own fonts."""
import os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
FONTS = 'file://' + os.path.join(ROOT, 'shared', 'ui', 'fonts') + '/'
LIVE = os.environ.get('MEDIA_LIVE_URL', 'https://dhairya233.github.io/browser-arcade/')
GITHUB = 'https://github.com/Dhairya233'
LIVE_SHOWN = LIVE.replace('https://', '').rstrip('/')
GITHUB_SHOWN = GITHUB.replace('https://', '')

CSS = """
@font-face{font-family:'Plex Condensed';font-weight:700;src:url(%(f)sibm-plex-sans-condensed-latin-700-normal.woff2)}
@font-face{font-family:'Plex Condensed';font-weight:500;src:url(%(f)sibm-plex-sans-condensed-latin-500-normal.woff2)}
@font-face{font-family:'Plex Sans';font-weight:400;src:url(%(f)sibm-plex-sans-latin-400-normal.woff2)}
@font-face{font-family:'Plex Sans';font-weight:600;src:url(%(f)sibm-plex-sans-latin-600-normal.woff2)}
@font-face{font-family:'Plex Mono';font-weight:500;src:url(%(f)sibm-plex-mono-latin-500-normal.woff2)}
*{box-sizing:border-box;margin:0}
body{background:transparent;font-family:'Plex Sans',sans-serif}
.it{position:absolute;left:0;top:0}
.lt{background:#14202Bee;border:3px solid #E8EDF0;padding:18px 28px 20px;color:#E8EDF0;min-width:420px}
.lt .k{font:500 22px 'Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#F2A93B}
.lt .t{font:700 54px/1.05 'Plex Condensed',sans-serif;margin-top:8px}
.tag{background:#F2A93B;color:#14202B;border:3px solid #14202B;padding:10px 22px;font:700 30px 'Plex Condensed',sans-serif;letter-spacing:.08em;text-transform:uppercase}
.note{background:#14202Bf0;border:2px solid #8FB3C7;color:#E8EDF0;padding:12px 26px;font:400 25px 'Plex Sans',sans-serif}
.card{width:%(w)spx;height:%(h)spx;position:relative;overflow:hidden}
.night{background:#14202B;color:#E8EDF0}.day{background:#EEF0E8;color:#1E2B33}
.stamp{display:inline-block;font:500 28px 'Plex Mono',monospace;letter-spacing:.16em;text-transform:uppercase;border:3px solid currentColor;padding:8px 18px}
.big{font:700 %(big)spx/1 'Plex Condensed',sans-serif}
.mono{font:500 %(mono)spx 'Plex Mono',monospace}
"""


def html(w, h, body, big, mono):
    return '<html><head><style>%s</style></head><body>%s</body></html>' % (CSS % dict(f=FONTS, w=w, h=h, big=big, mono=mono), body)


ROUTE = """<svg class="it" style="left:%dpx;top:%dpx" width="%d" height="%d" viewBox="0 0 740 300" fill="none">
<path d="M20 250 L180 110 L420 150 L680 60" stroke="#8FB3C7" stroke-width="5"/>
<path d="M180 110 L270 235 L400 225 L420 150" stroke="#8FB3C7" stroke-width="5" stroke-dasharray="14 12"/>
<circle cx="180" cy="110" r="22" fill="#14202B" stroke="#E8EDF0" stroke-width="5"/><circle cx="180" cy="110" r="10" stroke="#F2A93B" stroke-width="5"/>
<circle cx="20" cy="250" r="14" fill="#E8EDF0"/><circle cx="420" cy="150" r="22" fill="#14202B" stroke="#E8EDF0" stroke-width="5"/>
<path d="M680 20 l30 52 h-60z" stroke="#E8EDF0" stroke-width="5"/></svg>"""


def build(outdir):
    os.makedirs(outdir, exist_ok=True)
    items = {}   # name -> (w, h, body, big, mono)
    def lt(name, k, t): items[name] = (900, 170, '<div class="it lt"><div class="k">%s</div><div class="t">%s</div></div>' % (k, t), 54, 22)
    lt('lt_land', 'Browser Arcade', 'Two games, one link')
    lt('lt_sh', 'Shadow Hunt', 'One hidden Phantom')
    lt('lt_got', 'Game of Trades', 'Build, trade, race')
    lt('lt_how', 'How to play', 'Open the link')
    for n, t in (('tag_host', 'Host'), ('tag_join', 'Joining'), ('tag_phantom', "The Phantom's screen"), ('tag_det', "A detective's screen")):
        items[n] = (560, 70, '<div class="it tag">%s</div>' % t, 54, 22)
    items['note_demo'] = (1500, 60, '<div class="it note">Demo footage: three browser windows on one computer, a local signalling server, real WebRTC.</div>', 54, 22)
    items['note_demo_v'] = (900, 60, '<div class="it note">Demo footage, local test setup.</div>', 54, 22)
    items['card_hook'] = (1920, 1080, '<div class="card night"><div class="it" style="left:140px;top:150px"><span class="stamp" style="color:#F2A93B">Browser Arcade</span></div>'
        '<div class="it big" style="left:140px;top:300px">Two board games.<br>Open a link.<br><span style="color:#F2A93B">Play.</span></div>' + ROUTE % (1050, 620, 700, 300) + '</div>', 150, 28)
    items['card_end'] = (1920, 1080, '<div class="card day"><div class="it" style="left:140px;top:140px"><span class="stamp" style="color:#B8441A">Play it now</span></div>'
        '<div class="it big" style="left:140px;top:260px">Open the link.<br>Pick a table.</div>'
        '<div class="it mono" style="left:140px;top:640px;color:#B8441A">%s</div>'
        '<div class="it mono" style="left:140px;top:740px">%s</div>'
        '<div class="it" style="left:140px;top:840px;font:400 30px \'Plex Sans\'">No account. No install. Not affiliated with any commercial game.</div></div>' % (LIVE_SHOWN, GITHUB_SHOWN), 130, 52)
    items['card_hook_v'] = (1080, 1920, '<div class="card night"><div class="it" style="left:80px;top:220px"><span class="stamp" style="color:#F2A93B">Browser Arcade</span></div>'
        '<div class="it big" style="left:80px;top:420px">Two board<br>games.<br>Open a link.<br><span style="color:#F2A93B">Play.</span></div></div>', 170, 28)
    items['card_end_v'] = (1080, 1920, '<div class="card day"><div class="it" style="left:80px;top:220px"><span class="stamp" style="color:#B8441A">Play it now</span></div>'
        '<div class="it big" style="left:80px;top:420px">Open the<br>link.<br>Pick a<br>table.</div>'
        '<div class="it mono" style="left:80px;top:1250px;color:#B8441A;word-break:break-all;width:920px">%s</div>'
        '<div class="it mono" style="left:80px;top:1400px;width:920px">%s</div></div>' % (LIVE_SHOWN, GITHUB_SHOWN), 190, 36)
    lt('lt_v', 'Browser Arcade', 'Play in a tab')
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1920, 'height': 1920})
        for name, (w, h, body, big, mono) in items.items():
            tmp = os.path.join(outdir, '_page.html'); open(tmp, 'w').write(html(w, h, body, big, mono))
            pg.goto('file://' + os.path.abspath(tmp)); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(300)
            box = {'x': 0, 'y': 0, 'width': w, 'height': h}
            if name.startswith(('lt', 'tag', 'note')):          # trim to the drawn box
                box = pg.evaluate("(()=>{const r=document.querySelector('.it').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()")
            pg.screenshot(path=os.path.join(outdir, name + '.png'), clip=box, omit_background=name[:2] in ('lt', 'ta', 'no'))
        b.close()
    os.remove(os.path.join(outdir, '_page.html'))
    return list(items)


if __name__ == '__main__':
    print(build(sys.argv[1]))
