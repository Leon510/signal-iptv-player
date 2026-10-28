"""Testserver: statische Dateien mit Range-Support plus simulierte IPTV-Livestreams.

/stream/<datei>.ts?jitter=1&loop=1
  - schickt anfangs burst=<s> Sekunden Daten auf einmal (Standard 5, wie viele Restreamer)
  - danach Echtzeit-Takt nach Durchschnittsbitrate
  - mit jitter=1: alle ~8 s eine Pause von 1-2,5 s, danach den Rückstand als Burst
  - mit loop=1: Datei endlos wiederholen (Zeitstempel springen dann zurück, wie bei echten Streams)
"""
import os, re, sys, time, random, http.server, socketserver
from urllib.parse import urlparse, parse_qs

ROOT = sys.argv[1]
DURATION = 60.0  # Länge der Testdateien in Sekunden


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(s, *a):
        pass

    def do_GET(s):
        u = urlparse(s.path)
        if u.path.startswith('/stream/'):
            return s.stream(u)
        return super().do_GET()

    def stream(s, u):
        q = parse_qs(u.query)
        path = os.path.join(ROOT, 'live', os.path.basename(u.path))
        if not os.path.exists(path):
            s.send_error(404)
            return
        jitter = q.get('jitter', ['0'])[0] == '1'
        loop = q.get('loop', ['0'])[0] == '1'
        data = open(path, 'rb').read()
        rate = len(data) / DURATION  # Bytes pro Sekunde
        s.send_response(200)
        s.send_header('Content-Type', 'video/mp2t')
        s.end_headers()
        rnd = random.Random(42)
        pos = 0
        sent = 0
        start = time.time()
        burst = int(rate * float(q.get('burst', ['5'])[0]))
        next_pause = 8 + rnd.random() * 2
        try:
            while True:
                elapsed = time.time() - start
                target = burst + int(rate * elapsed)
                if jitter and elapsed > next_pause:
                    time.sleep(1.0 + rnd.random() * 1.5)
                    next_pause = time.time() - start + 7 + rnd.random() * 3
                    continue
                while sent < target:
                    n = min(target - sent, 65536 // 188 * 188)
                    if pos >= len(data):
                        if not loop:
                            return
                        pos = 0
                    chunk = data[pos:pos + n]
                    s.wfile.write(chunk)
                    pos += len(chunk)
                    sent += len(chunk)
                s.wfile.flush()
                time.sleep(0.1)
        except (BrokenPipeError, ConnectionResetError):
            return

    def send_head(s):
        path = s.translate_path(s.path.split('?')[0])
        if os.path.isdir(path) or not os.path.exists(path):
            return super().send_head()
        size = os.path.getsize(path)
        rng = s.headers.get('Range')
        f = open(path, 'rb')
        ctype = s.guess_type(path)
        if rng:
            m = re.match(r'bytes=(\d*)-(\d*)', rng)
            a = int(m.group(1) or 0)
            b = int(m.group(2)) if m.group(2) else size - 1
            s.send_response(206)
            s.send_header('Content-Range', f'bytes {a}-{b}/{size}')
            f.seek(a)
            s._len = b - a + 1
        else:
            s.send_response(200)
            s._len = size
        s.send_header('Content-Type', ctype)
        s.send_header('Accept-Ranges', 'bytes')
        s.send_header('Content-Length', str(s._len))
        s.end_headers()
        return f

    def copyfile(s, src, dst):
        left = getattr(s, '_len', None)
        if left is None:
            return super().copyfile(src, dst)
        while left > 0:
            b = src.read(min(65536, left))
            if not b:
                break
            try:
                dst.write(b)
            except Exception:
                break
            left -= len(b)


class T(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


T(('127.0.0.1', 8099), H).serve_forever()
