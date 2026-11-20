import os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'engine'))
os.environ['NEONCLIPPING_DATA_DIR'] = tempfile.mkdtemp()
os.environ.pop('NEONCLIPPING_LAN', None)
from fastapi.testclient import TestClient
import app as A

c = TestClient(A.app, base_url='http://127.0.0.1:8770', client=('127.0.0.1', 5000))


def test_ping_only_for_autoclip_site():
    ok = c.get('/ping', headers={'Origin': 'https://winplaybox.github.io'})
    assert ok.json()['desktop'] == 'autoclip'
    assert ok.headers['access-control-allow-origin'] == 'https://winplaybox.github.io'
    bad = c.get('/ping', headers={'Origin': 'https://evil.example'})
    assert 'access-control-allow-origin' not in bad.headers
    sneaky = c.get('/ping', headers={'Origin': 'https://winplaybox.github.io.evil.com'})
    assert 'access-control-allow-origin' not in sneaky.headers


def test_rebinding_host_blocked():
    assert c.get('/api/ai', headers={'Host': 'evil.com'}).status_code == 403


def test_cross_site_write_blocked():
    r = c.post('/api/ai', json={'provider': 'gemini', 'key': 'k'}, headers={'Origin': 'https://evil.com'})
    assert r.status_code == 403


def test_own_page_can_write():
    r = c.post('/api/ai', json={'provider': 'nope', 'key': 'k'}, headers={'Origin': 'http://127.0.0.1:8770'})
    assert r.status_code == 400   # reaches the handler (validation), not the guard
