import { useQuery } from "@tanstack/react-query";

import { fetchModelsDevCatalogCached } from "@/modules/config/models-dev-catalog";

export function useModelsDevCatalog() {
  return useQuery({
    queryKey: ["models-dev-catalog"],
    queryFn: () => fetchModelsDevCatalogCached(),
    staleTime: 5 * 60 * 1000,
  });
}
