/* sales-sim v3
   - Setup: objections + rubric blocks (checkbox + points)
   - Chat: manager FIO modal
   - End: score shown; includes basic grammar check and "no interrupt" heuristic
*/

const STORAGE_NS = "sales-sim:v3";
const DEFAULT_CONFIG = { workerUrl: "https://royal-breeze-aac8.julya14temina.workers.dev/", useLLM: true, saveMode: "download" };


const RUBRIC_CATALOG = [
  { block: "Установление контакта", items: [
    { id:"greeting", label:"Приветствие" },
    { id:"intro_self", label:"Представление себя" },
    { id:"intro_company", label:"Представление Компании" },
    { id:"ask_client_name", label:"Уточнение имени клиента в начале диалога" },
    { id:"ask_region", label:"Уточняет регион клиента в начале диалога" }
  ]},
  { block: "Норма общения", items: [
    { id:"use_name_3", label:"Использует имя клиента в разговоре 3 и более раз" },
    { id:"formatting", label:"Уверенность в голосе/ соблюдение норм оформления сообщений в чате" },
    { id:"initiative", label:"Проявляет инициативу в разговоре" },
    { id:"grammar", label:"Грамотная деловая речь (проверка грамотности менеджера в диалоге)" },
    { id:"no_interrupt", label:"Не перебивает клиента/не говорит одновременно с клиентом" },
    { id:"active_listen", label:"Использует техники активного слушания" }
  ]},
  { block: "Выявление потребностей", items: [
    { id:"open_questions", label:"Использует открытые вопросы" },
    { id:"purpose", label:"Уточняет сфокусированными вопросами для чего нужен материал (кровля/забор/коттедж/дача и т.п.)" },
    { id:"object_type", label:"Уточняет тип объекта (жилой/коммерческий/промышленный/склад/торговый центр)?" },
    { id:"thickness", label:"Определяет толщину металла" },
    { id:"color", label:"Определяет цвет металла" },
    { id:"coating", label:"Определяет покрытие (матовое/глянец/цинк и т.п.)" },
    { id:"shape", label:"Определяет какая нужна форма (С-8/С-20, Геркулес/Супермонтеррей, евро-штакетник/евротрапеция и т.п.)" },
    { id:"calc_data", label:"Узнает данные для расчета: длина забора, длина ската и т.п." },
    { id:"extras", label:"Определяет доборные материалы / предлагает посчитать доборные материалы" },
    { id:"summarize", label:"Резюмирует информацию" }
  ]},
  { block: "Презентация", items: [
    { id:"send_whatsapp", label:"Предлагает отправить на WhatsApp фото/счета и др. информацию для презентации" },
    { id:"why_product", label:"Объясняет, почему предлагает продукт / озвучивает рекомендованную толщину, если клиент не знает" },
    { id:"company_benefits", label:"Проговаривает преимущества компании" },
    { id:"fit_needs", label:"Презентация и преимущества материала соответствуют выявленным потребностям клиента" },
    { id:"present_extras", label:"Презентует доборные материалы/сопутствующие" }
  ]},
  { block: "Предзакрытие", items: [
    { id:"feedback", label:"Берет обратную связь (\"Как Вам предложение?\" / \"Остались вопросы?\")" }
  ]},
  { block: "Работа с возражениями", items: [
    { id:"listen_no_interrupt", label:"Выслушал и не перебивал" },
    { id:"agree_join", label:"Соглашается/присоединяется (\"Понимаю вас\") / задает уточняющие вопросы" },
    { id:"argue", label:"Аргументирует по сути возражения" },
    { id:"retry_sale", label:"Предпринял повторную попытку продажи" }
  ]},
  { block: "Закрытие", items: [
    { id:"next_steps", label:"Рассказывает о дальнейших шагах" },
    { id:"delivery_or_pickup", label:"Уточняет доставка или самовывоз, узнал адрес доставки" },
    { id:"crm_data", label:"Уточняет информацию для карточки клиента (ФИО, юр/физ для amoCRM)" },
    { id:"after_chat_whatsapp", label:"После звонка продолжил общение в WhatsApp" },
    { id:"ready_order", label:"Если клиент готов оформить заказ" },
    { id:"closing_techniques", label:"Использует техники завершения сделки (прямой/альтернативный вопрос, 3 \"да\", спешка и др.)" },
    { id:"not_ready_order", label:"Если клиент не готов оформить заказ" },
    { id:"invite_office_or_callback", label:"Пригласил в офис к назначенному дню и времени / назначил перезвон" }
  ]}
];


document.addEventListener("DOMContentLoaded", () => {
  const p = (location.pathname || "").toLowerCase();
  if (p.endsWith("chat.html")) initChat();
  else initSetup();
});

/* ---------- Setup ---------- */
function initSetup(){
  const btn = byId("createLinkBtn");
  if (!btn) return;

  renderRubricBlocks();

  // Defaults
  byId("c_name").value ||= "Андрей";
  byId("c_city").value ||= "Волгоград";
  byId("c_goal").value ||= "понять варианты и цену, не переплатить";
  byId("c_context").value ||= "Частный дом, хочет перекрыть крышу, не разбирается в покрытиях.";
  byId("c_objections").value ||= "Дорого\nМне нужно подумать\nНе уверен в качестве";
  byId("s_title").value ||= "Кровля: сомнения в цене и выборе покрытия";

  for (const cat of RUBRIC_CATALOG){
    for (const it of cat.items){
      const cb = byId(`rb_${it.id}`); if (cb) cb.checked = true;
      const pt = byId(`pt_${it.id}`); if (pt) pt.value = (it.id === "grammar") ? "2" : "1";
    }
  }

  btn.addEventListener("click", () => {
    const session = buildSession();
    const sid = "s_" + randomId(12);
    saveSession(sid, session);

    const url = new URL(location.href);
    url.pathname = url.pathname.replace(/index\.html$/i, "chat.html").replace(/\/$/,"/chat.html");
    url.searchParams.set("sid", sid);

    byId("linkOut").value = url.toString();
  });

  byId("copyBtn")?.addEventListener("click", async () => {
    const val = byId("linkOut").value;
    if (!val) return;
    await navigator.clipboard.writeText(val);
  });
}

function renderRubricBlocks(){
  const host = byId("rubricBlocks");
  if (!host) return;
  host.innerHTML = "";

  for (const cat of RUBRIC_CATALOG){
    const blk = document.createElement("div");
    blk.className = "rubricBlock";
    blk.innerHTML = `<div class="rubricTitle">${escapeHtml(cat.block)}</div>
                     <div class="rubricHeader"><div>Название</div><div>Баллы</div></div>`;
    const grid = document.createElement("div");
    grid.className = "rubricGrid";

    for (const it of cat.items){
      const item = document.createElement("div");
      item.className = "rubricItem";
      item.innerHTML = `<input type="checkbox" id="rb_${it.id}"><label for="rb_${it.id}">${escapeHtml(it.label)}</label>`;
      const pts = document.createElement("div");
      pts.className = "rubricPoints";
      pts.innerHTML = `<input id="pt_${it.id}" type="number" min="0" step="1" value="1">`;
      grid.appendChild(item);
      grid.appendChild(pts);
    }

    blk.appendChild(grid);
    host.appendChild(blk);
  }
}

function buildSession(){
  const checklist = [];
  for (const cat of RUBRIC_CATALOG){
    for (const it of cat.items){
      if (!byId(`rb_${it.id}`)?.checked) continue;
      const points = toInt(byId(`pt_${it.id}`)?.value, 1);
      checklist.push({ key: it.id, block: cat.block, title: it.label, points });
    }
  }
  const objections = (byId("c_objections").value || "").split("\n").map(s=>s.trim()).filter(Boolean);

  return {
    createdAt: new Date().toISOString(),
    scenario: {
      title: (byId("s_title").value || "").trim() || "Сценарий",
      client: {
        name: (byId("c_name").value || "").trim() || "Клиент",
        city: (byId("c_city").value || "").trim(),
        goal: (byId("c_goal").value || "").trim(),
        tone: byId("c_tone").value,
        delivery: byId("c_delivery").value,
        context: (byId("c_context").value || "").trim(),
        objections
      },
      checklist
    },
    config: { ...loadConfig(), useLLM: !!byId("llmDefault").checked },
    transcript: [],
    manager: { fio: "" },
    endedAt: null,
    score: null
  };
}

/* ---------- Chat ---------- */
function initChat(){
  const sid = new URLSearchParams(location.search).get("sid") || "";
  const session = sid ? loadSession(sid) : null;

  const scenarioTitleEl = byId("scenarioTitle");
  const scenarioMetaEl = byId("scenarioMeta");
  const statusDotEl = byId("statusDot");
  const statusTextEl = byId("statusText");
  const hintEl = byId("hintText");
  const chatEl = byId("chat");
  const inputEl = byId("input");
  const sendBtn = byId("sendBtn");
  const endBtn = byId("endBtn");
  const checklistEl = byId("checklist");
  const scoreEl = byId("scoreValue");
  const managerPill = byId("managerPill"); // optional (removed in v4)

  const workerUrlEl = byId("workerUrl");
  const saveModeEl = byId("saveMode");

  if (!session){
    scenarioTitleEl.textContent = "Сессия не найдена";
    scenarioMetaEl.textContent = "Откройте чат по ссылке из страницы настройки.";
    setStatus(statusDotEl, statusTextEl, "bad", "Нет сессии");
    inputEl.disabled = true; sendBtn.disabled = true; endBtn.disabled = true; resetBtn.disabled = true;
    return;
  }

  const state = {
    sid,
    session,
    config: { ...loadConfig(), ...(session.config || {}) },
    ended: !!session.endedAt
  };

  if (workerUrlEl) workerUrlEl.value = state.config.workerUrl || "";
  if (saveModeEl) saveModeEl.value = state.config.saveMode || "download";

  const c = session.scenario.client;
  scenarioTitleEl.textContent = session.scenario.title;
  scenarioMetaEl.textContent = `Клиент: ${c.name} • ${c.city} • Тон: ${c.tone} • Доставка: ${c.delivery} • Цель: ${c.goal}`;

  renderChat(chatEl, session.transcript || []);
  ensureManagerFio(state, managerPill);

  renderChecklist(checklistEl, groupByBlock(session.scenario.checklist || []), null);
  scoreEl.textContent = "—";
  setHint(hintEl, "Оценка появится после “Завершить диалог”.");

  sendBtn.addEventListener("click", () => send(state, chatEl, inputEl, sendBtn, statusDotEl, statusTextEl, hintEl));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); send(state, chatEl, inputEl, sendBtn, statusDotEl, statusTextEl, hintEl); }
  });

  const _saveBtn = byId("saveConfigBtn"); if (_saveBtn) _saveBtn.addEventListener("click", () => {
    state.config.workerUrl = workerUrlEl.value.trim();
    state.config.useLLM = !!llmToggle.checked;
    state.config.saveMode = saveModeEl.value;
    saveConfig(state.config);
    state.session.config = { ...state.session.config, ...state.config };
    saveSession(state.sid, state.session);
  });
    renderChat(chatEl, []);
    renderChecklist(checklistEl, groupByBlock(state.session.scenario.checklist||[]), null);
    scoreEl.textContent = "—";
  });

  endBtn.addEventListener("click", async () => {
    const result = scoreConversation(state.session);
    state.session.endedAt = new Date().toISOString();
    state.session.score = result.score;
    state.session.flags = result.flags;
    state.ended = true;
    saveSession(state.sid, state.session);

    scoreEl.textContent = `${result.score.total} / ${result.score.max}`;
    renderChecklist(checklistEl, groupByBlock(state.session.scenario.checklist||[]), result.flags);
    const sm = byId("scoreModal"); if (sm) sm.classList.remove("hidden");
    const sc = byId("scoreClose"); if (sc) sc.onclick = () => sm.classList.add("hidden");
    setStatus(statusDotEl, statusTextEl, "good", "Завершено");
    await autoSaveResult(state);
    // Закрыть окно после завершения
    setTimeout(() => { try { window.close(); } catch(e) {} }, 300);
  });

  // status
  if (state.config.useLLM && !state.config.workerUrl) setStatus(statusDotEl, statusTextEl, "warn", "LLM включен, но Worker URL пуст");
  else if (state.config.useLLM) setStatus(statusDotEl, statusTextEl, "good", "LLM режим");
  else setStatus(statusDotEl, statusTextEl, null, "Офлайн режим");
}

async function send(state, chatEl, inputEl, sendBtn, dotEl, textEl, hintEl){
  const msg = (inputEl.value || "").trim();
  if (!msg) return;
  if (state.ended) return;

  sendBtn.disabled = true;
  inputEl.value = "";

  pushMsg(state.session, "user", msg);
  appendBubble(chatEl, msg, "me");
  setStatus(dotEl, textEl, "warn", "Клиент печатает…");

  try{
    const reply = await getClientReply(state, msg);
    pushMsg(state.session, "assistant", reply.reply, { intent: reply.intent, tags: reply.tags });
    appendBubble(chatEl, reply.reply, "client");
    setStatus(dotEl, textEl, state.config.useLLM ? "good" : null, "Готово");
    setHint(hintEl, "По завершению нажмите “Завершить диалог”.");
  } catch (e){
    setStatus(dotEl, textEl, "bad", "Ошибка");
    setHint(hintEl, "Ошибка ответа клиента. Проверьте Worker URL.");
    console.error(e);
  } finally {
    saveSession(state.sid, state.session);
    sendBtn.disabled = false;
  }
}

/* ---------- LLM ---------- */
async function getClientReply(state, managerMsg){
  if (state.config.useLLM && state.config.workerUrl){
    const url = state.config.workerUrl.replace(/\/$/,"");
    const payload = {
      history: (state.session.transcript||[]).map(m=>({ role:m.role, content:m.content })).slice(-12),
      scenario: { ...state.session.scenario, manager: state.session.manager, state:{ turns:(state.session.transcript||[]).length } },
      manager_message: managerMsg
    };
    const res = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return { reply: String(data.reply||"Уточните, пожалуйста."), intent: String(data.intent||""), tags: Array.isArray(data.tags)?data.tags:[] };
  }
  return { reply:"Я не очень понял. Можете объяснить проще?", intent:"offline", tags:["offline"] };
}

/* ---------- Scoring ---------- */
function scoreConversation(session){
  const checklist = session.scenario.checklist || [];
  const tr = session.transcript || [];
  const client = session.scenario.client || {};
  const mgrText = tr.filter(m=>m.role==="user").map(m=>m.content).join("\n");
  const low = mgrText.toLowerCase();

  const name = (client.name||"").trim().toLowerCase();
  const nameCount = name ? countOcc(low, name) : 0;
  const qCount = (mgrText.match(/\?/g) || []).length;

  const interrupt = detectInterrupt(tr);
  const grammarOk = grammarBusinessOk(mgrText);
  const formatOk = formattingOk(mgrText);
  const initiative = /давайте|предлагаю|могу|готов|отправлю|посчитаю|рассчитаю/i.test(low);
  const activeListen = /понимаю|верно|правильно понял|если я правильно понял|уточню/i.test(low);
  const whatsapp = /whatsapp|ватсап|вацап|вотсап/i.test(low);

  const flags = {};
  let total = 0, max = 0;

  for (const it of checklist){
    const pts = toInt(it.points, 1);
    max += pts;
    let ok = false;

    switch (it.key){
      case "greeting": ok = /здравств|добрый день|добрый вечер|привет/i.test(low); break;
      case "intro_self": ok = /меня зовут|я .*менеджер/i.test(low); break;
      case "intro_company": ok = /компан|мы .* (производ|склад|завод|магазин)/i.test(low); break;
      case "ask_client_name": ok = /как к вам обращаться|ваше имя|как вас зовут/i.test(low); break;
      case "ask_region": ok = /какой город|какой регион|откуда вы|ваш город|где находитесь/i.test(low); break;

      case "use_name_3": ok = nameCount >= 3; break;
      case "formatting": ok = formatOk; break;
      case "initiative": ok = initiative; break;
      case "grammar": ok = grammarOk; break;
      case "no_interrupt": ok = !interrupt; break;
      case "active_listen": ok = activeListen; break;

      case "open_questions": ok = (qCount >= 2) || (/как|почему|зачем|какой|какая|какие|расскажите|подскажите/i.test(mgrText) && qCount>=1); break;
      case "purpose": ok = /кровл|крыша|забор|фасад|дач|коттедж|навес/i.test(low) || /для чего.*нуж/i.test(low); break;
      case "object_type": ok = /жил|коммерч|промышлен|склад|тц|торгов/i.test(low); break;
      case "thickness": ok = /толщин|\bмм\b/.test(low); break;
      case "color": ok = /цвет|ral/i.test(low); break;
      case "coating": ok = /покрыт|матов|глянец|цинк|полиэстер|пурал/i.test(low); break;
      case "shape": ok = /с-?8|с-?20|с-?21|нс|н-?\d+|геркулес|супермонтеррей|штакетник|евротрапец/i.test(low); break;
      case "calc_data": ok = /длин|периметр|скат|площад|м2|метр/i.test(low); break;
      case "extras": ok = /добор|саморез|конек|ендов|планк|уплотн|сопутств/i.test(low); break;
      case "summarize": ok = /итого|правильно понял|резюмир|подытож/i.test(low); break;

      case "send_whatsapp": ok = whatsapp; break;
      case "why_product": ok = /рекоменд|лучше|потому что|объясню почему/i.test(low); break;
      case "company_benefits": ok = /в наличии|быстро|гарант|доставка|цена|качество|сертифик/i.test(low); break;
      case "fit_needs": ok = /с учетом|исходя из|под ваши|для вашего/i.test(low); break;
      case "present_extras": ok = /добор|сопутств|комплект/i.test(low); break;

      case "feedback": ok = /как вам|остались вопросы|что скажете|подходит\?/i.test(low); break;

      case "listen_no_interrupt": ok = !interrupt; break;
      case "agree_join": ok = /понимаю|согласен|логично|конечно/i.test(low) && qCount>=1; break;
      case "argue": ok = /потому что|объясню|разница|сравним|поэтому/i.test(low); break;
      case "retry_sale": ok = /давайте оформим|могу посчитать|предлагаю вариант|зафиксируем|оформим/i.test(low); break;

      case "next_steps": ok = /дальше|следующий шаг|отправлю расчет|кп|созвон|замер/i.test(low); break;
      case "delivery_or_pickup": ok = /доставк|самовывоз|адрес/i.test(low); break;
      case "crm_data": ok = /фио|юр|физ|инн|кпп|реквизит/i.test(low); break;
      case "after_chat_whatsapp": ok = whatsapp; break;
      case "ready_order": ok = /оформим|заказ|счет|оплат/i.test(low); break;
      case "closing_techniques": ok = /какой вариант|удобнее|сегодня|забронируем|зафиксируем/i.test(low); break;
      case "not_ready_order": ok = /подумайте|перезвон|как вам будет удобно/i.test(low); break;
      case "invite_office_or_callback": ok = /офис|встреч|перезвон|созвон/i.test(low); break;
      default: ok = false;
    }

    flags[it.key] = { ok, points: pts, block: it.block, title: it.title };
    if (ok) total += pts;
  }

  return { flags, score: { total, max } };
}

function detectInterrupt(tr){
  let lastUserTs = null;
  let streak = 0;
  for (const m of tr){
    if (m.role === "user"){
      const t = Date.parse(m.ts || "");
      if (Number.isFinite(t) && lastUserTs !== null && (t - lastUserTs) <= 4000){
        streak += 1;
      } else {
        streak = 1;
      }
      lastUserTs = t;
      if (streak >= 2) return true;
    } else {
      streak = 0;
      lastUserTs = null;
    }
  }
  return false;
}

function formattingOk(text){
  const t = String(text || "");
  if (!t) return false;
  const ex = (t.match(/!/g) || []).length;
  const caps = (t.match(/\b[А-ЯЁ]{4,}\b/g) || []).length;
  const emojis = (t.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length;
  if (ex >= 6) return false;
  if (caps >= 2) return false;
  if (emojis >= 6) return false;
  return true;
}

function grammarBusinessOk(text){
  const t = String(text || "");
  if (!t) return false;
  const low = t.toLowerCase();
  const typos = ["граммот","пожайлуста","здела","пожалуйсто","извен","вообщем","прийд","ложить","ихний","нету"];
  let bad = 0;
  for (const w of typos) if (low.includes(w)) bad++;
  if (/(!!+|\?\?+|\.{4,}|,,+)/.test(t)) bad++;
  if (t.length >= 120 && /[,.!?][А-Яа-яЁё]/.test(t)) bad++;
  return bad <= 1;
}

/* ---------- Saving ---------- */
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
    const base = state.config.workerUrl.replace(/\/$/,"");
    const saveUrl = base + "/save";
    try{
      const res = await fetch(saveUrl, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(result) });
      if (!res.ok) throw new Error(await res.text());
      return;
    } catch (e){
      downloadJson(result, `result-${state.sid}.json`);
      return;
    }
  }
  downloadJson(result, `result-${state.sid}.json`);
}


async function startClientFirstMessage(state){
  try{
    const tr = state.session.transcript || [];
    if (tr.length > 0) return; // already started
    // Ask model to start the conversation as the client
    const res = await getClientReply(state, "Начни диалог первым сообщением от клиента.");
    pushMsg(state.session, "assistant", res.reply, { intent: res.intent, tags: res.tags });
    const chatEl = document.getElementById("chat");
    if (chatEl) appendBubble(chatEl, res.reply, "client");
    saveSession(state.sid, state.session);
  } catch (e){
    // fallback without LLM
    const c = state.session.scenario?.client || {};
    const fallback = `Здравствуйте! Меня зовут ${c.name || "клиент"}. Я из ${c.city || "вашего города"}. ${c.goal ? "Хочу " + c.goal + "." : ""} ${c.context || ""}`.trim();
    pushMsg(state.session, "assistant", fallback, { intent: "start_fallback", tags: ["start_fallback"] });
    const chatEl = document.getElementById("chat");
    if (chatEl) appendBubble(chatEl, fallback, "client");
    saveSession(state.sid, state.session);
  }
}

/* ---------- Modal ---------- */
function ensureManagerFio(state, pill){
  const existing = state.session.manager?.fio || "";
  if (existing){ if (pill) pill.textContent = `Менеджер: ${existing}`; return; }
  const modal = byId("modal");
  const input = byId("mgrName");
  const ok = byId("mgrOk");
  modal.classList.remove("hidden");
  input.focus();
  ok.addEventListener("click", () => {
    const fio = (input.value || "").trim();
    if (!fio) return;
    state.session.manager = { fio };
    saveSession(state.sid, state.session);
    if (pill) pill.textContent = `Менеджер: ${fio}`;
    modal.classList.add("hidden");
    // авто-старт: клиент пишет первым
    startClientFirstMessage(state);

  });
}

/* ---------- UI helpers ---------- */
function renderChat(chatEl, tr){
  chatEl.innerHTML = "";
  for (const m of (tr||[])) appendBubble(chatEl, m.content, m.role==="user" ? "me" : "client");
  chatEl.scrollTop = chatEl.scrollHeight;
}
function appendBubble(chatEl, text, who){
  const row = document.createElement("div");
  row.className = "msg " + (who==="me" ? "me" : "client");
  const b = document.createElement("div");
  b.className = "bubble";
  b.textContent = text;
  row.appendChild(b);
  chatEl.appendChild(row);
}
function renderChecklist(container, grouped, flags){
  container.innerHTML = "";
  for (const block of Object.keys(grouped||{})){
    const h = document.createElement("div");
    h.className = "small";
    h.style.padding = "10px 14px 0";
    h.style.fontWeight = "750";
    h.textContent = block;
    container.appendChild(h);

    for (const it of grouped[block]){
      const f = flags ? flags[it.key] : null;
      const ok = f ? !!f.ok : null;
      const badge = ok === null ? "—" : (ok ? `+${it.points}` : "0");
      const cls = ok === null ? "" : (ok ? "ok" : "no");

      const row = document.createElement("div");
      row.className = "checkItem";
      row.innerHTML = `
        <div class="checkLeft"><div class="checkTitle">${escapeHtml(it.title)}</div></div>
        <div class="badge ${cls}">${badge}</div>
      `;
      container.appendChild(row);
    }
  }
}
function groupByBlock(list){
  const out = {};
  for (const it of (list||[])){
    (out[it.block] ||= []).push(it);
  }
  return out;
}
function pushMsg(session, role, content, meta){
  const m = { role, content, ts: new Date().toISOString() };
  if (meta) m.meta = meta;
  session.transcript ||= [];
  session.transcript.push(m);
}
function setStatus(dot, text, kind, label){
  dot.classList.remove("good","warn","bad");
  if (kind) dot.classList.add(kind);
  text.textContent = label || "Готово";
}
function setHint(el, t){ el.textContent = t || ""; }

function downloadJson(obj, name){
  const blob = new Blob([JSON.stringify(obj,null,2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- Storage ---------- */
function saveSession(sid, session){ localStorage.setItem(`${STORAGE_NS}:session:${sid}`, JSON.stringify(session)); }
function loadSession(sid){
  const raw = localStorage.getItem(`${STORAGE_NS}:session:${sid}`);
  if (!raw) return null;
  try{ return JSON.parse(raw); } catch { return null; }
}
function loadConfig(){
  const raw = localStorage.getItem(`${STORAGE_NS}:config`);
  if (!raw) return { ...DEFAULT_CONFIG };
  try{ return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }; } catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(cfg){ localStorage.setItem(`${STORAGE_NS}:config`, JSON.stringify({ ...DEFAULT_CONFIG, ...cfg })); }

/* ---------- Utils ---------- */
function byId(id){ return document.getElementById(id); }
function toInt(s, d){ const x = parseInt(String(s||"").trim(),10); return Number.isFinite(x)?x:d; }
function randomId(n){ const a="abcdefghijklmnopqrstuvwxyz0123456789"; let s=""; for (let i=0;i<n;i++) s+=a[Math.floor(Math.random()*a.length)]; return s; }
function countOcc(text, sub){ let n=0,i=0; while(true){ i=text.indexOf(sub,i); if(i===-1) break; n++; i+=sub.length; } return n; }
function escapeHtml(s){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
