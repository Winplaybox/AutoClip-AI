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


def test_fonts_route_only_serves_woff2_files():
    ok = c.get('/fonts/instrument-sans-latin-400-normal.woff2')
    assert ok.status_code == 200 and ok.headers['content-type'] == 'font/woff2'
    assert c.get('/fonts/../app.py').status_code in (404, 422)
    assert c.get('/fonts/nope.woff2').status_code == 404
    assert c.get('/fonts/app.py').status_code == 404


def test_brand_has_no_neonclipping_in_ui():
    html = c.get('/').text
    assert 'AutoClip' in html and 'NeonClipping' not in html and 'NEONCLIPPING' not in html
    assert 'googleapis' not in html and 'googleapis' not in c.get('/assets/style.css').text


def test_about_shows_licence():
    r = c.get('/about')
    assert r.status_code == 200 and 'MIT' in r.text and 'Ajay K Meena' in r.text


def test_donate_accepts_only_live_dodo_links(monkeypatch, tmp_path):
    import json
    monkeypatch.setattr(A, 'ROOT', tmp_path)
    def put(url):
        (tmp_path / 'donate.json').write_text(json.dumps({'dodo': url, 'goal': 10000, 'currency': 'inr'}))
        return c.get('/donate').json()
    good = put('https://checkout.dodopayments.com/buy/pdt_123')
    assert good['dodo'].startswith('https://checkout.dodopayments.com') and good['goal'] == 10000 and good['currency'] == 'INR'
    for bad in ('https://test.checkout.dodopayments.com/buy/x', 'https://evil.com/dodopayments.com',
                'https://dodopayments.com.evil.com/x', 'http://checkout.dodopayments.com/x', 'javascript:alert(1)'):
        assert 'dodo' not in put(bad), bad
