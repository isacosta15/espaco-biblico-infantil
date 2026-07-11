import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/auth";
import { queryClient } from "./lib/query-client";
import { initOfflineSupport } from "./lib/offline";

// Precisa rodar antes de qualquer chamada à API (login, dashboard, etc.)
// para garantir que, mesmo offline, as requisições sejam respondidas pelo
// espelho local em vez de falharem.
initOfflineSupport(queryClient);

createRoot(document.getElementById("root")!).render(<App />);
