"""Renders the voiceover lines with Piper (free, local, offline) and measures each one.

Voice: en_US ljspeech medium (public domain recording). Set PIPER_PY to a Python that has piper-tts
installed and PIPER_VOICE to the folder holding en_US-ljspeech-medium.onnx and espeak-ng-data.
A paid voice would sound better; to use one, replace the wav files in the cache and keep the names.
"""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CACHE = os.environ.get('MEDIA_CACHE', os.path.join(ROOT, '.media-cache'))
PIPER_PY = os.environ.get('PIPER_PY', sys.executable)
PIPER_VOICE = os.environ.get('PIPER_VOICE', os.path.join(CACHE, 'voice'))


def dur(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]))


def render():
    script = json.load(open(os.path.join(HERE, 'script.json')))
    out = os.path.join(CACHE, 'vo'); os.makedirs(out, exist_ok=True)
    model = os.path.join(PIPER_VOICE, 'en_US-ljspeech-medium.onnx')
    durs = {}
    for kind, lines in script.items():
        for ln in lines:
            wav = os.path.join(out, '%s_%s.wav' % (kind, ln['id']))
            if not os.path.exists(wav):
                subprocess.run([PIPER_PY, '-m', 'piper', '-m', model, '--data-dir', PIPER_VOICE, '-f', wav],
                               input=ln['text'].encode(), check=True, stderr=subprocess.DEVNULL)
            durs['%s_%s' % (kind, ln['id'])] = round(dur(wav), 3)
    json.dump(durs, open(os.path.join(CACHE, 'vo_durs.json'), 'w'), indent=1)
    return durs


if __name__ == '__main__':
    d = render(); print(d)
    for k in ('main', 'short'): print(k, round(sum(v for n, v in d.items() if n.startswith(k + '_')), 1), 's of speech')
