"""Local AI-key settings page + API. Only reachable from this PC (see guard.py)."""
from fastapi import HTTPException
from fastapi.responses import HTMLResponse
import llm

PAGE = """<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>AutoClip - AI key</title><style>
body{font:15px system-ui,sans-serif;background:#0b0b0c;color:#f2f2f2;margin:0;display:grid;place-items:center;min-height:100vh}
main{width:min(520px,92vw);background:#151517;border:1px solid #2a2a2d;border-radius:14px;padding:26px}
h1{margin:0 0 6px;font-size:22px}p{color:#a8a8ad;line-height:1.5}label{display:block;margin:14px 0 6px;font-size:13px;color:#a8a8ad}
select,input{width:100%;box-sizing:border-box;padding:11px;border-radius:9px;border:1px solid #333;background:#0b0b0c;color:#fff;font:inherit}
button{margin-top:16px;padding:11px 16px;border-radius:9px;border:0;background:#fff;color:#000;font-weight:600;cursor:pointer;margin-right:8px}
button.sec{background:#2a2a2d;color:#fff}#m{margin-top:14px;min-height:20px}.ok{color:#6ee7a0}.er{color:#ff8a8a}a{color:#fff}</style></head><body><main>
<h1>Your AI key</h1><p>Used only to pick the best moments and write hooks. It is stored on this PC and sent only to the provider you choose. Without a key, clips are picked by loudness and motion.</p>
<label>Provider</label><select id=p></select><label>API key</label><input id=k type=password autocomplete=off placeholder="paste your key">
<label>Model (optional)</label><input id=md placeholder="leave empty for the default">
<button id=s>Save &amp; test</button><button class=sec id=c>Remove key</button><div id=m></div><p><a href="/">&larr; Back to AutoClip</a></p></main>
<script>
const $=i=>document.getElementById(i),msg=(t,c)=>{$('m').className=c;$('m').textContent=t};
async function load(){const r=await (await fetch('/api/ai')).json();$('p').innerHTML=Object.entries(r.providers).map(([k,v])=>`<option value=${k}>${v}</option>`).join('');
 if(r.provider)$('p').value=r.provider;msg(r.configured?'Key saved ('+r.provider+', '+r.model+')':'No key saved yet',r.configured?'ok':'')}
$('s').onclick=async()=>{msg('Testing...','');const r=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:$('p').value,key:$('k').value,model:$('md').value})});
 const j=await r.json();if(r.ok){$('k').value='';msg('Saved and working ('+j.model+')','ok')}else msg(j.detail||'Failed','er')};
$('c').onclick=async()=>{await fetch('/api/ai',{method:'DELETE'});msg('Key removed','');load()};load();
</script></body></html>"""


def attach(app):
    @app.get('/ai-key')
    def page():
        return HTMLResponse(PAGE)

    @app.get('/api/ai')
    def status():
        return llm.public()

    @app.post('/api/ai')
    def save(b: dict):
        try:
            llm.save(b.get('provider'), b.get('key'), b.get('model', ''))
        except ValueError as e:
            raise HTTPException(400, str(e))
        try:
            llm.complete('Reply with the JSON {"ok":true}', 40, 0)
        except Exception as e:  # noqa: BLE001
            llm.clear()
            raise HTTPException(400, 'That key did not work: ' + str(e)[:120])
        return llm.public()

    @app.delete('/api/ai')
    def remove():
        llm.clear()
        return llm.public()
