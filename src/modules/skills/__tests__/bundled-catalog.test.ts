import { it, expect } from "vitest";

import bundledCatalog from "../../../../catalog/skills.json";
import { parseSkillCatalog } from "../catalog";

it("bundled skills catalog parses", () => {
  const entries = parseSkillCatalog(bundledCatalog);
  expect(entries.length).toBeGreaterThan(1);
});
