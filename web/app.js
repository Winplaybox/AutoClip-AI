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

  // ---------------------------------------------------------------- storage (can throw in some browsers)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
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

  // ---------------------------------------------------------------- server status + options
  const statusEl = $("#status");
  async function checkHealth() {
    try {
      const h = await api("/health");
      statusEl.className = "status " + (h.enabled ? "ok" : "down");
      $("span", statusEl).textContent = h.enabled ? (h.ai ? "AI online" : "Online (basic mode)") : "Paused";
      return h;
    } catch {
      statusEl.className = "status down";
      $("span", statusEl).textContent = "Offline";
      return null;
    }
  }

  const state = { style: "pop", layout: "auto", limits: null };

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
    caption_styles: [
      { id: "pop", name: "Pop Highlight" }, { id: "single", name: "One Word Punch" }, { id: "box", name: "Boxed Phrase" },
      { id: "karaoke", name: "Karaoke Fill" }, { id: "minimal", name: "Minimal" }, { id: "none", name: "No captions" }],
    layouts: [{ id: "auto", name: "Auto" }, { id: "face", name: "Face crop" }, { id: "center", name: "Center crop" },
      { id: "fit", name: "Fit + blur" }],
    languages: [{ id: "auto", name: "Auto detect" }, { id: "hi", name: "Hindi / Hinglish" }, { id: "en", name: "English" }],
    limits: null,
  };

  async function loadOptions() {
    let o = FALLBACK_OPTIONS;
    try { o = await api("/options"); } catch { /* keep fallback */ }
    chips($("#styles"), o.caption_styles, "style");
    chips($("#layouts"), o.layouts, "layout");
    const sel = $("#language");
    sel.textContent = "";
    for (const l of o.languages) sel.add(new Option(l.name, l.id));
    state.limits = o.limits;
    if (o.limits) {
      const parts = [];
      if (o.limits.daily && !o.unlimited) parts.push(`${o.limits.daily} free videos per day`);
      parts.push(`up to ${o.limits.max_source_minutes} min`, `${o.limits.max_upload_mb} MB uploads`);
      $("#limits").textContent = parts.join(" · ");
      $("#dropHint").textContent = `MP4, MOV, MKV, WEBM · max ${o.limits.max_upload_mb} MB`;
    }
  }

  // ---------------------------------------------------------------- form
  let mode = "link";
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
      hook: $("#hook").checked, focus: $("#focus").value.trim().slice(0, 300),
    };
  }

  function uploadJob(file, st, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("settings", JSON.stringify(st));
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
        $("span", go).textContent = "Sending…";
        created = await api("/jobs", { method: "POST", body: { url, settings: st } });
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
    if (job.engine && job.engine.engine === "loudness") bits.push("picked by audio energy");
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
      const mp4 = $(".mp4", el);
      mp4.href = fileUrl(rec, c.files.video, true);
      const srt = $(".srt", el);
      srt.href = fileUrl(rec, c.files.srt, true);
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
    await Promise.all([checkHealth(), loadOptions()]);
    recent.forEach((r) => mountJob(r, null, false));
    setInterval(checkHealth, 60000);
  })();
})();
