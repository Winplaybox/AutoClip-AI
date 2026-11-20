"""Local-server hardening: only this PC may talk to it, and only the AutoClip site may ping it."""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response
import re

VERSION = '1.0.0'
ORIGINS = re.compile(r'^https://(winplaybox\.github\.io|([a-z0-9-]+\.)?winplaybox\.in)$')
HOSTS = re.compile(r'^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$')


class Guard(BaseHTTPMiddleware):
    def __init__(self, app, allow_lan=False):
        super().__init__(app)
        self.allow_lan = allow_lan

    async def dispatch(self, request, call_next):
        host = request.headers.get('host', '')
        # Blocks DNS-rebinding. With phone access on, LAN hosts are allowed but the phone PIN still applies.
        if not self.allow_lan and not HOSTS.match(host):
            return Response('Forbidden host', status_code=403)
        origin = request.headers.get('origin', '')
        if request.url.path == '/ping':
            h = {'Cache-Control': 'no-store'}
            if ORIGINS.match(origin):
                h.update({'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
                          'Access-Control-Allow-Private-Network': 'true'})
            if request.method == 'OPTIONS':
                h.update({'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': '*'})
                return Response(status_code=204, headers=h)
            return JSONResponse({'desktop': 'autoclip', 'version': VERSION}, headers=h)
        # Browsers always send Origin on cross-site writes: refuse any that is not this app itself.
        if request.method in ('POST', 'PUT', 'DELETE', 'PATCH') and origin:
            if not re.match(r'^https?://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$', origin) and not self.allow_lan:
                return Response('Forbidden origin', status_code=403)
        return await call_next(request)
