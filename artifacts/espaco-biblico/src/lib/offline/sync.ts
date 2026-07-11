// Quando a internet volta, esse módulo reenvia (em ordem) tudo que foi feito
// offline: crianças/congregações criadas ou editadas, presenças marcadas.
import type { QueryClient } from "@tanstack/react-query";
import {
  getQueuedActions,
  removeAction,
  mapTempId,
  resolveTempId,
  type OutboxAction,
} from "./outbox";
import { getToken } from "@/lib/auth";

export type SyncStatus = "idle" | "syncing" | "error";

let currentStatus: SyncStatus = "idle";
let syncing = false;
const statusListeners = new Set<(status: SyncStatus) => void>();

export function onSyncStatusChange(fn: (status: SyncStatus) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function setStatus(status: SyncStatus) {
  currentStatus = status;
  for (const fn of statusListeners) fn(status);
}

export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

/** Troca qualquer ID temporário (negativo) presente no corpo/URL por um ID real já sincronizado. */
async function resolveAction(action: OutboxAction): Promise<{ path: string; body?: Record<string, unknown> } | null> {
  let path = action.path;
  let body = action.body ? { ...action.body } : undefined;

  // IDs negativos podem aparecer tanto na URL (PATCH/DELETE de algo criado
  // offline) quanto no corpo (ex: childId ao marcar presença de uma criança
  // criada offline).
  const idFieldsToResolve = ["childId", "congregationId"] as const;

  for (const field of idFieldsToResolve) {
    const value = body?.[field];
    if (typeof value === "number" && value < 0) {
      const realId = await resolveTempId(value);
      if (realId === undefined) return null; // ainda não sincronizado — tenta depois
      body = { ...body, [field]: realId };
    }
  }

  const urlTempIdMatch = path.match(/\/(-\d+)(?:$|\/)/);
  if (urlTempIdMatch) {
    const tempId = Number(urlTempIdMatch[1]);
    const realId = await resolveTempId(tempId);
    if (realId === undefined) return null;
    path = path.replace(String(tempId), String(realId));
  }

  return { path, body };
}

let queryClientRef: QueryClient | null = null;
export function registerQueryClient(client: QueryClient) {
  queryClientRef = client;
}

export async function syncOutbox(): Promise<void> {
  if (syncing) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  syncing = true;
  setStatus("syncing");
  let hadError = false;

  try {
    const actions = await getQueuedActions();

    for (const action of actions) {
      if (action.id == null) continue;

      const resolved = await resolveAction(action);
      if (!resolved) continue; // dependência ainda não sincronizada, tenta na próxima rodada

      try {
        const token = getToken();
        const response = await fetch(resolved.path, {
          method: action.method,
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: resolved.body !== undefined ? JSON.stringify(resolved.body) : undefined,
        });

        // 409 = já existia (ex: presença duplicada marcada em outro
        // dispositivo enquanto este estava offline) — trata como sucesso,
        // não faz sentido tentar de novo.
        if (response.ok || response.status === 409) {
          if (action.method === "POST" && action.tempId != null && response.ok) {
            const data = await response.json().catch(() => null);
            if (data?.id != null) {
              await mapTempId(action.tempId, data.id);
            }
          }
          await removeAction(action.id);
        } else if (response.status >= 400 && response.status < 500) {
          // Erro do cliente (dado inválido, etc.) — não adianta tentar de
          // novo automaticamente. Remove da fila para não travar as
          // próximas ações, mas marca que houve um problema.
          await removeAction(action.id);
          hadError = true;
        } else {
          // Erro de servidor/rede — para por aqui e tenta tudo de novo na
          // próxima sincronização, preservando a ordem.
          hadError = true;
          break;
        }
      } catch {
        hadError = true;
        break;
      }
    }
  } finally {
    syncing = false;
    setStatus(hadError ? "error" : "idle");
    queryClientRef?.invalidateQueries();
  }
}

let listenersInstalled = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

export function startAutoSync(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  window.addEventListener("online", () => {
    void syncOutbox();
  });

  // Além do evento "online", tenta periodicamente — em redes instáveis o
  // evento nem sempre dispara de forma confiável.
  intervalId = setInterval(() => {
    void syncOutbox();
  }, 15000);

  if (navigator.onLine) {
    void syncOutbox();
  }
}

export function stopAutoSync(): void {
  if (intervalId) clearInterval(intervalId);
  listenersInstalled = false;
}
