# AutoClip AI

Long video in, viral Shorts out. Paste a YouTube / Twitch / Kick / Vimeo / Instagram link or upload a file:
AutoClip AI transcribes every word, asks Gemini which moments a stranger would watch to the end, and renders each
one as a 9:16 clip with animated captions, a hook title, loudness-matched audio, a thumbnail, an SRT file and a
ready title, description and hashtags.

**Live:** https://winplaybox.github.io/AutoClip-AI/

## Architecture

```
GitHub Pages (this repo, /web)  ──HTTPS──▶  api.winplaybox.in  /api/autoclip/*   (Winplaybox API, isolated module)
                                                   │  queue + leases (SQLite)
                                                   ▼
                                       inline worker  or  remote workers (python -m backend.autoclip.worker)
                                       yt-dlp → faster-whisper → Gemini → ffmpeg (crop, captions, -14 LUFS)
```

* **No separate backend.** The engine is an isolated module in the Winplaybox API repo
  (`Winplaybox/anydownloader` → `backend/autoclip/`, `backend/routes_autoclip.py`, docs in `docs/AUTOCLIP.md`).
* **Gemini key is never in this repo.** The API reads the existing `GEMINI_API_KEY` from its server environment.
  Without a key, clips are picked from loudness + speech density instead.
* This repo is only the static frontend: no build step, no framework, no secrets.

## Features

- Link or upload (up to 500 MB / 90 min by default), drag and drop, upload progress
- 1–12 clips, length range, spoken language (Hindi/Hinglish, English, 15+ more), 720p or 1080p
- Caption styles: Pop Highlight, One Word Punch, Boxed Phrase, Karaoke Fill, Minimal, none; custom colour
- Framing: Auto (face-aware), face crop, centre crop, fit with blurred background (slides / gameplay)
- Optional "what should the AI look for" focus prompt
- Per clip: AI score, hook, title, description + hashtags (one-tap copy), MP4, SRT; whole job as ZIP
- Jobs survive a page reload (private token in this browser only); files auto-delete after 24 h

## Deploy (GitHub Pages)

1. Repo **Settings → Pages → Source: GitHub Actions**.
2. Push to `main`. The workflow in `.github/workflows/pages.yml` syntax-checks and publishes `web/`.
3. Optional custom domain (e.g. `clip.winplaybox.in`): add it under Settings → Pages and a CNAME DNS record
   to `winplaybox.github.io`. Already allowed by the API's CORS rules.

Backend must allow the origin: `https://winplaybox.github.io` and any `https://*.winplaybox.in` are allowed by default.

## Local development

```bash
cd web && python -m http.server 5500
# open http://localhost:5500/?api=http://localhost:8000   (remembered; ?api= with nothing resets it)
```

Run the API locally from the Winplaybox API repo: `uvicorn backend.main:app --port 8000`.

## API (summary)

| | |
|---|---|
| `POST /api/autoclip/jobs` | JSON `{url, settings}` or multipart `file` + `settings` → `{job, token}` |
| `GET /api/autoclip/jobs/{id}` | header `X-Job-Token` → status, stage, progress, clips |
| `GET /api/autoclip/jobs/{id}/files/{name}?t=` | `clip_01.mp4`, `clip_01.jpg`, `clip_01.srt`, `clips.json` |
| `GET /api/autoclip/jobs/{id}/zip?t=` | everything |

Full reference and server env vars: `docs/AUTOCLIP.md` in the API repo.

## Credits

Product idea inspired by [PeakCut](https://github.com/haziqahmedqasmi/PeakCut) (MIT). Code here is original.
