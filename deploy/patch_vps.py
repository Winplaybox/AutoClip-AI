#!/usr/bin/env python3
"""
Surgical, idempotent patch that wires the AutoClip module into a LIVE OVD backend
(/opt/ovd-backend) without replacing any existing code.

  python3 patch_vps.py /opt/ovd-backend [--check]

It edits exactly two files (main.py, security/zero_trust.py). Every edit needs its
anchor to match exactly once; if it does not, NOTHING is written and the script
exits non-zero. --check only verifies that the anchors are present.
"""
import os
import re
import sys

APP = sys.argv[1] if len(sys.argv) > 1 else "/opt/ovd-backend"
CHECK = "--check" in sys.argv
B = os.path.join(APP, "backend")


def read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def apply(path, edits):
    src = read(path)
    out = src
    for name, marker, fn in edits:
        if marker in out:
            print(f"  skip   {name} (already applied)")
            continue
        new = fn(out)
        if new is None:
            sys.exit(f"FATAL: anchor for '{name}' not found exactly once in {path}")
        out = new
        print(f"  {'found ' if CHECK else 'patch '} {name}")
    if out != src and not CHECK:
        compile(out, path, "exec")  # syntax check before anything is written
        tmp = path + ".autoclip.new"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(out)
        os.replace(tmp, path)


def once(old, new):
    def _f(s):
        return s.replace(old, new) if s.count(old) == 1 else None
    return _f


# ---------------------------------------------------------------- main.py
GATE_OLD = '"/api/v1", "/api/v2")) or request.url.path.startswith("/admin/")'
GATE_NEW = '"/api/v1", "/api/v2", "/api/autoclip")) or request.url.path.startswith("/admin/")'

ROUTES_OLD = "routes = routes_v2 + routes_analytics"
ROUTES_NEW = '''try:
    from backend.routes_autoclip import routes_autoclip, startup as _autoclip_startup
except Exception:  # pragma: no cover
    try:
        from routes_autoclip import routes_autoclip, startup as _autoclip_startup
    except Exception as _ac_err:  # AutoClip must never take the main API down
        print(f"[autoclip] disabled: {_ac_err}")
        routes_autoclip = []

        async def _autoclip_startup():
            return None

routes = routes_autoclip + routes_v2 + routes_analytics'''

APP_OLD = "app = Starlette(debug=False, routes=routes, middleware=middleware)"
APP_NEW = '''from contextlib import asynccontextmanager as _acm


@_acm
async def _ac_lifespan(_app):
    try:
        await _autoclip_startup()
    except Exception as _e:  # never block the main API
        print(f"[autoclip] startup failed: {_e}")
    yield


app = Starlette(debug=False, routes=routes, middleware=middleware, lifespan=_ac_lifespan)'''

print("main.py")
apply(os.path.join(B, "main.py"), [
    ("origin-gate bypass for /api/autoclip", '"/api/autoclip"', once(GATE_OLD, GATE_NEW)),
    ("routes + safe import", "routes_autoclip + routes_v2", once(ROUTES_OLD, ROUTES_NEW)),
    ("lifespan startup", "_ac_lifespan", once(APP_OLD, APP_NEW)),
])

# ---------------------------------------------------------------- zero_trust.py
BODY_RE = re.compile(
    r'(?m)^(?P<ind> +)max_body = \(int\(os\.environ\.get\("EDITOR_MAX_UPLOAD_MB", "100"\)\) \+ 1\) \* 1024 \* 1024\n')


def body_limit(s):
    ms = list(BODY_RE.finditer(s))
    if len(ms) != 1:
        return None
    m = ms[0]
    pad = m.group("ind")[:-4]
    add = (f'{pad}if path == "/api/autoclip/jobs":  # AutoClip uploads; the route enforces AUTOCLIP_MAX_UPLOAD_MB\n'
           f'{pad}    max_body = (int(os.environ.get("AUTOCLIP_MAX_UPLOAD_MB", "500")) + 1) * 1024 * 1024\n'
           f'{pad}if path.startswith("/api/autoclip/workers/jobs/") and path.endswith("/artifact"):\n'
           f'{pad}    max_body = 2 * 1024 * 1024 * 1024\n')
    return s[:m.end()] + add + s[m.end():]


HDR_OLD = '"X-Auth-Token", "cf-turnstile-response"'
HDR_NEW = '"X-Auth-Token", "X-Job-Token", "X-API-Key", "cf-turnstile-response"'

print("security/zero_trust.py")
apply(os.path.join(B, "security", "zero_trust.py"), [
    ("upload body limit for /api/autoclip/jobs", '"/api/autoclip/jobs"', body_limit),
    ("CORS allow-headers (X-Job-Token, X-API-Key)", '"X-Job-Token"', once(HDR_OLD, HDR_NEW)),
])
print("OK" if not CHECK else "anchors OK")
