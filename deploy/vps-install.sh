#!/usr/bin/env bash
# AutoClip AI -> live OVD backend (systemd, no Docker). Additive, backed up, auto-rollback.
#   bash vps-install.sh            install / update
#   bash vps-install.sh check      only verify the patch anchors, change nothing
#   bash vps-install.sh rollback   restore the newest backup and restart
set -Eeuo pipefail

APP=/opt/ovd-backend
SVC=ovd-backend
PORT=8000
SRC=/opt/anydownloader-src
BKROOT=/root/backups
SECRET_FILE=/etc/ovd-autoclip.secret
DROPIN=/etc/systemd/system/$SVC.service.d/autoclip.conf
RAW=${RAW:-https://raw.githubusercontent.com/Winplaybox/AutoClip-AI/main/deploy}
say() { printf '\n== %s\n' "$*"; }

health_wait() {
  local i
  for i in $(seq 1 40); do
    sleep 1
    curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && return 0
  done
  return 1
}

restore() {   # $1 = backup dir
  set +e
  cp -a "$1/main.py" "$APP/backend/main.py"
  cp -a "$1/zero_trust.py" "$APP/backend/security/zero_trust.py"
  rm -rf "$APP/backend/autoclip" "$APP/backend/routes_autoclip.py"
  rm -f "$DROPIN"
  systemctl daemon-reload
  systemctl restart "$SVC"
  if health_wait; then echo "ROLLED BACK - API healthy again (backup: $1)"; else echo "ROLLBACK DONE BUT API NOT HEALTHY - check: journalctl -u $SVC -n 50"; fi
}

if [ "${1:-}" = rollback ]; then
  BK=$(ls -1dt $BKROOT/ovd-backend-* 2>/dev/null | head -1)
  [ -n "$BK" ] || { echo "no backup found"; exit 1; }
  restore "$BK"; exit 0
fi

[ -d "$APP/backend" ] || { echo "$APP/backend not found"; exit 1; }
TS=$(date +%Y%m%d-%H%M%S)
BK=$BKROOT/ovd-backend-$TS

say "1/7 backup -> $BK"
mkdir -p "$BK"
cp -a "$APP/backend/main.py" "$BK/main.py"
cp -a "$APP/backend/security/zero_trust.py" "$BK/zero_trust.py"
tar -czf "$BK/backend.tgz" -C "$APP" --exclude='__pycache__' --exclude='.pytest_cache' backend
if [ -f "$APP/auth.db" ]; then
  if command -v sqlite3 >/dev/null; then sqlite3 "$APP/auth.db" ".backup '$BK/auth.db'"; else cp -a "$APP/auth.db" "$BK/auth.db"; fi
fi
du -sh "$BK" | cut -f1

say "2/7 fetch AutoClip module (anydownloader main)"
if [ -d "$SRC/.git" ]; then
  git -C "$SRC" fetch -q --depth 1 origin main && git -C "$SRC" reset -q --hard origin/main
else
  rm -rf "$SRC"; git clone -q --depth 1 https://github.com/Winplaybox/anydownloader.git "$SRC"
fi
echo "source commit: $(git -C "$SRC" log -1 --format='%h %s' | cut -c1-70)"
[ -f "$SRC/backend/routes_autoclip.py" ] && [ -d "$SRC/backend/autoclip" ] || { echo "module missing in source"; exit 1; }

say "3/7 verify patch anchors"
curl -fsSL "$RAW/patch_vps.py" -o /tmp/patch_vps.py
python3 /tmp/patch_vps.py "$APP" --check
[ "${1:-}" = check ] && { echo "check only - nothing changed"; exit 0; }

trap 'echo "FAILED at line $LINENO - rolling back"; trap - ERR; restore "$BK"; exit 1' ERR

say "4/7 install files + patch (existing code untouched except 2 files)"
rm -rf "$APP/backend/autoclip"
cp -a "$SRC/backend/autoclip" "$APP/backend/autoclip"
cp -a "$SRC/backend/routes_autoclip.py" "$APP/backend/routes_autoclip.py"
find "$APP/backend/autoclip" -name __pycache__ -prune -exec rm -rf {} +
# Caption fonts for scripts we do not bundle (Thai, Hebrew, CJK, Sinhala). Optional: never fails the deploy.
if ! fc-list 2>/dev/null | grep -qi "noto sans cjk"; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fonts-noto-core fonts-noto-cjk >/dev/null 2>&1 && fc-cache -f >/dev/null 2>&1 || echo "note: optional caption fonts not installed"
fi
python3 /tmp/patch_vps.py "$APP"

say "5/7 OpenCV (face-aware crop), keep numpy as is"
NP_BEFORE=$("$APP/venv/bin/python" -c 'import numpy;print(numpy.__version__)')
"$APP/venv/bin/pip" install -q --no-deps "opencv-python-headless>=4.9,<5" || echo "opencv install failed (face crop falls back to centre crop)"
NP_AFTER=$("$APP/venv/bin/python" -c 'import numpy;print(numpy.__version__)')
echo "numpy $NP_BEFORE -> $NP_AFTER"
[ "$NP_BEFORE" = "$NP_AFTER" ] || { echo "numpy changed unexpectedly"; false; }
"$APP/venv/bin/python" -c 'import cv2;print("cv2",cv2.__version__)' || echo "cv2 not importable (graceful fallback)"

say "6/7 settings (systemd drop-in, secret stays in $SECRET_FILE)"
[ -s "$SECRET_FILE" ] || { umask 077; openssl rand -hex 32 > "$SECRET_FILE"; }
mkdir -p "$(dirname "$DROPIN")" /var/lib/ovd-autoclip
( umask 077; cat > "$DROPIN" <<EOF
[Service]
Environment="AUTOCLIP_ENABLED=1"
Environment="AUTOCLIP_WORKER_MODE=inline"
Environment="AUTOCLIP_SECRET=$(cat "$SECRET_FILE")"
Environment="AUTOCLIP_DATA_DIR=/var/lib/ovd-autoclip"
Environment="AUTOCLIP_ALLOWED_ORIGINS=https://winplaybox.github.io,https://winplaybox.in,https://ovd.winplaybox.in"
Environment="WPB_CORS_EXTRA_ORIGINS=https://winplaybox.github.io"
EOF
)
systemctl daemon-reload

say "7/7 restart + verify (auto-rollback on failure)"
systemctl restart "$SVC"
health_wait || { echo "API did not come back"; false; }
curl -fsS -m 10 "http://127.0.0.1:$PORT/api/health" >/dev/null
AC=$(curl -fsS -m 10 "http://127.0.0.1:$PORT/api/autoclip/health") || { echo "autoclip health failed"; false; }
echo "$AC"
curl -fsS -m 10 "http://127.0.0.1:$PORT/api/platforms" >/dev/null || { echo "existing /api/platforms broke"; false; }
trap - ERR
echo; echo "DONE. backup: $BK   rollback: bash vps-install.sh rollback"
