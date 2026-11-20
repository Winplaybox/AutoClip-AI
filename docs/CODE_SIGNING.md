# Code signing policy

Windows releases of AutoClip Desktop are built from this repository by GitHub Actions
(`.github/workflows/desktop.yml`) from the public source, and signed through SignPath.

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## Roles
- **Author / committer / reviewer / approver:** the repository owner, [Winplaybox](https://github.com/Winplaybox).
  Only builds produced by the GitHub Actions workflow from the `main` branch can be submitted for signing.

## What is signed
Only binaries built from this repository's source. Third-party components (yt-dlp, FFmpeg downloaded at first run,
faster-whisper, the NeonClipping engine, MIT) are listed in `desktop/NEONCLIPPING-LICENSE` and the dependency files.

## Privacy
See [PRIVACY.md](PRIVACY.md). AutoClip Desktop processes videos on your own computer. It does not upload your videos.

## Owner setup (one time)
1. Apply at https://signpath.org/foundation (open-source project, MIT licence, public repo: all met).
2. After approval: create project `autoclip-ai` with signing policy `release-signing` and an artifact configuration
   that signs `AutoClipDesktop.exe` inside the zip.
3. In this repo: set variable `SIGNPATH_ORGANIZATION_ID` and secret `SIGNPATH_API_TOKEN`.
   The workflow signs automatically from then on; until then it publishes the unsigned build.
