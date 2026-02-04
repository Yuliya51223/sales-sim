/* Sales Simulator v2
   - index.html: setup page -> creates session link to chat.html?sid=...
   - chat.html: chat page with manager name prompt, end dialog button reveals scoring
   - Optional LLM via Worker (YandexGPT or other) using Worker URL
   - Optional saving: download JSON or POST to Worker /save (if implemented)
*/

const STORAGE_NS = "sales-sim:v2";
const DEFAULT_CONFIG = {
  workerUrl: "",
  useLLM: true,
  saveMode: "download" // "download" | "worker"
};

document.addEventListener("DOMContentLoaded", () => {
  const path = (location.pathname || "").toLowerCase();
  if (path.endsWith("/chat.html") || path.endsWith("chat.html")) initChatPage();
  else initSetupPage();
});

/* ===================== SETUP PAGE ===================== */
function initSetupPage(){
  const createLinkBtn = byId("createLinkBtn");
  const linkOut = byId("linkOut");
  const copyBtn = byId("copyBtn");

  if (!createLinkBtn) return;

  // Prefill example
  byId("c_name").value ||= "Андрей";
  byId("c_city").value ||= "Волгоград";
  byId("c_goal").value ||= "понять варианты и цену, не переплатить";
  byId("c_context").value ||= "Частный дом, хочет перекрыть крышу, не разбирается в покрытиях.";
  byId("s_title").value ||= "Кровля: сомнения в цене и выборе покрытия";

  createLinkBtn.addEventListener("click", () => {
    const session = buildSessionFromForm();
    const sid = "s_" + randomId(12);
    saveSession(sid, session);

    const url = new URL(location.href);
    url.pathname = url.pathname.replace(/index\.html$/i, "chat.html").replace(/\/$/,"/chat.html");
    url.searchParams.set("sid", sid);

    linkOut.value = url.toString();
    toast("Ссылка создана");
  });

  copyBtn?.addEventListener("click", async () => {
    if (!linkOut.value) return;
    await navigator.clipboard.writeText(linkOut.value);
    toast("Скопировано");
  });
}

function buildSessionFromForm(){
  const rubricLines = (byId("rubric").value || "").split("\n").map(s => s.trim()).filter(Boolean);
  const checklist = rubricLines.map((line, idx) => {
    const parts = line.split("|").map(p => p.trim());
    const title = parts[0] || `Пункт ${idx+1}`;
    const desc = parts[1] || "";
    const points = toInt(parts[2], 1);
    return { key: "k" + (idx+1), title, desc, points };
  });

  return {
    createdAt: new Date().toISOString(),
    scenario: {
      title: byId("s_title").value.trim() || "Сценарий",
      client: {
        name: byId("c_name").value.trim() || "Клиент",
        city: byId("c_city").value.trim() || "",
        goal: byId("c_goal").value.trim() || "",
        tone: byId("c_tone").value,
        delivery: byId("c_delivery").value,
        context: byId("c_context").value.trim() || ""
      },
      checklist
    },
    config: {
      ...loadConfig(),
      useLLM: !!byId("llmDefault").checked
    },
    transcript: [], // filled on chat page
    manager: { fio: "" },
    endedAt: null,
    score: null
  };
}

/* ===================== CHAT PAGE ===================== */
function initChatPage(){
  const sid = new URLSearchParams(location.search).get("sid") || "";
  const session = sid ? loadSession(sid) : null;

  // DOM refs
  const chatEl = byId("chat");
  const inputEl = byId("input");
  const sendBtn = byId("sendBtn");
  const resetBtn = byId("resetBtn");
  const endBtn = byId("endBtn");
  const llmToggle = byId("llmToggle");
  const workerUrlEl = byId("workerUrl");
  const saveModeEl = byId("saveMode");
  const saveConfigBtn = byId("saveConfigBtn");

  const scenarioTitleEl = byId("scenarioTitle");
  const scenarioMetaEl = byId("scenarioMeta");
  const statusDotEl = byId("statusDot");
  const statusTextEl = byId("statusText");
  const hintTextEl = byId("hintText");
  const checklistEl = byId("checklist");
  const scoreValueEl = byId("scoreValue");
  const managerPill = byId("managerPill");
  const sessionInfo = byId("sessionInfo");

  // basic guard
  if (!session){
    scenarioTitleEl.textContent = "Сессия не найдена";
    scenarioMetaEl.textContent = "Откройте чат по ссылке из страницы настройки (index.html).";
    setStatus(statusDotEl, statusTextEl, "bad", "Нет сессии");
    disableChat(true);
    return;
  }

  // state
  const state = {
    sid,
    session,
    config: { ...loadConfig(), ...(session.config || {}) },
    history: session.transcript || [],  // {role:"user"|"assistant", content, ts}
    flags: {}, // computed on end
    ended: !!session.endedAt
  };

  // init UI config
  workerUrlEl.value = state.config.workerUrl || "";
  llmToggle.checked = !!state.config.useLLM;
  saveModeEl.value = state.config.saveMode || "download";

  // render scenario
  scenarioTitleEl.textContent = state.session.scenario.title;
  const c = state.session.scenario.client;
  scenarioMetaEl.textContent =
    `Клиент: ${c.name} • ${c.city} • Тон: ${c.tone} • Доставка: ${c.delivery} • Цель: ${c.goal}`;

  sessionInfo.textContent = `Сессия: ${sid} • Создана: ${fmtDate(state.session.createdAt)}`;

  // render chat
  renderChat(chatEl, state.history);

  // manager fio modal
  ensureManagerFio(state, managerPill);

  // checklist placeholders (hidden until end)
  renderChecklist(checklistEl, state.session.scenario.checklist, null);

  // events
  sendBtn.addEventListener("click", () => onSend(state, chatEl, inputEl, sendBtn, hintTextEl, statusDotEl, statusTextEl));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); onSend(state, chatEl, inputEl, sendBtn, hintTextEl, statusDotEl, statusTextEl); }
  });

  resetBtn.addEventListener("click", () => {
    state.history = [];
    state.session.transcript = [];
    state.session.endedAt = null;
    state.session.score = null;
    state.session.flags = null;
    state.ended = false;
    saveSession(state.sid, state.session);
    renderChat(chatEl, state.history);
    renderChecklist(checklistEl, state.session.scenario.checklist, null);
    scoreValueEl.textContent = "—";
    setHint(hintTextEl, "Напишите первое сообщение клиенту.");
    setStatus(statusDotEl, statusTextEl, null, "Офлайн/LLM готово");
  });

  endBtn.addEventListener("click", async () => {
    const result = scoreConversation(state.session.scenario.checklist, state.history);
    state.session.endedAt = new Date().toISOString();
    state.session.score = result.score;
    state.session.flags = result.flags;
    state.ended = true;
    saveSession(state.sid, state.session);

    // show score now
    scoreValueEl.textContent = `${result.score.total} баллов`;
    renderChecklist(checklistEl, state.session.scenario.checklist, result.flags);
    setHint(hintTextEl, "Диалог завершён. Можно экспортировать результат.");
    setStatus(statusDotEl, statusTextEl, "good", "Завершено");

    // auto-save
    await autoSaveResult(state);
  });

  saveConfigBtn.addEventListener("click", () => {
    state.config.workerUrl = workerUrlEl.value.trim();
    state.config.useLLM = !!llmToggle.checked;
    state.config.saveMode = saveModeEl.value;
    saveConfig(state.config);
    // also store into session so manager gets same defaults
    state.session.config = { ...state.session.config, ...state.config };
    saveSession(state.sid, state.session);
    toast("Настройки сохранены");
  });

  llmToggle.addEventListener("change", () => {
    state.config.useLLM = !!llmToggle.checked;
    saveConfig(state.config);
  });

  // initial status/hint
  if (state.config.useLLM && !state.config.workerUrl){
    setStatus(statusDotEl, statusTextEl, "warn", "LLM включен, но Worker URL пуст");
  } else if (state.config.useLLM){
    setStatus(statusDotEl, statusTextEl, "good", "LLM режим");
  } else {
    setStatus(statusDotEl, statusTextEl, null, "Офлайн режим");
  }
  setHint(hintTextEl, "Пишите коротко и по делу. Оценка появится после завершения.");

  function disableChat(disabled){
    inputEl.disabled = disabled;
    sendBtn.disabled = disabled;
    endBtn.disabled = disabled;
    resetBtn.disabled = disabled;
  }
}

async function onSend(state, chatEl, inputEl, sendBtn, hintTextEl, statusDotEl, statusTextEl){
  const text = (inputEl.value || "").trim();
  if (!text) return;

  if (state.ended){
    toast("Диалог уже завершён. Нажмите Сброс, чтобы начать заново.");
    return;
  }

  sendBtn.disabled = true;
  inputEl.value = "";

  pushMsg(state, "user", text);
  appendBubble(chatEl, text, "me");

  setStatus(statusDotEl, statusTextEl, "warn", "Клиент печатает…");

  try{
    const reply = await getClientReply(state, text);
    pushMsg(state, "assistant", reply.reply, { intent: reply.intent, tags: reply.tags });
    appendBubble(chatEl, reply.reply, "client");
    setStatus(statusDotEl, statusTextEl, state.config.useLLM ? "good" : null, "Готово");
    setHint(hintTextEl, "Продолжайте. По завершению нажмите “Завершить диалог”.");
  } catch (e){
    setStatus(statusDotEl, statusTextEl, "bad", "Ошибка");
    setHint(hintTextEl, "Ошибка ответа клиента. Проверьте Worker URL/доступ.");
    console.error(e);
  } finally {
    saveSession(state.sid, state.session);
    sendBtn.disabled = false;
  }
}

/* ===================== LLM / fallback ===================== */
async function getClientReply(state, managerMsg){
  if (state.config.useLLM && state.config.workerUrl){
    return await callWorkerChat(state, managerMsg);
  }
  // minimal offline fallback: ask to clarify
  return { reply: "Я не очень понял. Можете объяснить проще?", intent: "offline", tags: ["offline"] };
}

async function callWorkerChat(state, managerMsg){
  const url = state.config.workerUrl.replace(/\/$/,"");
  const payload = {
    history: state.session.transcript.map(m => ({ role: m.role, content: m.content })).slice(-12),
    scenario: {
      title: state.session.scenario.title,
      client: state.session.scenario.client,
      checklist: state.session.scenario.checklist,
      manager: state.session.manager,
      state: {
        turns: state.session.transcript.length
      }
    },
    manager_message: managerMsg
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok){
    const txt = await res.text();
    throw new Error(txt);
  }
  const data = await res.json();
  return { reply: String(data.reply || "Уточните, пожалуйста."), intent: String(data.intent || ""), tags: Array.isArray(data.tags) ? data.tags : [] };
}

/* ===================== SCORING (shown only on End) ===================== */
function scoreConversation(checklist, history){
  const full = history.filter(m => m.role === "user").map(m => m.content).join("\n").toLowerCase();

  const flags = {};
  let total = 0;

  for (const item of checklist){
    // lightweight heuristics; can be replaced by LLM-based grading later
    let ok = false;

    if (item.title.toLowerCase().includes("выяв")) {
      const q = (full.match(/\?/g) || []).length;
      ok = q >= 2 || /площад|м2|скат|срок|бюджет|доставк|адрес/.test(full);
    } else if (item.title.toLowerCase().includes("цена")) {
      ok = /толщин|покрыт|цинк|добор|доставк|объем|монтаж|гарант/.test(full);
    } else if (item.title.toLowerCase().includes("страх") || item.title.toLowerCase().includes("эмпат")) {
      ok = /понимаю|давайте сравним|без лишн|не перепла/.test(full);
    } else if (item.title.toLowerCase().includes("следующ")) {
      ok = /кп|коммерческ|расчет|созвон|замер|встреч|что нужно/.test(full);
    } else {
      // generic: any presence of keywords from desc (best effort)
      ok = item.desc ? item.desc.toLowerCase().split(/[,;()]/).some(k => k.trim().length >= 5 && full.includes(k.trim().slice(0,8))) : false;
    }

    flags[item.key] = { ok, points: item.points };
    if (ok) total += item.points;
  }

  return { flags, score: { total, max: checklist.reduce((s,i)=>s+i.points,0) } };
}

/* ===================== AUTO-SAVE (download or worker) ===================== */
async function autoSaveResult(state){
  const result = {
    sid: state.sid,
    createdAt: state.session.createdAt,
    endedAt: state.session.endedAt,
    scenario: state.session.scenario,
    manager: state.session.manager,
    score: state.session.score,
    flags: state.session.flags,
    transcript: state.session.transcript
  };

  if ((state.config.saveMode || "download") === "worker" && state.config.workerUrl){
    // POST to /save on same worker domain (optional)
    const base = state.config.workerUrl.replace(/\/$/,"");
    const saveUrl = base + "/save";
    try{
      const res = await fetch(saveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result)
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast(data.review_url ? "Сохранено (есть ссылка проверяющему)" : "Сохранено");
      if (data.review_url) console.log("Review URL:", data.review_url);
    } catch (e){
      console.warn(e);
      // fallback to download
      downloadJson(result, `result-${state.sid}.json`);
      toast("Не удалось отправить в Worker — скачано JSON");
    }
    return;
  }

  // default: download
  downloadJson(result, `result-${state.sid}.json`);
  toast("Скачано: результат (JSON)");
}

/* ===================== MANAGER FIO MODAL ===================== */
function ensureManagerFio(state, managerPill){
  const existing = (state.session.manager && state.session.manager.fio) ? state.session.manager.fio : "";
  if (existing){
    managerPill.textContent = `Менеджер: ${existing}`;
    return;
  }

  const modal = byId("modal");
  const mgrName = byId("mgrName");
  const mgrOk = byId("mgrOk");

  modal.classList.remove("hidden");
  mgrName.focus();

  mgrOk.addEventListener("click", () => {
    const fio = (mgrName.value || "").trim();
    if (!fio) return;
    state.session.manager = { fio };
    saveSession(state.sid, state.session);
    managerPill.textContent = `Менеджер: ${fio}`;
    modal.classList.add("hidden");
  });
}

/* ===================== SESSION STORAGE ===================== */
function saveSession(sid, session){
  const key = `${STORAGE_NS}:session:${sid}`;
  localStorage.setItem(key, JSON.stringify(session));
}

function loadSession(sid){
  const key = `${STORAGE_NS}:session:${sid}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try{ return JSON.parse(raw); } catch { return null; }
}

function loadConfig(){
  const raw = localStorage.getItem(`${STORAGE_NS}:config`);
  if (!raw) return { ...DEFAULT_CONFIG };
  try{ return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }; } catch { return { ...DEFAULT_CONFIG }; }
}

function saveConfig(cfg){
  localStorage.setItem(`${STORAGE_NS}:config`, JSON.stringify({ ...DEFAULT_CONFIG, ...cfg }));
}

/* ===================== UI HELPERS ===================== */
function renderChat(chatEl, history){
  chatEl.innerHTML = "";
  for (const m of history){
    appendBubble(chatEl, m.content, m.role === "user" ? "me" : "client");
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

function appendBubble(chatEl, text, who){
  const row = document.createElement("div");
  row.className = "msg " + (who === "me" ? "me" : "client");
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function renderChecklist(container, checklist, flags){
  container.innerHTML = "";
  for (const item of checklist){
    const ok = flags ? !!flags[item.key]?.ok : null;
    const badge = ok === null ? "—" : (ok ? `+${item.points}` : "0");
    const cls = ok === null ? "" : (ok ? "ok" : "no");
    const row = document.createElement("div");
    row.className = "checkItem";
    row.innerHTML = `
      <div class="checkLeft">
        <div class="checkTitle">${escapeHtml(item.title)}</div>
        <div class="checkDesc">${escapeHtml(item.desc)}</div>
      </div>
      <div class="badge ${cls}">${badge}</div>
    `;
    container.appendChild(row);
  }
}

function pushMsg(state, role, content, meta){
  const m = { role, content, ts: new Date().toISOString() };
  if (meta) m.meta = meta;
  state.session.transcript = state.session.transcript || [];
  state.session.transcript.push(m);
}

function setStatus(dotEl, textEl, kind, text){
  dotEl.classList.remove("good","warn","bad");
  if (kind) dotEl.classList.add(kind);
  textEl.textContent = text || "Готово";
}

function setHint(el, text){ el.textContent = text || ""; }

function toast(msg){
  // minimal: console + status bar could be extended later
  console.log("[ui]", msg);
}

function downloadJson(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function fmtDate(iso){
  if (!iso) return "—";
  try{
    const d = new Date(iso);
    return d.toLocaleString();
  } catch { return iso; }
}

function randomId(n){
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i=0;i<n;i++) s += alphabet[Math.floor(Math.random()*alphabet.length)];
  return s;
}

function toInt(s, def){
  const x = parseInt(String(s||"").trim(), 10);
  return Number.isFinite(x) ? x : def;
}

function byId(id){ return document.getElementById(id); }
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
