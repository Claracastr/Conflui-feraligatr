import { cache } from "./api.js";
import { sectors, pointIn, rand, counts, concentration } from "./data.js";
const mapImages = [
  new URL("./mapa-terreo.png", import.meta.url).href,
  new URL("./mapa-alimentacao.png", import.meta.url).href,
];
const maps = [];
let nextId = 0;
export function destroyMaps() {
  maps.splice(0).forEach((m) => {
    m.dead = true;
    m.observer?.disconnect();
  });
}
export function mapMarkup(
  state,
  {
    minute = state.minute,
    day = state.day,
    date = state.date,
    mini = false,
    flow = false,
  } = {},
) {
  let id = "map-" + ++nextId;
  return `<div class="mapstage" id="${id}" data-floor="${state.floor}" data-minute="${minute}" data-day="${day}" data-date="${date}" data-mini="${mini}" data-flow="${flow}"><div class="mapgroup"><img src="${mapImages[state.floor]}" alt="Planta real do ${state.floor ? "segundo pavimento" : "térreo"} do Capim Dourado Shopping" draggable="false"><canvas aria-hidden="true"></canvas><svg viewBox="0 0 1000 734" preserveAspectRatio="none" role="group" aria-label="Setores selecionáveis na planta"></svg></div><div class="loading">Carregando a planta…</div><div class="mapnote">PLANTA REAL · DADOS DA API</div><div class="mapcontrols"><button class="btn" data-zoom="out" aria-label="Diminuir zoom">−</button><button class="btn zoomval" data-zoom="reset" aria-label="Restaurar visão geral">100%</button><button class="btn" data-zoom="in" aria-label="Aumentar zoom">+</button></div></div>`;
}
export function initMaps(state, onSelect) {
  document.querySelectorAll(".mapstage").forEach((el) => {
    let mini = el.dataset.mini === "true",
      m = {
        el,
        id: el.id,
        mini,
        floor: +el.dataset.floor,
        minute: +el.dataset.minute,
        day: +el.dataset.day,
        date: el.dataset.date,
        flow: el.dataset.flow === "true",
        zoom: 1,
        x: 0,
        y: 0,
        dead: false,
        state,
        onSelect,
        dirty: true,
      };
    m.group = el.querySelector(".mapgroup");
    m.canvas = el.querySelector("canvas");
    m.ctx = m.canvas.getContext("2d");
    m.canvas.width = 400;
    m.canvas.height = 294;
    m.field = document.createElement("canvas");
    m.field.width = 250;
    m.field.height = 184;
    m.fctx = m.field.getContext("2d", { willReadFrequently: true });
    m.svg = el.querySelector("svg");
    let img = el.querySelector("img");
    const ready = () => {
      el.querySelector(".loading").hidden = true;
    };
    img.onload = ready;
    img.onerror = () => {
      el.querySelector(".loading").textContent =
        "A planta não pôde ser carregada. Tente atualizar a página.";
    };
    if (img.complete && img.naturalWidth) ready();
    maps.push(m);
    drawSectors(m);
    el.querySelectorAll("[data-zoom]").forEach(
      (b) =>
        (b.onclick = () => {
          let type = b.dataset.zoom;
          if (type === "reset") {
            m.zoom = 1;
            m.x = 0;
            m.y = 0;
            onSelect(null, false);
          } else {
            let old = m.zoom;
            m.zoom = Math.min(
              3,
              Math.max(1, m.zoom + (type === "in" ? 0.3 : -0.3)),
            );
            m.x =
              el.clientWidth / 2 - ((el.clientWidth / 2 - m.x) * m.zoom) / old;
            m.y =
              el.clientHeight / 2 -
              ((el.clientHeight / 2 - m.y) * m.zoom) / old;
          }
          transform(m);
        }),
    );
    let dragging = false,
      start,
      last;
    m.group.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-sector]")) return;
      dragging = true;
      start = [e.clientX, e.clientY];
      last = [m.x, m.y];
      m.group.classList.add("dragging");
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      m.x = last[0] + e.clientX - start[0];
      m.y = last[1] + e.clientY - start[1];
      transform(m);
    });
    el.addEventListener("pointerup", () => {
      dragging = false;
      m.group.classList.remove("dragging");
    });
    el.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        m.zoom = Math.max(1, Math.min(3, m.zoom - e.deltaY * 0.002));
        transform(m);
      },
      { passive: false },
    );
    m.observer = new ResizeObserver(() => {
      if (state.selected) focusMap(m, state.selected);
      else transform(m);
    });
    m.observer.observe(el);
    if (state.selected) focusMap(m, state.selected);
  });
}
function transform(m) {
  let w = m.el.clientWidth,
    h = m.el.clientHeight;
  m.x = Math.max(w * (1 - m.zoom), Math.min(0, m.x));
  m.y = Math.max(h * (1 - m.zoom), Math.min(0, m.y));
  m.group.style.transform = `translate(${m.x}px,${m.y}px) scale(${m.zoom})`;
  m.el.querySelector(".zoomval").textContent = Math.round(m.zoom * 100) + "%";
  if (m.mini) {
    for (let other of maps) {
      if (other !== m && other.mini) {
        other.zoom = m.zoom;
        other.x = m.x;
        other.y = m.y;
        other.group.style.transform = m.group.style.transform;
        other.el.querySelector(".zoomval").textContent =
          Math.round(m.zoom * 100) + "%";
      }
    }
  }
}
function focusMap(m, id) {
  let s = sectors.find((s) => s.id === id);
  if (!s || s.floor !== m.floor || m.mini) return;
  m.zoom = 1.9;
  m.x = m.el.clientWidth / 2 - (s.center[0] / 1000) * m.el.clientWidth * m.zoom;
  m.y =
    m.el.clientHeight / 2 - (s.center[1] / 734) * m.el.clientHeight * m.zoom;
  transform(m);
}
function drawSectors(m) {
  let list = counts({
    ...m.state,
    date: m.date,
    minute: m.minute,
    day: m.day,
  }).filter((s) => s.floor === m.floor);
  let flow = m.flow;
  let prefix = m.id;
  let svg = `<defs><marker id="${prefix}-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0 L5 2.5 L0 5" fill="#305f4c"/></marker><pattern id="${prefix}-hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8 L8 0" stroke="#9d9e8c" stroke-width="1"/></pattern></defs>`;
  list.forEach((s) => {
    let selected = m.state.selected === s.id;
    svg += `<polygon points="${s.poly.map((p) => p.join(",")).join(" ")}" class="sect-hit ${selected ? "selected" : ""}" style="${s.unavailable ? `fill:url(#${prefix}-hatch);stroke:#9c9e88` : ""}" data-sector="${s.id}" role="button" tabindex="0" aria-label="${s.name}, ${s.unavailable ? "sem informação" : s.count + " pessoas estimadas"}"><title>${s.name}</title></polygon><rect class="label-bg" x="${s.center[0] - 22}" y="${s.center[1] - 11}" width="44" height="21" rx="10"/><text class="sector-label" data-label="${s.id}" x="${s.center[0]}" y="${s.center[1] + 3}" text-anchor="middle">${s.unavailable ? "—" : s.count}</text>`;
  });
  if (flow) {
    m.state.flowRecords.forEach((f) => {
      let a = sectors.find((s) => s.id === f.from),
        b = sectors.find((s) => s.id === f.to);
      if (a?.floor !== m.floor || b?.floor !== m.floor) return;
      let mx = (a.center[0] + b.center[0]) / 2,
        my = (a.center[1] + b.center[1]) / 2 - 40;
      svg += `<path class="flow-line" style="stroke-width:${2 + f.count / 15}" d="M${a.center.join(" ")} Q${mx} ${my} ${b.center.join(" ")}" marker-end="url(#${prefix}-arrow)"/><text class="sector-label" x="${mx}" y="${my}">${f.count} passagens</text>`;
    });
  }
  m.svg.innerHTML = svg;
  m.svg.querySelectorAll("[data-sector]").forEach((e) => {
    e.onclick = () => m.onSelect(e.dataset.sector);
    e.onkeydown = (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        m.onSelect(e.dataset.sector);
      }
    };
  });
}
function patchSectors(m) {
  for (const s of counts({
    ...m.state,
    date: m.date,
    minute: m.minute,
    day: m.day,
  }).filter((s) => s.floor === m.floor)) {
    let label = m.svg.querySelector(`[data-label="${s.id}"]`),
      hit = m.svg.querySelector(`[data-sector="${s.id}"]`);
    if (label) label.textContent = s.unavailable ? "—" : s.count;
    if (hit) {
      hit.classList.toggle("selected", m.state.selected === s.id);
      hit.style.fill = s.unavailable ? `url(#${m.id}-hatch)` : "";
      hit.setAttribute(
        "aria-label",
        s.name +
          ", " +
          (s.unavailable ? "sem informação" : s.count + " pessoas estimadas"),
      );
    }
  }
}
export function updateMaps(state) {
  for (let m of maps) {
    m.state = state;
    if (!m.mini) {
      m.minute = state.minute;
      m.day = state.day;
      m.date = state.date;
    }
    patchSectors(m);
  }
}
export function focusSelection(state) {
  for (let m of maps) {
    m.state = state;
    drawSectors(m);
    if (state.selected) focusMap(m, state.selected);
    else {
      m.zoom = 1;
      m.x = 0;
      m.y = 0;
      transform(m);
    }
  }
}
const lut = Array.from({ length: 256 }, (_, i) => {
  let t = i / 255,
    stops = [
      [41, 171, 255],
      [33, 218, 208],
      [154, 233, 70],
      [252, 213, 38],
      [255, 115, 29],
      [231, 30, 25],
    ],
    j = Math.min(4, Math.floor(t * 5)),
    f = t * 5 - j;
  return stops[j].map((v, k) => Math.round(v + (stops[j + 1][k] - v) * f));
});
let last = 0;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
function animate(ms) {
  requestAnimationFrame(animate);
  if (ms - last < (reduced ? 700 : 70)) return;
  last = ms;
  for (let m of maps) {
    if (m.dead) continue;
    let state = m.state;
    let signature = [
      m.minute,
      m.day,
      m.date,
      state.opacity,
      state.unavailable,
      state.phase,
      cache.revision,
    ].join(":");
    if ((!state.live || state.stale || m.mini) && m.lastSignature === signature)
      continue;
    m.lastSignature = signature;
    let list = counts({
        ...state,
        date: m.date,
        minute: m.minute,
        day: m.day,
      }).filter((s) => s.floor === m.floor && !s.unavailable),
      ctx = m.fctx;
    ctx.clearRect(0, 0, 250, 184);
    ctx.globalCompositeOperation = "lighter";
    let clock =
      state.live && !m.mini
        ? reduced || state.stale
          ? state.phase
          : ms / 1000
        : m.minute / 4;
    for (let s of list) {
      for (let i = 0; i < s.positions.length; i++) {
        let p = s.positions[i],
          key = s.id + ":" + i;
        m.smooth ||= new Map();
        let previous = m.smooth.get(key) || [p.x, p.y];
        let factor = reduced || !state.live || m.mini ? 1 : 0.22;
        let x = previous[0] + (p.x - previous[0]) * factor,
          y = previous[1] + (p.y - previous[1]) * factor;
        m.smooth.set(key, [x, y]);
        x /= 4;
        y /= 4;
        let rad = 6;
        let gradient = ctx.createRadialGradient(x, y, 0, x, y, rad);
        gradient.addColorStop(
          0,
          `rgba(0,0,0,${Math.min(0.6, (0.06 * s.count) / Math.max(1, s.positions.length))})`,
        );
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
    let data = ctx.getImageData(0, 0, 250, 184),
      d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      let alpha = d[i + 3],
        v = Math.min(255, Math.round(alpha * 2));
      if (alpha < 4) {
        d[i + 3] = 0;
        continue;
      }
      let c = lut[v];
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = Math.min(220, alpha * 5);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.putImageData(data, 0, 0);
    m.ctx.clearRect(0, 0, 400, 294);
    m.ctx.imageSmoothingEnabled = true;
    m.ctx.drawImage(m.field, 0, 0, 400, 294);
    m.canvas.style.opacity = state.opacity / 100;
  }
}
requestAnimationFrame(animate);
