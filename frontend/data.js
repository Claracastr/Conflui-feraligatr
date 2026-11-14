import { cache, snapshotFor } from "./api.js";
import { hasData } from "./domain.js";
// Regiões conceituais de observação, delimitadas sobre a planta fornecida.
// Não representam zonas de cobertura real de câmeras.
const S = (id, name, floor, poly, base, ref) => ({
  id,
  name,
  floor,
  poly,
  base,
  ref,
  center: poly.reduce(
    (a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length],
    [0, 0],
  ),
});
export const sectors = [
  S(
    "renner",
    "Circulação · Renner",
    0,
    [
      [45, 520],
      [74, 485],
      [162, 482],
      [182, 515],
      [164, 542],
      [71, 555],
    ],
    38,
    "Entorno da Renner",
  ),
  S(
    "oeste",
    "Corredor oeste",
    0,
    [
      [174, 454],
      [195, 407],
      [286, 380],
      [316, 395],
      [280, 427],
      [230, 463],
    ],
    45,
    "Entre Renner e corredor central",
  ),
  S(
    "cea",
    "Circulação · C&A",
    0,
    [
      [330, 348],
      [402, 308],
      [423, 325],
      [370, 363],
    ],
    47,
    "Acesso lateral à C&A",
  ),
  S(
    "eventos-norte",
    "Praça de eventos · C&A",
    0,
    [
      [450, 332],
      [520, 332],
      [521, 366],
      [451, 366],
    ],
    68,
    "Praça identificada abaixo da C&A",
  ),
  S(
    "leitura",
    "Corredor · Leitura",
    0,
    [
      [551, 324],
      [619, 363],
      [647, 393],
      [633, 411],
      [599, 376],
      [544, 345],
    ],
    42,
    "Entorno da Leitura",
  ),
  S(
    "central-oeste",
    "Corredor central · oeste",
    0,
    [
      [303, 408],
      [363, 370],
      [388, 389],
      [344, 426],
      [313, 440],
    ],
    54,
    "Lateral oeste da Riachuelo",
  ),
  S(
    "eventos-central",
    "Praça de eventos · central",
    0,
    [
      [465, 512],
      [482, 497],
      [518, 497],
      [541, 514],
      [538, 542],
      [510, 558],
      [478, 552],
      [461, 535],
    ],
    95,
    "Praça circular central",
  ),
  S(
    "central-leste",
    "Corredor central · leste",
    0,
    [
      [576, 419],
      [600, 399],
      [665, 447],
      [649, 471],
    ],
    66,
    "Lateral leste da Riachuelo",
  ),
  S(
    "cinema",
    "Circulação · Cinemark",
    0,
    [
      [665, 480],
      [769, 479],
      [771, 541],
      [660, 542],
    ],
    87,
    "Corredor diante do cinema",
  ),
  S(
    "leste",
    "Corredor leste",
    0,
    [
      [759, 258],
      [791, 258],
      [790, 475],
      [765, 475],
    ],
    34,
    "Circulação diante das lojas do eixo leste",
  ),
  S(
    "entrada-central",
    "Entrada central",
    0,
    [
      [489, 582],
      [521, 582],
      [523, 680],
      [493, 680],
    ],
    48,
    "Acesso central identificado na planta",
  ),
  S(
    "eventos-oeste",
    "Praça de eventos · oeste",
    0,
    [
      [285, 557],
      [332, 547],
      [337, 574],
      [290, 585],
    ],
    31,
    "Praça próxima à Renner",
  ),
  S(
    "mesas-oeste",
    "Alimentação · mesas oeste",
    1,
    [
      [285, 343],
      [392, 296],
      [450, 290],
      [418, 365],
      [422, 437],
      [321, 423],
      [281, 396],
    ],
    80,
    "Área oeste das mesas",
  ),
  S(
    "mesas-leste",
    "Alimentação · mesas leste",
    1,
    [
      [474, 282],
      [618, 263],
      [637, 326],
      [637, 433],
      [618, 485],
      [491, 476],
      [519, 407],
      [519, 341],
    ],
    110,
    "Área leste das mesas",
  ),
  S(
    "rest-norte",
    "Restaurantes · circulação norte",
    1,
    [
      [288, 323],
      [376, 282],
      [477, 261],
      [615, 240],
      [625, 261],
      [474, 284],
      [384, 308],
      [295, 347],
    ],
    57,
    "Faixa pública diante dos restaurantes",
  ),
  S(
    "rest-sul",
    "Restaurantes · circulação sul",
    1,
    [
      [294, 414],
      [381, 449],
      [475, 472],
      [620, 486],
      [613, 506],
      [470, 494],
      [375, 472],
      [284, 438],
    ],
    49,
    "Faixa pública diante dos restaurantes",
  ),
  S(
    "acesso-alimentacao",
    "Alimentação · acesso leste",
    1,
    [
      [637, 325],
      [683, 325],
      [683, 437],
      [637, 437],
    ],
    44,
    "Conexão com a área de alimentação",
  ),
  S(
    "circulacao-oeste",
    "Alimentação · circulação oeste",
    1,
    [
      [235, 325],
      [280, 326],
      [281, 435],
      [235, 435],
    ],
    27,
    "Circulação junto ao acesso oeste",
  ),
];
export const days = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
];
export const floors = ["Térreo", "2º pavimento · alimentação"];
export const historyMinutes = Array.from({ length: 16 }, (_, i) => 540 + i * 60);
export function inside(x, y, poly) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    let [a, b] = poly[i],
      [c, d] = poly[j];
    if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a) yes = !yes;
  }
  return yes;
}
export function rand(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
export function pointIn(s, seed) {
  let xs = s.poly.map((p) => p[0]),
    ys = s.poly.map((p) => p[1]);
  for (let k = 0; k < 100; k++) {
    let x =
        Math.min(...xs) +
        rand(seed + k * 2) * (Math.max(...xs) - Math.min(...xs)),
      y =
        Math.min(...ys) +
        rand(seed + k * 2 + 1) * (Math.max(...ys) - Math.min(...ys));
    if (inside(x, y, s.poly)) return [x, y];
  }
  return s.center;
}
let analysisContext = { date: "2026-11-13", events: [] };
export function setAnalysisContext(c) {
  analysisContext = c;
}
export function occupancy(
  s,
  minute,
  day = 5,
  phase = 0,
  date = analysisContext.date,
) {
  return (
    cache.history
      .get(date + "|" + minute)
      ?.sectors.find((r) => r.sector_id === s.id)?.count ?? null
  );
}

function simulatedSnapshot(date, minute) {
  const key = date + "|" + minute;
  if (cache.simulatedHistory.has(key)) return cache.simulatedHistory.get(key);
  let seed = 2166136261;
  for (const char of key) {
    seed ^= char.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  seed >>>= 0;
  const elapsed = Math.max(0, Math.min(900, minute - 540));
  const curve = 0.25 + 0.75 * Math.sin((Math.PI * elapsed) / 900);
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();
  const dayFactor = 0.75 + weekday * 0.06;
  const rows = sectors.map((sector) => {
    const count = Math.max(1, Math.round(sector.base * curve * dayFactor));
    const sectorSeed =
      seed +
      sector.id
        .split("")
        .reduce((sum, c) => sum + c.charCodeAt(0), 0);
    return {
      sector_id: sector.id,
      count,
      positions: Array.from(
        { length: Math.min(count, 60) },
        (_, i) => {
          const [x, y] = pointIn(sector, sectorSeed + i * 2);
          return { x, y };
        },
      ),
      status: "available",
      source: "simulator",
      simulated: true,
    };
  });
  const snapshot = { sectors: rows, source: "simulator", simulated: true };
  cache.simulatedHistory.set(key, snapshot);
  return snapshot;
}

export function counts(
  state,
  minute = state.minute,
  day = state.day,
  date = state.date,
) {
  let snap = snapshotFor(state, minute, date);
  if (
    !state.live &&
    cache.mode === "simulator" &&
    cache.historyDates.has(date) &&
    !cache.historyErrors.has(date) &&
    !snap?.sectors?.some(
      (row) => row.count !== null && row.status !== "unavailable",
    )
  )
    snap = simulatedSnapshot(date, minute);
  return sectors.map((s) => {
    let row = snap?.sectors.find((r) => r.sector_id === s.id);
    return {
      ...s,
      count: row?.count ?? null,
      positions: row?.positions || [],
      captured_at: row?.captured_at,
      source: row?.source,
      status: row?.status,
      simulated: row?.simulated || false,
      unavailable: !row || row.count === null || row.status === "unavailable",
    };
  });
}
export function time(minute) {
  return minute === 1440
    ? "00:00"
    : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
// Média por região nos recortes disponíveis. Simulações são preenchidas apenas
// no modo demonstrativo quando não há medições para aquele horário.
export function periodStats(state, date = state.date) {
  const acc = new Map(
    sectors.map((s) => [
      s.id,
      {
        id: s.id,
        name: s.name,
        floor: s.floor,
        sum: 0,
        samples: 0,
        min: null,
        max: null,
      },
    ]),
  );
  for (const [key, snap] of [
    ...cache.history,
    ...cache.simulatedHistory,
  ]) {
    if (!key.startsWith(date + "|")) continue;
    for (const row of snap?.sectors || []) {
      const item = acc.get(row.sector_id);
      if (!item || row.count === null || row.status === "unavailable") continue;
      item.sum += row.count;
      item.samples += 1;
      if (item.min === null || row.count < item.min) item.min = row.count;
      if (item.max === null || row.count > item.max) item.max = row.count;
    }
  }
  return [...acc.values()].map((x) => ({
    ...x,
    avg: x.samples ? x.sum / x.samples : null,
    available: x.samples > 0,
  }));
}

export function concentration(s) {
  let area = Math.abs(
    s.poly.reduce(
      (v, p, i) =>
        v +
        p[0] * s.poly[(i + 1) % s.poly.length][1] -
        s.poly[(i + 1) % s.poly.length][0] * p[1],
      0,
    ) / 2,
  );
  let index = s.count / Math.max(30, area / 140);
  return index > 2 ? "Alta" : index > 1 ? "Moderada" : "Baixa";
}
export function flowData(origin, minute, day) {
  let d = cache.flows.get(analysisContext.date + "|" + minute + "|" + origin);
  return (d?.items || []).map((r) => ({
    from: r.origin,
    to: r.destination,
    count: r.count,
    total: r.denominator,
  }));
}
export function applyCatalog(rows, names) {
  sectors.splice(0, sectors.length, ...rows);
  floors.splice(0, floors.length, ...names.map((f) => f.name));
}
