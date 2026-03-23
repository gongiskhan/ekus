"""Simple HTTPS reverse proxy to the HTTP gateway on port 7600.
Run alongside main.py to provide HTTPS on port 7443 for browser mic access.
"""
import ssl
import http.server
import urllib.request
from pathlib import Path

CERT_DIR = Path(__file__).parent / "certs"
TARGET = "http://127.0.0.1:7600"

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_request(self):
        url = f"{TARGET}{self.path}"
        headers = {k: v for k, v in self.headers.items()}
        body = None
        if cl := self.headers.get("Content-Length"):
            body = self.rfile.read(int(cl))
        req = urllib.request.Request(url, data=body, headers=headers, method=self.command)
        try:
            with urllib.request.urlopen(req) as resp:
                self.send_response(resp.status)
                for k, v in resp.getheaders():
                    if k.lower() not in ('transfer-encoding', 'connection'):
                        self.send_header(k, v)
                self.end_headers()
                self.wfile.write(resp.read())
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            for k, v in e.headers.items():
                if k.lower() not in ('transfer-encoding', 'connection'):
                    self.send_header(k, v)
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(f"Proxy error: {e}".encode())

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = do_request

    def log_message(self, format, *args):
        pass  # Quiet

if __name__ == "__main__":
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(CERT_DIR / "cert.pem"), str(CERT_DIR / "key.pem"))
    server = http.server.HTTPServer(("0.0.0.0", 7443), ProxyHandler)
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    print("HTTPS proxy running on https://0.0.0.0:7443 -> http://127.0.0.1:7600")
    server.serve_forever()
