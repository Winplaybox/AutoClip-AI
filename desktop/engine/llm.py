"""Bring-your-own-AI adapter. Replaces the Ollama-only path so any user can plug in their own key.
The key lives only in this PC's local settings file (never uploaded anywhere except the provider they chose)."""
import json, os, urllib.request, urllib.error
from pathlib import Path

PROVIDERS = {
    'gemini': {'label': 'Google Gemini', 'model': 'gemini-2.0-flash'},
    'openai': {'label': 'OpenAI', 'model': 'gpt-4o-mini'},
    'groq': {'label': 'Groq', 'model': 'llama-3.3-70b-versatile'},
    'openrouter': {'label': 'OpenRouter', 'model': 'meta-llama/llama-3.3-70b-instruct'},
    'anthropic': {'label': 'Anthropic Claude', 'model': 'claude-haiku-4-5'},
}
_OPENAI_URL = {'openai': 'https://api.openai.com/v1/chat/completions',
               'groq': 'https://api.groq.com/openai/v1/chat/completions',
               'openrouter': 'https://openrouter.ai/api/v1/chat/completions'}


def _file():
    base = os.environ.get('NEONCLIPPING_DATA_DIR') or str(Path(__file__).parent / 'data')
    Path(base).mkdir(parents=True, exist_ok=True)
    return Path(base) / 'ai_settings.json'


def load():
    try:
        d = json.loads(_file().read_text('utf-8'))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def save(provider, key, model=''):
    provider = (provider or '').strip().lower()
    if provider not in PROVIDERS:
        raise ValueError('Unknown provider')
    key = (key or '').strip()
    if not key or len(key) > 400 or any(c.isspace() for c in key):
        raise ValueError('That key does not look right')
    f = _file()
    f.write_text(json.dumps({'provider': provider, 'key': key, 'model': (model or '').strip()[:120]}), 'utf-8')
    try:
        os.chmod(f, 0o600)
    except OSError:
        pass


def clear():
    try:
        _file().unlink()
    except OSError:
        pass


def active():
    d = load()
    return d if d.get('provider') in PROVIDERS and d.get('key') else None


def public():
    d = active()
    return {'configured': bool(d), 'provider': d['provider'] if d else None,
            'model': (d.get('model') or PROVIDERS[d['provider']]['model']) if d else None,
            'providers': {k: v['label'] for k, v in PROVIDERS.items()}}


def _post(url, headers, body, timeout=90):
    req = urllib.request.Request(url, json.dumps(body).encode(), {'Content-Type': 'application/json', **headers})
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        # Never echo the key; surface only the status.
        raise RuntimeError(f'AI provider answered HTTP {e.code}') from None


def complete(prompt, max_tokens=300, temperature=0.3):
    """Return the model's raw text (expected to be JSON). Raises if no key is set."""
    d = active()
    if not d:
        raise RuntimeError('no_ai_key')
    p, key = d['provider'], d['key']
    model = d.get('model') or PROVIDERS[p]['model']
    if p == 'gemini':
        r = _post(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
                  {'x-goog-api-key': key},
                  {'contents': [{'parts': [{'text': prompt}]}],
                   'generationConfig': {'temperature': temperature, 'maxOutputTokens': max_tokens,
                                        'responseMimeType': 'application/json'}})
        return r['candidates'][0]['content']['parts'][0]['text']
    if p == 'anthropic':
        r = _post('https://api.anthropic.com/v1/messages', {'x-api-key': key, 'anthropic-version': '2023-06-01'},
                  {'model': model, 'max_tokens': max_tokens, 'temperature': temperature,
                   'messages': [{'role': 'user', 'content': prompt + '\nReply with JSON only.'}]})
        return r['content'][0]['text']
    r = _post(_OPENAI_URL[p], {'Authorization': 'Bearer ' + key},
              {'model': model, 'temperature': temperature, 'max_tokens': max_tokens,
               'response_format': {'type': 'json_object'}, 'messages': [{'role': 'user', 'content': prompt}]})
    return r['choices'][0]['message']['content']
