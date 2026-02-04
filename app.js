/* === Hybrid Sales Chat Simulator (Scenario + Optional LLM via Worker) ===
   - No build tools. Vanilla JS.
   - LLM mode calls a serverless proxy (Worker) to keep API key off the browser.
   - Offline fallback is rule-based so you can run it locally or on GitHub Pages.
*/

const STORAGE_KEY = "sales-sim:v1";

const DEFAULT_CONFIG = {
  useLLM: false,
  workerUrl: "",              // e.g. https://your-worker.workers.dev
  fallbackMode: "rules"       // "rules" | "random"
};

// One scenario + scoring rules (MVP)
const scenario = {
  id: "s001",
  title: "Кровля для частного дома: сомнения в цене и выборе покрытия",
  client: {
    name: "Андрей",
    tone: "спокойный",
    knowledge: "низкий",
    goal: "понять варианты и цену, не переплатить",
    constraints: "срок ~ 2 недели"
  },
  context: {
    city: "Волгоград",
    product: "профлист/металлочерепица",
    pain: "не понимает разницу покрытий, боится переплатить"
  },
  // What the scenario expects the manager to do
  checklist: [
    {
      key: "need_discovery",
      title: "Выявление потребностей",
      desc: "Задать 2+ уточняющих вопроса: площадь/геометрия, покрытие, сроки, доставка, бюджет."
    },
    {
      key: "price_frame",
      title: "Объяснить от чего зависит цена",
      desc: "Коротко и понятно: толщина, покрытие, объем, доборные элементы, доставка/монтаж."
    },
    {
      key: "empathy",
      title: "Снять страх переплаты",
      desc: "Эмпатия + логика: 'понимаю', 'сравним 2–3 варианта', 'без лишних затрат'."
    },
    {
      key: "next_step",
      title: "Следующий шаг",
      desc: "Предложить КП/созвон/замер и зафиксировать что нужно для расчёта."
    }
  ],
  // Offline reply rules (fallback)
  rules: [
    {
      id: "start",
      when: (m, st) => st.turns === 0,
      reply: () => "Здравствуйте. Хочу крышу перекрыть, но не понимаю что выбрать и сколько это будет стоить."
    },
    {
      id: "ask_price_first",
      when: (m, st) => /цена|сколько|стоимость|дорого|дешев/i.test(m) && st.needLevel < 2,
      reply: () => "А от чего зависит цена? Мне бы понять порядок. Дом частный."
    },
    {
      id: "provide_area",
      when: (m, st) => /площад|м2|квадрат|скат|угол|размер|ширин|длин|план|чертеж/i.test(m),
      effect: (st) => { st.clientShared.area = true; st.needLevel = Math.max(st.needLevel, 2); },
      reply: () => "Площадь примерно 140 м², два ската. Чертежа нет, могу примерно описать."
    },
    {
      id: "objection_overpay",
      when: (m, st) => /покрыт|полимер|грунт|толщин|гарант|срок служб|цинк/i.test(m) || st.flags.priceFrame,
      reply: () => "Честно, боюсь переплатить. Хочется надежно, но без лишних затрат."
    },
    {
      id: "ready_next_step",
      when: (m, st) => /кп|коммерческ|расчет|смет|созвон|замер|встреч|whatsapp|телеграм|телефон/i.test(m),
      effect: (st) => { st.flags.nextStep = true; },
      reply: () => "Давайте. Как удобнее — созвон или вы пришлете расчет в сообщении?"
    },
    {
      id: "close",
      when: (m, st) => st.flags.needDiscovery && st.flags.priceFrame && st.flags.nextStep,
      reply: () => "Ок, звучит хорошо. Пришлите 2–3 варианта с разницей по покрытию, срокам и итоговой цене."
    },
    {
      id: "generic",
      when: () => true,
      reply: () => "Понял. Можно чуть проще? Я не очень разбираюсь."
    }
  ]
};

// ===== State =====
const state = {
  config: loadConfig(),
  history: [],      // in chat format: {role: "user"|"assistant", content: string}
  turns: 0,
  flags: {
    needDiscovery: false,
    priceFrame: false,
    empathy: false,
    nextStep: false
  },
  needLevel: 0,
  clientShared: {
    area: false
  }
};

// ===== DOM =====
const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const resetBtn = document.getElementById("resetBtn");
const exportBtn = document.getElementById("exportBtn");
const llmToggle = document.getElementById("llmToggle");
const workerUrlEl = document.getElementById("workerUrl");
const fallbackModeEl = document.getElementById("fallbackMode");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const scoreValueEl = document.getElementById("scoreValue");
const checklistEl = document.getElementById("checklist");
const scenarioTitleEl = document.getElementById("scenarioTitle");
const scenarioMetaEl = document.getElementById("scenarioMeta");
const statusDotEl = document.getElementById("statusDot");
const statusTextEl = document.getElementById("statusText");
const hintTextEl = document.getElementById("hintText");

// ===== Init =====
renderScenario();
renderChecklist();
applyConfigToUI();
boot();

// ===== Functions =====
function boot(){
  // load session history
  const saved = loadSession();
  if (saved){
    state.history = saved.history || [];
    state.turns = saved.turns || 0;
    state.flags = saved.flags || state.flags;
    state.needLevel = saved.needLevel || 0;
    state.clientShared = saved.clientShared || state.clientShared;
    state.config = saved.config || state.config;
    applyConfigToUI();
  }
  renderChat();
  if (state.turns === 0){
    // start with client greeting
    postClientMessage(offlineReply("", true));
  }
  updateUI();
}

function renderScenario(){
  scenarioTitleEl.textContent = scenario.title;
  scenarioMetaEl.textContent =
    `Клиент: ${scenario.client.name} • Тон: ${scenario.client.tone} • Цель: ${scenario.client.goal} • Контекст: ${scenario.context.city}, ${scenario.context.product}`;
}

function renderChecklist(){
  checklistEl.innerHTML = "";
  for (const item of scenario.checklist){
    const row = document.createElement("div");
    row.className = "checkItem";
    row.innerHTML = `
      <div class="checkLeft">
        <div class="checkTitle">${escapeHtml(item.title)}</div>
        <div class="checkDesc">${escapeHtml(item.desc)}</div>
      </div>
      <div class="badge no" id="badge-${item.key}">нет</div>
    `;
    checklistEl.appendChild(row);
  }
}

function applyConfigToUI(){
  llmToggle.checked = !!state.config.useLLM;
  workerUrlEl.value = state.config.workerUrl || "";
  fallbackModeEl.value = state.config.fallbackMode || "rules";
}

function setStatus(kind, text){
  statusDotEl.classList.remove("good","warn","bad");
  if (kind) statusDotEl.classList.add(kind);
  statusTextEl.textContent = text || "Готово";
}

function renderChat(){
  chatEl.innerHTML = "";
  for (const msg of state.history){
    addBubble(msg.content, msg.role === "user" ? "me" : "client");
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addBubble(text, who, tagText){
  const row = document.createElement("div");
  row.className = "msg " + (who === "me" ? "me" : "client");
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  if (tagText){
    const tag = document.createElement("div");
    tag.className = "smalltag";
    tag.textContent = tagText;
    bubble.appendChild(tag);
  }
  row.appendChild(bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function postManagerMessage(text){
  state.history.push({ role: "user", content: text });
  addBubble(text, "me");
}

function postClientMessage(text, tag){
  state.history.push({ role: "assistant", content: text });
  addBubble(text, "client", tag || "");
}

function updateUI(){
  const score = computeScore();
  scoreValueEl.textContent = String(score.total);

  // badges
  setBadge("need_discovery", state.flags.needDiscovery);
  setBadge("price_frame", state.flags.priceFrame);
  setBadge("empathy", state.flags.empathy);
  setBadge("next_step", state.flags.nextStep);

  // hints
  hintTextEl.textContent = makeHint();

  // status indicator
  if (state.config.useLLM && !state.config.workerUrl){
    setStatus("warn", "LLM включен, но Worker URL пуст");
  } else if (state.config.useLLM){
    setStatus("good", "LLM режим");
  } else {
    setStatus(null, "Офлайн режим");
  }

  saveSession();
}

function setBadge(key, ok){
  const el = document.getElementById(`badge-${key}`);
  if (!el) return;
  el.classList.remove("ok","no");
  el.classList.add(ok ? "ok" : "no");
  el.textContent = ok ? "ок" : "нет";
}

function computeScore(){
  // simple weights
  const w = { needDiscovery: 3, priceFrame: 3, empathy: 2, nextStep: 2 };
  let total = 0;
  if (state.flags.needDiscovery) total += w.needDiscovery;
  if (state.flags.priceFrame) total += w.priceFrame;
  if (state.flags.empathy) total += w.empathy;
  if (state.flags.nextStep) total += w.nextStep;
  return { total };
}

function makeHint(){
  if (!state.flags.needDiscovery) return "Спросите параметры: площадь, геометрия, сроки, доставка.";
  if (!state.flags.priceFrame) return "Объясните простыми словами от чего зависит цена.";
  if (!state.flags.empathy) return "Снимите страх переплаты: 'понимаю', сравним 2–3 варианта.";
  if (!state.flags.nextStep) return "Предложите следующий шаг: КП/созвон/замер.";
  return "Можно завершать: зафиксируйте договоренности и отправьте варианты.";
}

// ===== Evaluation from manager message =====
function evaluateManagerMessage(m){
  const msg = (m || "").toLowerCase();

  // Need discovery: 2+ question marks or key parameters asked
  const qCount = (m.match(/\?/g) || []).length;
  const asksParams = /площад|м2|квадрат|скат|угол|размер|доставк|срок|адрес|бюджет|проект|чертеж/.test(msg);
  if (qCount >= 2 || (asksParams && state.needLevel >= 1)) state.flags.needDiscovery = true;
  if (asksParams) state.needLevel = Math.min(3, state.needLevel + 1);

  // Price framing: mentions drivers
  const frames = /толщин|покрыт|цинк|добор|саморез|доставк|объем|монтаж|гарант|срок служб/.test(msg);
  if (frames) state.flags.priceFrame = true;

  // Empathy: simple phrases
  const empath = /понимаю|вас понимаю|логично|согласен|не переплач|без лишн|давайте сравним|подберем/.test(msg);
  if (empath) state.flags.empathy = true;

  // Next step
  const next = /кп|коммерческ|расчет|смет|созвон|замер|встреч|оформим|зафиксир|что нужно/.test(msg);
  if (next) state.flags.nextStep = true;
}

// ===== Client reply (LLM or offline) =====
async function getClientReply(managerMsg){
  if (state.config.useLLM && state.config.workerUrl){
    return await llmReply(managerMsg);
  }
  return { reply: offlineReply(managerMsg, false), intent: "offline", tags: ["offline"] };
}

async function llmReply(managerMsg){
  setStatus("warn", "Клиент печатает…");
  const payload = {
    history: state.history.slice(-12), // keep short
    scenario: {
      id: scenario.id,
      title: scenario.title,
      client: scenario.client,
      context: scenario.context,
      // Include current state so LLM stays on rails
      state: {
        turns: state.turns,
        flags: state.flags,
        needLevel: state.needLevel,
        clientShared: state.clientShared
      }
    },
    manager_message: managerMsg
  };

  const url = state.config.workerUrl.replace(/\/$/, "");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok){
    const text = await res.text();
    setStatus("bad", "Ошибка Worker");
    return { reply: "Похоже, произошла ошибка. Можем начать заново?", intent: "error", tags: ["worker_error"], debug: text.slice(0, 200) };
  }

  const data = await res.json();
  // Expect {reply, intent, tags}
  return {
    reply: String(data.reply || "Уточните, пожалуйста."),
    intent: String(data.intent || "unknown"),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : []
  };
}

function offlineReply(managerMsg, isStart){
  const m = (managerMsg || "").trim();
  if (isStart) return scenario.rules[0].reply();

  // Optional: add small randomness in "random" mode
  const randomMode = state.config.fallbackMode === "random";
  const jitter = randomMode ? (Math.random() < 0.25) : false;

  for (const rule of scenario.rules){
    if (rule.when(m, state)){
      if (rule.effect) rule.effect(state);
      const base = rule.reply(m, state);
      if (jitter && rule.id === "generic"){
        const alt = [
          "А можно пример по цене? Я просто не понимаю, что выбрать.",
          "Я запутался: какое покрытие надежнее и не слишком дорого?",
          "Если честно, хочу понять разницу без сложных терминов."
        ];
        return alt[Math.floor(Math.random() * alt.length)];
      }
      return base;
    }
  }
  return "Понял.";
}

// ===== Events =====
sendBtn.addEventListener("click", onSend);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey){
    e.preventDefault();
    onSend();
  }
});

resetBtn.addEventListener("click", () => resetAll(true));
exportBtn.addEventListener("click", exportSession);

saveConfigBtn.addEventListener("click", () => {
  state.config.workerUrl = workerUrlEl.value.trim();
  state.config.fallbackMode = fallbackModeEl.value;
  state.config.useLLM = llmToggle.checked;
  saveConfig();
  updateUI();
});

llmToggle.addEventListener("change", () => {
  state.config.useLLM = llmToggle.checked;
  saveConfig();
  updateUI();
});

async function onSend(){
  const text = inputEl.value.trim();
  if (!text) return;

  sendBtn.disabled = true;
  inputEl.value = "";

  postManagerMessage(text);
  evaluateManagerMessage(text);
  state.turns += 1;
  updateUI();

  try{
    const { reply, intent, tags } = await getClientReply(text);
    const tag = tags && tags.length ? `${intent}: ${tags.join(", ")}` : intent;
    postClientMessage(reply, state.config.useLLM ? tag : "");
    setStatus(state.config.useLLM ? "good" : null, "Готово");
  } finally {
    sendBtn.disabled = false;
    updateUI();
  }
}

function resetAll(withGreeting){
  state.history = [];
  state.turns = 0;
  state.flags = { needDiscovery: false, priceFrame: false, empathy: false, nextStep: false };
  state.needLevel = 0;
  state.clientShared = { area: false };
  clearSession();
  renderChat();
  if (withGreeting) postClientMessage(offlineReply("", true));
  updateUI();
}

function exportSession(){
  const data = {
    scenario: scenario.id,
    exportedAt: new Date().toISOString(),
    config: state.config,
    turns: state.turns,
    flags: state.flags,
    history: state.history
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `session-${scenario.id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ===== Storage =====
function loadConfig(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...(parsed.config || {}) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(){
  const current = loadSession() || {};
  const payload = { ...current, config: state.config };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadSession(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSession(){
  const payload = {
    config: state.config,
    history: state.history,
    turns: state.turns,
    flags: state.flags,
    needLevel: state.needLevel,
    clientShared: state.clientShared
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function clearSession(){
  localStorage.removeItem(STORAGE_KEY);
}

// ===== Utils =====
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
