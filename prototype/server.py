#!/usr/bin/env python3
"""
Hot-reload dev server for prototype files.
Serves on 0.0.0.0:28001 with auto-reload when files change.
Zero dependencies -- Python stdlib only.

Usage:
    python3 server.py                  # default: 0.0.0.0:28001
    python3 server.py 3000             # custom port
    python3 server.py 3000 127.0.0.1   # custom port + host

Gotchas:
    - server.py itself is NOT watched; after editing server.py, restart manually.
    - Browser may spam /service-worker.js (PWA probe) -- harmless 404.
    - Directory URLs (/subdir/) auto-resolve to index.html with livereload.
"""
import http.server
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Files/dirs ignored by the file watcher
IGNORE_PARTS = {'.git', '__pycache__', '.DS_Store',
                'node_modules', 'server.py', 'start.sh',
                'package.json', 'package-lock.json'}

NOISE_PATHS = {'/service-worker.js', '/favicon.ico'}

# Live-reload snippet injected before </body> (or </head> as fallback)
LIVERELOAD_SCRIPT = (
    b'<script>'
    b'(function(){var t=0;'
    b'setInterval(function(){'
    b'fetch("/__reload").then(function(r){return r.json()}).then(function(d){'
    b'if(d.reload&&t>0)location.reload();t++'
    b'}).catch(function(){})'
    b'},800)'
    b'})();'
    b'</script>'
)

# Global: max mtime across all files
_latest_mtime = 0.0


def scan_mtime() -> float:
    """Walk ROOT and return the most recent file mtime (ignoring noise files)."""
    max_mt = 0.0
    for p in ROOT.rglob('*'):
        if not p.is_file():
            continue
        for part in p.relative_to(ROOT).parts:
            if part in IGNORE_PARTS:
                break
        else:
            mt = p.stat().st_mtime
            if mt > max_mt:
                max_mt = mt
    return max_mt


class Handler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        # -- reload check endpoint --
        if self.path.startswith('/__reload'):
            global _latest_mtime
            current = scan_mtime()
            changed = current > _latest_mtime
            _latest_mtime = current
            body = json.dumps({'reload': changed}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        clean = self.path.split('?')[0]
        fs_path = self.translate_path(clean)

        if os.path.isdir(fs_path):
            if os.path.isfile(os.path.join(fs_path, 'index.html')):
                return self._serve_html_with_reload(clean)

        if clean.endswith('.html'):
            return self._serve_html_with_reload(clean)

        super().do_GET()

    def _serve_html_with_reload(self, path: str):
        fs_path = self.translate_path(path)
        if os.path.isdir(fs_path):
            fs_path = os.path.join(fs_path, 'index.html')
        if not os.path.isfile(fs_path):
            return self.send_error(404, 'File not found')
        try:
            with open(fs_path, 'rb') as fh:
                content = fh.read()
        except OSError as e:
            return self.send_error(500, str(e))

        # Only inject if it looks like HTML
        head = content[:512]
        if b'<html' in head.lower() or b'<!doctype' in head.lower() or b'<head' in head.lower():
            # Prefer </body>, fallback to </head>
            if b'</body>' in content:
                content = content.replace(b'</body>', LIVERELOAD_SCRIPT + b'</body>', 1)
            elif b'</head>' in content:
                content = content.replace(b'</head>', LIVERELOAD_SCRIPT + b'</head>', 1)
            else:
                content += LIVERELOAD_SCRIPT

        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format, *args):
        if '/__reload' in str(args[0]):
            return
        if any(n in str(args[0]) for n in NOISE_PATHS):
            return
        sys.stderr.write('[%s] %s\n' % (self.log_date_time_string(), format % args))


if __name__ == '__main__':
    _latest_mtime = scan_mtime()

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 28001
    host = sys.argv[2] if len(sys.argv) > 2 else '0.0.0.0'

    server = http.server.HTTPServer((host, port), Handler)
    print(f'Prototype server: http://{host}:{port}')
    print(f'Serving: {ROOT}')
    print(f'Hot reload: on (poll 800 ms)')
    print(f'Stop: Ctrl+C')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
        server.server_close()
