// Fila de ações feitas offline que precisam ser replicadas no servidor assim
// que a internet voltar (criar criança, marcar presença, etc.)
import { STORES, idbGetAll, idbPut, idbDelete, idbGet } from "./db";
import type { AnyRecord } from "./mirror";

export type OutboxEntity = "child" | "congregation" | "attendance";
export type OutboxMethod = "POST" | "PATCH" | "DELETE";

export interface OutboxAction {
  id?: number;
  method: OutboxMethod;
  /** Caminho relativo, ex: "/api/children" ou "/api/children/123" */
  path: string;
  body?: AnyRecord;
  entity: OutboxEntity;
  /** ID temporário (negativo) desta ação, quando ela cria um registro novo. */
  tempId?: number;
  createdAt: number;
}

const listeners = new Set<() => void>();

/** Permite que a UI (badge de status) seja avisada quando a fila mudar. */
export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

export async function queueAction(action: Omit<OutboxAction, "id" | "createdAt">): Promise<number> {
  const id = (await idbPut(STORES.OUTBOX, { ...action, createdAt: Date.now() })) as number;
  notify();
  return id;
}

export async function getQueuedActions(): Promise<OutboxAction[]> {
  const rows = await idbGetAll<OutboxAction>(STORES.OUTBOX);
  return rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export async function removeAction(id: number): Promise<void> {
  await idbDelete(STORES.OUTBOX, id);
  notify();
}

/** Atualiza o corpo de uma ação de criação ainda não sincronizada (ex: editar algo criado offline antes de sincronizar). */
export async function patchQueuedActionBody(id: number, patch: AnyRecord): Promise<void> {
  const action = await idbGet<OutboxAction>(STORES.OUTBOX, id);
  if (!action) return;
  await idbPut(STORES.OUTBOX, { ...action, body: { ...action.body, ...patch } });
  notify();
}

export async function findPendingCreateByTempId(tempId: number): Promise<OutboxAction | undefined> {
  const rows = await getQueuedActions();
  return rows.find((r) => r.method === "POST" && r.tempId === tempId);
}

export async function removeActionsReferencingTempId(tempId: number): Promise<void> {
  const rows = await getQueuedActions();
  const toRemove = rows.filter(
    (r) => r.tempId === tempId || r.body?.childId === tempId || r.body?.congregationId === tempId,
  );
  for (const row of toRemove) {
    if (row.id != null) await removeAction(row.id);
  }
}

// ---------------------------------------------------------------------------
// Mapeamento de IDs temporários (negativos) -> IDs reais gerados pelo servidor
// ---------------------------------------------------------------------------

export async function mapTempId(tempId: number, realId: number): Promise<void> {
  await idbPut(STORES.ID_MAP, { tempId, realId });
}

export async function resolveTempId(tempId: number): Promise<number | undefined> {
  if (tempId >= 0) return tempId;
  const record = await idbGet<{ tempId: number; realId: number }>(STORES.ID_MAP, tempId);
  return record?.realId;
}

export function generateTempId(): number {
  // IDs reais do Postgres são sempre positivos (serial); usamos negativos
  // para deixar claro (e garantir que nunca colidem) que ainda não foram
  // confirmados pelo servidor.
  return -Date.now() - Math.floor(Math.random() * 1000);
}
