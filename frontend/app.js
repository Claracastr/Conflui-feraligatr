import {
  request,
  bootstrap,
  remember,
  persist as persistApi,
  loadView,
  cache,
  clearCache,
  opening,
  closing,
  profileKey,
} from "./api.js";
import {
  months,
  isoDate,
  parseDate,
  weekDay,
  labelDate,
  monthCells,
  hasData,
  seedEvents,
  specialDates,
  eventsOn,
  selectSamples,
  sumDimension,
} from "./domain.js";
import {
  sectors,
  days,
  floors,
  counts,
  occupancy,
  time,
  concentration,
  periodStats,
  flowData,
  setAnalysisContext,
  applyCatalog,
} from "./data.js";
import {
  mapMarkup,
  initMaps,
  destroyMaps,
  updateMaps,
  focusSelection,
} from "./map.js";
const icons = {
  map: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 3v18M16 3v18M3 9h18M3 15h18"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  compare: '<path d="M4 5h6v14H4zM14 5h6v14h-6z"/>',
  flows: '<path d="M4 7h15l-4-4M20 17H5l4 4M19 7l-4 4M5 17l4-4"/>',
  assistant: '<path d="M8 18h8l-2 3M7 8a5 5 0 1 1 10 0v4a5 5 0 1 1-10 0zM10 12h4"/>',
  reports: '<path d="M6 3h9l4 4v14H6zM10 11h5M10 15h5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  refresh:
    '<path d="M20 7v5h-5M4 17v-5h5M19 10a7 7 0 0 0-12-5L4 8M5 14a7 7 0 0 0 12 5l3-3"/>',
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n] || icons.map}</svg>`;
const state = {
  mode: "admin",
  page: "map",
  floor: 0,
  selected: null,
  query: "",
  scope: "all",
  minute: 1080,
  day: 4,
  date: "2026-11-13",
  compareDay: 6,
  live: true,
  playing: false,
  phase: 0,
  opacity: 70,
  updated: new Date(),
  unavailable: null,
  stale: false,
  collapsed: false,
  origin: "cinema",
  flowRecords: [],
  browse: false,
  present: false,
  login: true,
  session: false,
  split: 50,
  compareSide: "split",
  favorites: [],
  events: [],
  programs: [],
  special: [],
  calOpen: false,
  calYear: 2026,
  calMonth: 10,
  compareDate: "2026-11-15",
  programId: "",
  profileEvent: "",
  profileSector: "",
  eventCategory: "all",
  assistantMessages: [],
  assistantContext: { date: "", start: "", end: "", sector: "", event: "" },
  assistantLoading: false,
};
state.date = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/Araguaina",
});
state.day = weekDay(state.date);
{
  let previous = parseDate(state.date);
  previous.setDate(previous.getDate() - 1);
  state.compareDate = isoDate(previous);
}
state.calYear = Number(state.date.slice(0, 4));
state.calMonth = Number(state.date.slice(5, 7)) - 1;
const app = document.querySelector("#app");
let replayTimer, toastTimer;
const esc = (t) =>
  String(t)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function persist() {
  cache.calendar.clear();
  return persistApi(state, (e) => {
    toast("Falha ao salvar: " + e.message);
    render();
  });
}
async function startSession() {
  clearCache();
  const catalog = await bootstrap(state);
  applyCatalog(catalog.sectors, catalog.floors);
  state.mode = cache.demo ? "demo" : "admin";
  remember(state);
  await loadView(state);
  render();
}
function applyLiveStatus() {
  if (!state.live) return;
  let rows = cache.live?.sectors || [];
  let times = rows
    .map((r) => (r.captured_at ? new Date(r.captured_at).getTime() : null))
    .filter((x) => x !== null);
  state.updated = times.length ? new Date(Math.max(...times)) : new Date();
  state.stale = rows.some((r) => r.status === "stale");
  document
    .querySelectorAll("[data-livebadge]")
    .forEach(
      (b) =>
        (b.textContent = !times.length
          ? "Sem medições"
          : state.stale
            ? "Capturas atrasadas"
            : "Ao vivo · API"),
    );
}
let loadingKey = "",
  generation = 0;
async function syncView() {
  if (!state.session) return;
  const key = [
    state.page,
    state.date,
    state.minute,
    state.compareDate,
    state.calYear,
    state.calMonth,
    state.profileEvent,
    state.profileSector,
    state.origin,
    state.programId,
  ].join("|");
  if (loadingKey === key) return;
  loadingKey = key;
  const ticket = ++generation;
  try {
    await loadView(state);
    if (ticket !== generation) return;
    applyLiveStatus();
    if (
      ["profile", "events", "reports", "assistant"].includes(
        state.page,
      ) ||
      state.calOpen
    ) {
      renderContent();
    } else updateData();
  } catch (e) {
    state.stale = true;
    if (e.status === 401) {
      state.session = false;
      state.login = true;
      renderContent();
    } else toast("Atualização indisponível: " + e.message);
  }
}
const optionDays = (d) =>
  days
    .map(
      (x, i) =>
        `<option value="${i}" ${d === i ? "selected" : ""}>${x}</option>`,
    )
    .join("");
function toast(t) {
  let e = document.querySelector("#toast");
  e.textContent = t;
  e.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (e.hidden = true), 3500);
}
function navItems() {
  return [
    ["map", "map", "Visão geral"],
    ["history", "history", "Calendário e histórico"],
    ["events", "history", "Eventos"],
    ["profile", "reports", "Perfil do público"],
    ["reports", "reports", "Relatórios"],
    ["assistant", "assistant", "Assistente IA"],
  ];
}
function nav(mobile = false) {
  return navItems()
    .map(
      ([id, ic, label]) =>
        `<button class="${mobile ? "btn" : "navbtn"} ${state.page === id ? "active" : ""}" data-nav="${id}" ${state.page === id ? 'aria-current="page"' : ""}>${mobile ? "" : icon(ic)}<span class="navtext">${label}</span></button>`,
    )
    .join("");
}
function botanicalMark() {
  return `<span class="capim-symbol" aria-hidden="true"><svg viewBox="0 0 48 54" fill="none"><g stroke="currentColor" stroke-width="1.6"><path d="M24 49 Q13 33 10 16M24 49V12M24 49Q35 31 38 20M10 16L24 12L38 20"/><circle cx="10" cy="12" r="5"/><circle cx="24" cy="7" r="5"/><circle cx="39" cy="16" r="5"/><circle cx="10" cy="12" r="2"/><circle cx="24" cy="7" r="2"/><circle cx="39" cy="16" r="2"/></g></svg></span>`;
}
function header() {
  return `<main class="main"><header class="topbar"><a class="brand toplogo" href="#" id="home">${botanicalMark()}<span>conflui<span style="color:#b18a49">.</span></span></a><div class="top-location"><span>CAPIM DOURADO</span><small>Inteligência de espaços · Palmas, TO</small></div><div class="top-actions"><span class="badge demo">${cache.mode === "simulator" ? (cache.demo ? "◇ Dados simulados · sem monitoramento real" : "◇ Ambiente simulado") : "Medições por vídeo"}</span><span class="adminsession">${state.mode === "demo" ? "Modo demonstração · Somente leitura" : "Central administrativa"}</span><button class="btn" id="logout">Sair</button></div></header><div class="adminbar"><nav aria-label="Navegação administrativa">${nav(true)}</nav><button class="btn" id="present">${state.present ? "Sair da apresentação" : "⛶ Apresentar"}</button></div>`;
}
function heading() {
  let info =
    state.mode === "public"
      ? [
          "O shopping, agora.",
          "Acompanhe a ocupação dos espaços em tempo real.",
        ]
      : {
          map: [
            "O movimento ganha sentido.",
            "Uma leitura viva dos espaços do shopping.",
          ],
          events: [
            "Encontros que movimentam.",
            "Programação, espaços e contexto para cada análise.",
          ],
          profile: [
            "Pessoas, em suas diferenças.",
            "Pesquisa agregada por amostragem, com fonte e cobertura.",
          ],
          history: [
            "O tempo revela os padrões.",
            "Um horário selecionado. Todos os setores atualizados.",
          ],
          reports: [
            "O movimento em números.",
            "Indicadores do cenário e qualidade da informação.",
          ],
          assistant: [
            "O espaço fala em padrões.",
            "Interpretação guiada por regras e dados reais do shopping.",
          ],
        }[state.page];
  return `<section class="heading"><div><span class="eyebrow">${state.mode === "public" ? "EXPLORE O PRESENTE" : "CENTRAL DE INTELIGÊNCIA"}</span><h1>${info[0]}</h1></div><p>${info[1]}</p></section>`;
}

function statCards() {
  let list = counts(state).filter(
      (s) => s.floor === state.floor && !s.unavailable,
    ),
    total = list.reduce((a, s) => a + s.count, 0),
    before = list.reduce(
      (a, s) =>
        a + occupancy(s, Math.max(opening, state.minute - 60), state.day),
      0,
    ),
    diff = Math.round(((total - before) / before) * 100);
  return `<section class="metric-ribbon" aria-label="Resumo da ocupação"><span><b data-stat="total">${list.length ? total : "—"}</b> pessoas estimadas <small>no pavimento · ${list.length}/${counts(state).filter((s) => s.floor === state.floor).length} setores com medição</small></span>${state.mode === "admin" ? `<span><b data-stat="trend">${Number.isFinite(diff) && before > 0 ? (diff > 0 ? "+" : "") + diff + "%" : "—"}</b> <small>em relação a 1h antes</small></span>` : ""}<span class="ribbon-update"><i class="dot"></i> ${state.live ? (state.stale ? "Informação atrasada" : "Atualizado") : "Recorte selecionado"} <b data-stat="updated">${state.live ? state.updated.toLocaleTimeString("pt-BR", { timeZone: "America/Araguaina" }) : time(state.minute)}</b></span></section>`;
}

function mapPanel() {
  let snap = state.live
      ? cache.live
      : cache.history.get(state.date + "|" + state.minute),
    noFloor =
      !!snap &&
      !counts(state).some((s) => s.floor === state.floor && !s.unavailable);
  return `<section class="panel map-panel"><div class="panel-head"><div><h2>${floors[state.floor]}</h2><p>${state.selected ? "Região selecionada · contexto preservado" : "Visão geral · todos os setores do pavimento"}</p></div><span class="badge ${state.stale ? "stale" : ""}" data-livebadge><span class="dot"></span>${state.live ? (state.stale ? "Atualização atrasada" : "Ao vivo · API") : time(state.minute) + " · Histórico"}</span></div><div class="filters"><div class="segmented" aria-label="Pavimento"><button data-floor="0" class="${state.floor === 0 ? "active" : ""}">Térreo</button><button data-floor="1" class="${state.floor === 1 ? "active" : ""}">2º pavimento</button></div><button class="btn" data-overview>Visão geral</button><button class="btn" id="browse-sectors">⌕ Buscar setor</button></div>${noFloor ? `<div class="map-empty"><b>Sem medições neste recorte.</b><span>Nenhum setor deste pavimento tem amostra em ${labelDate(state.date)} às ${time(state.minute)}. O mapa não desenha calor sem medição — escolha outro horário ou consulte o histórico.</span>${state.page === "history" ? "" : `<button class="btn" data-nav="history">Abrir histórico</button>`}</div>` : ""}${mapMarkup(state, { flow: false })}<div class="maplegend"><div class="flex items-center gap-2"><span>Menor</span><span class="heatgradient"></span><span>Maior concentração</span></div><label class="flex items-center gap-2"><span class="opacitylabel">Transparência</span><input class="range" aria-label="Intensidade da camada de calor" type="range" min="10" max="95" value="${state.opacity}" id="opacity"></label></div>${state.mode === "admin" && state.page === "history" ? timeline() + eventPanel() : ""}<div class="scope-note">Os números representam ocupação estimada. As delimitações são propostas de análise baseadas na planta, sem cobertura real de câmeras.</div></section>`;
}
function timeline() {
  return `<div class="timeline">${miniChart()}<div class="flex items-center justify-between gap-2"><span class="time-title">${days[state.day]} · <span data-time>${time(state.minute)}</span></span><button class="btn" id="play">${state.playing ? "Ⅱ Pausar" : "▷ Reproduzir"}</button></div><input type="range" min="${opening}" max="${closing}" step="15" value="${state.minute}" aria-label="Horário global de todos os setores" id="timeline"><div class="timeline-times"><span>09h</span><span>12h</span><span>15h</span><span>18h</span><span>21h</span><span>00h</span></div></div>`;
}
function sectorList() {
  let list = sectors.filter(
    (s) =>
      (state.scope === "all" || s.floor === state.floor) &&
      s.name
        .toLocaleLowerCase("pt-BR")
        .includes(state.query.toLocaleLowerCase("pt-BR")),
  );
  let cs = counts(state);
  return list.length
    ? list
        .map((s) => {
          let d = cs.find((x) => x.id === s.id);
          return `<button class="sectoritem ${s.id === state.selected ? "active" : ""}" data-pick="${s.id}" aria-label="Selecionar ${s.name}"><span><span class="name"><i class="level ${d.count > 80 ? "high" : ""}"></i>${s.name}</span><small>${floors[s.floor]}</small></span><strong data-count="${s.id}">${d.unavailable ? "—" : d.count}</strong></button>`;
        })
        .join("")
    : '<div class="empty">Nenhum setor encontrado.<br>Tente outro nome.</div>';
}
function detailMarkup() {
  let s = counts(state).find((s) => s.id === state.selected);
  return s
    ? `<section class="detailbox ${state.collapsed ? "collapsed" : ""}" aria-label="Detalhes do setor"><button class="bottomhandle" id="collapse" aria-expanded="${!state.collapsed}">${state.collapsed ? "Abrir" : "Recolher"} detalhes · ${s.name}</button><div class="flex items-center justify-between gap-2"><span class="eyebrow">SETOR SELECIONADO</span><button class="circlebtn" data-overview aria-label="Fechar detalhes do setor">×</button></div><h2 style="margin-top:9px">${s.name}</h2>${state.mode === "admin" ? `<button class="favorite-toggle" id="favorite-toggle">${state.favorites.includes(s.id) ? "★ Salvo nos favoritos" : "☆ Salvar setor favorito"}</button>` : ""}<div class="detailbody"><strong class="detailcount" data-detail-count>${s.unavailable ? "—" : s.count}</strong><p>${s.unavailable ? "Sem informação disponível" : "pessoas estimadas nesta região"}</p><span class="badge" data-detail-level>${s.unavailable ? "Medição indisponível" : concentration(s) + " concentração"}</span><div class="detaildivider">${floors[s.floor]}<br><span data-detail-time>${state.live ? "Captura: " + (s.captured_at ? new Date(s.captured_at).toLocaleTimeString("pt-BR", { timeZone: "America/Araguaina" }) : "Sem medição") : days[state.day] + " às " + time(state.minute)}</span><br>Fonte: ${esc(s.source || "Sem medição")}${s.count !== null && !s.positions.length ? " · distribuição espacial indisponível" : ""}</div>${s.unavailable ? '<div class="state-warn">Indisponibilidade demonstrativa. Não significa que o espaço está vazio.</div>' : ""}</div></section>`
    : `<section class="panel" style="margin-top:15px"><div class="hint"><b style="color:#526d49">Cada região conta uma parte da história.</b><br>Selecione um setor na lista ou na planta para consultar os detalhes.</div></section>`;
}
function rightPanel() {
  return `<aside class="rightcol ${state.browse ? "open" : ""}">${state.browse ? `<section class="panel sector-browser"><div class="sectorheader flex items-center justify-between"><h2>Encontre um setor</h2><button class="circlebtn" id="close-browser" aria-label="Fechar busca de setores">×</button></div><label class="search">${icon("search")}<input id="sector-search" type="search" placeholder="Cinema, alimentação, corredores…" aria-label="Buscar setor em todos os pavimentos" value="${esc(state.query)}"></label><div style="padding:0 15px 10px"><select class="select" style="width:100%" id="scope" aria-label="Pavimentos na lista de setores"><option value="all" ${state.scope === "all" ? "selected" : ""}>Todos os pavimentos · 18 regiões</option><option value="floor" ${state.scope === "floor" ? "selected" : ""}>Somente este pavimento</option></select></div><div class="sectorlist" id="sector-list">${sectorList()}</div></section>` : ""}<div id="detail-slot">${state.selected ? detailMarkup() : ""}</div></aside>`;
}

function insights() {
  let floorNow = counts(state).filter(
      (s) => s.floor === state.floor && !s.unavailable,
    ),
    top = [...floorNow].sort((a, b) => b.count - a.count).slice(0, 3),
    topSum = top.reduce((a, x) => a + x.count, 0) || 1;
  // No histórico, usa a média de todos os recortes carregados do dia.
  // No ao vivo, usa o instante atual. Medição ausente nunca vira zero.
  let stats = state.live ? null : periodStats(state, state.date),
    base = stats
      ? stats.filter((x) => x.floor === state.floor && x.available)
      : floorNow.map((x) => ({ ...x, avg: x.count, available: true })),
    low = [...base].sort((a, b) => a.avg - b.avg).slice(0, 3),
    ref = Math.max(...base.map((x) => x.avg), 1),
    moment = stats ? "média do dia" : "agora";
  return `<section class="below"><div class="panel insight"><div class="eyebrow">DISTRIBUIÇÃO DOS ESPAÇOS</div><h2 style="margin-top:8px">Regiões com maior ocupação</h2>${
    top.length
      ? top
          .map(
            (x) =>
              `<div class="minirow"><button class="alloverview" data-pick="${x.id}">${x.name}</button><b data-count="${x.id}">${x.count}</b></div><div class="bar"><i style="width:${(x.count / topSum) * 100}%"></i></div>`,
          )
          .join("")
      : '<div class="insight-note">Sem setores com medição neste pavimento.</div>'
  }</div><div class="panel insight insight-low"><div class="eyebrow">ATENÇÃO · OCIOSIDADE</div><h2 style="margin-top:8px">Regiões com menor circulação</h2><p class="insight-note">${stats ? `Média de todos os recortes de ${labelDate(state.date)}.` : "Instante atual da captura."} A barra é relativa ao setor mais movimentado do pavimento. Ausência de medição não entra como zero.</p>${
    low.length
      ? low
          .map(
            (x) =>
              `<div class="minirow"><button class="alloverview" data-pick="${x.id}">${x.name}</button><b>${Math.round(x.avg)}</b></div><div class="bar low"><i style="width:${(x.avg / ref) * 100}%"></i></div>`,
          )
          .join("")
      : '<div class="insight-note">Sem medições disponíveis para este recorte.</div>'
  }<div class="insight-foot">Valores em pessoas estimadas · ${moment}</div></div><div class="panel insight"><div class="eyebrow">UMA LEITURA MAIS COMPLETA</div><h2 style="margin-top:8px">O espaço muda ao longo do dia.</h2><p style="font-size:11px;margin-top:12px">O mapa mostra onde o público se concentra. O histórico revela como a ocupação e a ociosidade mudam hora a hora, sempre com o mesmo horário aplicado a todos os setores.</p><button class="btn" style="margin-top:10px" data-nav="history">Explorar histórico ${icon("arrow")}</button></div></section>`;
}
function historyControls() {
  return `<div class="historyinfo flex flex-wrap items-center justify-between gap-3"><div class="flex flex-wrap gap-2"><button class="btn" id="toggle-calendar">▦ ${labelDate(state.date)}</button><input class="select" type="date" id="date" aria-label="Data do histórico" value="${state.date}"><span class="badge outline">${days[state.day]} · ${time(opening)} — ${time(closing)}</span></div><div class="flex gap-2"><button class="btn" id="new-event">＋ Marcação</button><button class="btn" data-nav="map">Voltar ao vivo</button></div></div>${dateContext()}`;
}
function comparePage() {
  let ca = counts(state),
    cb = counts(
      state,
      state.minute,
      weekDay(state.compareDate),
      state.compareDate,
    );
  return `<section class="panel compare-shell"><div class="comparison-tools"><label>Período A <input class="select" type="date" id="date" aria-label="Data do período A" value="${state.date}"></label><label>Período B <input class="select" type="date" id="compare-date" aria-label="Data do período B" value="${state.compareDate}"></label><label>Horário <select class="select" id="compare-hour" aria-label="Horário da comparação">${Array.from(
    { length: Math.floor((closing - opening) / 60) + 1 },
    (_, i) => opening + i * 60,
  )
    .map(
      (m) =>
        `<option value="${m}" ${Math.floor(state.minute / 60) === m / 60 ? "selected" : ""}>${time(m)}</option>`,
    )
    .join(
      "",
    )}</select></label><select class="select" id="compare-floor" aria-label="Pavimento da comparação"><option value="0" ${state.floor === 0 ? "selected" : ""}>Térreo</option><option value="1" ${state.floor === 1 ? "selected" : ""}>2º pavimento</option></select><div class="compare-mobile-switch"><button class="btn" data-side="A">Ver A</button><button class="btn" data-side="B">Ver B</button><button class="btn" data-side="split">Dividir</button></div></div><div class="compare-viewport" style="--split:${state.split}%" data-side="${state.compareSide}"><div class="comparison-base">${mapMarkup(state, { day: weekDay(state.compareDate), date: state.compareDate, mini: true })}</div><div class="comparison-overlay">${mapMarkup(state, { day: state.day, mini: true })}</div><div class="period-label a">A · ${labelDate(state.date)} · ${time(state.minute)}</div><div class="period-label b">B · ${labelDate(state.compareDate)} · ${time(state.minute)}</div><div class="split-line"><span>↔</span></div><input id="compare-divider" class="compare-divider" type="range" min="5" max="95" value="${state.split}" aria-label="Divisor da comparação entre os períodos"></div><div class="maplegend"><span>Mesma planta · zoom e escala alinhados</span><span class="heatgradient"></span><span>Arraste o divisor ↔</span></div></section><section class="panel tablewrap" style="margin-top:17px"><table class="comparetable"><thead><tr><th>SETOR</th><th>A · OCUPAÇÃO</th><th>B · OCUPAÇÃO</th><th>DIFERENÇA B − A</th></tr></thead><tbody>${ca
    .filter((s) => s.floor === state.floor)
    .map((s) => {
      let b = cb.find((x) => x.id === s.id),
        d = b.count - s.count;
      return `<tr><td>${s.name}</td><td>${s.unavailable ? "Sem informação" : s.count}</td><td>${b.unavailable ? "Sem informação" : b.count}</td><td>${s.unavailable || b.unavailable ? "—" : (d > 0 ? "+" : "") + d}</td></tr>`;
    })
    .join("")}</tbody></table></section>`;
}

function flowsPage() {
  state.flowRecords = flowData(state.origin, state.minute, state.day);
  let origin = sectors.find((s) => s.id === state.origin),
    dest = state.flowRecords[0];
  if (!dest)
    return `<section class="panel insight"><h2>Sem passagens medidas neste intervalo.</h2><p>A ausência de registro não representa fluxo zero. Não há trajetórias inferidas a partir da ocupação.</p><input class="select" type="date" id="date" value="${state.date}"><select class="select" id="origin">${sectors.map((s) => `<option value="${s.id}" ${s.id === state.origin ? "selected" : ""}>${s.name}</option>`).join("")}</select><select class="select" id="compare-hour">${Array.from(
      { length: Math.floor((closing - opening) / 60) + 1 },
      (_, i) => opening + i * 60,
    )
      .map(
        (m) =>
          `<option value="${m}" ${Math.floor(state.minute / 60) === m / 60 ? "selected" : ""}>${time(m)}</option>`,
      )
      .join("")}</select></section>`;
  return `<div class="historyinfo">Passagens entre regiões, não visitantes únicos. Fonte: ${cache.mode === "simulator" ? "simulador identificado" : "observações de passagens"}. Não representa percursos completos.</div><section class="panel" style="margin-bottom:17px"><div class="comparison-tools"><label>Origem <select class="select" id="origin" aria-label="Setor de origem">${sectors.map((s) => `<option value="${s.id}" ${s.id === state.origin ? "selected" : ""}>${s.name}</option>`).join("")}</select></label><input class="select" type="date" id="date" aria-label="Data da análise de fluxo" value="${state.date}"><select class="select" id="compare-hour" aria-label="Início do intervalo de fluxo">${Array.from(
    { length: Math.floor((closing - opening) / 60) + 1 },
    (_, i) => opening + i * 60,
  )
    .map(
      (m) =>
        `<option value="${m}" ${Math.floor(state.minute / 60) === m / 60 ? "selected" : ""}>${time(m)}</option>`,
    )
    .join(
      "",
    )}</select><span style="font-size:10px;color:#8c9881">Janela: 15 minutos anteriores ao horário escolhido</span></div></section><div class="grid-main"><div>${mapPanel()}</div><aside><section class="panel insight"><div class="eyebrow">PRÓXIMOS DESTINOS</div><h2 style="margin:8px 0 15px">Depois desta região</h2>${state.flowRecords.map((f) => `<div class="minirow"><span>${sectors.find((s) => s.id === f.to).name}</span><b>${f.total ? Math.round((f.count / f.total) * 100) : "—"}%</b></div><div class="bar"><i style="width:${f.total ? (f.count / f.total) * 100 : 0}%"></i></div><p style="font-size:9px">${f.count} de ${f.total} passagens de origem</p>`).join("")}<p style="font-size:9px;margin-top:18px">Percentuais calculados sobre as ${dest.total} passagens registradas que saíram da região selecionada neste intervalo.</p></section></aside></div><section class="panel insight" style="margin-top:17px"><h2>Uma conexão, duas etapas</h2><div class="flow-summary"><div class="flow-pill">ORIGEM<strong>${dest.total}</strong>${origin.name}</div><span style="color:#a6b48e">→</span><div class="flow-pill">PRÓXIMO SETOR<strong>${dest.count}</strong>${sectors.find((s) => s.id === dest.to).name}</div></div><p style="font-size:10px">Esta visualização não comprova percursos completos de pessoas. Relacionar múltiplas etapas exige dados e validação adicionais.</p></section>`;
}
function reportPage() {
  let list = counts(state).filter((s) => s.floor === state.floor);
  return `<section class="panel"><div class="comparison-tools"><input class="select" type="date" id="date" aria-label="Data do relatório" value="${state.date}"><select class="select" id="compare-floor" aria-label="Pavimento do relatório"><option value="0" ${state.floor === 0 ? "selected" : ""}>Térreo</option><option value="1" ${state.floor === 1 ? "selected" : ""}>2º pavimento</option></select><label>Horário <input class="select" type="time" id="report-hour" value="${time(state.minute)}" min="${time(opening)}" max="23:59" aria-label="Horário do relatório"></label><button class="btn primary" id="export">${icon("download")} Exportar CSV</button></div></section>${statCards()}<section class="panel tablewrap"><div class="panel-head"><h2>Ocupação por setor</h2><span class="badge demo">${cache.mode === "simulator" ? "Dados simulados" : "Dados de vídeo"}</span></div><table class="comparetable"><thead><tr><th>REGIÃO</th><th>OCUPAÇÃO</th><th>CONCENTRAÇÃO</th><th>ESTADO</th></tr></thead><tbody>${list.map((s) => `<tr><td>${s.name}</td><td>${s.unavailable ? "—" : s.count + " pessoas"}</td><td>${s.unavailable ? "—" : concentration(s)}</td><td>${s.unavailable ? "Sem informação" : s.status === "stale" ? "Atrasado" : s.source}</td></tr>`).join("")}</tbody></table></section><section class="below"><div class="panel insight"><h2>Qualidade dos dados</h2><p>Sem informação é diferente de zero. Estado, origem e captura são consultados na API. Posições só geram calor quando disponíveis e calibradas.</p></div><div class="panel insight"><h2>Cobertura</h2><p>Uma câmera autoritativa por setor. Os números representam ocupação, nunca visitantes únicos.</p></div></section>`;
}
function timeValueFromMinutes(minutes = 0) {
  const total = Math.max(0, Math.min(1439, Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}
function assistantContextFromInputs() {
  const date = document.querySelector("#assistant-date")?.value || state.assistantContext.date || state.date;
  const start = document.querySelector("#assistant-start")?.value || state.assistantContext.start || "16:00";
  const end = document.querySelector("#assistant-end")?.value || state.assistantContext.end || "17:00";
  const sector = document.querySelector("#assistant-sector")?.value || state.assistantContext.sector || "";
  const event = document.querySelector("#assistant-event")?.value || state.assistantContext.event || "";
  return { date, start, end, sector, event };
}
function applyAssistantContext(context = {}) {
  const next = {
    ...state.assistantContext,
    ...context,
  };
  state.assistantContext = next;
  if (next.date) state.date = next.date;
  if (next.start) state.minute = Math.max(opening, Math.min(closing, (Number(next.start.split(":")[0]) || 0) * 60 + (Number(next.start.split(":")[1]) || 0)));
  if (next.end) state.minute = Math.max(state.minute, Math.max(opening, Math.min(closing, (Number(next.end.split(":")[0]) || 0) * 60 + (Number(next.end.split(":")[1]) || 0))));
  if (next.sector) state.selected = next.sector;
}
async function submitAssistantPrompt(messageText) {
  const textarea = document.querySelector("#assistant-message");
  const text = (messageText ?? textarea?.value ?? "").trim();
  if (!text || state.assistantLoading) return;
  const context = assistantContextFromInputs();
  state.assistantContext = context;
  state.assistantMessages.push({ role: "user", text });
  state.assistantLoading = true;
  renderContent();
  try {
    const payload = await request("/assistant/analyze", {
      method: "POST",
      body: JSON.stringify({
        message: text,
        context: {
          date: context.date,
          start: context.start,
          end: context.end,
          sector: context.sector,
          event: context.event,
        },
      }),
    });
    const interpreted = payload?.interpreted || {};
    if (interpreted.date) state.assistantContext.date = interpreted.date;
    if (interpreted.period) {
      state.assistantContext.start = timeValueFromMinutes(interpreted.period.start);
      state.assistantContext.end = timeValueFromMinutes(interpreted.period.end);
    }
    if (interpreted.sector_id) state.assistantContext.sector = interpreted.sector_id;
    if (interpreted.event_id) state.assistantContext.event = interpreted.event_id;
    state.assistantMessages.push({ role: "bot", answer: payload });
  } catch (error) {
    state.assistantMessages.push({
      role: "bot",
      answer: {
        mode_note: "Assistente indisponível",
        response: {
          observations: ["Não foi possível consultar o banco de dados no momento."],
          interpretations: ["Verifique a sessão do administrador e tente novamente."],
          suggestions: ["Ajuste o recorte e repita a pergunta em seguida."],
        },
        data_source: { simulated: cache.mode === "simulator" },
      },
    });
    toast(error.message || "Falha ao consultar o assistente.");
  } finally {
    state.assistantLoading = false;
    renderContent();
    const chat = document.querySelector(".assistant-chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
    const input = document.querySelector("#assistant-message");
    if (input) {
      input.value = "";
      input.style.height = "auto";
    }
  }
}
function assistantPage() {
  const defaultMessages = state.assistantMessages.length
    ? state.assistantMessages
    : [
        {
          role: "bot",
          answer: {
            mode_note: "Assistente demonstrativo — análise por regras, sem modelo de linguagem conectado.",
            response: {
              observations: [
                "Use a pergunta em linguagem natural ou ajuste o recorte. O assistente interpreta data, horário, setor e evento com base no banco do shopping.",
              ],
              interpretations: [
                "Ele compara o período com a referência histórica e explica o que o padrão de ocupação sugere, sem inventar conclusões.",
              ],
              suggestions: [
                "Pergunte: 'Como estava a praça central no sábado às 16h?'",
              ],
            },
            data_source: { simulated: cache.mode === "simulator" },
          },
        },
      ];
  const { date, start, end, sector, event } = state.assistantContext;
  const selectedDate = date || state.date;
  const selectedStart = start || "16:00";
  const selectedEnd = end || "17:00";
  return `<section class="panel assistant-shell"><div class="assistant-header"><div><span class="eyebrow">ASSISTENTE IA</span><h2>Assistente orientado por dados do shopping.</h2></div><button class="btn" id="clear-assistant-chat">Limpar conversa</button></div><div class="assistant-chat">${defaultMessages.map((msg) => msg.role === "user" ? `<div class="assistant-bubble assistant-user"><strong>Você</strong><p>${esc(msg.text)}</p></div>` : `<div class="assistant-bubble assistant-bot"><div class="assistant-badge">Assistente</div>${assistantMessageMarkup(msg.answer)}</div>`).join("")}${state.assistantLoading ? `<div class="assistant-bubble assistant-bot"><div class="assistant-badge">Assistente</div><div class="assistant-answer assistant-loading"><span class="assistant-spinner"></span><p>Consultando registros e comparando contexto…</p></div></div>` : ""}</div><div class="assistant-toolbar"><label>Data<input class="select" id="assistant-date" type="date" value="${selectedDate}"></label><label>Início<input class="select" id="assistant-start" type="time" value="${selectedStart}"></label><label>Fim<input class="select" id="assistant-end" type="time" value="${selectedEnd}"></label><label>Setor<select class="select" id="assistant-sector"><option value="">Qualquer setor</option>${sectors.map((s) => `<option value="${s.id}" ${sector === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label><label>Evento<select class="select" id="assistant-event"><option value="">Sem filtro</option>${state.programs.map((e) => `<option value="${e.id}" ${event === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></label></div><div class="assistant-input"><textarea id="assistant-message" rows="3" placeholder="Ex.: Como estava a praça central no sábado às 16h?"></textarea><button class="btn primary" id="assistant-send" ${state.assistantLoading ? "disabled" : ""}>${state.assistantLoading ? "Analisando…" : "Enviar"}</button></div><div class="assistant-suggestions">${["Como estava a praça central no sábado às 16h?", "Quais setores tiveram menor ocupação no último sábado?", "Houve períodos de baixa utilização na praça de eventos?", "O que podemos testar para aproveitar melhor esse espaço?"].map((item) => `<button class="btn" data-assistant-suggestion="${esc(item)}">${esc(item)}</button>`).join("")}</div></section>`;
}
function assistantMessageMarkup(answer) {
  if (!answer) return "<p>Sem resposta.</p>";
  const response = answer.response || {};
  const observations = (response.observations || []).map((text) => `<li>${esc(text)}</li>`).join("");
  const interpretations = (response.interpretations || []).map((text) => `<li>${esc(text)}</li>`).join("");
  const suggestions = (response.suggestions || []).map((text) => `<li>${esc(text)}</li>`).join("");
  const note = answer.mode_note || answer.mode || "Assistente demonstrativo";
  const actions = [];
  const mapJson = answer.map_params ? JSON.stringify(answer.map_params).replace(/"/g, "&quot;") : "";
  if (answer.map_params && answer.map_params.date) {
    actions.push(`<button class="btn" data-assistant-map='${mapJson}'>Ver no mapa</button>`);
  }
  if (answer.interpreted) {
    const ctxJson = JSON.stringify({ date: answer.interpreted.date || state.assistantContext.date || state.date, start: answer.interpreted.period?.start != null ? timeValueFromMinutes(answer.interpreted.period.start) : state.assistantContext.start || "16:00", end: answer.interpreted.period?.end != null ? timeValueFromMinutes(answer.interpreted.period.end) : state.assistantContext.end || "17:00", sector: answer.interpreted.sector_id || state.assistantContext.sector || "", event: answer.interpreted.event_id || state.assistantContext.event || "" }).replace(/"/g, "&quot;");
    actions.push(`<button class="btn" data-assistant-context='${ctxJson}'>Ajustar análise</button>`);
  }
  const metrics = answer.metrics || {};
  const metricChips = [
    metrics.mean != null ? `Média ${metrics.mean}` : null,
    metrics.peak != null ? `Pico ${metrics.peak}` : null,
    metrics.valid_measurements != null ? `${metrics.valid_measurements} medições` : null,
  ].filter(Boolean);
  return `<div class="assistant-mode">${esc(note)}</div><div class="assistant-answer"><div class="assistant-metrics">${metricChips.map((chip) => `<span>${esc(chip)}</span>`).join("") || "<span>Baseado em dados do shopping</span>"}</div>${response.observations?.length ? `<p class="assistant-summary"><strong>Observação:</strong> ${esc(response.observations[0])}</p>` : ""}${observations ? `<ul class="assistant-list">${observations}</ul>` : ""}${interpretations ? `<div class="assistant-subsection"><strong>Interpretação</strong><ul class="assistant-list">${interpretations}</ul></div>` : ""}${suggestions ? `<div class="assistant-subsection"><strong>Próximos passos</strong><ul class="assistant-list">${suggestions}</ul></div>` : ""}${response.clarification ? `<p class="assistant-warning"><strong>Esclarecimento:</strong> ${esc(response.clarification)}</p>` : ""}${answer.data_source?.simulated ? `<small>Dados simulados identificados no retorno do assistente.</small>` : ""}${actions.length ? `<div class="assistant-actions">${actions.join("")}</div>` : ""}</div>`;
}
function render() {
  renderContent();
  syncView();
}
function renderContent() {
  setAnalysisContext({ date: state.date, events: state.programs });
  if (state.login || !state.session) {
    destroyMaps();
    document.body.className = "login-view";
    app.innerHTML = loginMarkup();
    bindLogin();
    return;
  }
  state.mode = cache.demo ? "demo" : "admin";
  destroyMaps();
  document.body.className =
    "administrative botanical" + (state.present ? " presentation" : "");
  let content =
    state.page === "events"
      ? eventsPage()
      : state.page === "profile"
        ? profilePage()
        : state.page === "reports"
          ? reportPage()
          : state.page === "assistant"
            ? assistantPage()
            : `${state.page === "history" ? historyControls() : liveDateBar()}${statCards()}<div class="calendar-layout ${state.calOpen ? "with-calendar" : ""}">${state.calOpen ? calendarPanel() : ""}<div class="calendar-map-col"><div class="grid-main">${mapPanel()}${rightPanel()}</div></div></div><div id="insights-slot">${insights()}</div>`;
  app.innerHTML =
    header() +
    heading() +
    `<div id="favorites-slot"></div>` +
    content +
    `<footer class="foot"><span>CONFLUI · PROPOSTA CONCEITUAL PARA O CAPIM DOURADO</span><span>Identidade original inspirada no capim-dourado · ${cache.mode === "simulator" ? "Dados sintéticos · Sem câmeras conectadas." : "Dados de vídeo · Consulte a cobertura das câmeras."}</span></footer></main>`;
  if (cache.demo) {
    app
      .querySelectorAll(
        "#new-event, #add-event, #new-special, #create-program, #edit-program, #favorite-toggle, [data-delete-event]",
      )
      .forEach((control) => control.remove());
  }
  bind();
  bindExtra();
  bindDomain();
  initMaps(state, selectSector);
}
function selectSector(id, focus = true) {
  if (!id) {
    state.selected = null;
    if (focus) focusSelection(state);
    renderDetail();
    document
      .querySelectorAll("[data-pick]")
      .forEach((e) => e.classList.remove("active"));
    return;
  }
  let s = sectors.find((s) => s.id === id);
  if (!s) return;
  state.selected = id;
  state.collapsed = false;
  state.browse = false;
  if (state.floor !== s.floor) {
    state.floor = s.floor;
    render();
  } else {
    if (document.querySelector(".sector-browser")) {
      render();
      return;
    }
    focusSelection(state);
    renderDetail();
    document
      .querySelectorAll("[data-pick]")
      .forEach((e) => e.classList.toggle("active", e.dataset.pick === id));
  }
}
function renderDetail() {
  let slot = document.querySelector("#detail-slot");
  if (slot) {
    slot.innerHTML = state.selected ? detailMarkup() : "";
    bindDetail();
    bindFavorite();
  }
}
function bindDetail() {
  document.querySelectorAll("[data-overview]").forEach(
    (b) =>
      (b.onclick = () => {
        state.selected = null;
        state.collapsed = false;
        focusSelection(state);
        renderDetail();
        document
          .querySelectorAll("[data-pick]")
          .forEach((e) => e.classList.remove("active"));
      }),
  );
  let e = document.querySelector("#collapse");
  if (e)
    e.onclick = () => {
      state.collapsed = !state.collapsed;
      renderDetail();
    };
}
function bindList() {
  document
    .querySelectorAll("[data-pick]")
    .forEach((b) => (b.onclick = () => selectSector(b.dataset.pick)));
}
function changePage(page) {
  if (!state.session) return;
  clearInterval(replayTimer);
  state.playing = false;
  state.page = page;
  state.live = page === "map";
  state.selected = null;
  state.query = "";
  state.browse = false;
  state.calOpen = page === "history";
  if (page === "map") {
    setDate(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Araguaina",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
    state.minute = new Date().getHours() * 60 + new Date().getMinutes();
  }
  render();
}
function bind() {
  document.querySelectorAll("[data-mode]").forEach(
    (b) =>
      (b.onclick = () => {
        clearInterval(replayTimer);
        state.mode = b.dataset.mode;
        state.page = "map";
        state.live = true;
        state.playing = false;
        state.selected = null;
        state.minute = 1080;
        state.day = 5;
        state.query = "";
        state.collapsed = false;
        render();
      }),
  );
  document
    .querySelectorAll("[data-nav]")
    .forEach((b) => (b.onclick = () => changePage(b.dataset.nav)));
  const assistantDate = document.querySelector("#assistant-date");
  if (assistantDate)
    assistantDate.onchange = () => {
      state.assistantContext.date = assistantDate.value || state.date;
    };
  const assistantStart = document.querySelector("#assistant-start");
  if (assistantStart)
    assistantStart.onchange = () => {
      state.assistantContext.start = assistantStart.value || "16:00";
    };
  const assistantEnd = document.querySelector("#assistant-end");
  if (assistantEnd)
    assistantEnd.onchange = () => {
      state.assistantContext.end = assistantEnd.value || "17:00";
    };
  const assistantSector = document.querySelector("#assistant-sector");
  if (assistantSector)
    assistantSector.onchange = () => {
      state.assistantContext.sector = assistantSector.value || "";
    };
  const assistantEvent = document.querySelector("#assistant-event");
  if (assistantEvent)
    assistantEvent.onchange = () => {
      state.assistantContext.event = assistantEvent.value || "";
    };
  const assistantSend = document.querySelector("#assistant-send");
  if (assistantSend)
    assistantSend.onclick = () => submitAssistantPrompt();
  const clearAssistant = document.querySelector("#clear-assistant-chat");
  if (clearAssistant)
    clearAssistant.onclick = () => {
      state.assistantMessages = [];
      state.assistantContext = {
        date: state.date,
        start: "16:00",
        end: "17:00",
        sector: "",
        event: "",
      };
      state.assistantLoading = false;
      render();
    };
  const assistantText = document.querySelector("#assistant-message");
  if (assistantText) {
    assistantText.onkeydown = (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitAssistantPrompt(assistantText.value);
      }
    };
    assistantText.oninput = () => {
      assistantText.style.height = "auto";
      assistantText.style.height = `${Math.min(assistantText.scrollHeight, 180)}px`;
    };
  }
  document.querySelectorAll("[data-assistant-suggestion]").forEach((button) => {
    button.onclick = () => {
      const suggestion = button.dataset.assistantSuggestion || "";
      if (!suggestion) return;
      submitAssistantPrompt(suggestion);
    };
  });
  document.querySelectorAll("[data-assistant-map]").forEach((button) => {
    button.onclick = () => {
      try {
        const params = JSON.parse(button.dataset.assistantMap || "{}");
        if (params.date) state.date = params.date;
        if (params.minute != null) state.minute = Number(params.minute);
        if (params.sector_id) {
          state.selected = params.sector_id;
          const target = sectors.find((s) => s.id === params.sector_id);
          if (target) state.floor = target.floor;
        }
        if (params.event_id) state.programId = params.event_id;
        if (params.floor != null) state.floor = Number(params.floor);
        state.page = "map";
        state.live = false;
        render();
      } catch {}
    };
  });
  document.querySelectorAll("[data-assistant-context]").forEach((button) => {
    button.onclick = () => {
      try {
        const next = JSON.parse(button.dataset.assistantContext || "{}");
        state.assistantContext = { ...state.assistantContext, ...next };
        render();
      } catch {}
    };
  });
  document.querySelectorAll("[data-floor]").forEach(
    (b) =>
      (b.onclick = () => {
        state.floor = +b.dataset.floor;
        state.selected = null;
        if (state.page === "flows")
          state.origin = state.floor ? "acesso-alimentacao" : "cinema";
        render();
      }),
  );
  bindList();
  bindDetail();
  let q = document.querySelector("#sector-search");
  if (q)
    q.oninput = () => {
      state.query = q.value;
      document.querySelector("#sector-list").innerHTML = sectorList();
      bindList();
    };
  let scope = document.querySelector("#scope");
  if (scope)
    scope.onchange = () => {
      state.scope = scope.value;
      document.querySelector("#sector-list").innerHTML = sectorList();
      bindList();
    };
  let op = document.querySelector("#opacity");
  if (op)
    op.oninput = () => {
      state.opacity = +op.value;
      document
        .querySelectorAll(".mapgroup canvas")
        .forEach((c) => (c.style.opacity = state.opacity / 100));
    };
  let day = document.querySelector("#day");
  if (day)
    day.onchange = () => {
      state.day = +day.value;
      let base = new Date("2026-11-09T12:00:00");
      base.setDate(9 + state.day);
      state.date = base.toISOString().slice(0, 10);
      render();
    };
  let date = document.querySelector("#date");
  if (date)
    date.onchange = () => {
      if (!date.value) return;
      state.date = date.value;
      let d = new Date(date.value + "T12:00:00");
      state.day = (d.getDay() + 6) % 7;
      render();
    };
  let timelineEl = document.querySelector("#timeline");
  if (timelineEl)
    timelineEl.oninput = () => {
      state.minute = +timelineEl.value;
      updateData();
      refreshEventHighlight();
      document
        .querySelectorAll("[data-time]")
        .forEach((e) => (e.textContent = time(state.minute)));
      document.querySelector("[data-livebadge]").textContent =
        time(state.minute) + " · Histórico";
    };
  let play = document.querySelector("#play");
  if (play)
    play.onclick = () => {
      state.playing = !state.playing;
      play.textContent = state.playing ? "Ⅱ Pausar" : "▷ Reproduzir";
      clearInterval(replayTimer);
      if (state.playing)
        replayTimer = setInterval(() => {
          if (state.minute >= closing) {
            state.playing = false;
            clearInterval(replayTimer);
            document.querySelector("#play").textContent = "▷ Reproduzir";
            return;
          }
          state.minute += 15;
          updateData();
          refreshEventHighlight();
          let t = document.querySelector("#timeline");
          if (t) t.value = state.minute;
          document
            .querySelectorAll("[data-time]")
            .forEach((e) => (e.textContent = time(state.minute)));
          let badge = document.querySelector("[data-livebadge]");
          if (badge) badge.textContent = time(state.minute) + " · Histórico";
        }, 900);
    };
  document.querySelectorAll("[data-week]").forEach(
    (b) =>
      (b.onclick = () => {
        [state.day, state.minute] = b.dataset.week.split(",").map(Number);
        state.date = "2026-11-" + String(9 + state.day).padStart(2, "0");
        render();
      }),
  );
  let cday = document.querySelector("#compare-day");
  if (cday)
    cday.onchange = () => {
      state.compareDay = +cday.value;
      render();
    };
  let chour = document.querySelector("#compare-hour");
  if (chour)
    chour.onchange = () => {
      state.minute = +chour.value;
      render();
    };
  let cfloor = document.querySelector("#compare-floor");
  if (cfloor)
    cfloor.onchange = () => {
      state.floor = +cfloor.value;
      render();
    };
  let origin = document.querySelector("#origin");
  if (origin)
    origin.onchange = () => {
      state.origin = origin.value;
      state.floor = sectors.find((s) => s.id === state.origin).floor;
      render();
    };
  let avail = document.querySelector("#availability");
  if (avail)
    avail.onchange = () => {
      state.unavailable = avail.value || null;
      render();
    };
  let stale = document.querySelector("#stale");
  if (stale)
    stale.onclick = () => {
      state.stale = !state.stale;
      render();
      toast(
        state.stale
          ? "A simulação ao vivo ficará com atualização atrasada."
          : "Atualização restaurada.",
      );
    };
  let hr = document.querySelector("#report-hour");
  if (hr)
    hr.onchange = () => {
      if (!hr.value) return;
      let [h, m] = hr.value.split(":").map(Number);
      state.minute = Math.max(opening, Math.min(closing, h * 60 + m));
      render();
    };
  let ex = document.querySelector("#export");
  if (ex) ex.onclick = exportCSV;
}
function exportCSV() {
  let rows = [
    [
      "Setor",
      "Pavimento",
      "Data",
      "Dia",
      "Horario",
      "Pessoas estimadas",
      "Estado",
      "Fonte",
    ],
    ...counts(state)
      .filter((s) => s.floor === state.floor)
      .map((s) => [
        s.name,
        floors[s.floor],
        state.date,
        days[state.day],
        time(state.minute),
        s.unavailable ? "" : s.count,
        s.unavailable ? "Sem informacao" : s.status,
        s.source || "Indisponível",
      ]),
  ];
  let url = URL.createObjectURL(
    new Blob(["\ufeff" + rows.map((r) => r.join(";")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  let a = document.createElement("a");
  a.href = url;
  a.download = "conflui-ocupacao.csv";
  a.click();
  URL.revokeObjectURL(url);
  toast("Relatório exportado com a origem dos registros.");
}
function updateData() {
  syncView();
  updateMaps(state);
  let list = counts(state),
    floorlist = list.filter((s) => s.floor === state.floor && !s.unavailable);
  document.querySelectorAll("[data-count]").forEach((e) => {
    let s = list.find((s) => s.id === e.dataset.count);
    if (s) e.textContent = s.unavailable ? "—" : s.count;
  });
  let s = list.find((s) => s.id === state.selected),
    dc = document.querySelector("[data-detail-count]");
  if (s && dc) {
    dc.textContent = s.unavailable ? "—" : s.count;
    document.querySelector("[data-detail-level]").textContent = s.unavailable
      ? "Medição indisponível"
      : concentration(s) + " concentração";
    document.querySelector("[data-detail-time]").textContent = state.live
      ? "Captura: " +
        (s.captured_at
          ? new Date(s.captured_at).toLocaleTimeString("pt-BR", {
              timeZone: "America/Araguaina",
            })
          : "Sem medição")
      : days[state.day] + " às " + time(state.minute);
  }
  let total = document.querySelector('[data-stat="total"]');
  if (total)
    total.textContent = floorlist.length
      ? floorlist.reduce((a, s) => a + s.count, 0)
      : "—";
  let upd = document.querySelector('[data-stat="updated"]');
  if (upd)
    upd.textContent = state.live
      ? state.updated.toLocaleTimeString("pt-BR", {
          timeZone: "America/Araguaina",
        })
      : time(state.minute);
  let max = [...floorlist].sort((a, b) => b.count - a.count)[0],
    mx = document.querySelector('[data-stat="maximum"]');
  if (mx && max) {
    mx.textContent = max.name;
    document.querySelector('[data-stat-hint="maximum"]').textContent =
      max.count + " pessoas estimadas";
  }
  let trend = document.querySelector('[data-stat="trend"]');
  if (trend) {
    let before = floorlist.reduce(
        (a, s) =>
          a + occupancy(s, Math.max(opening, state.minute - 60), state.day),
        0,
      ),
      now = floorlist.reduce((a, s) => a + s.count, 0),
      d = Math.round(((now - before) / before) * 100);
    trend.textContent =
      before > 0 && Number.isFinite(d) ? (d > 0 ? "+" : "") + d + "%" : "—";
  }
  let slot = document.querySelector("#insights-slot");
  if (slot) {
    slot.innerHTML = insights();
    bindList();
    slot
      .querySelectorAll("[data-nav]")
      .forEach((b) => (b.onclick = () => changePage(b.dataset.nav)));
  }
}

function miniChart() {
  return `<div class="mini-timeline-chart">${Array.from(
    { length: Math.floor((closing - opening) / 15) + 1 },
    (_, i) => {
      let minute = opening + i * 15,
        v = counts(state, minute, state.day)
          .filter((s) => s.floor === state.floor && !s.unavailable)
          .reduce((a, s) => a + s.count, 0);
      return `<button type="button" data-chart-minute="${minute}" style="height:${Math.max(8, (v / 900) * 100)}%" aria-label="Consultar ${time(minute)}: ${v} pessoas estimadas"></button>`;
    },
  ).join("")}</div>`;
}
function eventPanel() {
  let list = [
    ...programsOn(state.date).map((e) => ({
      id: "program-marker-" + e.id,
      text: e.name + " · início do evento",
      minute: e.start,
      sector: e.sectors[0],
      program: e.id,
    })),
    ...state.events.filter((e) => e.date === state.date),
  ];
  return `<section class="event-strip"><div class="flex items-center justify-between gap-2"><span class="eyebrow">ACONTECIMENTOS DO DIA</span><button class="btn" id="add-event">＋ Marcação</button></div><div id="event-entries">${list.length ? list.map((e) => `<div class="event-entry ${Math.abs(state.minute - e.minute) <= 15 ? "current" : ""}" data-event-time="${e.minute}"><button class="event-jump" ${e.program ? `data-program="${e.program}"` : `data-event-id="${e.id}"`}><b>${time(e.minute)}</b> ${esc(e.text)}<small>${esc(sectors.find((s) => s.id === e.sector)?.name || "Todos os setores")}</small></button>${e.program ? "" : `<button class="circlebtn" data-delete-event="${e.id}" aria-label="Excluir marcação ${esc(e.text)}">×</button>`}</div>`).join("") : '<p class="event-empty">Registre eventos e sessões para contextualizar o movimento.</p>'}</div><p class="event-disclaimer">Marcações persistidas na API. A proximidade com uma mudança de ocupação não demonstra causalidade.</p></section>`;
}
function refreshEventHighlight() {
  document
    .querySelectorAll("[data-event-time]")
    .forEach((e) =>
      e.classList.toggle(
        "current",
        Math.abs(state.minute - Number(e.dataset.eventTime)) <= 15,
      ),
    );
}
function favoritesMarkup() {
  return state.mode === "admin"
    ? `<div class="favorites-strip"><span>FAVORITOS</span>${
        state.favorites.length
          ? state.favorites
              .map((id) => {
                let s = sectors.find((s) => s.id === id);
                return s
                  ? `<button class="btn favorite-chip" data-pick="${s.id}">★ ${s.name}</button>`
                  : "";
              })
              .join("")
          : "<small>Selecione um setor e toque na estrela para salvar.</small>"
      }</div>`
    : "";
}
function bindFavorite() {
  let fav = document.querySelector("#favorite-toggle");
  if (fav)
    fav.onclick = () => {
      let id = state.selected;
      state.favorites = state.favorites.includes(id)
        ? state.favorites.filter((x) => x !== id)
        : [...state.favorites, id];
      persist();
      renderDetail();
      let bar = document.querySelector("#favorites-slot");
      if (bar) {
        bar.innerHTML = favoritesMarkup();
        bindList();
      }
    };
}
function loginMarkup() {
  return `<div class="login-layout"><section class="login-art"><a href="#" class="brand" id="login-home">${botanicalMark()}conflui.</a><div class="botanical-stems" aria-hidden="true"><svg viewBox="0 0 500 420" fill="none"><g stroke="currentColor" stroke-width="1.2"><path d="M260 410Q180 190 110 95M260 410Q260 170 250 55M260 410Q340 220 390 120M260 410Q225 200 180 145"/><circle cx="108" cy="84" r="20"/><circle cx="108" cy="84" r="13"/><circle cx="249" cy="43" r="24"/><circle cx="249" cy="43" r="16"/><circle cx="394" cy="109" r="20"/><circle cx="394" cy="109" r="13"/><circle cx="177" cy="134" r="16"/><circle cx="177" cy="134" r="9"/><path d="M108 64v40M88 84h40M249 19v48M225 43h48M394 89v40M374 109h40M177 118v32M161 134h32" opacity=".4"/></g></svg></div><div class="flow-art" aria-hidden="true"><svg viewBox="0 0 600 600"><g fill="none" stroke="currentColor">${Array.from({ length: 12 }, (_, i) => `<path d="M-80 ${100 + i * 23} C 230 ${-150 + i * 20}, 180 ${620 + i * 4}, 690 ${250 + i * 21}" stroke-width="${i % 4 === 0 ? 2 : 1}"/>`).join("")}</g></svg></div><div class="login-art-copy"><span class="eyebrow">INTELIGÊNCIA DE ESPAÇOS</span><h1>O movimento<br>ganha sentido.</h1><p>Das tramas do Tocantins<br>às conexões de cada espaço.</p></div><small>IDENTIDADE CONCEITUAL · CAPIM-DOURADO · TOCANTINS</small></section><section class="login-form-side"><span class="back-public">ACESSO EXCLUSIVO À ADMINISTRAÇÃO</span><div class="login-content"><span class="eyebrow">ÁREA ADMINISTRATIVA</span><h2>Bem-vindo de volta.</h2><p>Acesse a central de análise do Conflui.</p><div class="login-demo-note">Entre com o administrador criado no backend. O ambiente identifica separadamente dados simulados e medições por vídeo.</div><form id="login-form"><label>E-mail<input type="email" id="login-email" placeholder="seu.email@exemplo.com" autocomplete="on" required></label><label>Senha<div class="password-wrap"><input type="password" id="login-password" placeholder="Sua senha" autocomplete="on" minlength="6" required><button type="button" id="show-password" aria-label="Mostrar senha">Mostrar</button></div></label><p id="login-error" role="alert"></p><button class="btn primary login-submit" type="submit">Acessar a central →</button></form><div class="login-or"><span></span>ou<span></span></div><button type="button" id="demo-login" class="btn demo-access">Explorar demonstração →</button><p class="login-security-note" id="demo-note">Conheça o Conflui com dados simulados, sem precisar criar uma conta.</p><p class="login-security-note">Autenticação por sessão com expiração. O tipo de dado depende do ambiente configurado no backend.</p></div></section></div>`;
}
function bindLogin() {
  const errorMessage = document.querySelector("#login-error");
  document.querySelector("#demo-login").onclick = async () => {
    const button = document.querySelector("#demo-login");
    errorMessage.textContent = "";
    button.disabled = true;
    button.textContent = "Abrindo demonstração...";
    try {
      await request("/auth/demo", {
        method: "POST",
      });
      await startSession();
    } catch (error) {
      cache.demo = false;
      errorMessage.textContent =
        error.message || "Não foi possível iniciar a demonstração.";
      button.disabled = false;
      button.textContent = "Explorar demonstração →";
    }
  };
  document.querySelector("#login-home").onclick = (e) => e.preventDefault();
  document.querySelector("#show-password").onclick = () => {
    let p = document.querySelector("#login-password");
    p.type = p.type === "password" ? "text" : "password";
  };
  document.querySelector("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    let b = document.querySelector(".login-submit");
    errorMessage.textContent = "";
    clearCache();
    b.disabled = true;
    b.textContent = "Entrando…";
    try {
      await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.querySelector("#login-email").value,
          password: document.querySelector("#login-password").value,
        }),
      });
      await startSession();
    } catch (error) {
      errorMessage.textContent = error.message;
      b.disabled = false;
      b.textContent = "Acessar a central";
    }
  };
}
function openEvent() {
  let dialog = document.createElement("dialog");
  dialog.className = "event-dialog";
  dialog.innerHTML = `<form id="event-form"><div class="flex items-center justify-between"><h2>Marcar um acontecimento</h2><button type="button" id="cancel-event" class="circlebtn" aria-label="Fechar formulário">×</button></div><p>Adicione contexto à linha do tempo.</p><label>Data<input class="select" type="date" id="event-date" value="${state.date}" required></label><label>Horário<input class="select" type="time" id="event-hour" min="${time(opening)}" max="23:59" value="${time(Math.min(1439, state.minute))}" required></label><label>Setor<select class="select" id="event-sector"><option value="">Todos os setores</option>${sectors.map((s) => `<option value="${s.id}" ${state.selected === s.id ? "selected" : ""}>${s.name}</option>`).join("")}</select></label><label>Descrição<input class="select" type="text" id="event-text" maxlength="120" placeholder="Ex.: início do evento na praça" required></label><button class="btn primary" type="submit">Salvar marcação</button><p style="font-size:10px">Salvo no backend, vinculado ao administrador.</p></form>`;
  document.body.append(dialog);
  dialog.showModal();
  document.querySelector("#cancel-event").onclick = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.oncancel = () => dialog.remove();
  document.querySelector("#event-form").onsubmit = (e) => {
    e.preventDefault();
    let text = document.querySelector("#event-text").value.trim();
    if (!text) return;
    let [h, m] = document
        .querySelector("#event-hour")
        .value.split(":")
        .map(Number),
      minute = h * 60 + m;
    if (minute < opening) {
      toast("Selecione um horário entre 09h e meia-noite.");
      return;
    }
    state.events.push({
      id: Date.now().toString(36),
      date: document.querySelector("#event-date").value,
      minute,
      sector: document.querySelector("#event-sector").value,
      text,
    });
    state.events.sort((a, b) => a.minute - b.minute);
    persist();
    dialog.close();
    dialog.remove();
    render();
    toast("Acontecimento registrado no histórico.");
  };
}
function bindExtra() {
  let home = document.querySelector("#home");
  if (home)
    home.onclick = (e) => {
      e.preventDefault();
      state.mode = cache.demo ? "demo" : "admin";
      changePage("map");
    };
  let entry = document.querySelector("#adminentry");
  if (entry)
    entry.onclick = () => {
      if (state.session) {
        state.mode = cache.demo ? "demo" : "admin";
        state.page = "map";
        state.live = true;
        render();
      } else {
        state.login = true;
        render();
      }
    };
  let logout = document.querySelector("#logout");
  if (logout)
    logout.onclick = async () => {
      try {
        await request("/auth/logout", { method: "POST" });
      } catch (error) {
        if (error.status !== 401) {
          toast("Não foi possível encerrar a sessão: " + error.message);
          return;
        }
      }
      clearCache();
      state.favorites = [];
      state.events = [];
      state.programs = [];
      state.special = [];
      state.assistantMessages = [];
      state.assistantContext = {
        date: "",
        start: "",
        end: "",
        sector: "",
        event: "",
      };
      loadingKey = "";
      state.session = false;
      state.mode = cache.demo ? "demo" : "admin";
      state.login = true;
      state.present = false;
      render();
    };
  let pr = document.querySelector("#present");
  if (pr)
    pr.onclick = () => {
      state.present = !state.present;
      state.browse = false;
      render();
    };
  let browse = document.querySelector("#browse-sectors");
  if (browse)
    browse.onclick = () => {
      state.browse = !state.browse;
      render();
      if (state.browse) document.querySelector("#sector-search")?.focus();
    };
  let close = document.querySelector("#close-browser");
  if (close)
    close.onclick = () => {
      state.browse = false;
      render();
    };
  bindFavorite();
  let slot = document.querySelector("#favorites-slot");
  if (slot) {
    slot.innerHTML = favoritesMarkup();
    bindList();
  }
  for (let id of ["new-event", "add-event"]) {
    let el = document.getElementById(id);
    if (el) el.onclick = openEvent;
  }
  document.querySelectorAll("[data-chart-minute]").forEach(
    (b) =>
      (b.onclick = () => {
        state.minute = +b.dataset.chartMinute;
        updateData();
        refreshEventHighlight();
        document.querySelector("#timeline").value = state.minute;
        document
          .querySelectorAll("[data-time]")
          .forEach((e) => (e.textContent = time(state.minute)));
        document.querySelector("[data-livebadge]").textContent =
          time(state.minute) + " · Histórico";
      }),
  );
  document.querySelectorAll("[data-event-id]").forEach(
    (b) =>
      (b.onclick = () => {
        let e = state.events.find((x) => x.id === b.dataset.eventId);
        state.minute = e.minute;
        if (e.sector) {
          state.selected = e.sector;
          state.floor = sectors.find((s) => s.id === e.sector).floor;
        }
        render();
      }),
  );
  document.querySelectorAll("[data-delete-event]").forEach(
    (b) =>
      (b.onclick = () => {
        state.events = state.events.filter(
          (e) => e.id !== b.dataset.deleteEvent,
        );
        persist();
        render();
      }),
  );
  let slider = document.querySelector("#compare-divider");
  if (slider)
    slider.oninput = () => {
      state.split = +slider.value;
      document
        .querySelector(".compare-viewport")
        .style.setProperty("--split", state.split + "%");
    };
  let line = document.querySelector(".split-line");
  if (line) {
    let dragging = false;
    const move = (e) => {
      if (!dragging) return;
      let rect = document
        .querySelector(".compare-viewport")
        .getBoundingClientRect();
      state.split = Math.max(
        5,
        Math.min(95, ((e.clientX - rect.left) / rect.width) * 100),
      );
      document
        .querySelector(".compare-viewport")
        .style.setProperty("--split", state.split + "%");
      slider.value = state.split;
    };
    line.onpointerdown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      line.setPointerCapture(e.pointerId);
      move(e);
    };
    line.onpointermove = move;
    line.onpointerup = () => (dragging = false);
  }
  document.querySelectorAll("[data-side]").forEach(
    (b) =>
      (b.onclick = () => {
        state.compareSide = b.dataset.side;
        document.querySelector(".compare-viewport").dataset.side =
          state.compareSide;
      }),
  );
}
function allSpecial() {
  return state.special;
}
function programsOn(date) {
  return eventsOn(date, state.programs);
}
function setDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  state.date = date;
  state.day = weekDay(date);
  let d = parseDate(date);
  state.calYear = d.getFullYear();
  state.calMonth = d.getMonth();
  state.live = false;
  state.playing = false;
  clearInterval(replayTimer);
}
function liveDateBar() {
  return `<div class="date-context live-context"><span><i class="dot"></i> Ao vivo · API · ${labelDate(state.date)}</span><button class="alloverview" data-nav="history">▦ Consultar outra data</button></div>`;
}
function dateContext() {
  let events = programsOn(state.date),
    dates = allSpecial().filter((x) => x.date === state.date);
  return `<div class="date-context"><div class="flex flex-wrap gap-2"><span class="context-label">${labelDate(state.date)} · Registro desta data · ${cache.mode === "simulator" ? "simulado" : "vídeo"}</span>${!hasData(state.date) ? '<span class="badge stale">∅ Sem dados de ocupação</span>' : ""}${dates.map((d) => `<button class="badge holiday-badge" data-special-id="${d.id}">◇ ${esc(d.name)}</button>`).join("")}${events.map((e) => `<button class="badge event-badge" data-program="${e.id}">● ${esc(e.name)}</button>`).join("")}</div><p>Ocupação consultada na API. Não é uma média de ${days[state.day].toLowerCase()}.</p></div>`;
}
function calendarPanel() {
  let selected = parseDate(state.date),
    today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Araguaina",
    }),
    cells = monthCells(state.calYear, state.calMonth);
  return `<aside class="calendar-panel panel"><div class="calendar-title"><div><span class="eyebrow">ESCOLHA UM MOMENTO</span><h2>${months[state.calMonth]} <span>${state.calYear}</span></h2></div><div class="flex gap-1"><button class="circlebtn" id="prev-month" aria-label="Mês anterior">‹</button><button class="circlebtn" id="next-month" aria-label="Próximo mês">›</button></div></div><div class="calendar-weekdays">${["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"].map((d) => `<span>${d}</span>`).join("")}</div><div class="calendar-days">${cells
    .map((date) => {
      if (!date) return '<span class="day-blank"></span>';
      let ev = programsOn(date),
        sp = allSpecial().filter((x) => x.date === date),
        no = !hasData(date);
      let aria = `${labelDate(date)}${ev.length ? ", " + ev.length + " evento(s)" : ""}${sp.length ? ", data especial ou feriado" : ""}${no ? ", sem dados" : ""}`;
      return `<button class="calendar-day ${date === state.date ? "selected" : ""} ${date === today ? "today" : ""} ${no ? "no-data" : ""}" data-calendar-date="${date}" aria-label="${esc(aria)}" ${date === state.date ? 'aria-pressed="true"' : ""}><span>${Number(date.slice(-2))}</span><small>${sp.length ? "◇" : ""}${ev.length ? "●" : ""}${no ? "∅" : ""}</small></button>`;
    })
    .join(
      "",
    )}</div><div class="calendar-legend"><span><b>●</b> Evento</span><span><b>◇</b> Feriado/data especial</span><span><b>∅</b> Sem dados</span><span><b>○</b> Hoje</span></div><div class="calendar-actions"><button class="btn" id="calendar-today">Ir para hoje</button><button class="btn" id="new-special">＋ Data especial</button></div><div class="calendar-selection"><span class="eyebrow">${labelDate(state.date)}</span>${
    programsOn(state.date).length
      ? programsOn(state.date)
          .map(
            (e) =>
              `<button class="calendar-event" data-program="${e.id}"><span class="event-category">${esc(e.category)}</span><b>${esc(e.name)}</b><small>${time(e.start)} — ${time(e.end)} · ${esc(e.source)}</small></button>`,
          )
          .join("")
      : "<p>Nenhum evento cadastrado para este dia.</p>"
  }${allSpecial()
    .filter((x) => x.date === state.date)
    .map(
      (d) =>
        `<button class="calendar-special" data-special-id="${d.id}">◇ ${esc(d.name)}<small>${esc(d.type)} · ${esc(d.scope)}</small></button>`,
    )
    .join(
      "",
    )}</div><div class="calendar-foot">Disponibilidade consultada no banco. ∅ indica ausência de medições. Feriados: cadastro com fonte, sem integração automática.</div></aside>`;
}
function programForm(edit = null) {
  let old = edit ? state.programs.find((x) => x.id === edit) : null;
  const e = old || {
    name: "",
    category: "Parque infantil",
    startDate: state.date,
    endDate: state.date,
    start: 840,
    end: 1200,
    sectors: [state.selected || "eventos-central"],
    audience: "",
    description: "",
  };
  let d = document.createElement("dialog");
  d.className = "event-dialog program-dialog";
  d.innerHTML = `<form id="program-form"><div class="flex items-center justify-between"><div><span class="eyebrow">PROGRAMAÇÃO DO SHOPPING</span><h2>${old ? "Editar" : "Cadastrar"} evento</h2></div><button type="button" class="circlebtn" id="close-program" aria-label="Fechar cadastro de evento">×</button></div><p>Relacione uma atividade aos espaços e ao período de análise.</p><label>Nome<input class="select" id="program-name" value="${esc(e.name)}" maxlength="100" placeholder="Ex.: parque de diversões infantil" required></label><div class="form-grid"><label>Categoria<select class="select" id="program-category">${["Parque infantil", "Apresentação cultural", "Ação de férias", "Exposição", "Evento em feriado", "Outro"].map((c) => `<option ${e.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label>Público-alvo declarado<input class="select" id="program-audience" value="${esc(e.audience)}" placeholder="Ex.: crianças e famílias" required maxlength="100"></label><label>Data inicial<input class="select" type="date" id="program-date" value="${e.startDate}" required></label><label>Data final<input class="select" type="date" id="program-end-date" value="${e.endDate}" required></label><label>Início<input class="select" type="time" id="program-start" value="${time(e.start)}" min="${time(opening)}" required></label><label>Término<input class="select" type="time" id="program-end" value="${time(e.end)}" required></label></div><fieldset class="program-sector-fieldset"><legend>Setores envolvidos</legend><div class="program-sector-options">${sectors.map((s) => `<label><input type="checkbox" name="program-sector" value="${s.id}" ${e.sectors.includes(s.id) ? "checked" : ""}>${s.name}</label>`).join("")}</div></fieldset><label>Descrição<textarea class="select" id="program-description" rows="3" maxlength="500" placeholder="O que acontece neste evento?">${esc(e.description)}</textarea></label><p class="form-error" id="program-error" role="alert"></p><button type="submit" class="btn primary">${old ? "Salvar alterações" : "Cadastrar evento"}</button><p style="font-size:9px">Cadastro persistido na API. Público-alvo não representa público observado.</p></form>`;
  document.body.append(d);
  d.showModal();
  const close = () => {
    d.close();
    d.remove();
  };
  document.querySelector("#close-program").onclick = close;
  d.oncancel = () => d.remove();
  document.querySelector("#program-form").onsubmit = (ev) => {
    ev.preventDefault();
    let get = (id) => document.getElementById(id).value,
      st = get("program-start").split(":").map(Number),
      en = get("program-end").split(":").map(Number),
      start = st[0] * 60 + st[1],
      end = en[0] * 60 + en[1];
    if (end === 0) end = 1440;
    let date = get("program-date"),
      endDate = get("program-end-date"),
      ids = Array.from(
        document.querySelectorAll('[name="program-sector"]:checked'),
      ).map((x) => x.value);
    if (date > endDate || start < opening || end <= start || !ids.length) {
      document.querySelector("#program-error").textContent =
        "Confira o período, escolha ao menos um setor e use horários entre 09h e meia-noite, com término após o início.";
      return;
    }
    let name = get("program-name").trim(),
      audience = get("program-audience").trim();
    if (!name || !audience) return;
    let program = {
      id: old?.id || "local-" + Date.now().toString(36),
      name,
      category: get("program-category"),
      startDate: date,
      endDate,
      start,
      end,
      sectors: ids,
      audience,
      description: get("program-description").trim(),
      source: "Cadastro administrativo",
    };
    state.programs = old
      ? state.programs.map((x) => (x.id === old.id ? program : x))
      : [...state.programs, program];
    state.programId = program.id;
    setDate(date);
    state.minute = start;
    state.floor = sectors.find((x) => x.id === ids[0]).floor;
    state.selected = ids[0];
    state.page = "events";
    persist();
    close();
    render();
    toast("Evento salvo no calendário.");
  };
}
function eventCards() {
  let list = state.programs.filter(
    (e) => state.eventCategory === "all" || e.category === state.eventCategory,
  );
  return `<div class="program-cards">${list.map((e) => `<button class="program-card ${state.programId === e.id ? "active" : ""}" data-program="${e.id}"><div class="program-card-top"><span class="event-category">${esc(e.category)}</span><span>↗</span></div><h3>${esc(e.name)}</h3><p>${labelDate(e.startDate)}${e.endDate !== e.startDate ? " a " + labelDate(e.endDate) : ""}</p><small>${time(e.start)} — ${time(e.end)} · ${e.sectors.length} setor(es)</small><div class="program-target">Público-alvo: ${esc(e.audience)}</div></button>`).join("") || '<div class="empty">Nenhum evento nesta categoria.</div>'}</div>`;
}
function eventsPage() {
  let e = state.programs.find((x) => x.id === state.programId);
  return `<div class="page-toolbar"><div><span class="badge outline">${state.programs.length} eventos cadastrados</span><select class="select" id="event-category" aria-label="Filtrar categoria de evento"><option value="all">Todas as categorias</option>${[...new Set(state.programs.map((x) => x.category))].map((c) => `<option ${state.eventCategory === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div><button class="btn primary" id="create-program">＋ Cadastrar evento</button></div>${eventCards()}${e ? eventAnalysis(e) : `<div class="event-welcome"><div class="botanical-mini">${botanicalMark()}</div><h2>Cada encontro tem seu contexto.</h2><p>Escolha um evento para explorar sua localização, a ocupação da região e os fluxos do cenário.</p><button class="btn" id="toggle-calendar">▦ ${state.calOpen ? "Recolher" : "Abrir"} calendário</button>${state.calOpen ? `<div class="calendar-inline">${calendarPanel()}</div>` : ""}</div>`}`;
}
function eventAnalysis(e) {
  let sampleDate = state.date,
    analysis = cache.analysis.get(e.id + "|" + sampleDate),
    r = analysis?.intervals;
  let before = r?.before.mean_per_observed_sector ?? null,
    during = r?.during.mean_per_observed_sector ?? null,
    after = r?.after.mean_per_observed_sector ?? null,
    peak = {
      n: r?.during.peak_sector_count ?? null,
      m: r?.during.peak_minute ?? e.start,
    },
    available = !!r,
    snap = cache.history.get(sampleDate + "|" + state.minute),
    noSamples = !!snap && snap.total === null;
  let baseline = parseDate(sampleDate);
  baseline.setDate(baseline.getDate() - 7);
  let baselineDate = isoDate(baseline),
    base = null;
  return `<section class="event-analysis"><div class="analysis-heading"><div><span class="eyebrow">CONTEXTO DO EVENTO</span><h2>${esc(e.name)}</h2><p>${esc(e.description)}</p></div><div class="flex gap-2"><button class="btn" id="edit-program" data-id="${e.id}">Editar</button><button class="btn" id="event-to-history">▦ Ver no calendário</button></div></div><div class="event-meta"><span>Público-alvo declarado: <b>${esc(e.audience)}</b></span><span>${e.sectors.map((id) => esc(sectors.find((s) => s.id === id)?.name || id)).join(" · ")}</span><span>${esc(e.source)}</span></div><div class="analysis-metrics">${[
    ["Antes", before, "Média por setor observado · 1h antes"],
    ["Durante", during, "Média por setor observado · durante"],
    ["Depois", after, "Média por setor observado · 1h depois"],
    ["Pico", peak.n, time(peak.m) + " · " + labelDate(sampleDate)],
  ]
    .map(
      ([n, v, t]) =>
        `<div><span>${n}</span><strong>${available && v !== null ? v : "—"}</strong><small>${t}</small></div>`,
    )
    .join(
      "",
    )}</div><div class="historyinfo"><span>Data de referência: ${labelDate(baselineDate)} · ${time(e.start)}–${time(e.end)} · Use a comparação de mapas para consultar a referência..</span><button class="btn" id="event-compare">Comparar mapas →</button></div><p class="analysis-limit">${esc(analysis?.calculation || "Aguardando análise da API.")} A data de referência é sete dias antes; não se presume que esteja sem evento.</p><div class="event-map-controls"><label>Data analisada <input class="select" type="date" id="event-analysis-date" value="${sampleDate}" min="${e.startDate}" max="${e.endDate}" aria-label="Data da análise do evento"></label><button class="btn" id="event-profile">Consultar amostra do público →</button><button class="btn" id="event-flows">Passagens próximas →</button></div>${noSamples ? `<div class="event-data-warn"><div><b>Sem medições de ocupação neste recorte.</b><span>O evento está cadastrado, mas não há amostra de ocupação em ${labelDate(sampleDate)} às ${time(state.minute)}. O mapa permanece vazio de propósito: calor não é inventado. Consulte outra data ou o histórico.</span></div><button class="btn" id="event-open-history">Abrir histórico</button></div>` : ""}${statCards()}<div class="grid-main">${mapPanel()}${rightPanel()}</div><div class="event-period-bar"><span>${time(e.start)} Início</span><input type="range" min="${opening}" max="${closing}" step="15" value="${state.minute}" id="event-time" aria-label="Horário de análise do evento"><span>${time(state.minute)} · ${time(e.end)} Fim</span></div><section class="panel nearby-flows"><div class="panel-head"><div><h2>Passagens próximas no cenário</h2><p>Intervalo do evento · passagens medidas nas conexões cobertas · não participantes</p></div></div>${(
    r?.passages.items || []
  )
    .map((x) => ({
      from: x.origin,
      to: x.destination,
      count: x.count,
      total: x.denominator,
    }))
    .map(
      (f) =>
        `<div class="nearby-flow-row"><span>${esc(sectors.find((s) => s.id === f.from).name)} → ${esc(sectors.find((s) => s.id === f.to).name)}</span><b>${f.count} passagens</b><small>${f.total ? Math.round((f.count / f.total) * 100) : "—"}% de ${f.total}</small></div>`,
    )
    .join("")}</section></section>`;
}
function dimensionChart(title, subtitle, rows, total, note = "") {
  let palette = ["#224d3d", "#a68b4b", "#8d9c70", "#b9b6a1", "#d7d4c8"];
  let pct = (n) => ((n / total) * 100).toFixed(1).replace(".", ",");
  let unknown = rows.find((x) => x[0] === "Não informado")?.[1] || 0;
  return `<section class="panel profile-chart"><div class="panel-head"><div><h2>${title}</h2><p>${subtitle}</p></div><span class="badge outline">n = ${total}</span></div><div class="dimension-stack" aria-hidden="true">${rows.map(([label, n], i) => `<span style="width:${(n / total) * 100}%;background:${palette[i]}"></span>`).join("")}</div><div class="dimension-rows">${rows.map(([label, n], i) => `<div class="dimension-row ${label === "Não informado" ? "unknown" : ""}"><span><i style="background:${palette[i]}"></i>${label}</span><b>${n}</b><small>${pct(n)}%</small></div>`).join("")}</div><div class="profile-nonresponse">${note} Não informado: ${unknown} de ${total}. O denominador (n = ${total}) inclui as não respostas.</div></section>`;
}
function profileQuickRead(gender, age, total) {
  let named = (rows) => rows.filter(([label]) => label !== "Não informado");
  let top = (rows) => [...named(rows)].sort((a, b) => b[1] - a[1])[0];
  let leader = (rows, t) => {
    if (!t) return "—";
    let same = named(rows)
      .filter(([, n]) => n === t[1])
      .map(([label]) => label);
    return same.length > 1 ? same.join(" e ") : t[0];
  };
  let young = age
    .filter(
      ([label]) =>
        label.startsWith("Crianças") || label.startsWith("Adolescentes"),
    )
    .reduce((a, [, n]) => a + n, 0);
  let pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  let tg = top(gender),
    ta = top(age);
  return `<section class="profile-quick"><div><span>MAIOR GRUPO DE GÊNERO</span><strong>${pct(tg?.[1] || 0)}%</strong><small>${leader(gender, tg)}</small></div><div><span>MAIOR FAIXA ETÁRIA</span><strong>${pct(ta?.[1] || 0)}%</strong><small>${leader(age, ta)}</small></div><div><span>CRIANÇAS E ADOLESCENTES</span><strong>${pct(young)}%</strong><small>${young} de ${total} respostas · soma dentro da faixa etária</small></div></section>`;
}
function profilePage() {
  let samples = selectSamples({
      date: state.date,
      eventId: state.profileEvent,
      sector: state.profileSector,
      programs: state.programs,
      sectorIds: sectors.map((s) => s.id),
    }),
    total = samples.reduce((a, s) => a + s.n, 0),
    gender = total ? sumDimension(samples, "gender") : [],
    age = total ? sumDimension(samples, "age") : [],
    available = (cache.profileDates?.dates || [])
      .filter(
        (d) =>
          d.n > 0 ||
          (state.profileEvent && d.events.includes(state.profileEvent)),
      )
      .slice(0, 6),
    filterNote = state.profileEvent
      ? "evento selecionado"
      : state.profileSector
        ? "setor selecionado"
        : "amostra diária · todos os setores",
    periods = [
      ...new Set(samples.map((x) => time(x.from) + "–" + time(x.to))),
    ],
    coverage = [...new Set(samples.flatMap((x) => x.sectors))],
    loaded = cache.profiles.has(
      profileKey(state.date, state.profileEvent, state.profileSector),
    );
  let intro = `<div class="profile-intro"><div class="flex flex-wrap items-center gap-2"><span class="badge demo">${cache.mode === "simulator" ? "AMOSTRA SINTÉTICA" : "PESQUISA AGREGADA"} · NÃO É CONTAGEM DE CÂMERA</span><span class="badge outline">${filterNote}</span></div><p>Estes números vêm de uma pesquisa por amostragem — não da contagem das câmeras.</p></div><section class="profile-source"><div><b>Câmeras medem ocupação</b><span>Quantas pessoas passam em cada região. Elas não identificam gênero, idade ou rosto.</span></div><div><b>Perfil vem de pesquisa</b><span>Amostra independente, agregada e sem identificação individual. Nenhuma imagem é classificada.</span></div><div><b>Duas lentes, não uma soma</b><span>Gênero e faixa etária descrevem a mesma amostra. A mesma pessoa aparece nas duas — não se somam.</span></div></section>`;
  let filters = `<section class="panel profile-filters"><label>Data da amostra<input class="select" type="date" id="date" aria-label="Data da amostra" value="${state.date}"></label><label>Evento<select class="select" id="profile-event" aria-label="Evento da amostra"><option value="">Amostra diária · todos os setores</option>${state.programs.map((e) => `<option value="${e.id}" ${state.profileEvent === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></label><label>Setor<select class="select" id="profile-sector" aria-label="Setor da amostra"><option value="">Todos os setores com amostra</option>${sectors.map((s) => `<option value="${s.id}" ${state.profileSector === s.id ? "selected" : ""}>${s.name}</option>`).join("")}</select></label>${total ? `<button class="btn primary" id="export-profile">${icon("download")} CSV da amostra</button>` : ""}</section>`;
  let body = total
    ? `${profileQuickRead(gender, age, total)}<section class="sample-provenance"><div><span>TOTAL DA AMOSTRA</span><strong>${total}</strong><small>${cache.mode === "simulator" ? "registros sintéticos" : "respostas de pesquisa"}</small></div><dl><div><dt>Fonte</dt><dd>${esc([...new Set(samples.map((x) => x.provenance))].join("; "))}</dd></div><div><dt>Período e cobertura</dt><dd>${labelDate(state.date)} · ${periods.join(", ")} · ${coverage.length} ${coverage.length === 1 ? "setor" : "setores"} com amostra</dd></div><div><dt>Limite</dt><dd>Amostra agregada do período, sem detalhamento por minuto. Não muda em tempo real e não é extrapolada para a ocupação do mapa.</dd></div></dl></section><div class="profile-grid">${dimensionChart("Gênero", "Como as pessoas da amostra se identificam", gender, total)}${dimensionChart("Faixa etária", "Idade declarada no momento da pesquisa", age, total, "Crianças e adolescentes aparecem aqui, não em gênero.")}</div><div class="sample-rule"><b>Como ler esta tela.</b> A amostra é uma pesquisa à parte: não sai da contagem das câmeras. Gênero e faixa etária são dimensões separadas — cada pessoa aparece uma vez em cada gráfico, então os totais não devem ser somados entre si. “Não informado” permanece no denominador. Não há pontuação de diversidade nem reconhecimento facial.</div>`
    : !loaded
      ? `<section class="profile-empty panel"><div class="botanical-mini">${botanicalMark()}</div><h2>Carregando amostra de pesquisa…</h2><p>Consultando a pesquisa de ${labelDate(state.date)} para o recorte selecionado.</p></section>`
      : `<section class="profile-empty panel"><div class="botanical-mini">${botanicalMark()}</div><h2>Sem amostra de pesquisa para este recorte.</h2><p>${state.profileEvent ? `Não há pesquisa do evento selecionado em ${labelDate(state.date)}.` : state.profileSector ? `Não há pesquisa deste setor em ${labelDate(state.date)}.` : `Não há pesquisa registrada em ${labelDate(state.date)}.`} Isso não significa que o shopping estava vazio: a ocupação das câmeras é outro conjunto de dados e não preenche esta lacuna.</p>${available.length ? `<div class="profile-dates"><span>Datas com amostra:</span>${available.map((d) => `<button class="btn" data-profile-date="${d.date}">${labelDate(d.date)}${d.n ? " · " + d.n + " respostas" : " · evento"}</button>`).join("")}</div>` : '<p class="profile-dates-note">Nenhuma data com amostra carregada.</p>'}<div class="flex justify-center gap-2"><button class="btn" id="clear-profile-filters">Limpar filtros de evento e setor</button></div></section>`;
  return `${intro}${filters}${body}`;
}
function openSpecial() {
  let d = document.createElement("dialog");
  d.className = "event-dialog";
  d.innerHTML = `<form id="special-form"><div class="flex items-center justify-between"><h2>Cadastrar data especial</h2><button type="button" class="circlebtn" id="close-special" aria-label="Fechar cadastro de data especial">×</button></div><label>Nome<input class="select" id="special-name" maxlength="100" required></label><label>Data<input class="select" type="date" id="special-date" value="${state.date}" required></label><label>Tipo<select class="select" id="special-type"><option>Data comemorativa</option><option>Data especial interna</option><option>Feriado nacional</option><option>Feriado estadual</option><option>Feriado municipal</option></select></label><label>Abrangência<input class="select" id="special-scope" placeholder="Ex.: Palmas–TO" required maxlength="80"></label><label>Fonte ou referência<input class="select" id="special-source" placeholder="URL oficial ou identificação do cadastro" required maxlength="500"></label><p style="font-size:10px">Cadastros manuais de feriados ficam pendentes de verificação. O calendário não define a operação do shopping.</p><button type="submit" class="btn primary">Salvar data</button></form>`;
  document.body.append(d);
  d.showModal();
  document.querySelector("#close-special").onclick = () => {
    d.close();
    d.remove();
  };
  d.oncancel = () => d.remove();
  document.querySelector("#special-form").onsubmit = (e) => {
    e.preventDefault();
    let value = (id) => document.getElementById(id).value.trim();
    if (!value("special-name") || !value("special-source")) return;
    let item = {
      id: "special-" + Date.now().toString(36),
      name: value("special-name"),
      date: value("special-date"),
      type: value("special-type"),
      scope: value("special-scope"),
      source: value("special-source"),
      status: "Cadastro manual; verificação pendente",
    };
    state.special.push(item);
    setDate(item.date);
    persist();
    d.close();
    d.remove();
    render();
    toast("Data especial registrada no calendário.");
  };
}
function showSpecial(id) {
  let x = allSpecial().find((x) => x.id === id);
  if (!x) return;
  let d = document.createElement("dialog");
  d.className = "event-dialog";
  let source = /^https?:\/\//.test(x.source)
    ? `<a target="_blank" rel="noopener noreferrer" href="${esc(x.source)}">Consultar referência ↗</a>`
    : esc(x.source);
  d.innerHTML = `<div class="flex items-center justify-between"><span class="eyebrow">CALENDÁRIO · REFERÊNCIA</span><button class="circlebtn" id="close-special-detail" aria-label="Fechar detalhes da data">×</button></div><h2 style="margin-top:15px">${esc(x.name)}</h2><p>${labelDate(x.date)} · ${esc(x.type)}</p><p>Abrangência: ${esc(x.scope)}</p><div class="state-warn" style="margin:15px 0">${esc(x.status)}</div><p style="font-size:11px">Fonte: ${source}</p><p style="font-size:10px;margin-top:12px">Cadastro de referência, sem sincronização automática. Não é uma indicação do horário de funcionamento do shopping. Transferências e regras locais devem ser validadas pela administração.</p>`;
  document.body.append(d);
  d.showModal();
  document.querySelector("#close-special-detail").onclick = () => {
    d.close();
    d.remove();
  };
  d.oncancel = () => d.remove();
}
function csvDownload(name, rows) {
  let url = URL.createObjectURL(
    new Blob(
      [
        "\ufeff" +
          rows
            .map((r) =>
              r
                .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
                .join(";"),
            )
            .join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  let a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function bindDomain() {
  let toggle = document.querySelector("#toggle-calendar");
  if (toggle)
    toggle.onclick = () => {
      state.calOpen = !state.calOpen;
      render();
    };
  for (let [id, delta] of [
    ["prev-month", -1],
    ["next-month", 1],
  ]) {
    let el = document.getElementById(id);
    if (el)
      el.onclick = () => {
        let d = new Date(state.calYear, state.calMonth + delta, 1);
        state.calYear = d.getFullYear();
        state.calMonth = d.getMonth();
        render();
      };
  }
  document.querySelectorAll("[data-calendar-date]").forEach(
    (b) =>
      (b.onclick = () => {
        setDate(b.dataset.calendarDate);
        if (state.page === "map") state.page = "history";
        state.selected = null;
        render();
      }),
  );
  let today = document.querySelector("#calendar-today");
  if (today)
    today.onclick = () => {
      setDate(
        new Date().toLocaleDateString("en-CA", {
          timeZone: "America/Araguaina",
        }),
      );
      render();
    };
  let date = document.querySelector("#date");
  if (date)
    date.onchange = () => {
      if (!date.value) return;
      setDate(date.value);
      render();
    };
  let cd = document.querySelector("#compare-date");
  if (cd)
    cd.onchange = () => {
      if (!cd.value) return;
      state.compareDate = cd.value;
      state.compareDay = weekDay(cd.value);
      render();
    };
  document.querySelectorAll("[data-program]").forEach(
    (b) =>
      (b.onclick = () => {
        let e = state.programs.find((x) => x.id === b.dataset.program);
        if (!e) return;
        state.programId = e.id;
        if (state.date < e.startDate || state.date > e.endDate)
          setDate(e.startDate);
        else setDate(state.date);
        state.minute = e.start;
        state.floor = sectors.find((s) => s.id === e.sectors[0]).floor;
        state.selected = e.sectors[0];
        state.page = "events";
        render();
      }),
  );
  let create = document.querySelector("#create-program");
  if (create) create.onclick = () => programForm();
  let edit = document.querySelector("#edit-program");
  if (edit) {
    let del = document.createElement("button");
    del.className = "btn";
    del.textContent = "Excluir evento";
    del.onclick = async () => {
      if (!confirm("Excluir este evento?")) return;
      state.programs = state.programs.filter((x) => x.id !== edit.dataset.id);
      state.programId = "";
      await persist();
      render();
    };
    edit.after(del);
  }
  if (edit) edit.onclick = () => programForm(edit.dataset.id);
  let category = document.querySelector("#event-category");
  if (category)
    category.onchange = () => {
      state.eventCategory = category.value;
      render();
    };
  let toHistory = document.querySelector("#event-to-history");
  if (toHistory)
    toHistory.onclick = () => {
      state.page = "history";
      state.calOpen = true;
      render();
    };
  let eventHistory = document.querySelector("#event-open-history");
  if (eventHistory)
    eventHistory.onclick = () => {
      state.page = "history";
      state.calOpen = true;
      render();
    };
  let ec = document.querySelector("#event-compare");
  if (ec)
    ec.onclick = () => {
      let e = state.programs.find((x) => x.id === state.programId),
        d = parseDate(state.date);
      d.setDate(d.getDate() - 7);
      state.compareDate = isoDate(d);
      state.compareDay = weekDay(state.compareDate);
      state.page = "compare";
      state.minute = e.start;
      render();
    };
  let ep = document.querySelector("#event-profile");
  if (ep)
    ep.onclick = () => {
      state.profileEvent = state.programId;
      state.profileSector = "";
      state.page = "profile";
      render();
    };
  let ef = document.querySelector("#event-flows");
  if (ef)
    ef.onclick = () => {
      let e = state.programs.find((x) => x.id === state.programId);
      state.origin = e.sectors[0];
      state.page = "flows";
      render();
    };
  let et = document.querySelector("#event-time");
  if (et)
    et.onchange = () => {
      state.minute = +et.value;
      render();
    };
  let ed = document.querySelector("#event-analysis-date");
  if (ed)
    ed.onchange = () => {
      if (!ed.value) return;
      setDate(ed.value);
      render();
    };
  let pe = document.querySelector("#profile-event");
  if (pe)
    pe.onchange = () => {
      state.profileEvent = pe.value;
      render();
    };
  let ps = document.querySelector("#profile-sector");
  if (ps)
    ps.onchange = () => {
      state.profileSector = ps.value;
      render();
    };
  let clearProfile = document.querySelector("#clear-profile-filters");
  if (clearProfile)
    clearProfile.onclick = () => {
      state.profileEvent = "";
      state.profileSector = "";
      render();
    };
  document.querySelectorAll("[data-profile-date]").forEach(
    (b) =>
      (b.onclick = () => {
        setDate(b.dataset.profileDate);
        render();
      }),
  );
  let exportP = document.querySelector("#export-profile");
  if (exportP)
    exportP.onclick = () => {
      let sam = selectSamples({
          date: state.date,
          eventId: state.profileEvent,
          sector: state.profileSector,
          programs: state.programs,
          sectorIds: sectors.map((s) => s.id),
        }),
        total = sam.reduce((a, s) => a + s.n, 0);
      if (!total) return;
      let rows = [
        [
          "Data",
          "Dimensao",
          "Categoria",
          "Quantidade",
          "Denominador",
          "Percentual",
          "Fonte",
          "Cobertura",
        ],
        ...["gender", "age"].flatMap((dim) =>
          sumDimension(sam, dim).map(([label, n]) => [
            state.date,
            dim === "gender" ? "Genero" : "Faixa etaria",
            label,
            n,
            total,
            ((n / total) * 100).toFixed(1),
            cache.mode === "simulator"
              ? "Pesquisa sintética"
              : sam.map((x) => x.provenance).join("; "),
            "Somente registros da amostra, sem extrapolacao",
          ]),
        ),
      ];
      csvDownload("conflui-perfil-amostra.csv", rows);
      toast("Amostra exportada com fonte e denominadores.");
    };
  let ns = document.querySelector("#new-special");
  if (ns) ns.onclick = openSpecial;
  document
    .querySelectorAll("[data-special-id]")
    .forEach((b) => (b.onclick = () => showSpecial(b.dataset.specialId)));
}

render();
setInterval(
  async () => {
    if (!state.session || !state.live) return;
    try {
      await loadView(state);
      state.phase += 1;
      applyLiveStatus();
      updateData();
    } catch (e) {
      state.stale = true;
      document
        .querySelectorAll("[data-livebadge]")
        .forEach((b) => (b.textContent = "Atualização indisponível"));
      if (e.status === 401) {
        state.session = false;
        state.login = true;
        render();
      }
    }
  },
  Number(import.meta.env.VITE_POLL_INTERVAL_MS || 5000),
);
request("/auth/me")
  .then(() => startSession())
  .catch(() => {});
