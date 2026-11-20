"""AutoClip Desktop launcher: runs the full clip engine on THIS PC (no upload, no limits) and opens it in the browser."""
import os, shutil, socket, sys, threading, time, webbrowser
from pathlib import Path

FFMPEG_URL = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
PORT = int(os.environ.get("AUTOCLIP_PORT", "8770"))


def base_dir() -> Path:
    root = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/.local/share")
    d = Path(root) / "AutoClipDesktop"
    d.mkdir(parents=True, exist_ok=True)
    return d


def ensure_ffmpeg(d: Path) -> None:
    if shutil.which("ffmpeg") and shutil.which("ffprobe"):
        return
    if sys.platform == "win32":
        exe = d / "ffmpeg.exe"
        if not exe.is_file():
            import urllib.request, zipfile
            print("First run: downloading ffmpeg (about 130 MB, one time)...", flush=True)
            zp = d / "ffmpeg.zip"
            try:
                urllib.request.urlretrieve(FFMPEG_URL, zp)
                with zipfile.ZipFile(zp) as z:
                    for n in z.namelist():
                        if n.endswith("/bin/ffmpeg.exe") or n.endswith("/bin/ffprobe.exe"):
                            with z.open(n) as src, open(d / Path(n).name, "wb") as out:
                                shutil.copyfileobj(src, out)
            except Exception as e:  # noqa: BLE001
                print("Could not download ffmpeg:", type(e).__name__, flush=True)
            finally:
                zp.unlink(missing_ok=True)
        os.environ["PATH"] = str(d) + os.pathsep + os.environ.get("PATH", "")
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        print("ffmpeg is required. Install it (Windows: winget install ffmpeg) and start again.", flush=True)
        sys.exit(2)


def port_open(p: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", p)) == 0


def main() -> None:
    if "--phone" in sys.argv:  # control AutoClip from a phone on the same Wi-Fi (PIN protected)
        os.environ["NEONCLIPPING_LAN"] = "1"
    d = base_dir()
    os.environ.setdefault("NEONCLIPPING_DATA_DIR", str(d / "data"))
    os.environ.setdefault("NEONCLIPPING_PORT", str(PORT))
    here = Path(getattr(sys, "_MEIPASS", Path(__file__).parent / "engine"))
    sys.path.insert(0, str(here))
    url = f"http://127.0.0.1:{PORT}"
    if port_open(PORT):
        print("AutoClip is already running. Opening it...", flush=True)
        webbrowser.open(url)
        return
    ensure_ffmpeg(d)
    print(f"AutoClip Desktop is starting at {url}  (close this window to stop)", flush=True)
    if os.environ.get("AUTOCLIP_NO_BROWSER") != "1":
        threading.Thread(target=lambda: (time.sleep(2.5), webbrowser.open(url)), daemon=True).start()
    import uvicorn
    import app as engine  # noqa: E402  (engine/app.py)
    uvicorn.run(engine.app, host="0.0.0.0" if os.environ.get("NEONCLIPPING_LAN") == "1" else "127.0.0.1",
                port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
