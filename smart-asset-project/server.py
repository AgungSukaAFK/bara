import http.server, json, os, mimetypes, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(ROOT, 'db.json')
SEED_JSON = os.path.join(ROOT, 'data.json')

def load_db():
    if not os.path.exists(DB_FILE):
        assets = []
        if os.path.exists(SEED_JSON):
            try:
                assets = json.load(open(SEED_JSON, encoding='utf-8'))
            except Exception:
                assets = []
        db = {'assets': assets, 'locationMap': {}, 'codeFormats': [], 'version': 1}
        save_db(db)
        return db
    try:
        with open(DB_FILE, encoding='utf-8') as f:
            db = json.load(f)
        if not isinstance(db, dict):
            db = {'assets': [], 'locationMap': {}, 'codeFormats': [], 'version': 1}
        db.setdefault('assets', [])
        db.setdefault('locationMap', {})
        db.setdefault('codeFormats', [])
        db.setdefault('version', 1)
        return db
    except Exception:
        return {'assets': [], 'locationMap': {}, 'codeFormats': [], 'version': 1}

def save_db(db):
    with open(DB_FILE, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/db':
            db = load_db()
            data = json.dumps(db, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/db':
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length)
            try:
                db = json.loads(raw.decode('utf-8'))
                if not isinstance(db, dict):
                    raise ValueError('invalid')
                db.setdefault('assets', [])
                db.setdefault('locationMap', {})
                db.setdefault('codeFormats', [])
                db.setdefault('version', 1)
                save_db(db)
                resp = json.dumps({'ok': True}).encode('utf-8')
                self.send_response(200)
            except Exception as e:
                resp = json.dumps({'ok': False, 'error': str(e)}).encode('utf-8')
                self.send_response(400)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, *args):
        pass

if __name__ == '__main__':
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', '8000'))
    httpd = http.server.ThreadingHTTPServer((host, port), Handler)
    print(f'Smart Asset server running at http://localhost:{port}')
    if host == '0.0.0.0':
        print(f'For other devices on your network, use this computer\'s LAN IP on port {port}.')
    print('Press Ctrl+C to stop.')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
