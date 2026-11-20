import json, sys, os, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'engine'))
os.environ['NEONCLIPPING_DATA_DIR'] = tempfile.mkdtemp()
import pytest
import llm, smart


def test_no_key_means_no_byo():
    assert llm.active() is None
    assert smart._model() != 'byo'


def test_save_validates():
    for bad in [('nope', 'k'), ('gemini', ''), ('gemini', 'has space'), ('openai', 'x' * 500)]:
        with pytest.raises(ValueError):
            llm.save(*bad)


@pytest.mark.parametrize('prov', list(llm.PROVIDERS))
def test_each_provider_shape(prov, monkeypatch):
    seen = {}

    def fake(url, headers, body, timeout=90):
        seen['url'], seen['headers'] = url, headers
        return {'candidates': [{'content': {'parts': [{'text': '{"ok":1}'}]}}],
                'content': [{'text': '{"ok":1}'}],
                'choices': [{'message': {'content': '{"ok":1}'}}]}
    monkeypatch.setattr(llm, '_post', fake)
    llm.save(prov, 'secret-key-123')
    assert json.loads(llm.complete('hi')) == {'ok': 1}
    assert seen['url'].startswith('https://')          # fixed provider URLs only (no SSRF)
    assert 'secret-key-123' not in seen['url']          # key never in the URL
    assert smart._model() == 'byo'
    llm.clear()


def test_http_error_does_not_leak_key(monkeypatch):
    import urllib.error, io
    def boom(*a, **k):
        raise urllib.error.HTTPError('u', 401, 'x', {}, io.BytesIO(b'secret-key-123'))
    monkeypatch.setattr('urllib.request.urlopen', boom)
    llm.save('openai', 'secret-key-123')
    with pytest.raises(RuntimeError) as e:
        llm.complete('hi')
    assert 'secret-key-123' not in str(e.value) and '401' in str(e.value)
    llm.clear()


def test_judge_uses_byo(monkeypatch):
    monkeypatch.setattr(llm, 'complete', lambda *a, **k: json.dumps(
        {'score': 9, 'kind': 'humour', 'title': 'Funny moment', 'hook': 'He said what?!', 'evidence': 'said what'}))
    llm.save('gemini', 'k1')
    out = smart._judge('byo', '[CLIP] he said what happened there [after] x')
    assert out['score'] == 9 and out['kind'] == 'humour'
    llm.clear()
