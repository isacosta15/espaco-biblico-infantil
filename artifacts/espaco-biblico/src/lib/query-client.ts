import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Em modo offline as respostas "de rede" na verdade vêm do espelho
      // local — não faz sentido o React Query recusar refetch por causa de
      // staleTime; deixamos o interceptador decidir a fonte dos dados.
      retry: 1,
    },
  },
});
