/* AutoClip AI frontend. Static, no build step. Backend: Winplaybox API /api/autoclip */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const STAGE_TEXT = {
    uploading: "Uploading", queued: "Waiting in queue", starting: "Starting", fetching: "Getting video",
    analyzing: "Reading video", transcribing: "Listening to every word", finding: "AI is picking moments",
    rendering: "Editing clips", done: "Done", failed: "Failed", cancelled: "Cancelled",
  };
  const ORDER = ["fetching", "transcribing", "finding", "rendering"];

  // Providers: the same ids the server accepts (backend/autoclip/byo.py). Guide text lives here so it works offline.
  const PROVIDERS = {
    gemini: {
      name: "Google Gemini", tag: "Free tier available", model: "gemini-2.5-flash", url: "https://aistudio.google.com/apikey",
      steps: ["Open Google AI Studio and sign in with a Google account.", "Click “Create API key”.",
        "Copy the key (it starts with AIza…) and paste it here."],
      note: "Best default: fast, great with Hindi/Hinglish and other languages, and a free tier that is enough for many videos.",
    },
    groq: {
      name: "Groq", tag: "Free tier available", model: "llama-3.3-70b-versatile", url: "https://console.groq.com/keys",
      steps: ["Open the Groq console and sign in.", "Go to API Keys and click “Create API Key”.", "Copy the key (gsk_…) and paste it here."],
      note: "Very fast. Good for English; for Indian languages Gemini usually picks better.",
    },
    openai: {
      name: "OpenAI", tag: "Paid", model: "gpt-4o-mini", url: "https://platform.openai.com/api-keys",
      steps: ["Open the OpenAI platform and sign in.", "Add a small balance under Billing (API usage is separate from ChatGPT).",
        "Go to API keys → “Create new secret key”, copy it (sk-…) and paste it here."],
      note: "Reliable and cheap per video with the mini model.",
    },
    anthropic: {
      name: "Anthropic Claude", tag: "Paid", model: "claude-haiku-4-5", url: "https://console.anthropic.com/settings/keys",
      steps: ["Open the Anthropic Console and sign in.", "Add credits under Billing.", "Settings → API Keys → “Create Key”, copy it (sk-ant-…) and paste it here."],
      note: "Strong at following the clip-picking rules. Leave the model blank to use the default.",
    },
    openrouter: {
      name: "OpenRouter", tag: "One key, many models", model: "google/gemini-2.5-flash", url: "https://openrouter.ai/keys",
      steps: ["Open OpenRouter and sign in.", "Go to Keys → “Create Key”.", "Copy the key (sk-or-…), paste it here, and type any model name from their list if you want a specific one."],
      note: "Handy if you want to try many models with one account; some models are free.",
    },
  };

  // ---------------------------------------------------------------- storage (can throw in some browsers)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const session = {
    get(k) { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
  };

  // ---------------------------------------------------------------- API base
  const API = (() => {
    const q = new URLSearchParams(location.search).get("api");
    if (q !== null) {
      if (/^https?:\/\/[^\s/?#]+$/.test(q)) store.set("ac_api", q); else store.set("ac_api", null);
    }
    const saved = store.get("ac_api", null);
    return (saved || (window.AUTOCLIP_CONFIG || {}).API_BASE || "https://api.winplaybox.in").replace(/\/+$/, "");
  })();
  const BASE = API + "/api/autoclip";

  const guestId = (() => {
    let g = store.get("ac_guest", null);
    if (!g) {
      g = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^a-z0-9-]/gi, "");
      store.set("ac_guest", g);
    }
    return g;
  })();

  async function api(path, { method = "GET", body, token } = {}) {
    const headers = { "X-Guest-ID": guestId };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers["X-Job-Token"] = token;
    let res;
    try {
      res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error("Can't reach the server. Check your internet and try again.");
    }
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok || data.ok === false) {
      const e = new Error(data.error || `Server error (${res.status}). Please try again.`);
      e.status = res.status; e.code = data.code;
      throw e;
    }
    return data;
  }

  const fileUrl = (job, name, download) =>
    `${BASE}/jobs/${job.id}/files/${encodeURIComponent(name)}?t=${encodeURIComponent(job.token)}${download ? "&download=1" : ""}`;

  // ---------------------------------------------------------------- router + theme
  const VIEWS = ["create", "keys", "speech"];
  function route() {
    const name = (location.hash.replace(/^#\/?/, "") || "create").split("?")[0];
    const view = VIEWS.includes(name) ? name : "create";
    $$(".view").forEach((v) => v.classList.toggle("hidden", v.dataset.view !== view));
    $$("[data-nav]").forEach((a) => { if (a.dataset.nav === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    if (view === "speech") loadSpeech();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  $("#themeBtn").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("ac_theme", next); } catch { /* ignore */ }
    $("#themeColor").content = next === "dark" ? "#0A0A0A" : "#FFFFFF";
  });

  // ---------------------------------------------------------------- server status + options
  const statusEl = $("#status");
  async function checkHealth() {
    try {
      const h = await api("/health");
      statusEl.className = "status " + (h.enabled ? "ok" : "down");
      $("span", statusEl).textContent = h.enabled ? "Online" : "Paused";
      return h;
    } catch {
      statusEl.className = "status down";
      $("span", statusEl).textContent = "Offline";
      return null;
    }
  }

  const state = { style: "pop", layout: "auto", limits: null, options: null };

  function chips(container, items, key) {
    container.textContent = "";
    for (const it of items) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = it.name; b.title = it.desc || "";
      b.setAttribute("aria-pressed", String(it.id === state[key]));
      b.addEventListener("click", () => {
        state[key] = it.id;
        $$(".chip", container).forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
      });
      container.appendChild(b);
    }
  }

  const FALLBACK_OPTIONS = {
    caption_styles: [{ id: "pop", name: "Pop Highlight" }, { id: "single", name: "One Word Punch" }, { id: "box", name: "Boxed Phrase" },
      { id: "karaoke", name: "Karaoke Fill" }, { id: "minimal", name: "Minimal" }, { id: "none", name: "No captions" }],
    layouts: [{ id: "auto", name: "Auto" }, { id: "face", name: "Face crop" }, { id: "center", name: "Center crop" }, { id: "fit", name: "Fit + blur" }],
    languages: [{ id: "auto", name: "Auto detect" }, { id: "hi", name: "Hindi / Hinglish" }, { id: "en", name: "English" }],
    stt_models: [], limits: null,
  };

  async function loadOptions() {
    let o = FALLBACK_OPTIONS;
    try { o = await api("/options"); } catch { /* keep fallback */ }
    state.options = o;
    chips($("#styles"), o.caption_styles, "style");
    chips($("#layouts"), o.layouts, "layout");
    const sel = $("#language");
    sel.textContent = "";
    for (const l of o.languages) sel.add(new Option(l.name, l.id));
    const stt = $("#sttModel");
    stt.textContent = "";
    stt.add(new Option("Server default", "auto"));
    for (const m of o.stt_models || []) stt.add(new Option(`${m.name} (${m.id})`, m.id));
    state.limits = o.limits;
    if (o.limits) {
      const parts = [];
      if (o.limits.daily && !o.unlimited) parts.push(`${o.limits.daily} free videos per day`);
      parts.push(`up to ${o.limits.max_source_minutes} min`, `${o.limits.max_upload_mb} MB uploads`);
      $("#limits").textContent = parts.join(" · ");
      $("#dropHint").textContent = `MP4, MOV, MKV, WEBM · max ${o.limits.max_upload_mb} MB`;
    }
  }

  // ---------------------------------------------------------------- AI key (browser only)
  const aiEls = { provider: $("#aiProvider"), model: $("#aiModel"), key: $("#aiKey"), remember: $("#aiRemember"), pill: $("#keyPill"), msg: $("#keyMsg") };
  for (const [id, p] of Object.entries(PROVIDERS)) aiEls.provider.add(new Option(p.name, id));

  function loadAI() {
    const saved = store.get("ac_ai", null) || session.get("ac_ai");
    if (saved) {
      aiEls.provider.value = PROVIDERS[saved.provider] ? saved.provider : "gemini";
      aiEls.model.value = saved.model || "";
      aiEls.key.value = saved.key || "";
      aiEls.remember.checked = !!store.get("ac_ai", null);
    }
    refreshAI();
  }
  function saveAI() {
    const rec = { provider: aiEls.provider.value, model: aiEls.model.value.trim(), key: aiEls.key.value.trim() };
    store.del("ac_ai"); session.del("ac_ai");
    if (rec.key) (aiEls.remember.checked ? store.set : session.set)("ac_ai", rec);
    refreshAI();
  }
  function refreshAI() {
    const has = aiEls.key.value.trim().length >= 16;
    aiEls.pill.textContent = has ? "key added" : "no key";
    aiEls.pill.classList.toggle("ok", has);
    $("#keyBanner").classList.toggle("hidden", has);
    aiEls.model.placeholder = (PROVIDERS[aiEls.provider.value] || {}).model || "default";
  }
  const aiPayload = () => {
    const key = aiEls.key.value.trim();
    return key ? { ai_provider: aiEls.provider.value, ai_key: key, ai_model: aiEls.model.value.trim() } : {};
  };
  ["input", "change"].forEach((ev) => [aiEls.provider, aiEls.model, aiEls.key, aiEls.remember].forEach((el) => el.addEventListener(ev, saveAI)));

  $("#keyTest").addEventListener("click", async () => {
    const btn = $("#keyTest");
    const p = aiPayload();
    if (!p.ai_key) { aiEls.msg.textContent = "Paste your API key first."; return; }
    btn.disabled = true; btn.textContent = "Testing…";
    try {
      const r = await api("/keys/test", { method: "POST", body: { provider: p.ai_provider, key: p.ai_key, model: p.ai_model } });
      aiEls.msg.textContent = `Key works (${r.model}, ${r.ms} ms). You're ready.`;
      aiEls.msg.style.color = "var(--positive)";
    } catch (e) {
      aiEls.msg.textContent = e.message;
      aiEls.msg.style.color = "var(--negative)";
    } finally { btn.disabled = false; btn.textContent = "Test key"; }
  });

  // ---------------------------------------------------------------- guide page
  function renderGuide() {
    const host = $("#guide");
    host.textContent = "";
    for (const [id, p] of Object.entries(PROVIDERS)) {
      const c = document.createElement("article");
      c.className = "gcard";
      const h = document.createElement("header");
      const h3 = document.createElement("h3"); h3.textContent = p.name;
      const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = p.tag;
      h.append(h3, tag);
      const note = document.createElement("p"); note.textContent = p.note;
      const ol = document.createElement("ol");
      for (const s of p.steps) { const li = document.createElement("li"); li.textContent = s; ol.appendChild(li); }
      const acts = document.createElement("div"); acts.className = "acts";
      const open = document.createElement("a"); open.className = "btn primary"; open.href = p.url; open.target = "_blank"; open.rel = "noopener noreferrer";
      open.textContent = `Open ${p.name}`;
      const use = document.createElement("a"); use.className = "btn ghost"; use.href = "#/"; use.textContent = "I have the key";
      use.addEventListener("click", () => { aiEls.provider.value = id; saveAI(); setTimeout(() => aiEls.key.focus(), 50); });
      acts.append(open, use);
      c.append(h, note, ol, acts);
      host.appendChild(c);
    }
  }

  // ---------------------------------------------------------------- speech + languages page
  let speechTimer = null;
  async function loadSpeech() {
    clearTimeout(speechTimer);
    const o = state.options || FALLBACK_OPTIONS;
    const langs = $("#langList");
    langs.textContent = "";
    for (const l of o.languages) { if (l.id === "auto") continue; const s = document.createElement("span"); s.className = "chip"; s.textContent = l.name; langs.appendChild(s); }
    const host = $("#sttList");
    let data;
    try { data = await api("/models"); } catch (e) { host.textContent = e.message; return; }
    host.textContent = "";
    if (!data.engine) { host.textContent = "Speech engine is not installed on this server."; return; }
    let busy = false;
    for (const m of data.models) {
      const card = document.createElement("div"); card.className = "mcard";
      const info = document.createElement("div"); info.className = "info";
      const b = document.createElement("b"); b.textContent = `${m.name} · ${m.id}`;
      const sm = document.createElement("small"); sm.textContent = `${m.desc} · ~${m.size_mb} MB`;
      info.append(b, sm);
      card.appendChild(info);
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn " + (m.installed ? "ghost" : "primary");
      if (m.installed) { btn.textContent = "Installed ✓"; btn.disabled = true; }
      else if (m.status === "downloading") { btn.textContent = "Downloading…"; btn.disabled = true; busy = true; }
      else {
        btn.textContent = m.status === "error" ? "Retry install" : "Install on server";
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try { await api("/models/install", { method: "POST", body: { id: m.id } }); } catch (e) { alert(e.message); }
          loadSpeech();
        });
      }
      card.appendChild(btn);
      if (m.error) { const er = document.createElement("small"); er.textContent = m.error; er.style.color = "var(--negative)"; info.appendChild(er); }
      host.appendChild(card);
    }
    if (busy) speechTimer = setTimeout(loadSpeech, 4000);
  }

  // ---------------------------------------------------------------- local helper (downloads links on the user's PC)
  const HELPER = "http://127.0.0.1:8791";
  const helper = { ok: false, cookies: "none" };
  async function hfetch(path, opt = {}, ms = 0) {
    const ctl = new AbortController();
    const t = ms ? setTimeout(() => ctl.abort(), ms) : null;
    try { return await fetch(HELPER + path, { ...opt, signal: ctl.signal }); } finally { if (t) clearTimeout(t); }
  }
  async function pingHelper() {
    try {
      const r = await hfetch("/ping", {}, 1500);
      const d = await r.json();
      helper.ok = !!(d && d.helper === "autoclip");
      helper.cookies = d.cookies || "none";
    } catch { helper.ok = false; }
    const el = $("#helperHint");
    if (!el) return;
    el.textContent = "";
    if (helper.ok) {
      el.textContent = "Helper connected ✓ Links are downloaded on your computer, so YouTube does not block them.";
      el.style.color = "var(--positive)";
    } else {
      el.style.color = "";
      el.append("YouTube often blocks downloads from our server. Run the ");
      const a = document.createElement("a");
      a.href = "https://github.com/Winplaybox/AutoClip-AI/releases/download/helper-latest/AutoClipHelper.exe"; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.textContent = "AutoClip Helper (Windows, one click)";
      el.append(a, " on your PC to download links locally, or upload the video file (always works).");
    }
  }
  async function viaHelper(url, onStatus) {
    let r;
    try { r = await hfetch("/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }); }
    catch { throw new Error("Lost connection to the helper. Is it still running?"); }
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Helper refused the link.");
    for (;;) {
      await new Promise((res) => setTimeout(res, 1000));
      let s;
      try { s = await (await hfetch("/status/" + d.id)).json(); } catch { throw new Error("Lost connection to the helper. Is it still running?"); }
      if (s.status === "failed") throw new Error(s.error || "Download failed.");
      if (s.status === "done") { onStatus(`Fetching from your PC…`); break; }
      onStatus(`Downloading on your PC ${Math.round((s.progress || 0) * 100)}%`);
    }
    const res = await hfetch("/file/" + d.id);
    if (!res.ok) throw new Error("Could not read the downloaded file from the helper.");
    const blob = await res.blob();
    return new File([blob], "video.mp4", { type: "video/mp4" });
  }

  // ---------------------------------------------------------------- form
  let mode = "file";
  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    mode = t.dataset.tab;
    $$(".tab").forEach((x) => { x.classList.toggle("active", x === t); x.setAttribute("aria-selected", String(x === t)); });
    $$(".pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== mode));
  }));

  const range = $("#maxClips");
  range.addEventListener("input", () => { $("#maxClipsOut").textContent = range.value; });
  $("#accent").addEventListener("input", (e) => { $("#accentOut").textContent = e.target.value.toUpperCase(); });

  const drop = $("#drop"), fileIn = $("#file");
  const showFile = () => {
    const f = fileIn.files[0];
    $("#dropText").textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)} MB` : "Drop a video here or browse";
  };
  fileIn.addEventListener("change", showFile);
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) { fileIn.files = e.dataTransfer.files; showFile(); }
  });

  const msg = $("#msg");
  const say = (text, info) => { msg.textContent = text || ""; msg.classList.toggle("info", !!info); };

  function settings() {
    let minLen = Math.max(8, Math.min(90, +$("#minLen").value || 20));
    let maxLen = Math.max(15, Math.min(180, +$("#maxLen").value || 60));
    if (maxLen < minLen + 5) maxLen = minLen + 5;
    return {
      max_clips: +range.value, min_len: minLen, max_len: maxLen, caption_style: state.style, layout: state.layout,
      language: $("#language").value || "auto", resolution: +$("#resolution").value, accent: $("#accent").value,
      hook: $("#hook").checked, focus: $("#focus").value.trim().slice(0, 300), stt_model: $("#sttModel").value || "auto",
    };
  }

  function uploadJob(file, st, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("settings", JSON.stringify(st));
      for (const [k, v] of Object.entries(aiPayload())) fd.append(k, v);
      fd.append("file", file, file.name);
      const x = new XMLHttpRequest();
      x.open("POST", BASE + "/jobs");
      x.setRequestHeader("X-Guest-ID", guestId);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () => {
        let d = {};
        try { d = JSON.parse(x.responseText); } catch { /* empty */ }
        if (x.status >= 200 && x.status < 300 && d.ok) resolve(d);
        else reject(new Error(d.error || (x.status === 413 ? "File is too large." : `Upload failed (${x.status}).`)));
      };
      x.onerror = () => reject(new Error("Upload failed. Check your internet and try again."));
      x.send(fd);
    });
  }

  $("#form").addEventListener("submit", async (e) => {
    e.preventDefault();
    say("");
    const st = settings();
    const go = $("#go");
    go.disabled = true;
    try {
      let created;
      if (mode === "link") {
        const url = $("#url").value.trim();
        if (!/^https?:\/\//i.test(url)) { say("Paste a full video link starting with https://"); return; }
        if (helper.ok) {
          const f = await viaHelper(url, (t) => { $("span", go).textContent = t; });
          created = await uploadJob(f, st, (p) => { $("span", go).textContent = `Uploading ${Math.round(p * 100)}%`; });
        } else {
          $("span", go).textContent = "Sending…";
          created = await api("/jobs", { method: "POST", body: { url, settings: st, ...aiPayload() } });
        }
      } else {
        const f = fileIn.files[0];
        if (!f) { say("Choose a video file first."); return; }
        const maxMb = state.limits ? state.limits.max_upload_mb : 500;
        if (f.size > maxMb * 1048576) { say(`File is larger than ${maxMb} MB.`); return; }
        created = await uploadJob(f, st, (p) => { $("span", go).textContent = `Uploading ${Math.round(p * 100)}%`; });
      }
      const rec = { id: created.job.id, token: created.token, created: Date.now() };
      const list = store.get("ac_jobs", []).filter((j) => j.id !== rec.id);
      list.unshift(rec);
      store.set("ac_jobs", list.slice(0, 12));
      mountJob(rec, created.job, true);
      $("#url").value = "";
    } catch (err) {
      say(err.message);
    } finally {
      go.disabled = false;
      $("span", go).textContent = "Find my clips";
    }
  });

  // ---------------------------------------------------------------- jobs
  const views = new Map();

  function fmtDur(s) {
    s = Math.round(s || 0);
    return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function mountJob(rec, job, top) {
    if (views.has(rec.id)) return;
    const el = $("#jobTpl").content.firstElementChild.cloneNode(true);
    const v = { rec, el, timer: null, rendered: false };
    views.set(rec.id, v);
    $(".cancel", el).addEventListener("click", async () => {
      try { await api(`/jobs/${rec.id}/cancel`, { method: "POST", token: rec.token }); poll(v, 0); } catch (err) { say(err.message); }
    });
    $(".remove", el).addEventListener("click", () => {
      clearTimeout(v.timer); views.delete(rec.id); el.remove();
      store.set("ac_jobs", store.get("ac_jobs", []).filter((j) => j.id !== rec.id));
    });
    const host = $("#jobs");
    top ? host.prepend(el) : host.appendChild(el);
    if (job) paint(v, job);
    poll(v, job ? 2000 : 0);
    if (top) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  function poll(v, delay) {
    clearTimeout(v.timer);
    v.timer = setTimeout(async () => {
      if (document.hidden) { poll(v, 4000); return; }
      try {
        const { job } = await api(`/jobs/${v.rec.id}`, { token: v.rec.token });
        paint(v, job);
        if (!["done", "failed", "cancelled"].includes(job.status)) poll(v, job.status === "queued" ? 4000 : 2500);
      } catch (err) {
        if (err.status === 404) {
          $(".job-title", v.el).textContent = "Expired";
          $(".job-sub", v.el).textContent = "This job's files were deleted (24 h limit).";
          v.el.classList.add("finished");
          $(".cancel", v.el).classList.add("hidden");
          $(".remove", v.el).classList.remove("hidden");
        } else {
          poll(v, 6000);
        }
      }
    }, delay);
  }

  const ENGINE_NOTE = {
    no_ai_key: "Clips were picked by audio energy because no AI key was added. Add a free Gemini key for smarter picks.",
    ai_failed: "Your AI provider did not answer, so clips were picked by audio energy.",
    ai_found_nothing: "The AI found nothing clearly worth clipping, so clips were picked by audio energy.",
  };

  function paint(v, job) {
    const el = v.el;
    const fin = ["done", "failed", "cancelled"].includes(job.status);
    el.classList.toggle("finished", fin);
    const src = job.source || {};
    $(".job-title", el).textContent = job.title || src.name || src.url || "Your video";
    const bits = [STAGE_TEXT[job.stage] || STAGE_TEXT[job.status] || job.stage];
    if (job.status === "queued" && job.queue_position > 1) bits.push(`#${job.queue_position} in line`);
    if (job.duration) bits.push(fmtDur(job.duration) + " video");
    if (job.status === "done") bits.push(`${job.clips.length} clip${job.clips.length === 1 ? "" : "s"}`);
    $(".job-sub", el).textContent = bits.join(" · ");
    $(".bar i", el).style.width = `${job.progress}%`;
    $(".pct", el).textContent = `${job.progress}%`;
    const idx = ORDER.indexOf(job.stage === "analyzing" ? "fetching" : job.stage);
    $$(".steps li", el).forEach((li, i) => {
      li.classList.toggle("done", idx > i || job.status === "done");
      li.classList.toggle("now", idx === i && !fin);
    });
    $(".cancel", el).classList.toggle("hidden", fin);
    $(".remove", el).classList.toggle("hidden", !fin);
    const errEl = $(".job-error", el);
    errEl.classList.toggle("hidden", job.status !== "failed");
    errEl.textContent = job.error || "";
    const noteEl = $(".job-note", el);
    const eng = job.engine || {};
    let note = job.status === "done" ? ENGINE_NOTE[eng.reason] || "" : "";
    if (job.status === "done" && eng.byo && eng.usage) note = `AI: ${eng.usage.provider} · ${eng.usage.input_tokens + eng.usage.output_tokens} tokens used on your key.`;
    noteEl.textContent = note;
    noteEl.classList.toggle("hidden", !note);
    if (job.status === "done" && !v.rendered) {
      v.rendered = true;
      const zip = $(".zip", el);
      zip.href = `${BASE}/jobs/${job.id}/zip?t=${encodeURIComponent(v.rec.token)}`;
      zip.classList.remove("hidden");
      renderClips(v, job);
    }
  }

  function renderClips(v, job) {
    const host = $(".clips", v.el);
    host.textContent = "";
    const rec = { id: job.id, token: v.rec.token };
    for (const c of job.clips) {
      const el = $("#clipTpl").content.firstElementChild.cloneNode(true);
      const video = $("video", el);
      if (c.files.thumb) video.poster = fileUrl(rec, c.files.thumb);
      video.src = fileUrl(rec, c.files.video);
      $(".score", el).textContent = `${c.score}`;
      $(".len", el).textContent = fmtDur(c.duration || c.end - c.start);
      $(".hook", el).textContent = c.hook || "";
      $(".title", el).textContent = c.title || "";
      const tags = (c.hashtags || []).map((t) => "#" + t).join(" ");
      const desc = [c.description, tags].filter(Boolean).join("\n\n");
      $(".desc", el).textContent = desc;
      $(".why", el).textContent = c.reason ? `Why: ${c.reason}` : `${fmtDur(c.start)} – ${fmtDur(c.end)} in the original`;
      $(".mp4", el).href = fileUrl(rec, c.files.video, true);
      $(".srt", el).href = fileUrl(rec, c.files.srt, true);
      $$(".copy", el).forEach((b) => b.addEventListener("click", async () => {
        const text = b.dataset.copy === "title" ? c.title : desc;
        try {
          await navigator.clipboard.writeText(text);
          b.textContent = "Copied"; b.classList.add("done");
          setTimeout(() => { b.textContent = "Copy"; b.classList.remove("done"); }, 1500);
        } catch { say("Copy failed. Select the text and copy it manually."); }
      }));
      host.appendChild(el);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) views.forEach((v) => { if (!v.el.classList.contains("finished")) poll(v, 0); });
  });

  // ---------------------------------------------------------------- boot
  (async () => {
    const day = 24 * 3600 * 1000;
    const recent = store.get("ac_jobs", []).filter((j) => j && j.id && j.token && Date.now() - j.created < day);
    store.set("ac_jobs", recent);
    renderGuide();
    loadAI();
    pingHelper();
    setInterval(pingHelper, 8000);
    route();
    await Promise.all([checkHealth(), loadOptions()]);
    if (!$('[data-view="speech"]').classList.contains("hidden")) loadSpeech();
    recent.forEach((r) => mountJob(r, null, false));
    setInterval(checkHealth, 60000);
  })();
})();
