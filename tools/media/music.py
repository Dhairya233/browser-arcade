"""Generates the default music bed: a slow, original ambient loop made from plain sine tones.

It has no licence conditions because it is synthesised here from nothing. To use a licensed track
instead, set MEDIA_MUSIC to the path of a wav or mp3 and build again (see docs/media/README.md).
"""
import subprocess, sys, wave
import numpy as np

SR = 44100
CHORDS = [  # Am, F, C, G (low root, then upper tones), 8 seconds each
    [110.00, 164.81, 220.00, 261.63, 329.63],
    [87.31, 130.81, 174.61, 220.00, 261.63],
    [130.81, 196.00, 261.63, 329.63, 392.00],
    [98.00, 146.83, 196.00, 246.94, 293.66],
]
BELLS = [440.00, 523.25, 587.33, 659.25, 783.99]


def make(path, seconds, seed=7):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR); t = np.arange(n) / SR
    out = np.zeros((2, n))
    seg = 8.0
    for k in range(int(seconds // seg) + 2):
        t0 = k * seg - 1.5; chord = CHORDS[k % 4]
        env = np.clip((t - t0) / 3.0, 0, 1) * np.clip((t0 + seg + 3.0 - t) / 3.0, 0, 1)
        env = np.sin(env * np.pi / 2) ** 2
        for j, f in enumerate(chord):
            for side, det in ((0, 1.0011), (1, 0.9989)):
                lfo = 1 + 0.15 * np.sin(2 * np.pi * (0.07 + 0.02 * j) * t + j)
                out[side] += env * lfo * np.sin(2 * np.pi * f * det * t) * (0.20 if j == 0 else 0.11)
    for k in range(int(seconds / 4.5)):                       # a few soft bell notes
        t0 = 3 + k * 4.5 + rng.uniform(-0.6, 0.6); f = BELLS[rng.integers(len(BELLS))]
        d = np.clip(t - t0, 0, None); e = np.where(t >= t0, np.exp(-d * 1.6) * (1 - np.exp(-d * 60)), 0)
        pan = rng.uniform(0.3, 0.7); s = e * np.sin(2 * np.pi * f * t) * 0.07
        out[0] += s * (1 - pan); out[1] += s * pan
    fade = np.clip(t / 2.0, 0, 1) * np.clip((seconds - t) / 3.0, 0, 1)
    out *= fade; out /= max(1e-9, np.abs(out).max()) / 0.8
    pcm = (out.T * 32767).astype('<i2')
    with wave.open(path + '.dry.wav', 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path + '.dry.wav', '-af',
                    'aecho=0.8:0.6:700|1100:0.35|0.25,lowpass=f=5000', '-map_metadata', '-1', path], check=True)


if __name__ == '__main__':
    make(sys.argv[1], float(sys.argv[2]))
