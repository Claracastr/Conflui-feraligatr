import test from "node:test";
import assert from "node:assert/strict";
import { monthCells, hasData, selectSamples, sumDimension } from "../domain.js";
import {
  counts,
  historyMinutes,
  periodStats,
  sectors,
  time,
} from "../data.js";
import {
  bootstrap,
  cache,
  clearCache,
  loadView,
  request,
  snapshotFor,
} from "../api.js";

test("Calendário segunda–domingo e anos bissextos", () => {
  for (let year = 2024; year <= 2028; year++)
    for (let month = 0; month < 12; month++) {
      let cells = monthCells(year, month),
        days = cells.filter(Boolean);
      assert.equal(days.length, new Date(year, month + 1, 0).getDate());
      assert.equal(cells.length % 7, 0);
      assert.equal(
        cells.findIndex(Boolean),
        (new Date(year, month, 1).getDay() + 6) % 7,
      );
    }
});
test("Ausência não vira ocupação zero e não cria posições", () => {
  cache.live = null;
  let rows = counts({ live: true, minute: 1080, date: "2026-01-02", day: 4 });
  assert.equal(rows.length, 18);
  assert(
    rows.every(
      (r) => r.unavailable && r.count === null && r.positions.length === 0,
    ),
  );
});
test("Linha do tempo seleciona horas de 09:00 até a meia-noite seguinte", () => {
  assert.equal(historyMinutes.length, 16);
  assert.equal(historyMinutes[0], 540);
  assert.equal(historyMinutes[3], 720);
  assert.equal(historyMinutes[9], 1080);
  assert.equal(historyMinutes[14], 1380);
  assert.equal(historyMinutes[15], 1440);
  assert.deepEqual(
    [0, 3, 9, 14, 15].map((index) => time(historyMinutes[index])),
    ["09:00", "12:00", "18:00", "23:00", "00:00"],
  );
  assert(
    historyMinutes.every(
      (minute, index) => !index || minute - historyMinutes[index - 1] === 60,
    ),
  );
});
test("Histórico sem registros fica marcado como carregado e não é buscado repetidamente", async () => {
  const old = globalThis.fetch;
  let timelineCalls = 0;
  globalThis.fetch = async (url) => {
    if (url.includes("/occupancy/timeline")) {
      timelineCalls++;
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({ days: [] }) };
  };
  const state = {
    date: "2026-01-02",
    compareDate: "2026-01-01",
    minute: 540,
    live: false,
    page: "history",
    calYear: 2026,
    calMonth: 0,
  };
  try {
    await loadView(state);
    await loadView(state);
    assert.equal(timelineCalls, 1);
    assert.equal(cache.historyDates.has(state.date), true);
  } finally {
    globalThis.fetch = old;
    clearCache();
  }
});
test("Histórico demonstrativo sem registros é determinístico e exclusivo do simulador", () => {
  clearCache();
  cache.mode = "simulator";
  const state = {
    live: false,
    date: "2026-11-14",
    minute: 540,
    day: 5,
  };
  assert(counts(state).every((row) => row.unavailable));
  cache.historyDates.add(state.date);
  const first = counts(state);
  const later = counts({ ...state, minute: 1080 });
  const again = counts(state);
  assert(first.every((row) => row.simulated && row.count > 0));
  assert.deepEqual(
    first.map((row) => [row.count, row.positions]),
    again.map((row) => [row.count, row.positions]),
  );
  assert.notDeepEqual(
    first.map((row) => row.count),
    later.map((row) => row.count),
  );
  assert(periodStats(state).some((row) => row.available));
  cache.history.set(state.date + "|540", {
    sectors: [
      {
        sector_id: sectors[0].id,
        count: 999,
        status: "available",
        source: "simulator",
        positions: [],
      },
    ],
  });
  const recorded = counts(state);
  assert.equal(recorded[0].count, 999);
  assert(recorded.slice(1).every((row) => row.unavailable));
  cache.history.delete(state.date + "|540");
  cache.mode = "video";
  assert(counts(state).every((row) => row.unavailable));
  clearCache();
});
test("Todos os setores usam o mesmo instante, preservado ao trocar pavimento", () => {
  let state = {
    live: false,
    date: "2026-01-02",
    minute: 1080,
    day: 4,
    floor: 0,
  };
  let snap = {
    sectors: sectors.map((s, i) => ({
      sector_id: s.id,
      count: i,
      status: "available",
      positions: [],
    })),
  };
  cache.history.set("2026-01-02|1080", snap);
  assert.equal(counts(state)[0].count, 0);
  assert.equal(snapshotFor({ ...state, floor: 1 }), snap);
  assert.equal(counts({ ...state, minute: 1095 })[0].count, null);
});
test("Disponibilidade de calendário vem da API", () => {
  assert.equal(hasData("2024-02-29"), false);
  cache.calendar.set("2024|2", {
    days: [{ date: "2024-02-29", has_data: true }],
  });
  assert.equal(hasData("2024-02-29"), true);
  assert.equal(hasData("2024-02-28"), false);
});
test("Perfil sem dado não inventa amostra", () => {
  assert.deepEqual(selectSamples({ date: "2026-01-02" }), []);
  cache.profiles.set("2026-01-02||", {
    samples: [
      {
        n: 10,
        gender: {
          Mulheres: 4,
          Homens: 3,
          "Outra identificação": 1,
          "Não informado": 2,
        },
        age: { Adultos: 10 },
      },
    ],
  });
  let samples = selectSamples({ date: "2026-01-02" });
  assert.equal(
    sumDimension(samples, "gender").reduce((s, [k, n]) => s + n, 0),
    10,
  );
  assert.deepEqual(
    selectSamples({ date: "2026-01-02", eventId: "unknown" }),
    [],
  );
});
test("Cliente envia cookie e propaga erro de sessão", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/auth/me");
    assert.equal(options.credentials, "include");
    return {
      ok: false,
      status: 401,
      json: async () => ({ detail: "Sessão expirada" }),
    };
  };
  try {
    await assert.rejects(
      request("/auth/me"),
      (e) => e.status === 401 && e.message === "Sessão expirada",
    );
  } finally {
    globalThis.fetch = old;
  }
});

test("Sessão demo permite análise e logout, mas bloqueia escritas administrativas", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  cache.demo = true;
  globalThis.fetch = async (url) => {
    calls++;
    return {
      ok: true,
      status: url.endsWith("/auth/logout") ? 204 : 200,
      json: async () => ({ accepted: true }),
    };
  };
  try {
    await assert.rejects(request("/events", { method: "POST" }), /demonstração/i);
    assert.equal(calls, 0);
    assert.deepEqual(
      await request("/assistant/analyze", { method: "POST", body: "{}" }),
      { accepted: true },
    );
    assert.equal(await request("/auth/logout", { method: "POST" }), null);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = old;
    clearCache();
  }
});

test("Bootstrap restaura o tipo de sessão demo informado pela API", async () => {
  const old = globalThis.fetch;
  const responses = {
    "/auth/me": { demo: true, data_mode: "simulator" },
    "/config": { open_minute: 540, close_minute: 1440 },
    "/sectors": [],
    "/floors": [],
    "/events?limit=500": [],
    "/special-dates": [],
    "/favorites": [],
    "/annotations": [],
  };
  globalThis.fetch = async (url) => {
    const path = url.replace("/api", "");
    return { ok: true, status: 200, json: async () => responses[path] };
  };
  try {
    await bootstrap({ minute: 1080 });
    assert.equal(cache.demo, true);
    assert.equal(cache.mode, "simulator");
  } finally {
    globalThis.fetch = old;
    clearCache();
  }
});
