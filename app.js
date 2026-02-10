/* sales-sim v10
   Worker URL: https://royal-breeze-aac8.julya14temina.workers.dev
   - клиент пишет первым по настройкам
   - оценка показывается после "Завершить диалог"
   - результат (диалог + оценка) отправляется на Worker /save (Cloudflare KV/D1) с fallback на скачивание
*/

const WORKER_URL = "https://d5de7bqfdbt3i3ft9ggb.qsvaa8tq.apigw.yandexcloud.net";

const STORAGE_NS = "sales-sim:v15";

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
    { id:"grammar", label:"Грамотная деловая речь" },
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


  // scoring toggle
  const scoreToggle = byId("scoreEnabled");
  const rubricSection = byId("rubricSection");
  const scoreLabel = scoreToggle?.closest(".toggle")?.querySelector("span");

  function applyScoreToggle(){
    const on = (scoreToggle?.checked !== false);
    if (rubricSection) rubricSection.style.display = on ? "" : "none";
    // disable rubric inputs when off
    for (const cat of RUBRIC_CATALOG){
      for (const it of cat.items){
        const cb = byId(`rb_${it.id}`);
        const pt = byId(`pt_${it.id}`);
        if (cb) cb.disabled = !on;
        if (pt) pt.disabled = !on;
      }
    }
    if (scoreLabel) scoreLabel.textContent = on ? "Оценка включена" : "Оценка выключена";
  }

  scoreToggle?.addEventListener("change", applyScoreToggle);
  applyScoreToggle();


  for (const cat of RUBRIC_CATALOG){
    for (const it of cat.items){
      const cb = byId(`rb_${it.id}`);
      const pt = byId(`pt_${it.id}`);
      if (cb) cb.checked = true;
      if (pt) pt.value = (it.id === "grammar") ? "2" : "1";
    }
  }

  btn.addEventListener("click", async () => {
  const session = buildSession();
  const sid = "s_" + randomId(12);

  // local cache
  saveSession(sid, session);

  // remote store (so link works anywhere)
  try {
    await createRemoteSession(sid, session);
  } catch (e) {
    console.error(e);
    alert("Не удалось сохранить сессию на сервере. Ссылка откроется только на этом устройстве.\n\nПроверьте Worker (/session/create) и CORS.");
  }

  const url = new URL(location.origin + location.pathname);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/index\.html$/i, "chat.html").replace(/\/$/, "/chat.html");
  url.searchParams.set("sid", sid);

  const out = byId("linkOut");
  if (out) out.value = url.toString();
  const toast = byId("linkCreated");
  if (toast){
    toast.style.display = "";
    clearTimeout(window.__linkToastT);
    window.__linkToastT = setTimeout(()=>{ toast.style.display = "none"; }, 2000);
  }
} const toast = byId("linkCreated");
  if (toast){
    toast.style.display = "";
    clearTimeout(window.__linkToastT);
    window.__linkToastT = setTimeout(()=>{ toast.style.display = "none"; }, 2000);
  }
});

  byId("copyBtn")?.addEventListener("click", async () => {
    const out = byId("linkOut");
    if (!out?.value) return;
    await navigator.clipboard.writeText(out.value);
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
  const scoringEnabled = (byId("scoreEnabled")?.checked !== false);

  const checklist = [];
  if (scoringEnabled){
    for (const cat of RUBRIC_CATALOG){
      for (const it of cat.items){
        if (!byId(`rb_${it.id}`)?.checked) continue;
        const points = toInt(byId(`pt_${it.id}`)?.value, 1);
        checklist.push({ key: it.id, block: cat.block, title: it.label, points });
      }
    }
  }

  const objections = (byId("c_objections")?.value || "").split("\n").map(s=>s.trim()).filter(Boolean);

  return {
    createdAt: new Date().toISOString(),
    scenario: {
      title: (byId("s_title")?.value || "").trim() || "Сценарий",
      client: {
        name: (byId("c_name")?.value || "").trim() || "Клиент",
        city: (byId("c_city")?.value || "").trim(),
        goal: (byId("c_goal")?.value || "").trim(),
        tone: byId("c_tone")?.value || "спокойный",
        delivery: byId("c_delivery")?.value || "не знаю",
        context: (byId("c_context")?.value || "").trim(),
        objections
      },
      checklist,
      scoreEnabled: scoringEnabled
    },
    transcript: [],
    manager: { fio: "" },
    endedAt: null,
    score: null,
    flags: null
  };
}

