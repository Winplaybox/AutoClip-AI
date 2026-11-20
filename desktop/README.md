# AutoClip Desktop

The full AutoClip engine on your own PC: no upload, **no limits** on video length or number of videos.

Based on the MIT-licensed [NeonClipping](https://github.com/iamajmeena/neonclipping) by Ajay K Meena
(licence kept in `NEONCLIPPING-LICENSE`), extended with: your-own-AI-key support (Gemini, OpenAI, Groq, OpenRouter,
Anthropic), a hardened local server, and one-click Windows packaging.

## Use it (Windows)
1. Download `AutoClipDesktop-win64.zip` from the **desktop-latest** release, unzip, run `AutoClipDesktop.exe`.
2. First run fetches ffmpeg once. Your browser opens AutoClip. Paste a link or drop a file.
3. Optional: open **AI key** in the app and paste your own key for smarter moment picking.

Long videos: Fast mode (default over 10 minutes) downloads only the audio first and renders only the chosen moments.

## Phone (Android / iPhone)
Start with `set NEONCLIPPING_LAN=1` (PIN-protected), then open the printed `/m` address on your phone on the same
Wi-Fi. The PC does the work; the phone is the remote. Or use the web version and upload from the phone.

## Develop
`pip install -r engine/requirements.txt` then `python autoclip_desktop.py` (needs ffmpeg).
`PYTHONPATH=engine python -m pytest tests`
