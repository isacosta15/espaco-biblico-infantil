import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, CloudUpload, CheckCircle2 } from "lucide-react";
import { onOutboxChange, getQueuedActions, onSyncStatusChange, getSyncStatus, syncOutbox, type SyncStatus } from "@/lib/offline";

export function OfflineStatusBadge() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);

    const refreshPending = () => {
      getQueuedActions().then((actions) => setPending(actions.length));
    };
    refreshPending();

    const unsubOutbox = onOutboxChange(refreshPending);
    const unsubStatus = onSyncStatusChange((s) => {
      setStatus(s);
      refreshPending();
    });

    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      unsubOutbox();
      unsubStatus();
    };
  }, []);

  if (online && pending === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
        <span>Tudo sincronizado</span>
      </div>
    );
  }

  if (!online) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
        <WifiOff className="w-3.5 h-3.5 shrink-0" />
        <span>
          Sem internet — {pending > 0 ? `${pending} ${pending === 1 ? "ação salva" : "ações salvas"} localmente` : "trabalhando offline"}
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void syncOutbox()}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 transition-colors"
    >
      {status === "syncing" ? (
        <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
      ) : (
        <CloudUpload className="w-3.5 h-3.5 shrink-0" />
      )}
      <span>
        {status === "syncing"
          ? "Sincronizando..."
          : `${pending} ${pending === 1 ? "ação pendente" : "ações pendentes"} — toque para sincronizar`}
      </span>
    </button>
  );
}
