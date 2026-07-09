import { useQuery } from "@tanstack/react-query";

import { fetchLiveModelCatalog } from "@/lib/config/live-model-catalog";

export function useLiveModelCatalog() {
  return useQuery({
    queryKey: ["live-model-catalog"],
    queryFn: ({ signal }) => fetchLiveModelCatalog(signal),
  });
}
