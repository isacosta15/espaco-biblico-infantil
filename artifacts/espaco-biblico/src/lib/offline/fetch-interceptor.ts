// Substitui o `fetch` global por uma versão "offline-aware". Nenhuma tela ou
// hook precisa saber que isso existe: toda chamada feita pelos hooks gerados
// (@workspace/api-client-react) passa por aqui, porque eles usam o `fetch`
// global por baixo dos panos.
//
// Regra geral:
//   - Online e a rede responde   -> usa a resposta real e atualiza o espelho
//     local (para funcionar offline depois).
//   - Offline (ou rede falhou)   -> GET é respondido com o espelho local;
//     POST/PATCH/DELETE são aplicados de forma otimista no espelho local e
//     colocados na fila (outbox) para sincronizar depois.
import * as mirror from "./mirror";
import { queueAction, generateTempId, findPendingCreateByTempId, patchQueuedActionBody, removeActionsReferencingTempId, removeAction, getQueuedActions } from "./outbox";
import type { AnyRecord } from "./mirror";

function jsonResponse(data: unknown, status = 200): Response {
  if (status === 204 || data === undefined) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parseRequest(input: RequestInfo | URL): { pathname: string; search: URLSearchParams } | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!raw.includes("/api/")) return null;
  const [pathPart, searchPart] = raw.split("?");
  const pathname = pathPart.slice(pathPart.indexOf("/api/"));
  return { pathname, search: new URLSearchParams(searchPart ?? "") };
}

function readBody(init?: RequestInit): AnyRecord | undefined {
  if (!init?.body || typeof init.body !== "string") return undefined;
  try {
    return JSON.parse(init.body);
  } catch {
    return undefined;
  }
}

function segments(pathname: string): string[] {
  return pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
}

// ---------------------------------------------------------------------------
// Espelhar respostas bem-sucedidas da rede (usadas depois, offline)
// ---------------------------------------------------------------------------

async function mirrorSuccessfulGet(pathname: string, search: URLSearchParams, data: unknown): Promise<void> {
  const parts = segments(pathname);

  try {
    if (parts[0] === "children" && parts.length === 1 && [...search.keys()].length === 0) {
      await mirror.replaceAllChildren(data as AnyRecord[]);
    } else if (parts[0] === "children" && parts.length === 2 && parts[1] !== "birthdays" && parts[1] !== "most-absent") {
      await mirror.putChild(data as AnyRecord);
    } else if (parts[0] === "congregations" && parts.length === 1) {
      await mirror.replaceAllCongregations(data as AnyRecord[]);
    } else if (parts[0] === "congregations" && parts.length === 2) {
      await mirror.putCongregation(data as AnyRecord);
    } else if (parts[0] === "attendance" && parts.length === 1) {
      const date = search.get("date") ?? mirror.getTodayStr();
      await mirror.setAttendanceForDate(date, data as AnyRecord[]);
    } else if (parts[0] === "attendance" && parts[1] === "dates") {
      for (const report of data as AnyRecord[]) await mirror.putDailyReport(report);
    } else if (parts[0] === "reports" && parts[1] === "daily" && parts.length === 2) {
      for (const report of data as AnyRecord[]) await mirror.putDailyReport(report);
    } else if (parts[0] === "reports" && parts[1] === "daily" && parts.length === 3) {
      await mirror.putDailyReport(data as AnyRecord);
    } else if (parts[0] === "dashboard" && parts[1] === "stats") {
      await mirror.setMisc("dashboardStats", data);
    } else if (parts[0] === "dashboard" && parts[1] === "weekly") {
      await mirror.setMisc("dashboardWeekly", data);
    } else if (parts[0] === "auth" && parts[1] === "me") {
      await mirror.setMisc("currentUser", data);
    } else if (parts[0] === "children" && parts[1] === "birthdays") {
      await mirror.setMisc("childrenBirthdays", data);
    } else if (parts[0] === "children" && parts[1] === "most-absent") {
      await mirror.setMisc("childrenMostAbsent", data);
    } else if (parts[0] === "children" && parts[2] === "frequency") {
      await mirror.setMisc(`childFrequency:${parts[1]}`, data);
    } else if (parts[0] === "children" && parts[2] === "attendance") {
      await mirror.setMisc(`childAttendance:${parts[1]}`, data);
    }
  } catch {
    // Nunca deixar uma falha ao gravar o espelho quebrar a resposta real.
  }
}

// ---------------------------------------------------------------------------
// Leituras offline (a partir do espelho local)
// ---------------------------------------------------------------------------

async function handleOfflineGet(pathname: string, search: URLSearchParams): Promise<Response> {
  const parts = segments(pathname);
  const presentTodayIds = await mirror.getPresentTodayIds();

  // GET /children
  if (parts[0] === "children" && parts.length === 1) {
    let list = await mirror.getAllChildren();
    const enrichPromises = list.map((c) => mirror.enrichChild(c, presentTodayIds));
    let enriched = await Promise.all(enrichPromises);

    const search_ = search.get("search");
    if (search_) {
      const term = search_.toLowerCase();
      enriched = enriched.filter((c) => (c.fullName ?? "").toLowerCase().includes(term));
    }
    const gender = search.get("gender");
    if (gender) enriched = enriched.filter((c) => c.gender === gender);
    const congregationId = search.get("congregationId");
    if (congregationId) enriched = enriched.filter((c) => String(c.congregationId) === congregationId);
    if (search.get("autism") === "true") enriched = enriched.filter((c) => c.autism);
    if (search.get("foodRestriction") === "true") enriched = enriched.filter((c) => c.foodRestriction);
    if (search.get("ageAbove12") === "true") enriched = enriched.filter((c) => c.age >= 12);
    if (search.get("presentToday") === "true") enriched = enriched.filter((c) => c.presentToday);
    if (search.get("absentToday") === "true") enriched = enriched.filter((c) => !c.presentToday);

    enriched.sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));
    return jsonResponse(enriched);
  }

  // GET /children/birthdays
  if (parts[0] === "children" && parts[1] === "birthdays") {
    const month = new Date().getMonth() + 1;
    const list = await mirror.getAllChildren();
    const enriched = await Promise.all(
      list
        .filter((c) => new Date(c.birthDate).getMonth() + 1 === month)
        .map((c) => mirror.enrichChild(c, presentTodayIds)),
    );
    enriched.sort((a, b) => new Date(a.birthDate).getDate() - new Date(b.birthDate).getDate());
    return jsonResponse(enriched);
  }

  // GET /children/most-absent (aproximado: usa só o que já foi visto nesta sessão/dispositivo)
  if (parts[0] === "children" && parts[1] === "most-absent") {
    const cached = await mirror.getMisc<AnyRecord[]>("childrenMostAbsent");
    return jsonResponse(cached ?? []);
  }

  // GET /children/:id/frequency
  if (parts[0] === "children" && parts[2] === "frequency") {
    const cached = await mirror.getMisc(`childFrequency:${parts[1]}`);
    if (cached) return jsonResponse(cached);
    return jsonResponse({ childId: Number(parts[1]), presenceCount: 0, absenceCount: 0, frequencyPercent: 0, lastPresence: null });
  }

  // GET /children/:id/attendance
  if (parts[0] === "children" && parts[2] === "attendance") {
    const cached = await mirror.getMisc<AnyRecord[]>(`childAttendance:${parts[1]}`);
    return jsonResponse(cached ?? []);
  }

  // GET /children/:id
  if (parts[0] === "children" && parts.length === 2) {
    const child = await mirror.getChildById(Number(parts[1]));
    if (!child) return jsonResponse({ error: "Criança não encontrada" }, 404);
    return jsonResponse(await mirror.enrichChild(child, presentTodayIds));
  }

  // GET /congregations
  if (parts[0] === "congregations" && parts.length === 1) {
    const list = await mirror.getAllCongregations();
    return jsonResponse([...list].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")));
  }

  // GET /congregations/:id
  if (parts[0] === "congregations" && parts.length === 2) {
    const cong = await mirror.getCongregationById(Number(parts[1]));
    if (!cong) return jsonResponse({ error: "Congregação não encontrada" }, 404);
    return jsonResponse(cong);
  }

  // GET /attendance?date=X
  if (parts[0] === "attendance" && parts.length === 1) {
    const date = search.get("date") ?? mirror.getTodayStr();
    return jsonResponse(await mirror.getAttendanceForDate(date));
  }

  // GET /attendance/dates
  if (parts[0] === "attendance" && parts[1] === "dates") {
    return jsonResponse(await mirror.getAllDailyReports());
  }

  // GET /reports/daily
  if (parts[0] === "reports" && parts[1] === "daily" && parts.length === 2) {
    let list = await mirror.getAllDailyReports();
    const start = search.get("startDate");
    const end = search.get("endDate");
    if (start) list = list.filter((r) => r.reportDate >= start);
    if (end) list = list.filter((r) => r.reportDate <= end);
    return jsonResponse(list);
  }

  // GET /reports/daily/:date
  if (parts[0] === "reports" && parts[1] === "daily" && parts.length === 3) {
    const report = await mirror.getDailyReport(parts[2]);
    if (!report) return jsonResponse({ error: "Relatório não encontrado" }, 404);
    return jsonResponse(report);
  }

  // GET /dashboard/stats (recalculado a partir do espelho local, para refletir o que já foi feito offline)
  if (parts[0] === "dashboard" && parts[1] === "stats") {
    const children = await mirror.getAllChildren();
    const today = mirror.getTodayStr();
    const todayRows = await mirror.getAttendanceForDate(today);
    const totalGirls = children.filter((c) => c.gender === "F").length;
    const totalBoys = children.filter((c) => c.gender === "M").length;
    const todayGirls = todayRows.filter((r) => r.child?.gender === "F").length;
    const todayBoys = todayRows.filter((r) => r.child?.gender === "M").length;
    const reports = await mirror.getAllDailyReports();
    const recent = reports.slice(0, 8);
    const weeklyAverage = recent.length > 0
      ? Math.round((recent.reduce((sum, r) => sum + (r.totalChildren ?? 0), 0) / recent.length) * 10) / 10
      : 0;
    return jsonResponse({
      totalChildren: children.length,
      totalGirls,
      totalBoys,
      presentToday: todayGirls + todayBoys,
      absentToday: children.length - (todayGirls + todayBoys),
      todayGirls,
      todayBoys,
      weeklyAverage,
    });
  }

  // GET /dashboard/weekly
  if (parts[0] === "dashboard" && parts[1] === "weekly") {
    const reports = await mirror.getAllDailyReports();
    const result = reports.slice(0, 8).reverse().map((r) => ({
      weekLabel: new Date(`${r.reportDate}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
      reportDate: r.reportDate,
      totalChildren: r.totalChildren,
      totalGirls: r.totalGirls,
      totalBoys: r.totalBoys,
    }));
    return jsonResponse(result);
  }

  // GET /auth/me
  if (parts[0] === "auth" && parts[1] === "me") {
    const cached = await mirror.getMisc("currentUser");
    if (cached) return jsonResponse(cached);
    return jsonResponse({ error: "Sem dados salvos localmente. Faça login com internet pelo menos uma vez neste aparelho." }, 401);
  }

  return jsonResponse({ error: "Sem conexão e sem dados salvos localmente para esta consulta." }, 503);
}

// ---------------------------------------------------------------------------
// Escritas offline (otimistas + fila de sincronização)
// ---------------------------------------------------------------------------

async function handleOfflineWrite(
  method: string,
  pathname: string,
  body: AnyRecord | undefined,
): Promise<Response> {
  const parts = segments(pathname);

  // --- Crianças -------------------------------------------------------
  if (parts[0] === "children" && method === "POST") {
    const tempId = generateTempId();
    const record: AnyRecord = { ...body, id: tempId };
    const congregationName = await mirror.getCongregationNameById(record.congregationId);
    const enriched = { ...record, age: mirror.calcAge(record.birthDate), congregationName, presentToday: false };
    await mirror.putChild(enriched);
    await queueAction({ method: "POST", path: "/api/children", body, entity: "child", tempId });
    return jsonResponse(enriched, 201);
  }

  if (parts[0] === "children" && method === "PATCH") {
    const id = Number(parts[1]);
    const existing = (await mirror.getChildById(id)) ?? { id };
    const updated = { ...existing, ...body };
    const congregationName = await mirror.getCongregationNameById(updated.congregationId);
    const enriched = { ...updated, age: mirror.calcAge(updated.birthDate), congregationName };
    await mirror.putChild(enriched);

    if (id < 0) {
      const pending = await findPendingCreateByTempId(id);
      if (pending?.id != null) await patchQueuedActionBody(pending.id, body ?? {});
    } else {
      await queueAction({ method: "PATCH", path: `/api/children/${id}`, body, entity: "child" });
    }
    return jsonResponse(enriched);
  }

  if (parts[0] === "children" && method === "DELETE") {
    const id = Number(parts[1]);
    await mirror.deleteChildMirror(id);
    if (id < 0) {
      await removeActionsReferencingTempId(id);
    } else {
      await queueAction({ method: "DELETE", path: `/api/children/${id}`, entity: "child" });
    }
    return jsonResponse(undefined, 204);
  }

  // --- Congregações -----------------------------------------------------
  if (parts[0] === "congregations" && method === "POST") {
    const tempId = generateTempId();
    const record = { ...body, id: tempId };
    await mirror.putCongregation(record);
    await queueAction({ method: "POST", path: "/api/congregations", body, entity: "congregation", tempId });
    return jsonResponse(record, 201);
  }

  if (parts[0] === "congregations" && method === "PATCH") {
    const id = Number(parts[1]);
    const existing = (await mirror.getCongregationById(id)) ?? { id };
    const updated = { ...existing, ...body };
    await mirror.putCongregation(updated);
    if (id < 0) {
      const pending = await findPendingCreateByTempId(id);
      if (pending?.id != null) await patchQueuedActionBody(pending.id, body ?? {});
    } else {
      await queueAction({ method: "PATCH", path: `/api/congregations/${id}`, body, entity: "congregation" });
    }
    return jsonResponse(updated);
  }

  if (parts[0] === "congregations" && method === "DELETE") {
    const id = Number(parts[1]);
    await mirror.deleteCongregationMirror(id);
    if (id < 0) {
      await removeActionsReferencingTempId(id);
    } else {
      await queueAction({ method: "DELETE", path: `/api/congregations/${id}`, entity: "congregation" });
    }
    return jsonResponse(undefined, 204);
  }

  // --- Presença -----------------------------------------------------------
  if (parts[0] === "attendance" && parts.length === 1 && method === "POST") {
    const childId = body?.childId as number;
    const date = (body?.attendanceDate as string) ?? mirror.getTodayStr();

    const existingRows = await mirror.getAttendanceForDate(date);
    if (existingRows.some((r) => (r.childId ?? r.child?.id) === childId)) {
      return jsonResponse({ error: "Presença já registrada para este dia" }, 409);
    }

    const tempId = generateTempId();
    const now = new Date();
    const attendanceTime = now.toTimeString().slice(0, 8);
    const attendanceRow = { id: tempId, childId, attendanceDate: date, attendanceTime };

    const child = await mirror.getChildById(childId);
    const congregationName = await mirror.getCongregationNameById(child?.congregationId);
    const enrichedChild = child
      ? { ...child, age: mirror.calcAge(child.birthDate), congregationName, presentToday: true }
      : null;

    await mirror.addAttendanceRow(date, { ...attendanceRow, child: enrichedChild });
    if (enrichedChild) await mirror.putChild(enrichedChild);
    await mirror.bumpDailyReport(date, child?.gender === "F" ? 1 : 0, child?.gender === "M" ? 1 : 0);

    await queueAction({
      method: "POST",
      path: "/api/attendance",
      body: { childId, attendanceDate: date },
      entity: "attendance",
      tempId,
    });

    return jsonResponse(attendanceRow, 201);
  }

  if (parts[0] === "attendance" && parts[1] === "today" && method === "DELETE") {
    const childId = Number(parts[2]);
    const date = mirror.getTodayStr();
    const child = await mirror.getChildById(childId);

    await mirror.removeAttendanceRow(date, childId);
    if (child) await mirror.putChild({ ...child, presentToday: false });
    await mirror.bumpDailyReport(date, child?.gender === "F" ? -1 : 0, child?.gender === "M" ? -1 : 0);

    // Se a presença foi marcada offline e ainda não sincronizou, só cancela
    // a ação pendente em vez de enfileirar uma exclusão.
    const queued = await getQueuedActions();
    const pending = queued.find(
      (a) => a.entity === "attendance" && a.method === "POST" && a.body?.childId === childId && a.body?.attendanceDate === date,
    );
    if (pending?.id != null) {
      await removeAction(pending.id);
    } else {
      await queueAction({ method: "DELETE", path: `/api/attendance/today/${childId}`, entity: "attendance" });
    }
    return jsonResponse(undefined, 204);
  }

  return jsonResponse({ error: "Ação não suportada offline." }, 501);
}

// ---------------------------------------------------------------------------
// Instalação do interceptador
// ---------------------------------------------------------------------------

export function installOfflineFetch(): void {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const parsed = parseRequest(input);
    if (!parsed) return nativeFetch(input, init);

    const { pathname, search } = parsed;
    const method = (init?.method ?? "GET").toUpperCase();

    // Login sempre precisa de rede de verdade — nunca deve "funcionar" offline.
    const isLogin = pathname.endsWith("/auth/login");

    const tryNetwork = !isLogin && navigator.onLine;

    if (tryNetwork) {
      try {
        const response = await nativeFetch(input, init);
        if (method === "GET" && response.ok) {
          const clone = response.clone();
          clone
            .json()
            .then((data) => mirrorSuccessfulGet(pathname, search, data))
            .catch(() => {});
        }
        return response;
      } catch {
        if (isLogin) throw new Error("Sem conexão com a internet. Conecte-se para fazer login.");
        // cai para o tratamento offline abaixo
      }
    } else if (isLogin) {
      throw new Error("Sem conexão com a internet. Conecte-se para fazer login.");
    }

    if (method === "GET") {
      return handleOfflineGet(pathname, search);
    }
    return handleOfflineWrite(method, pathname, readBody(init));
  };
}
