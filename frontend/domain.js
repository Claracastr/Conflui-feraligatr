import { cache, profileSamples as apiProfileSamples } from "./api.js";
export const months = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
export const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseDate = (s) => new Date(s + "T12:00:00");
export const weekDay = (s) => (parseDate(s).getDay() + 6) % 7;
export const labelDate = (s) =>
  parseDate(s).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
export function monthCells(year, month) {
  let first = (new Date(year, month, 1).getDay() + 6) % 7,
    length = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: Math.ceil((first + length) / 7) * 7 }, (_, i) =>
    i >= first && i < first + length
      ? `${year}-${String(month + 1).padStart(2, "0")}-${String(i - first + 1).padStart(2, "0")}`
      : null,
  );
}
export function hasData(date) {
  const [year, month] = date.split("-").map(Number);
  return (
    cache.calendar.get(year + "|" + month)?.days.find((d) => d.date === date)
      ?.has_data || false
  );
}
export const seedEvents = [
  {
    id: "demo-park",
    name: "Parque das pequenas descobertas",
    category: "Parque infantil",
    startDate: "2026-11-14",
    endDate: "2026-11-15",
    start: 840,
    end: 1260,
    sectors: ["eventos-central"],
    audience: "Crianças e famílias",
    description:
      "Cenário fictício de parque infantil para analisar a ocupação da praça e as passagens próximas.",
    source: "Exemplo demonstrativo",
  },
  {
    id: "demo-cultura",
    name: "Encontro de cultura e capim-dourado",
    category: "Apresentação cultural",
    startDate: "2026-11-20",
    endDate: "2026-11-20",
    start: 960,
    end: 1200,
    sectors: ["eventos-norte"],
    audience: "Público geral",
    description:
      "Programação fictícia usada para explorar um evento durante um feriado.",
    source: "Exemplo demonstrativo",
  },
  {
    id: "demo-expo",
    name: "Tramas do Tocantins",
    category: "Exposição",
    startDate: "2026-11-21",
    endDate: "2026-11-29",
    start: 600,
    end: 1320,
    sectors: ["eventos-oeste"],
    audience: "Público geral",
    description:
      "Exposição fictícia. Os dados não descrevem uma atividade real do shopping.",
    source: "Exemplo demonstrativo",
  },
];
const nat = "https://biblioteca.ana.gov.br/sophia_web/acervo/detalhe/112312";
const municipal =
  "https://trf1.jus.br/sjto/noticias/justica-federal-no-tocantins-divulga-calendario-oficial-de-feriados-e-pontos-facultativos-para-2026";
export const specialDates = [
  ...[
    ["01-01", "Confraternização Universal"],
    ["04-03", "Paixão de Cristo"],
    ["04-21", "Tiradentes"],
    ["05-01", "Dia do Trabalho"],
    ["09-07", "Independência do Brasil"],
    ["10-12", "Nossa Senhora Aparecida"],
    ["11-02", "Finados"],
    ["11-15", "Proclamação da República"],
    ["11-20", "Dia Nacional de Zumbi e da Consciência Negra"],
    ["12-25", "Natal"],
  ].map(([day, name]) => ({
    id: "national-" + day,
    date: "2026-" + day,
    name,
    type: "Feriado nacional",
    scope: "Brasil",
    source: nat,
    status: "Referência de calendário 2026",
  })),
  {
    id: "palmas-jose",
    date: "2026-03-19",
    name: "São José",
    type: "Feriado municipal",
    scope: "Palmas–TO",
    source: municipal,
    status: "Referência de calendário 2026",
  },
  {
    id: "palmas-aniv",
    date: "2026-05-20",
    name: "Aniversário de Palmas",
    type: "Feriado municipal",
    scope: "Palmas–TO",
    source: municipal,
    status: "Referência de calendário 2026",
  },
  {
    id: "to-criacao",
    date: "2026-10-09",
    name: "Criação do Tocantins · transferência em 2026",
    type: "Referência estadual",
    scope: "Tocantins / Palmas",
    source:
      "https://palmas.to.gov.br/core/noticias/prefeitura-de-palmas-acompanha-estado-e-transfere-folga-alusiva-a-criacao-do-estado-para-9-de-outubro/",
    status:
      "Transferência divulgada para a administração pública; aplicabilidade ao shopping a validar",
  },
  {
    id: "special-demo",
    date: "2026-11-27",
    name: "Dia especial de operação · exemplo",
    type: "Data especial interna",
    scope: "Shopping",
    source: "Cadastro demonstrativo",
    status: "Exemplo fictício",
  },
];
export function eventsOn(date, events) {
  return events.filter((e) => date >= e.startDate && date <= e.endDate);
}
export const profileSamples = [
  {
    id: "sample-park-14",
    eventId: "demo-park",
    date: "2026-11-14",
    from: 840,
    to: 1260,
    sectors: ["eventos-central"],
    n: 120,
    gender: [
      ["Mulheres", 54],
      ["Homens", 46],
      ["Outra identificação", 4],
      ["Não informado", 16],
    ],
    age: [
      ["Crianças · 0–11 anos", 42],
      ["Adolescentes · 12–17 anos", 18],
      ["Adultos · 18–59 anos", 43],
      ["Pessoas idosas · 60+ anos", 7],
      ["Não informado", 10],
    ],
  },
  {
    id: "sample-park-15",
    eventId: "demo-park",
    date: "2026-11-15",
    from: 840,
    to: 1260,
    sectors: ["eventos-central"],
    n: 100,
    gender: [
      ["Mulheres", 46],
      ["Homens", 36],
      ["Outra identificação", 3],
      ["Não informado", 15],
    ],
    age: [
      ["Crianças · 0–11 anos", 36],
      ["Adolescentes · 12–17 anos", 15],
      ["Adultos · 18–59 anos", 34],
      ["Pessoas idosas · 60+ anos", 6],
      ["Não informado", 9],
    ],
  },
  {
    id: "sample-cultura",
    eventId: "demo-cultura",
    date: "2026-11-20",
    from: 960,
    to: 1200,
    sectors: ["eventos-norte"],
    n: 80,
    gender: [
      ["Mulheres", 34],
      ["Homens", 30],
      ["Outra identificação", 2],
      ["Não informado", 14],
    ],
    age: [
      ["Crianças · 0–11 anos", 10],
      ["Adolescentes · 12–17 anos", 14],
      ["Adultos · 18–59 anos", 38],
      ["Pessoas idosas · 60+ anos", 8],
      ["Não informado", 10],
    ],
  },
];
function hash(value) {
  let h = 2166136261;
  for (const c of value) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function distribution(labels, total, seed) {
  let weights = labels.map((_, i) => 10 + (hash(seed + ":" + i) % 50)),
    sum = weights.reduce((a, n) => a + n, 0),
    used = 0;
  return labels.map((label, i) => {
    let n =
      i === labels.length - 1
        ? total - used
        : Math.floor((weights[i] / sum) * total);
    used += n;
    return [label, n];
  });
}
// Stable synthetic survey batches: never derived from occupancy or camera appearance.
export function selectSamples({ date, eventId = "", sector = "" }) {
  return apiProfileSamples(date, eventId, sector);
}
export function sumDimension(samples, dimension) {
  if (!samples.length) return [];
  return samples[0][dimension].map(([label], i) => [
    label,
    samples.reduce((a, s) => a + s[dimension][i][1], 0),
  ]);
}
