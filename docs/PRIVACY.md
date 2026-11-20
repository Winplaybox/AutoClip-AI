# Privacy

**AutoClip Desktop** runs on your computer. Videos, audio, transcripts and clips stay on your computer.

- No account, no analytics, no telemetry.
- Downloads (YouTube and others) are made by yt-dlp from your own internet connection. Browser cookies, if you
  choose to use them, are read locally and never sent anywhere.
- If you add an AI key, short transcript excerpts are sent to **the provider you chose** (Gemini, OpenAI, Groq,
  OpenRouter or Anthropic) to pick moments and write hooks. The key is stored in a file on your computer and is only
  sent to that provider. Without a key nothing is sent.
- First run downloads FFmpeg from the yt-dlp FFmpeg-Builds GitHub release, and speech models from Hugging Face when
  you first transcribe.

**AutoClip web (winplaybox.github.io/AutoClip-AI)** uploads the video you choose to our server to process it, keeps
the result for a limited time, and then deletes it. Your AI key is sent with the job, kept in memory only, and
dropped when the job ends.
