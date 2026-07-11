import type { QueryClient } from "@tanstack/react-query";
import { installOfflineFetch } from "./fetch-interceptor";
import { registerQueryClient, startAutoSync } from "./sync";

export { onOutboxChange, getQueuedActions } from "./outbox";
export { onSyncStatusChange, getSyncStatus, syncOutbox } from "./sync";

export function initOfflineSupport(queryClient: QueryClient): void {
  installOfflineFetch();
  registerQueryClient(queryClient);
  startAutoSync();
}
