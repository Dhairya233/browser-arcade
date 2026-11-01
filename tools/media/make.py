"""One command for the whole demo package: starts the two local servers, records the footage, builds the media.

    python tools/media/make.py            # everything
    python tools/media/make.py --build    # only re-render from the footage already in .media-cache

Needs: Python 3.10+, ffmpeg and ffprobe on PATH, Node (for npx), and the packages in tools/media/requirements.txt.
Playwright also needs its browser once:  python -m playwright install chromium
The voice needs the Piper model, see docs/media/README.md.
"""
import os, shutil, socket, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))


def wait_port(port, secs=60):
    end = time.time() + secs
    while time.time() < end:
        with socket.socket() as s:
            s.settimeout(0.5)
            if s.connect_ex(('127.0.0.1', port)) == 0: return
        time.sleep(0.5)
    raise SystemExit('port %d did not open' % port)


def main():
    for tool in ('ffmpeg', 'ffprobe'):
        if not shutil.which(tool): raise SystemExit(tool + ' is not on PATH')
    procs = []
    try:
        if '--build' not in sys.argv:
            procs.append(subprocess.Popen([sys.executable, '-m', 'http.server', '8780', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            npx = shutil.which('npx') or shutil.which('npx.cmd')
            if not npx: raise SystemExit('npx (Node) is needed for the local PeerJS server used by the online clips')
            procs.append(subprocess.Popen([npx, '-y', 'peer@1.0.2', '--host', '0.0.0.0', '--port', '9000'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            wait_port(8780); wait_port(9000)
            subprocess.run([sys.executable, os.path.join(HERE, 'capture.py'), 'landing', 'sh_local', 'got_local', 'online', 'stills', 'phones'], check=True)
        subprocess.run([sys.executable, os.path.join(HERE, 'build.py')], check=True)
    finally:
        for p in procs: p.terminate()


if __name__ == '__main__':
    main()
