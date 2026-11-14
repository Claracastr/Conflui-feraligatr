const base = import.meta.env?.VITE_API_BASE || "/api";
export let opening = 540,
  closing = 1440;
export const cache = {
  live: null,
  history: new Map(),
  calendar: new Map(),
  profiles: new Map(),
  profileDates: null,
  flows: new Map(),
  mode: null,
  analysis: new Map(),
  revision: 0,
};
export async function request(path, options = {}) {
  const response = await fetch(base + path, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    let error = await response
      .json()
      .catch(() => ({ detail: "API indisponível" }));
    throw Object.assign(
      new Error(
        typeof error.detail === "string"
          ? error.detail
          : JSON.stringify(error.detail),
      ),
      { status: response.status },
    );
  }
  return response.status === 204 ? null : response.json();
}
export const profileKey = (date, event = "", sector = "") =>
  [date, event, sector].join("|");
export const snapshotFor = (state, minute = state.minute, date = state.date) =>
  state.live ? cache.live : cache.history.get(date + "|" + minute);
export function profileSamples(date, event, sector) {
  return (
    cache.profiles.get(profileKey(date, event, sector))?.samples || []
  ).map((r) => ({
    ...r,
    gender: Object.entries(r.gender),
    age: Object.entries(r.age),
  }));
}
export async function bootstrap(state) {
  const me = await request("/auth/me");
  cache.mode = me.data_mode;
  const config = await request("/config");
  opening = config.open_minute;
  closing = config.close_minute;
  state.minute = Math.max(opening, Math.min(closing, state.minute));
  const [sectors, floors, programs, special, favorites, events] =
    await Promise.all(
      [
        "/sectors",
        "/floors",
        "/events?limit=500",
        "/special-dates",
        "/favorites",
        "/annotations",
      ].map((p) => request(p)),
    );
  Object.assign(state, {
    programs,
    special,
    favorites,
    events,
    session: true,
    login: false,
  });
  return { sectors, floors };
}
let saved;
export function remember(state) {
  saved = structuredClone({
    programs: state.programs,
    special: state.special,
    favorites: state.favorites,
    events: state.events,
  });
}
let queue = Promise.resolve();
export function persist(state, onError) {
  const next = structuredClone({
      programs: state.programs,
      special: state.special,
      favorites: state.favorites,
      events: state.events,
    }),
    previous = saved;
  saved = next;
  queue = queue
    .then(async () => {
      for (const [field, path] of [
        ["programs", "events"],
        ["special", "special-dates"],
        ["events", "annotations"],
      ]) {
        for (const row of next[field])
          if (
            JSON.stringify(row) !==
            JSON.stringify(previous[field].find((x) => x.id === row.id))
          ) {
            const payload = { ...row };
            if (field === "events" && !payload.sector) payload.sector = null;
            await request("/" + path + "/" + row.id, {
              method: "PUT",
              body: JSON.stringify(payload),
            });
          }
        for (const row of previous[field])
          if (!next[field].some((x) => x.id === row.id))
            await request("/" + path + "/" + row.id, { method: "DELETE" });
      }
      for (const id of next.favorites)
        if (!previous.favorites.includes(id))
          await request("/favorites/" + id, { method: "PUT" });
      for (const id of previous.favorites)
        if (!next.favorites.includes(id))
          await request("/favorites/" + id, { method: "DELETE" });
    })
    .catch(async (e) => {
      try {
        const restored = await bootstrap(state);
        remember(state);
      } catch {}
      onError(e);
    });
  return queue;
}
export async function loadView(state) {
  const view = {
    date: state.date,
    compareDate: state.compareDate,
    minute: state.minute,
    live: state.live,
    page: state.page,
    year: state.calYear,
    month: state.calMonth,
    event: state.profileEvent,
    sector: state.profileSector,
    origin: state.origin,
    program: state.programId,
  };
  const tasks = [];
  if (view.live)
    tasks.push(
      request("/occupancy/live").then((d) => {
        cache.live = d;
        cache.revision++;
      }),
    );
  if (view.page === "events" && view.program)
    tasks.push(
      request("/events/" + view.program + "/analysis?date=" + view.date).then(
        (d) => cache.analysis.set(view.program + "|" + view.date, d),
      ),
    );
  const dates = [
    ...new Set([
      view.date,
      ...(view.page === "compare" ? [view.compareDate] : []),
    ]),
  ];
  for (const date of dates)
    if (!view.live && !cache.history.has(date + "|" + opening))
      tasks.push(
        request(
          "/occupancy/timeline?date=" +
            date +
            "&start=" +
            opening +
            "&end=" +
            closing,
        ).then((d) => {
          for (const s of d.items) cache.history.set(date + "|" + s.minute, s);
          cache.revision++;
        }),
      );
  const monthKey = view.year + "|" + (view.month + 1);
  if (!cache.calendar.has(monthKey))
    tasks.push(
      request(`/calendar?year=${view.year}&month=${view.month + 1}`).then((d) =>
        cache.calendar.set(monthKey, d),
      ),
    );
  if (view.page === "profile") {
    if (!cache.profileDates)
      tasks.push(
        request("/profiles/available").then((d) => {
          cache.profileDates = d;
        }),
      );
    tasks.push(
      request(
        "/profiles?" +
          new URLSearchParams({
            date: view.date,
            ...(view.event ? { event_id: view.event } : {}),
            ...(view.sector ? { sector: view.sector } : {}),
          }),
      ).then((d) =>
        cache.profiles.set(profileKey(view.date, view.event, view.sector), d),
      ),
    );
  }
  if (view.page === "flows")
    tasks.push(
      request(
        "/flows?" +
          new URLSearchParams({
            date: view.date,
            start: Math.max(opening, view.minute - 15),
            end: Math.max(opening + 15, view.minute),
            origin: view.origin,
          }),
      ).then((d) =>
        cache.flows.set(view.date + "|" + view.minute + "|" + view.origin, d),
      ),
    );
  if (!view.live && view.minute % 15 !== 0)
    tasks.push(
      request(
        "/occupancy/history?date=" + view.date + "&minute=" + view.minute,
      ).then((d) => cache.history.set(view.date + "|" + view.minute, d)),
    );
  await Promise.all(tasks);
  return view;
}
