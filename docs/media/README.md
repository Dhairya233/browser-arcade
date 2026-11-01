# Demo media

Everything here is built by script from real runs of the real pages. Nothing is mocked, sped up or retimed.

| File | What it is |
|---|---|
| `browser-arcade-demo.mp4` | Main video, 1920x1080, 77 s, voiceover and music, no burned-in text |
| `browser-arcade-demo-captions.mp4` | Same video with captions burned in |
| `browser-arcade-demo.srt` | Captions for the main video |
| `browser-arcade-short.mp4` | Vertical 1080x1920 short, 31 s, captions burned in (`.srt` alongside) |
| `hero.gif` | 12 s loop of the hidden-information scene, 800 px wide, about 1.2 MB |
| `screens/` | Landing, each board, both lobbies, a phone shot of each game, and the reveal moment |
| `script.md`, `script-short.md` | Voiceover scripts with timings |

## What the footage shows, and what it does not

- **Pass-and-play and landing clips:** real mouse and keyboard input into the real pages, on one computer.
  The players are the fixed demo names Asha, Ben and Chen.
- **Setup is cut, not faked.** Long stretches of real play (placing the opening settlements, picking start
  stations) are shortened by cutting between real moments. The cuts are plain cuts; no clip is sped up.
- **Online clips are a local test setup.** Three browser windows run on one computer and find each other through
  a PeerJS signalling server started on that computer (`npx peer`). The pages, the PeerJS client and the
  WebRTC connections are the real ones, but the connections run over the computer's own loopback interface. The video says
  so on screen. It does **not** show two devices on different networks, NAT traversal or a relay server.
  The public PeerJS cloud was not reachable from the build machine.
- **The hidden-information scene** is a real run: the Phantom's page shows his piece and the detective's page,
  in the same game at the same moment, does not. The page counts were also checked in code during capture
  (`.media-cache/clips/clips.json`, `phantom_piece_absent_elsewhere`).
- **The live link on the end card is an assumption.** It is `https://dhairya233.github.io/browser-arcade/`,
  the address GitHub Pages would give a repository called `browser-arcade`. Until the site is deployed there,
  confirm it, or rebuild with `MEDIA_LIVE_URL=https://your-address/ python tools/media/make.py --build`.
- **Voiceover:** a synthetic voice (Piper, "ljspeech" medium, a public-domain recording). A paid voice would
  sound more natural. If you want one, replace the lines in `.media-cache/vo/` with your own recordings of
  the same text, named the same way (`main_hook.wav` and so on), and run `--build`.

## Loudness

Measured on the finished files with ffmpeg `ebur128`:

| File | Integrated | True peak | Range |
|---|---|---|---|
| `browser-arcade-demo.mp4` | -16.0 LUFS | -1.3 dBFS | 4.2 LU |
| `browser-arcade-short.mp4` | -16.1 LUFS | -1.3 dBFS | 4.5 LU |

The music is lowered automatically while the voice speaks (sidechain compression), then the mix is
normalised in two passes to -16 LUFS with a -1.5 dB true-peak ceiling. AAC encoding moves the peak by about
0.2 dB, which is why the file measures -1.3.

## Music

The default bed is **original**: `tools/media/music.py` synthesises it from sine tones, so it has no licence
conditions and needs no credit. If you would rather use a recorded track, these are the three candidates.
You choose and download; set `MEDIA_MUSIC` to the file and rebuild.

| # | Track | Licence | Notes |
|---|---|---|---|
| 1 | "Signal to Noise" by Scott Buckley (scottbuckley.com.au) | CC BY 4.0 | Mysterious, cinematic, solo cello and piano. Fits the Shadow Hunt mood. |
| 2 | "The Distant Sun" by Scott Buckley | CC BY 4.0 | Calm, slightly uneasy, strings and cello. |
| 3 | "Airport Lounge" by Kevin MacLeod (incompetech.com) | CC BY 4.0 | The title and licence were confirmed; **its mood was not**. Listen before choosing. |

Check the licence shown on each artist's own page when you download. I could not check the pages again after
the build.

CC BY 4.0 lets you use the track, including commercially, if you credit the artist. Full text:
https://creativecommons.org/licenses/by/4.0/

Credit lines to paste into the video description or the README if you use one:

- `"Signal to Noise" by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au`
- `"The Distant Sun" by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au`
- `Airport Lounge by Kevin MacLeod (incompetech.com) / Licensed under Creative Commons: By Attribution 4.0 / https://creativecommons.org/licenses/by/4.0/`

Cue sheet (same for any of them): fade in over 1.5 s from 0:00, play under the whole video, voice-led ducking
throughout, fade out over the last 3 s.

## Rebuild

Needs Python 3.10+, ffmpeg and ffprobe on the PATH, and Node (for `npx`).

```
pip install -r tools/media/requirements.txt
python -m playwright install chromium
```

The voice needs the Piper voice files, `en_US-ljspeech-medium.onnx` and its `espeak-ng-data` folder together
in one folder. Put them in `.media-cache/voice/` or point `PIPER_VOICE` at the folder. If `piper-tts` is in a
different Python from the one running the build, point `PIPER_PY` at it.

```
python tools/media/make.py            # record the footage, then build every file in docs/media
python tools/media/make.py --build    # re-render only (new voice, music, link or overlays), from the saved footage
```

On Windows PowerShell use `py` in place of `python`. Raw clips, voice lines and intermediate renders live in
`.media-cache/`, which git ignores. Fonts are the IBM Plex files in `shared/ui/fonts` (SIL OFL); the caption
variant converts two of them to a temporary TTF in the cache.

Other settings: `MEDIA_BASE` (site address, default `http://127.0.0.1:8780`), `MEDIA_MUSIC`,
`MEDIA_LIVE_URL`, `MEDIA_CACHE`.

## Not automatable

1. **Real two-device footage.** Needed before the site can claim "tested across devices" on video. Script:
   1. Laptop on home Wi-Fi, phone on mobile data (different networks). Screen-record the phone, and record the laptop
      with any screen recorder.
   2. Laptop: open the live site, Shadow Hunt, Online room, Create. Show the room code and the Copy invite link button.
   3. Phone: open the invite link the laptop made (send it by any chat app), type a name, Join. Show the lobby filling on both.
   4. Add a third player in another laptop tab, then Start. Everyone picks a start station.
   5. Play 20 to 30 seconds of real turns. Do not speed anything up.
   6. Mid-game, refresh the phone page and show it seating itself again.
   7. Keep the recordings unedited except for cuts, and note the network setup in the caption.
2. Choosing and downloading a recorded music track (section above), and adding its credit.
3. A paid voiceover, if wanted.
4. Confirming the live address, then rebuilding with `MEDIA_LIVE_URL`.
5. Uploading the video somewhere. The repository keeps the files; a video host is a separate choice.
