#!/usr/bin/env python3
"""Erzeugt alle Testmedien und Test-Playlisten für die automatischen Tests und Screenshots.

Aufruf:   python3 scripts/make-test-media.py <zielordner> [basis-url]
Beispiel: python3 scripts/make-test-media.py test-media http://127.0.0.1:8099
Danach:   python3 test/testserver.py test-media

Voraussetzungen: ffmpeg im PATH, Python 3.9+ mit Pillow (pip install pillow).
Alle Inhalte sind synthetisch (Testbilder, Sinustöne, ausgedachte Sender und Titel).
"""
import datetime as dt
import gzip
import os
import random
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'test-media')
B = (sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:8099').rstrip('/')
os.makedirs(OUT, exist_ok=True)


def p(*parts):
    path = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def ff(*args):
    if not shutil.which('ffmpeg'):
        sys.exit('ffmpeg wurde nicht gefunden. Bitte installieren und in den PATH aufnehmen.')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *args], check=True)


def font(size):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'C:/Windows/Fonts/segoeuib.ttf',
              '/System/Library/Fonts/Supplemental/Arial Bold.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def step(msg):
    print('•', msg, flush=True)


# ---------- Videos ----------
step('Livestreams (MPEG-TS, HLS)')
ff('-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
   '-t', '40', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '50', '-c:a', 'aac',
   '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', p('hls.m3u8'))
ff('-f', 'lavfi', '-i', 'smptebars=size=1280x720:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
   '-t', '60', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mpegts', p('live.ts'))
# 3 Mbit/s mit drei Tonspuren (AC-3 deutsch, AAC deutsch, AAC englisch)
ff('-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25,noise=alls=12:allf=t',
   '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
   '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '60',
   '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a',
   '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '3M', '-maxrate', '3M', '-bufsize', '3M', '-g', '50', '-pix_fmt', 'yuv420p',
   '-c:a:0', 'ac3', '-b:a:0', '192k', '-c:a:1', 'aac', '-b:a:1', '128k', '-c:a:2', 'aac', '-b:a:2', '128k',
   '-metadata:s:a:0', 'language=deu', '-metadata:s:a:1', 'language=deu', '-metadata:s:a:2', 'language=eng',
   '-mpegts_flags', '+resend_headers', '-f', 'mpegts', p('live', 'multi.ts'))
ff('-i', p('live', 'multi.ts'), '-map', '0:v', '-map', '0:a:1', '-c', 'copy', '-f', 'mpegts', p('live', 'aac.ts'))
ff('-i', p('live', 'multi.ts'), '-map', '0:v', '-map', '0:a', '-c', 'copy', '-mpegts_flags', 'system_b', '-f', 'mpegts',
   p('live', 'multi_dvb.ts'))
os.makedirs(p('hlsmulti', 'x'), exist_ok=True)
ff('-i', p('live', 'multi.ts'), '-t', '40', '-map', '0:v', '-map', '0:a:1', '-map', '0:a:2', '-c:v', 'copy', '-c:a', 'copy',
   '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_segment_filename', p('hlsmulti', 'seg_%v_%03d.ts'),
   '-master_pl_name', 'master.m3u8',
   '-var_stream_map', 'v:0,agroup:aud a:0,agroup:aud,language:deu,name:Deutsch,default:yes a:1,agroup:aud,language:eng,name:English',
   p('hlsmulti', 'stream_%v.m3u8'))
os.rmdir(p('hlsmulti', 'x'))

step('Filme und Serienfolgen')


def clip(src, freq, secs, out):
    ff('-f', 'lavfi', '-i', f'{src}=size=960x540:rate=25', '-f', 'lavfi', '-i', f'sine=frequency={freq}:sample_rate=48000',
       '-t', str(secs), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
       '-movflags', '+faststart', out)


clip('testsrc2', 300, 90, p('movie', 'u', 'p', '101.mp4'))
clip('smptehdbars', 350, 90, p('movie', 'u', 'p', '102.mkv'))
clip('rgbtestsrc', 400, 20, p('series', 'u', 'p', '201.mp4'))
clip('testsrc', 450, 20, p('series', 'u', 'p', '202.mp4'))
clip('testsrc2', 500, 20, p('series', 'u', 'p', '203.mp4'))
for ext in ('mp4', 'mkv'):
    ff('-i', p('live', 'multi.ts'), '-t', '60', '-map', '0:v', '-map', '0:a:1', '-map', '0:a:2', '-c', 'copy',
       '-metadata:s:a:0', 'language=deu', '-metadata:s:a:1', 'language=eng',
       *(['-movflags', '+faststart'] if ext == 'mp4' else []), p('movie', 'u', 'p', f'10{3 if ext == "mp4" else 4}.{ext}'))

# ---------- Bilder ----------
step('Logos und Poster')
for name, col in [('a', (220, 60, 60)), ('b', (60, 140, 230)), ('c', (250, 250, 250))]:
    im = Image.new('RGBA', (200, 120), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle([10, 20, 190, 100], 20, fill=col)
    im.save(p(f'logo_{name}.png'))
POSTER_COLS = [(40, 70, 120), (120, 40, 60), (30, 90, 70), (90, 60, 130), (140, 100, 30)]
for i, c in enumerate(POSTER_COLS):
    im = Image.new('RGB', (400, 600), c)
    d = ImageDraw.Draw(im)
    for k in range(0, 600, 40):
        d.line([(0, k), (400, k + 200)], fill=tuple(min(255, x + 25) for x in c), width=12)
    d.text((30, 480), f'Poster {i + 1}', fill=(255, 255, 255), font=font(48))
    im.save(p('posters', f'p{i}.jpg'), quality=85)

# Demo-Daten für Screenshots: ausgedachte Sender und Titel
DEMO_CHANNELS = [
    ('Nordlicht', (64, 132, 222)), ('Kanal Mitte', (226, 88, 72)), ('Elbe TV', (46, 160, 120)),
    ('Weitblick', (240, 176, 60)), ('Prisma', (150, 92, 220)), ('Stadtfunk', (230, 110, 160)),
    ('Wissen+', (70, 170, 200)), ('Sportzeit', (60, 190, 90)), ('Kino Eins', (200, 60, 80)),
    ('Klassik HD', (180, 150, 110)), ('Kinderland', (250, 140, 50)), ('Reportage 24', (110, 120, 140)),
    ('Musikwelle', (230, 70, 140)), ('Doku Plus', (90, 150, 110)), ('Krimi Kanal', (120, 90, 80)),
    ('Wetterblick', (80, 160, 230)),
]
for i, (name, col) in enumerate(DEMO_CHANNELS):
    im = Image.new('RGBA', (240, 140), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([8, 18, 232, 122], 26, fill=col)
    letters = ''.join(w[0] for w in name.replace('+', ' ').split()[:2]).upper()
    f = font(56)
    w = d.textlength(letters, font=f)
    d.text(((240 - w) / 2, 38), letters, fill=(255, 255, 255), font=f)
    im.save(p('demo', f'logo{i}.png'))
DEMO_MOVIES = ['Der stille Hafen', 'Nachtzug nach Norden', 'Glas und Stein', 'Die letzte Welle', 'Sommer in Blau',
               'Kurs Süd', 'Das helle Haus', 'Funkstille', 'Am Rand der Karte', 'Zwischen den Gleisen',
               'Grünes Licht', 'Die Kartografin']
for i, title in enumerate(DEMO_MOVIES):
    c1 = POSTER_COLS[i % 5]
    c2 = tuple(max(0, x - 50) for x in c1)
    im = Image.new('RGB', (400, 600), c1)
    d = ImageDraw.Draw(im)
    for y in range(600):
        t = y / 600
        d.line([(0, y), (400, y)], fill=tuple(int(a * (1 - t) + b * t) for a, b in zip(c1, c2)))
    d.ellipse([60 + (i * 37) % 120, 90 + (i * 53) % 140, 300 + (i * 37) % 120, 330 + (i * 53) % 140],
              fill=tuple(min(255, x + 60) for x in c1))
    f = font(38)
    words, lines, cur = title.split(), [], ''
    for w in words:
        if d.textlength((cur + ' ' + w).strip(), font=f) > 340:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + ' ' + w).strip()
    lines.append(cur)
    for k, ln in enumerate(lines):
        d.text((30, 470 - (len(lines) - 1 - k) * 46), ln, fill=(255, 255, 255), font=f)
    im.save(p('demo', f'poster{i}.jpg'), quality=88)

# ---------- Programmführer ----------
step('Programmführer (XMLTV)')
SHOWS = ['Nachrichten', 'Wetter', 'Magazin am Abend', 'Doku: Küstenwelten', 'Spielfilm: Der stille Hafen',
         'Quiz um Acht', 'Talk am Morgen', 'Krimi: Die Spur im Schnee', 'Reportage: Unterwegs', 'Live: Sport am Sonntag',
         'Kochen mit Freunden', 'Musik bei Nacht', 'Wissen kompakt', 'Serie: Haus am See']
TZ = dt.timezone(dt.timedelta(hours=1))
now = dt.datetime.now(dt.timezone.utc)
start = (now - dt.timedelta(hours=6)).replace(minute=0, second=0, microsecond=0)
fmt = lambda t: t.astimezone(TZ).strftime('%Y%m%d%H%M%S +0100')
esc = lambda s: s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def xmltv(channel_ids, path, seed):
    rnd = random.Random(seed)
    x = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="signal-test">']
    for cid, name in channel_ids:
        x.append(f'  <channel id="{cid}"><display-name lang="de">{esc(name)}</display-name></channel>')
    for cid, _ in channel_ids:
        t = start
        while t < now + dt.timedelta(hours=54):
            d = dt.timedelta(minutes=rnd.choice([15, 30, 45, 60, 90, 105]))
            title = rnd.choice(SHOWS)
            x.append(f'  <programme start="{fmt(t)}" stop="{fmt(t + d)}" channel="{cid}"><title lang="de">{esc(title)}</title>'
                     f'<sub-title>Folge {rnd.randint(1, 300)}</sub-title><desc lang="de">Beschreibung zu „{esc(title)}“ '
                     f'– mit Umlauten äöü &amp; Sonderzeichen &lt;ok&gt;.</desc></programme>')
            t += d
    x.append('</tv>')
    with gzip.open(path, 'wt', encoding='utf-8') as f:
        f.write('\n'.join(x))


EPG_NAMES = ['Das Erste', 'ZDF', 'RTL', 'SAT.1', 'ProSieben', 'VOX', 'kabel eins', 'RTLZWEI', 'arte', '3sat', 'Phoenix',
             'tagesschau24', 'ZDFneo', 'ZDFinfo', 'KiKA', 'n-tv', 'WELT', 'Sport1', 'Eurosport 1', 'DMAX', 'Tele 5', 'sixx',
             'ProSieben MAXX', 'SAT.1 Gold', 'Nitro', 'Comedy Central', 'NDR Fernsehen', 'WDR', 'BR Fernsehen', 'SWR']
cid = lambda n: n.replace(' ', '').replace('.', '') + '.de'
xmltv([(cid(n), n) for n in EPG_NAMES], p('epg', 'guide.xml.gz'), 7)
xmltv([(f'demo{i}', n) for i, (n, _) in enumerate(DEMO_CHANNELS)], p('epg', 'demo.xml.gz'), 11)

# ---------- Playlisten ----------
step('Playlisten')


def write(name, lines):
    with open(p(name), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


test = ['#EXTM3U',
        f'#EXTINF:-1 tvg-logo="{B}/logo_a.png" group-title="Deutschland",Testbild HLS', f'{B}/hls.m3u8',
        f'#EXTINF:-1 tvg-logo="{B}/logo_b.png" group-title="Deutschland",Farbbalken TS', f'{B}/live.ts',
        f'#EXTINF:-1 tvg-logo="{B}/missing.png" group-title="Sport",Kaputter Sender', f'{B}/gibtsnicht.m3u8']
for i in range(1, 301):
    g = 'Sport' if i % 3 == 0 else 'Nachrichten' if i % 3 == 1 else 'Filme & Serien'
    test += [f'#EXTINF:-1 tvg-logo="{B}/logo_c.png" group-title="{g}",Sender {i} HD', f'{B}/live.ts?ch={i}']
write('test.m3u', test)

full = list(test)
full += [f'#EXTINF:-1 tvg-logo="{B}/posters/p0.jpg" group-title="VOD | Action",Der Testlauf (2024)', f'{B}/movie/u/p/101.mp4',
         f'#EXTINF:-1 tvg-logo="{B}/posters/p1.jpg" group-title="VOD | Drama",Farbbalken der Nacht (2019)', f'{B}/movie/u/p/102.mkv',
         '#EXTINF:-1 group-title="VOD | Drama",Ein Film ohne Poster', f'{B}/movie/u/p/101.mp4?x=3']
for k in range(1, 41):
    full += [f'#EXTINF:-1 tvg-logo="{B}/posters/p{k % 5}.jpg" group-title="VOD | Komödie",Komödie Nummer {k} ({1990 + k})',
             f'{B}/movie/u/p/101.mp4?k={k}']
full += [f'#EXTINF:-1 tvg-logo="{B}/posters/p2.jpg" group-title="Serien | Deutsch",Testserie S01 E01 - Der Anfang', f'{B}/series/u/p/201.mp4',
         f'#EXTINF:-1 tvg-logo="{B}/posters/p2.jpg" group-title="Serien | Deutsch",Testserie S01 E02 - Die Mitte', f'{B}/series/u/p/202.mp4',
         f'#EXTINF:-1 tvg-logo="{B}/posters/p2.jpg" group-title="Serien | Deutsch",Testserie S02 E01 - Neue Staffel', f'{B}/series/u/p/203.mp4',
         f'#EXTINF:-1 tvg-logo="{B}/posters/p3.jpg" group-title="Serien | English",Another Show S01E01', f'{B}/series/u/p/201.mp4?a=1',
         '#EXTINF:-1 group-title="Serien | English",Posterless Show S01E01', f'{B}/series/u/p/202.mp4?b=1']
write('full.m3u', full)

write('bench.m3u', ['#EXTM3U',
                    '#EXTINF:-1 group-title="Test",Schwankendes Netz', f'{B}/stream/aac.ts?jitter=1',
                    '#EXTINF:-1 group-title="Test",Endlosschleife', f'{B}/stream/aac.ts?loop=1',
                    '#EXTINF:-1 group-title="Test",Mehrspur ATSC', f'{B}/stream/multi.ts',
                    '#EXTINF:-1 group-title="Test",Mehrspur DVB', f'{B}/stream/multi_dvb.ts'])
write('bench2.m3u', ['#EXTM3U',
                     '#EXTINF:-1 group-title="Test",Ohne Vorpuffer, schwankend', f'{B}/stream/aac.ts?jitter=1&burst=0',
                     '#EXTINF:-1 group-title="Test",Großer Burst', f'{B}/stream/aac.ts?burst=12',
                     '#EXTINF:-1 group-title="Test",Endlosschleife', f'{B}/stream/aac.ts?loop=1&burst=0'])
write('audio.m3u', ['#EXTM3U',
                    '#EXTINF:-1 group-title="Test",Mehrspur DVB', f'{B}/stream/multi_dvb.ts?loop=1',
                    '#EXTINF:-1 group-title="Test",HLS Mehrspur', f'{B}/hlsmulti/master.m3u8',
                    '#EXTINF:-1 group-title="VOD | Test",Film MP4 zweisprachig (2024)', f'{B}/movie/u/p/103.mp4',
                    '#EXTINF:-1 group-title="VOD | Test",Film MKV zweisprachig (2023)', f'{B}/movie/u/p/104.mkv'])

epg_a = [f'#EXTM3U url-tvg="{B}/epg/guide.xml.gz"']
for i, n in enumerate(EPG_NAMES):
    tid = f'tvg-id="{cid(n)}" ' if i % 3 != 2 else ''
    disp = f'DE: {n} HD' if i % 2 == 0 else n
    grp = 'Vollprogramm' if i < 12 else 'Spartensender'
    epg_a += [f'#EXTINF:-1 {tid}tvg-logo="{B}/logo_c.png" group-title="{grp}",{disp}', f'{B}/stream/aac.ts?burst=3&ch={i}']
write('epg_a.m3u', epg_a)
epg_b = ['#EXTM3U']
for i, n in enumerate(['CNN International', 'BBC World News', 'France 24', 'Al Jazeera English', 'DW English', 'Euronews']):
    epg_b += [f'#EXTINF:-1 tvg-logo="{B}/logo_b.png" group-title="International",{n}', f'{B}/stream/aac.ts?burst=3&b={i}']
epg_b += ['#EXTINF:-1 group-title="VOD | Kino",Ein Film nur in Playlist B (2022)', f'{B}/movie/u/p/101.mp4?b=1']
write('epg_b.m3u', epg_b)

demo = [f'#EXTM3U url-tvg="{B}/epg/demo.xml.gz"']
for i, (n, _) in enumerate(DEMO_CHANNELS):
    grp = 'Vollprogramm' if i < 6 else 'Wissen & Doku' if n in ('Wissen+', 'Reportage 24', 'Doku Plus', 'Wetterblick') else 'Unterhaltung'
    demo += [f'#EXTINF:-1 tvg-id="demo{i}" tvg-logo="{B}/demo/logo{i}.png" group-title="{grp}",{n}',
             f'{B}/stream/aac.ts?burst=3&demo={i}']
for i, t in enumerate(DEMO_MOVIES):
    demo += [f'#EXTINF:-1 tvg-logo="{B}/demo/poster{i}.jpg" group-title="Filme | Drama",{t} ({2014 + i})',
             f'{B}/movie/u/p/101.mp4?demo={i}']
for k in range(1, 4):
    demo += [f'#EXTINF:-1 tvg-logo="{B}/demo/poster6.jpg" group-title="Serien",Haus am See S01 E0{k} - Folge {k}',
             f'{B}/series/u/p/20{k}.mp4?demo={k}']
write('demo.m3u', demo)

print(f'Fertig: {OUT}')
