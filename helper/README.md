# AutoClip Helper

Downloads video links on **your** computer (your own internet, so YouTube does not block it), then your browser
hands the file to AutoClip. Cookies never leave your PC.

## Windows (no installs)
1. Download `AutoClipHelper.exe` from the **helper-latest** release and double-click it. Keep the window open.
   First run fetches ffmpeg once (~130 MB).
2. Open the AutoClip site. The link tab shows "Helper connected ✓". Paste a YouTube (or any) link.
3. Optional: `AutoClipHelper.exe --autostart on` starts it with Windows.

If YouTube asks you to sign in: `AutoClipHelper.exe --browser edge` (chrome, firefox, brave). The helper reads that
browser's cookies locally. Or put a `cookies.txt` next to the exe. Only the finished video is uploaded.

## Mac / Linux / from source
`pip install yt-dlp`, install ffmpeg, then `python3 autoclip_helper.py`.

Listens on 127.0.0.1:8791 only and answers only the AutoClip website.
