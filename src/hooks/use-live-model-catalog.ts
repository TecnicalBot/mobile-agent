import { useQuery } from "@tanstack/react-query";

import { fetchLiveModelCatalogCached } from "@/modules/config/live-model-catalog";

export function useLiveModelCatalog() {
  return useQuery({
    queryKey: ["live-model-catalog"],
    queryFn: () => fetchLiveModelCatalogCached(),
    staleTime: 5 * 60 * 1000,
  });
}
