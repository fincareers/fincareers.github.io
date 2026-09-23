/* FinCoach — AI career coach for the Finance Careers Learning Platform.
 * Open-source stack: WebLLM (Apache-2.0, mlc-ai) running an open-weights model
 * entirely in the browser (WebGPU), with retrieval-augmented answers grounded
 * in the platform's own content (coach/kb.json). No server, no uploads.
 */
"use strict";

const KB_URL = "coach/kb.json";
const WEBLLM_CDN = "https://esm.run/@mlc-ai/web-llm";
const LS_MODEL = "fincoach-model-v1";
const CTX_CHUNKS = 4;
const MAX_TOKENS = 700;

/* Prefer capable-but-small models; fall back to the lightest available. */
const MODEL_PREFS = [
  /llama-3\.2.*3b/i,
  /qwen2\.?5.*3b/i,
  /phi-3\.5/i,
  /qwen2.*1\.5b/i,
  /smollm/i,
  /llama-3\.2.*1b/i,
  /gemma-?2b/i,
];

const $ = (id) => document.getElementById(id);
const els = {
  messages: $("messages"), starters: $("starters"), form: $("composer"),
  input: $("q"), send: $("sendBtn"),
  modeCoach: $("modeCoach"), modeInterview: $("modeInterview"),
  rolePick: $("rolePick"), modelSel: $("modelSel"), loadBtn: $("loadBtn"),
  prog: $("prog"), progFill: $("progFill"), status: $("status"),
};

const state = {
  kb: [],
  roles: [],
  engine: null,
  modelId: null,
  loading: false,
  generating: false,
  mode: "coach",
  history: [],          // [{role, content}] assistant turns, trimmed
  lastSources: [],      // kb chunks used for the latest answer
};

const STOP = new Set(
  ("a,an,the,and,or,but,of,to,in,on,for,with,from,at,by,is,are,was,were,be,been," +
   "what,how,when,where,which,who,whom,why,does,do,did,can,could,should,would," +
   "i,me,my,you,your,we,our,it,its,this,that,these,those,as,into,about,than," +
   "tell,give,show,explain,between,through,over,under,more,most,other,some," +
   "such,just,like,get,got,need,want,make,many,much,very,really,also,well," +
   "career,careers,job,jobs,role,roles,finance,financial").split(","));

/* ------------------------------------------------------------ knowledge */
function tokens(s) {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
}

function retrieve(query, k = CTX_CHUNKS) {
  const qs = tokens(query);
  if (!qs.length || !state.kb.length) return [];
  const qlow = " " + query.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  return state.kb
    .map((c) => {
      const tt = tokens(c.title + " " + c.section);
      const bt = tokens(c.text);
      let s = 0;
      for (const t of qs) {
        const th = tt.reduce((n, x) => n + (x === t || x.startsWith(t) ? 1 : 0), 0);
        const bh = bt.reduce((n, x) => n + (x === t || x.startsWith(t) ? 1 : 0), 0);
        s += th * 4 + Math.min(bh, 6);
      }
      // Phrase bonus: the chunk's title words appearing contiguously in the
      // query means the user is asking about exactly this thing.
      const pt = tokens(c.title);
      const joined = pt.join(" ");
      if (joined && qlow.includes(" " + joined + " ")) s += 24;
      else if (pt.length > 1) {
        for (let i = 0; i + 1 < pt.length; i++) {
          if (qlow.includes(" " + pt[i] + " " + pt[i + 1] + " ")) { s += 12; break; }
        }
      }
      return { c, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k);
}

function contextBlock(hits) {
  return hits
    .map((h, i) => `[${i + 1}] ${h.c.title} (${h.c.section}) — ${h.c.url}\n${h.c.text}`)
    .join("\n\n");
}

function systemPrompt() {
  if (state.mode === "interview") {
    const role = els.rolePick.value || "finance operations analyst";
    return (
      `You are a hiring manager running a mock interview for the "${role}" role at a financial firm. ` +
      `Rules: ask exactly ONE interview question per message. When the candidate answers, give brief feedback ` +
      `(one strength, one specific improvement grounded in the platform sources below), then ask the next question. ` +
      `Vary difficulty. Keep a professional, encouraging tone. ` +
      `If the candidate asks to wrap up or end, give an overall assessment: 2 strengths, 2 things to work on, ` +
      `and the 2 most relevant platform modules to study next, with links from the sources. ` +
      `Never invent salaries, firms, or hiring statistics.\n\nPlatform sources:\n` + contextBlock(state.lastHits || [])
    );
  }
  return (
    `You are FinCoach, the AI career coach of the Finance Careers Learning Platform. ` +
    `Answer the learner's question concisely and practically, using the platform sources below for facts. ` +
    `Cite factual claims with [n] matching the source numbers. Keep answers under 220 words unless asked for depth. ` +
    `Use short paragraphs and bullet lists. If the sources do not cover the question, say so in one sentence ` +
    `and suggest the closest module or page from the sources. ` +
    `Never invent salaries, hiring statistics, credentials, or firm names.\n\nPlatform sources:\n` +
    contextBlock(state.lastHits || [])
  );
}

/* -------------------------------------------------------------- rendering */
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function linkifyCitations(html, sources) {
  return html.replace(/\[(\d+)\]/g, (m, n) => {
    const src = sources[Number(n) - 1];
    if (!src) return m;
    return `<a class="cite" href="${esc(src.url)}" title="${esc(src.title)}">[${n}]</a>`;
  });
}

function mdLite(text, sources) {
  let s = linkifyCitations(esc(text), sources);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = s.split("\n");
  let out = "", inList = false, listTag = "ul";
  const closeList = () => { if (inList) { out += `</${listTag}>`; inList = false; } };
  for (const line of lines) {
    const t = line.trim();
    const um = t.match(/^[-*]\s+(.*)/);
    const om = t.match(/^\d+[.)]\s+(.*)/);
    if (um || om) {
      const tag = om ? "ol" : "ul";
      if (!inList || listTag !== tag) { closeList(); out += `<${tag}>`; inList = true; listTag = tag; }
      out += `<li>${(um || om)[1]}</li>`;
    } else if (!t) {
      closeList();
    } else {
      closeList();
      out += `<p>${t}</p>`;
    }
  }
  closeList();
  return out;
}

function addMsg(who, html) {
  const d = document.createElement("div");
  d.className = "msg " + who;
  d.innerHTML = html;
  els.messages.appendChild(d);
  els.messages.scrollTop = els.messages.scrollHeight;
  return d;
}

function sourcesFooter(sources) {
  if (!sources.length) return "";
  const links = sources
    .map((s, i) => `<a href="${esc(s.url)}">[${i + 1}] ${esc(s.title)}</a>`)
    .join("");
  return `<div class="srcs">Sources: ${links}</div>`;
}

function renderExtractive(hits, query) {
  const note = state.mode === "interview"
    ? (("gpu" in navigator)
      ? `<p><em>Load the model above to run the mock interview — meanwhile, here's the closest material from the guides:</em></p>`
      : `<p><em>Mock interviews need the on-device model (requires WebGPU), which this browser doesn't support — here's the closest material from the guides instead:</em></p>`)
    : "";
  if (!hits.length) {
    addMsg("bot", note + `<p>I couldn't find anything on that in the platform guides. Try asking about a track, a role (e.g. collateral analyst), or interview prep — or browse the <a href="index.html">learning paths</a>.</p>`);
    return;
  }
  const qts = tokens(query);
  const cards = hits.slice(0, 3).map((h, i) => {
    const text = h.c.text;
    const low = text.toLowerCase();
    let pos = -1;
    for (const t of qts) { const p = low.indexOf(t); if (p >= 0) { pos = p; break; } }
    const start = Math.max(0, (pos < 0 ? 0 : pos) - 90);
    const snippet = (start > 0 ? "…" : "") + text.slice(start, start + 260) + "…";
    return `<p><strong>[${i + 1}] ${esc(h.c.title)}</strong><br>${esc(snippet)}<br><a href="${esc(h.c.url)}">Open ${esc(h.c.section.toLowerCase())} →</a></p>`;
  }).join("");
  addMsg("bot", note + cards);
}

/* ------------------------------------------------------------------ chat */
function setBusy(busy) {
  state.generating = busy;
  els.send.disabled = busy;
  els.input.disabled = busy;
}

async function ask(text) {
  text = text.trim();
  if (!text || state.generating) return;
  addMsg("user", `<p>${esc(text)}</p>`);
  els.input.value = "";
  const hits = retrieve(text, CTX_CHUNKS);
  state.lastHits = hits;
  state.lastSources = hits.map((h) => h.c);

  if (!state.engine) {
    renderExtractive(hits, text);   // guide-search fallback: no WebGPU / no model
    return;
  }

  setBusy(true);
  const bubble = addMsg("bot", `<span class="typing"><i></i><i></i><i></i></span>`);
  const messages = [{ role: "system", content: systemPrompt() }];
  for (const m of state.history.slice(-10)) messages.push(m);
  messages.push({ role: "user", content: text });

  let full = "";
  try {
    const stream = await state.engine.chat.completions.create({
      messages, stream: true, temperature: 0.6, max_tokens: MAX_TOKENS,
    });
    let first = true;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      if (!delta) continue;
      if (first) { bubble.innerHTML = ""; first = false; }
      full += delta;
      bubble.innerHTML = mdLite(full, state.lastSources);
      els.messages.scrollTop = els.messages.scrollHeight;
    }
    if (!full) throw new Error("empty");
    bubble.innerHTML = mdLite(full, state.lastSources) + sourcesFooter(state.lastSources);
    state.history.push({ role: "user", content: text }, { role: "assistant", content: full });
    state.history = state.history.slice(-12);
  } catch (e) {
    bubble.innerHTML = `<p>Something hiccupped on-device. Here's what the guides say instead:</p>`;
    renderExtractive(hits, text);
  } finally {
    setBusy(false);
    els.messages.scrollTop = els.messages.scrollHeight;
  }
}

/* ------------------------------------------------------------ model load */
function pickDefaultModel(list) {
  for (const re of MODEL_PREFS) {
    const m = list.find((x) => re.test(x.model_id));
    if (m) return m.model_id;
  }
  const sorted = [...list].sort((a, b) => (a.vram_required_MB || 1e9) - (b.vram_required_MB || 1e9));
  return sorted.length ? sorted[0].model_id : null;
}

function fmtSize(m) {
  const mb = m.vram_required_MB;
  return mb ? ` — ${(mb / 1024).toFixed(1)} GB` : "";
}

async function initModels() {
  let webllm;
  try {
    webllm = await import(/* @vite-ignore */ WEBLLM_CDN);
  } catch (e) {
    throw new Error("cdn");
  }
  const list = (webllm.prebuiltAppConfig && webllm.prebuiltAppConfig.model_list) || [];
  if (!list.length) throw new Error("nomodels");
  state.webllm = webllm;
  els.modelSel.innerHTML = "";
  for (const m of list) {
    const o = document.createElement("option");
    o.value = m.model_id;
    o.textContent = m.model_id + fmtSize(m);
    els.modelSel.appendChild(o);
  }
  const saved = localStorage.getItem(LS_MODEL);
  const def = saved && list.some((m) => m.model_id === saved) ? saved : pickDefaultModel(list);
  els.modelSel.value = def;
  state.modelId = def;
  els.modelSel.disabled = false;
  els.loadBtn.disabled = false;
}

async function loadModel() {
  if (state.loading || state.engine) return;
  state.loading = true;
  els.loadBtn.disabled = true;
  els.modelSel.disabled = true;
  els.prog.classList.add("on");
  els.status.className = "status";
  const webllm = state.webllm;
  try {
    state.engine = await webllm.CreateMLCEngine(state.modelId, {
      initProgressCallback: (p) => {
        els.progFill.style.width = Math.round((p.progress || 0) * 100) + "%";
        els.status.textContent = p.text || "";
      },
    });
    localStorage.setItem(LS_MODEL, state.modelId);
    els.status.className = "status ok";
    els.status.textContent = "Model ready — running on your device.";
    els.prog.classList.remove("on");
    enableChat("Ask about tracks, roles, or interview prep…");
    addMsg("bot", `<p>I'm loaded and ready. I answer from the platform's guides, roadmaps, role profiles, and dictionary — ask me anything, or try a suggestion below.</p>`);
  } catch (e) {
    state.engine = null;
    state.loading = false;
    els.loadBtn.disabled = false;
    els.modelSel.disabled = false;
    els.status.className = "status err";
    els.status.textContent = "Model failed to load (" + (e && e.message ? e.message : "unknown error") + "). Guide search still works below.";
    enableChat("Guide search is on — ask anything…");
  }
}

function enableChat(placeholder) {
  els.input.disabled = false;
  els.send.disabled = false;
  els.input.placeholder = placeholder || "Ask FinCoach…";
  els.input.focus();
}

/* ----------------------------------------------------------------- modes */
const STARTERS = {
  coach: [
    "Which track fits a move from client service into fintech?",
    "What does a collateral analyst do day to day?",
    "Build me a 2-week interview prep plan for operations",
    "Explain a securities lending loan lifecycle",
  ],
  interview: ["Start the interview", "Ask me something harder", "Wrap up with feedback"],
};

function renderStarters() {
  els.starters.innerHTML = "";
  for (const s of STARTERS[state.mode]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "starter";
    b.textContent = s;
    b.addEventListener("click", () => ask(s));
    els.starters.appendChild(b);
  }
}

function setMode(mode) {
  state.mode = mode;
  state.history = [];
  const ic = mode === "interview";
  els.modeCoach.classList.toggle("on", !ic);
  els.modeInterview.classList.toggle("on", ic);
  els.modeCoach.setAttribute("aria-selected", String(!ic));
  els.modeInterview.setAttribute("aria-selected", String(ic));
  els.rolePick.hidden = !ic;
  renderStarters();
  addMsg("bot", ic
    ? `<p><strong>Mock interview mode.</strong> Pick a role above, then say "start". I'll ask one question at a time, give feedback on each answer, and wrap up with a study plan when you're done.</p>`
    : `<p><strong>Career coach mode.</strong> Ask about tracks, roles, skills, or study plans — I answer from the platform's own guides.</p>`);
}

/* ------------------------------------------------------------------- init */
async function init() {
  try {
    const r = await fetch(KB_URL);
    const kb = await r.json();
    state.kb = kb.chunks || [];
    state.roles = state.kb
      .filter((c) => c.section === "Role profile")
      .map((c) => c.title.replace(/^Role profile:\s*/, "").replace(/\s*\(.*\)$/, ""));
    els.rolePick.innerHTML = state.roles.map((t) => `<option>${esc(t)}</option>`).join("");
  } catch (e) {
    addMsg("bot", `<p>The guide index didn't load — check your connection and refresh.</p>`);
    return;
  }

  renderStarters();
  addMsg("bot", `<p>Hi, I'm <strong>FinCoach</strong> — your AI career coach for finance. I can explain roles, recommend tracks, build study plans, and run mock interviews, all grounded in this platform's guides.</p><p>First, load an open-source model on your device (one-time download, then cached) — or just start typing and I'll search the guides directly.</p>`);

  els.modeCoach.addEventListener("click", () => setMode("coach"));
  els.modeInterview.addEventListener("click", () => setMode("interview"));
  els.form.addEventListener("submit", (e) => { e.preventDefault(); ask(els.input.value); });
  els.input.addEventListener("input", () => { els.send.disabled = state.generating || !els.input.value.trim(); });
  els.loadBtn.addEventListener("click", loadModel);
  els.modelSel.addEventListener("change", () => { state.modelId = els.modelSel.value; });

  if (!("gpu" in navigator)) {
    els.status.className = "status warn";
    els.status.textContent = "No WebGPU in this browser — running in guide-search mode (no download needed).";
    enableChat("Search the guides…");
    return;
  }
  try {
    await initModels();
    els.status.textContent = "Model list loaded. Hit Load to download (one time).";
  } catch (e) {
    els.status.className = "status warn";
    els.status.textContent = "Couldn't reach the model library — guide search still works below.";
    enableChat("Guide search is on — ask anything…");
  }
}

init();
