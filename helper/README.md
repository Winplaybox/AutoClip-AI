# AutoClip Helper

Downloads video links on **your** computer (your home internet, so YouTube does not block it), then your browser
hands the file to AutoClip. Cookies never leave your PC.

1. Install Python 3 and (recommended) ffmpeg: `winget install ffmpeg`.
2. Double-click `start.bat`. Keep the window open.
3. Open the AutoClip site. It shows "Helper connected". Paste a link and go.

If YouTube asks you to sign in: run `start.bat edge` (or chrome, firefox, brave). The helper reads that browser's
cookies locally. Or put a `cookies.txt` next to the script. Nothing is uploaded except the finished video.

Listens on 127.0.0.1:8791 only and answers only the AutoClip website.
