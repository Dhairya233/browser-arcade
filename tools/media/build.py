"""Builds every file in docs/media from the captured clips. One command: python3 tools/media/build.py

Reads the cache folder (.media-cache, ignored by git): clips from capture.py, voice lines from voice.py.
Nothing is sped up. Cuts are plain cuts of real footage; the last frame is held where a scene is
longer than its footage.
"""
import json, os, re, shutil, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import overlays, music, voice
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CACHE = voice.CACHE
OUT = os.path.join(ROOT, 'docs', 'media')
CLIPS = os.path.join(CACHE, 'clips'); OV = os.path.join(CACHE, 'ov'); TMP = os.path.join(CACHE, 'tmp'); SCR = os.path.join(OUT, 'screens')
LEAD, GAP, TAIL = 0.6, 0.3, 1.6
NIGHT, DAY = '0x14202B', '0xEEF0E8'
ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-bsf:v', 'filter_units=remove_types=6',
       '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1']


def run(*a):
    subprocess.run([str(x) for x in a], check=True, stderr=subprocess.DEVNULL if os.environ.get('MEDIA_QUIET') else None)


def ff(*a): run('ffmpeg', '-y', '-loglevel', 'error', *a)


def probe(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]))


# ------------------------------------------------------------------ scene definitions
# piece: ('clip', name, ss, dur|None) | ('pair', left, right, ss, dur|None) | ('still', png, dur|None, bg) | ('card', png, dur|None) | ('phones', [png, png], dur, bg)
def scenes_main(on):
    ph, det = on['phantom'], [k for k in on['others']][0]
    return [
        dict(id='hook', lines=['hook'], min=5.2, pieces=[('card', 'card_hook.png', None)], ov=[]),
        dict(id='land', lines=['land'], pieces=[('clip', 'landing', 0, None)], ov=[('lt_land.png', 1150, 130)]),
        dict(id='sh', lines=['sh', 'rev'], pieces=[('clip', 'sh_local', 3, 4.5), ('clip', 'sh_local', 12, 4.0), ('clip', 'sh_local', 27, None),
                                                     ('still', os.path.join(SCR, 'shadow-hunt-reveal.png'), 'line:rev', NIGHT)], ov=[('lt_sh.png', 64, 64)]),
        dict(id='got', lines=['got'], pieces=[('clip', 'got_local', 1, 3.5), ('clip', 'got_local', 10, 3.0), ('clip', 'got_local', -6, None)], ov=[('lt_got.png', 64, 64)]),
        dict(id='room', lines=['room'], pieces=[('pair', 'on_h', 'on_a', 9.0, None)],
             ov=[('tag_host.png', 40, 40), ('tag_join.png', 1000, 40), ('note_demo.png', 400, 990)]),
        dict(id='hide', lines=['hide'], pieces=[('pair', 'on_' + ph, 'on_' + det, 37.0, None)],
             ov=[('tag_phantom.png', 40, 40), ('tag_det.png', 1000, 40), ('note_demo.png', 400, 990)]),
        dict(id='how', lines=['how'], pieces=[('still', os.path.join(SCR, 'landing.png'), 3.4, DAY),
                                               ('phones', [os.path.join(SCR, 'shadow-hunt-mobile.png'), os.path.join(SCR, 'game-of-trades-mobile.png')], 3.6, NIGHT),
                                               ('still', os.path.join(SCR, 'shadow-hunt-lobby.png'), None, NIGHT)], ov=[('lt_how.png', 1150, 130)]),
        dict(id='end', lines=['end'], min=5.0, pieces=[('card', 'card_end.png', None)], ov=[]),
    ]


def scenes_short():
    return [
        dict(id='hook', lines=['hook'], min=3.6, pieces=[('card', 'card_hook_v.png', None)], ov=[]),
        dict(id='land', lines=[], min=4.6, pieces=[('clip', 'm_land', 0, None)], ov=[('lt_v.png', 40, 120)]),
        dict(id='sh', lines=['sh'], pieces=[('clip', 'm_sh', 0.6, None)], ov=[]),
        dict(id='got', lines=['got'], pieces=[('clip', 'm_got', 0.8, None)], ov=[]),
        dict(id='end', lines=['end'], min=4.8, pieces=[('card', 'card_end_v.png', None)], ov=[]),
    ]


# ------------------------------------------------------------------ video assembly
def piece_video(pc, d, out, size):
    W, H = size
    fit = 'scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=%s,setsar=1,fps=30,format=yuv420p'
    kind = pc[0]
    if kind == 'clip':
        _, name, ss, _d = pc; src = os.path.join(CLIPS, name + '.mp4')
        if ss < 0: ss = max(0, probe(src) + ss)
        ff('-ss', ss, '-i', src, '-vf', (fit % (W, H, W, H, NIGHT)) + ',tpad=stop_mode=clone:stop_duration=60', '-t', d, *ENC, out)
    elif kind == 'pair':
        _, l, r, ss, _d = pc
        ff('-ss', ss, '-i', os.path.join(CLIPS, l + '.mp4'), '-ss', ss, '-i', os.path.join(CLIPS, r + '.mp4'), '-filter_complex',
           '[0]scale=960:1080,setsar=1,fps=30[a];[1]scale=960:1080,setsar=1,fps=30[b];[a][b]hstack,format=yuv420p,tpad=stop_mode=clone:stop_duration=60[v]',
           '-map', '[v]', '-t', d, *ENC, out)
    elif kind in ('still', 'card'):
        png = pc[1] if kind == 'still' else os.path.join(OV, pc[1]); bg = pc[3] if kind == 'still' else NIGHT
        ff('-loop', '1', '-framerate', '30', '-i', png, '-vf', fit % (W, H, W, H, bg), '-t', d, *ENC, out)
    elif kind == 'phones':
        a, b = pc[1]
        ff('-loop', '1', '-framerate', '30', '-i', a, '-loop', '1', '-framerate', '30', '-i', b, '-filter_complex',
           '[0]scale=-1:900[a];[1]scale=-1:900[b];color=c=%s:s=%dx%d:r=30[bg];[bg][a]overlay=x=W/2-w-30:y=(H-h)/2:shortest=1[t];[t][b]overlay=x=W/2+30:y=(H-h)/2:shortest=1,format=yuv420p[v]'
           % (pc[3], W, H), '-map', '[v]', '-t', d, *ENC, out)


def build_video(kind, scenes, size, durs, name):
    os.makedirs(TMP, exist_ok=True)
    timeline = []; t = 0.0; segs = []
    for sc in scenes:
        lines = ['%s_%s' % (kind, l) for l in sc['lines']]
        starts = []; cur = LEAD
        for l in lines: starts.append(cur); cur += durs[l] + GAP
        speech_end = cur - GAP if lines else 0
        D = max(sc.get('min', 0), speech_end + TAIL if lines else 0)
        fixed = 0.0; flex = None
        for i, pc in enumerate(sc['pieces']):
            d = pc[-1] if pc[0] in ('clip', 'pair') else (pc[2] if pc[0] in ('still', 'card') else pc[2])
            if pc[0] == 'phones': d = pc[2]
            if d == 'line:rev': d = durs['%s_rev' % kind] + TAIL
            if d is None: flex = i
            else: fixed += d
        if flex is None: D = max(D, fixed)
        else: D = max(D, fixed + 1.0)
        files = []
        for i, pc in enumerate(sc['pieces']):
            d = pc[-1] if pc[0] in ('clip', 'pair') else pc[2]
            if d == 'line:rev': d = durs['%s_rev' % kind] + TAIL
            if d is None: d = round(D - fixed, 3)
            f = os.path.join(TMP, '%s_%s_%d.mp4' % (name, sc['id'], i)); piece_video(pc, d, f, size); files.append(f)
        lst = os.path.join(TMP, '%s_%s.txt' % (name, sc['id'])); open(lst, 'w').write(''.join("file '%s'\n" % f for f in files))
        base = os.path.join(TMP, '%s_%s_base.mp4' % (name, sc['id'])); ff('-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', base)
        # overlays and fades
        seg = os.path.join(TMP, '%s_%s.mp4' % (name, sc['id']))
        inputs = ['-i', base]; chain = '[0:v]'; fc = []
        for j, (png, x, y) in enumerate(sc['ov']):
            inputs += ['-loop', '1', '-framerate', '30', '-i', os.path.join(OV, png)]
            t_out = min(D - 0.4, 3.8) if png.startswith('lt') else D - 0.4
            fc.append('%s[%d:v]overlay=%d:%d:shortest=1:enable=\'between(t,%.2f,%.2f)\'[o%d]' % (chain, j + 1, x, y, 0.5, t_out, j)); chain = '[o%d]' % j
        fc.append('%sfade=t=in:st=0:d=0.3,fade=t=out:st=%.2f:d=0.3,format=yuv420p[v]' % (chain, D - 0.3))
        ff(*inputs, '-filter_complex', ';'.join(fc), '-map', '[v]', '-t', D, *ENC, seg)
        segs.append(seg)
        for l, s0 in zip(lines, starts): timeline.append((l, round(t + s0, 3), durs[l]))
        t += probe(seg)
    lst = os.path.join(TMP, name + '_all.txt'); open(lst, 'w').write(''.join("file '%s'\n" % s for s in segs))
    silent = os.path.join(TMP, name + '_silent.mp4'); ff('-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', silent)
    return silent, timeline, probe(silent)


# ------------------------------------------------------------------ audio and captions
def srt_time(x):
    h, r = divmod(x, 3600); m, s = divmod(r, 60); return '%02d:%02d:%02d,%03d' % (h, m, int(s), round((s - int(s)) * 1000) % 1000)


def make_srt(kind, timeline, path):
    script = {l['id']: l['text'] for l in json.load(open(os.path.join(HERE, 'script.json')))[kind]}
    cues = []
    for key, start, d in timeline:
        text = script[key.split('_', 1)[1]]
        sents = [s.strip() for s in re.findall(r'[^.!?]+[.!?]', text)]
        total = sum(len(s) for s in sents); t = start
        for s in sents:
            dd = d * len(s) / total; cues.append((t, t + dd - 0.02, s)); t += dd
    with open(path, 'w') as f:
        for i, (a, b, s) in enumerate(cues, 1): f.write('%d\n%s --> %s\n%s\n\n' % (i, srt_time(a), srt_time(b), s))
    return cues


def build_audio(kind, timeline, total, name):
    ins = []; parts = []
    for i, (key, start, d) in enumerate(timeline):
        ins += ['-i', os.path.join(CACHE, 'vo', key + '.wav')]
        parts.append('[%d]aresample=44100,aformat=channel_layouts=stereo,adelay=%d|%d[v%d]' % (i, start * 1000, start * 1000, i))
    n = len(timeline)
    fc = ';'.join(parts) + ';' + ''.join('[v%d]' % i for i in range(n)) + 'amix=inputs=%d:normalize=0,apad=whole_dur=%.2f[vo]' % (n, total)
    vo = os.path.join(TMP, name + '_vo.wav'); ff(*ins, '-filter_complex', fc, '-t', total, '-map', '[vo]', vo)
    mus = os.environ.get('MEDIA_MUSIC')
    bed = os.path.join(TMP, name + '_music.wav')
    if mus: ff('-i', mus, '-t', total, '-af', 'afade=t=in:d=1.5,afade=t=out:st=%.2f:d=3' % (total - 3), bed)
    else: music.make(bed, total)
    mix = os.path.join(TMP, name + '_mix.wav')
    ff('-i', bed, '-i', vo, '-filter_complex',
       '[0]volume=0.55[m];[1]asplit[v1][v2];[m][v1]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=700:makeup=1[d];[d][v2]amix=inputs=2:normalize=0[o]', '-map', '[o]', '-t', total, mix)
    # two-pass loudness normalisation to -16 LUFS integrated, true peak at most -1.5 dB
    p1 = subprocess.run(['ffmpeg', '-hide_banner', '-i', mix, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
    m = json.loads(p1[p1.rindex('{'):])
    final = os.path.join(TMP, name + '_final.wav')
    ff('-i', mix, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s:linear=true' %
       (m['input_i'], m['input_tp'], m['input_lra'], m['input_thresh'], m['target_offset']), '-ar', '44100', final)
    return final


def measure(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    tail = r[r.rindex('Summary:'):]
    return dict(integrated=re.search(r'I:\s+(-?[\d.]+) LUFS', tail).group(1), lra=re.search(r'LRA:\s+([\d.]+) LU', tail).group(1), true_peak=re.search(r'Peak:\s+(-?[\d.]+) dBFS', tail).group(1))


def fonts_ttf():
    from fontTools.ttLib import TTFont
    d = os.path.join(CACHE, 'fonts'); os.makedirs(d, exist_ok=True)
    for w in ('400', '600'):
        out = os.path.join(d, 'plex-%s.ttf' % w)
        if not os.path.exists(out):
            f = TTFont(os.path.join(ROOT, 'shared', 'ui', 'fonts', 'ibm-plex-sans-latin-%s-normal.woff2' % w)); f.flavor = None; f.save(out)
    return d


def mux(silent, audio, out, srt=None, vertical=False):
    vf = []
    if srt:
        st = "FontName=IBM Plex Sans,Bold=1,FontSize=%d,PrimaryColour=&H00F0EDE8,OutlineColour=&H00302014,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=%d" % ((15, 330) if vertical else (22, 40))[0:2] if False else None
        size, mv = (10, 40) if vertical else (12, 12)
        st = "FontName=IBM Plex Sans,Bold=1,FontSize=%d,PrimaryColour=&H00F0EDE8,OutlineColour=&H002B2014,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=%d,MarginL=60,MarginR=60" % (size, mv)
        vf = ['-vf', "subtitles=%s:fontsdir=%s:force_style='%s'%s" % (srt, fonts_ttf(), st, ':original_size=1080x1920' if vertical else ':original_size=1920x1080')]
        ff('-i', silent, '-i', audio, *vf, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-bsf:v', 'filter_units=remove_types=6',
           '-c:a', 'aac', '-b:a', '160k', '-shortest', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', '-map_metadata', '-1', '-movflags', '+faststart', out)
    else:
        ff('-i', silent, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-fflags', '+bitexact', '-flags:a', '+bitexact',
           '-map_metadata', '-1', '-movflags', '+faststart', out)


def scrub(path):
    """Remux without any encoder tags so the files carry no tool strings."""
    tmp = path + '.tmp.mp4'
    ff('-i', path, '-c', 'copy', '-map_metadata', '-1', '-metadata:s:v:0', 'encoder=', '-bitexact', '-movflags', '+faststart', tmp); os.replace(tmp, path)


def hero_gif(src, out, start=36.0, dur=12.0):
    pal = os.path.join(TMP, 'pal.png')
    vf = 'fps=12,scale=800:-1:flags=lanczos'
    ff('-ss', start, '-t', dur, '-i', src, '-vf', vf + ',palettegen=max_colors=96:stats_mode=diff', pal)
    ff('-ss', start, '-t', dur, '-i', src, '-i', pal, '-lavfi', vf + '[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4', '-map_metadata', '-1', '-fflags', '+bitexact', out)


def main():
    os.makedirs(OUT, exist_ok=True); shutil.rmtree(TMP, ignore_errors=True); os.makedirs(TMP)
    overlays.build(OV)
    durs = voice.render()
    on = json.load(open(os.path.join(CLIPS, 'clips.json')))['online']
    report = {}
    for kind, scenes, size, base in (('main', scenes_main(on), (1920, 1080), 'browser-arcade-demo'), ('short', scenes_short(), (1080, 1920), 'browser-arcade-short')):
        silent, timeline, total = build_video(kind, scenes, size, durs, kind)
        audio = build_audio(kind, timeline, total, kind)
        srt = os.path.join(OUT, base + '.srt'); make_srt(kind, timeline, srt)
        if kind == 'main':
            mux(silent, audio, os.path.join(OUT, base + '.mp4'))
            mux(silent, audio, os.path.join(OUT, base + '-captions.mp4'), srt=srt)
            hs = [st for k, st, d in timeline if k == 'main_hide'][0] - 3.0   # the hidden-information scene
            hero_gif(os.path.join(OUT, base + '.mp4'), os.path.join(OUT, 'hero.gif'), start=hs)
        else:
            mux(silent, audio, os.path.join(OUT, base + '.mp4'), srt=srt, vertical=True)
        scr = {l['id']: l['text'] for l in json.load(open(os.path.join(HERE, 'script.json')))[kind]}
        with open(os.path.join(OUT, ('script.md' if kind == 'main' else 'script-short.md')), 'w') as f:
            f.write('# Voiceover script, %s (%.0f s)\n\nVoice: Piper, en_US ljspeech medium. Times are seconds from the start of the video.\n\n| Start | End | Line |\n|---|---|---|\n' % (base, total))
            for key, st, d in timeline: f.write('| %.1f | %.1f | %s |\n' % (st, st + d, scr[key.split('_', 1)[1]]))
        for f in os.listdir(OUT):
            if f.endswith('.mp4') and f.startswith(base): scrub(os.path.join(OUT, f))
        report[base] = dict(duration=round(total, 1), loudness=measure(os.path.join(OUT, base + '.mp4')), timeline=timeline)
    json.dump(report, open(os.path.join(CACHE, 'report.json'), 'w'), indent=1)
    for k, v in report.items(): print(k, v['duration'], 's', v['loudness'])
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == '__main__':
    main()
