"""Records a Playwright page as video by collecting the browser's own screencast frames.

Frames arrive only when the screen changes, so each one is kept with its timestamp and the clip
is rebuilt at a steady 30 frames per second. A drawn cursor follows the real mouse so that
clicks are visible. Nothing here changes what the page does.
"""
import base64, json, os, shutil, subprocess, time

CURSOR_JS = """
(() => {
  if (window.__cursorInstalled) return; window.__cursorInstalled = true;
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border:3px solid #fff;border-radius:50%;background:rgba(242,169,59,.55);box-shadow:0 0 0 2px #1E2B33;pointer-events:none;z-index:2147483647;transition:transform .08s,background .08s;display:none';
  const add = () => document.documentElement.appendChild(c);
  if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
  addEventListener('mousemove', e => { c.style.display = 'block'; c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { c.style.transform = 'scale(.7)'; c.style.background = 'rgba(242,169,59,.95)'; }, true);
  addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; c.style.background = 'rgba(242,169,59,.55)'; }, true);
})();
"""


class Recorder:
    def __init__(self, page, out_dir, name, fps=30, shots=False):
        self.page, self.fps, self.name = page, fps, name
        self.dir = os.path.join(out_dir, name + '_frames')
        shutil.rmtree(self.dir, ignore_errors=True)
        os.makedirs(self.dir)
        self.frames = []          # (timestamp, filename)
        self.cdp = None if shots else page.context.new_cdp_session(page)
        if self.cdp: self.cdp.on('Page.screencastFrame', self._on_frame)
        self.running = False

    def _on_frame(self, ev):
        if not os.path.isdir(self.dir):
            return
        ts = ev['metadata']['timestamp']
        fn = '%06d.jpg' % len(self.frames)
        with open(os.path.join(self.dir, fn), 'wb') as f:
            f.write(base64.b64decode(ev['data']))
        self.frames.append((ts, fn))
        try:
            self.cdp.send('Page.screencastFrameAck', {'sessionId': ev['sessionId']})
        except Exception:
            pass

    def wait(self, seconds, quality=90):
        """Shots mode (full phone resolution, since screencast frames are CSS-sized): take screenshots while waiting."""
        end = time.time() + seconds
        while time.time() < end:
            fn = '%06d.jpg' % len(self.frames)
            ts = time.time()
            self.page.screenshot(path=os.path.join(self.dir, fn), type='jpeg', quality=quality)
            self.frames.append((ts, fn))

    def start(self, max_w=None, max_h=None):
        self.running = True
        if not self.cdp: return
        a = {'format': 'jpeg', 'quality': 92, 'everyNthFrame': 1}
        if max_w: a.update(maxWidth=max_w, maxHeight=max_h)
        self.cdp.send('Page.startScreencast', a)

    def stop(self):
        self.page.wait_for_timeout(250)
        self.t_stop = time.time()
        if self.cdp: self.cdp.send('Page.stopScreencast')
        self.running = False

    def save(self, path, tail=0.4, t0=None, t1=None):
        """Writes the clip to `path` (mp4, 30 fps, no audio) and returns its duration in seconds."""
        if not self.frames:
            raise RuntimeError('no frames recorded for ' + self.name)
        lst = os.path.join(self.dir, 'list.txt')
        frames = list(self.frames)
        if t1 is None and getattr(self, 't_stop', 0) > frames[-1][0]: t1 = self.t_stop
        if t0 is not None and frames[0][0] > t0:          # share a timeline with another recorder
            frames.insert(0, (t0, frames[0][1]))
        if t1 is not None:
            frames.append((t1, frames[-1][1])); tail = 0.04
        with open(lst, 'w') as f:
            for i, (ts, fn) in enumerate(frames):
                dur = (frames[i + 1][0] - ts) if i + 1 < len(frames) else tail
                f.write("file '%s'\nduration %.4f\n" % (fn, max(dur, 0.001)))
            f.write("file '%s'\n" % frames[-1][1])
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst,
                        '-vf', 'fps=%d,format=yuv420p' % self.fps, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
                        '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1', path], check=True)
        out = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path])
        shutil.rmtree(self.dir, ignore_errors=True)
        return float(out)


def glide(page, x, y, steps=28):
    """Moves the real mouse to (x, y) along a smooth path."""
    cur = page.evaluate('[window.__mx||0, window.__my||0]')
    sx, sy = cur
    for i in range(1, steps + 1):
        t = i / steps
        e = t * t * (3 - 2 * t)                          # ease in and out
        page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e)
        page.wait_for_timeout(14)
    page.evaluate('([a,b])=>{window.__mx=a;window.__my=b}', [x, y])


def click_el(page, locator, pause=0.25):
    """Glides to the middle of an element, then clicks it with the real mouse."""
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    if not box:
        raise RuntimeError('element not visible')
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    glide(page, x, y)
    page.wait_for_timeout(int(pause * 1000))
    page.mouse.click(x, y)
    page.wait_for_timeout(int(pause * 1000))
