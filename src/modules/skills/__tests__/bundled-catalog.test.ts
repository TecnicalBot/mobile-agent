import { afterEach, expect, it, vi } from "vitest";

import bundledCatalog from "../../../../catalog/skills.json";
import { fetchSkillCatalog, parseSkillCatalog } from "../catalog";

const ADDED_SKILLS = [
  { id: "frontend-design", source: "anthropics/skills" },
  { id: "web-design-guidelines", source: "vercel-labs/agent-skills" },
  { id: "doc-coauthoring", source: "anthropics/skills" },
  { id: "internal-comms", source: "anthropics/skills" },
  { id: "supabase-postgres-best-practices", source: "supabase/agent-skills" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

it("bundled skills catalog parses without dropping entries", () => {
  const entries = parseSkillCatalog(bundledCatalog);

  expect(entries).toHaveLength(bundledCatalog.skills.length);
});

it.each(ADDED_SKILLS)("$id is an opt-in upstream skill", ({ id, source }) => {
  const entry = parseSkillCatalog(bundledCatalog).find((skill) => skill.id === id);
  const baseUrl = `https://raw.githubusercontent.com/${source}/main/skills/${id}/`;

  expect(entry).toMatchObject({
    id,
    label: id,
    defaultInstalled: false,
    source,
    sourceUrl: `https://github.com/${source}/tree/main/skills/${id}`,
    url: `${baseUrl}SKILL.md`,
  });
  expect(entry?.extraFiles.every((url) => url.startsWith(baseUrl))).toBe(true);
  expect(new Set(entry?.extraFiles).size).toBe(entry?.extraFiles.length);
});

it("includes the web interface guidelines required for offline review", () => {
  const entry = parseSkillCatalog(bundledCatalog).find(
    (skill) => skill.id === "web-design-guidelines",
  );

  expect(entry?.extraFiles).toContain(
    "https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/web-design-guidelines/references/command.md",
  );
});

it("includes the internal communication templates and license", () => {
  const entry = parseSkillCatalog(bundledCatalog).find(
    (skill) => skill.id === "internal-comms",
  );
  const baseUrl =
    "https://raw.githubusercontent.com/anthropics/skills/main/skills/internal-comms/";

  expect(entry?.extraFiles).toEqual([
    `${baseUrl}LICENSE.txt`,
    `${baseUrl}examples/3p-updates.md`,
    `${baseUrl}examples/company-newsletter.md`,
    `${baseUrl}examples/faq-answers.md`,
    `${baseUrl}examples/general-comms.md`,
  ]);
});

it("includes the frontend design license", () => {
  const entry = parseSkillCatalog(bundledCatalog).find(
    (skill) => skill.id === "frontend-design",
  );

  expect(entry?.extraFiles).toContain(
    "https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/LICENSE.txt",
  );
});

it("includes the Supabase reference entry points within the catalog limit", () => {
  const entry = parseSkillCatalog(bundledCatalog).find(
    (skill) => skill.id === "supabase-postgres-best-practices",
  );
  const baseUrl =
    "https://raw.githubusercontent.com/supabase/agent-skills/main/skills/supabase-postgres-best-practices/references/";

  expect(entry?.extraFiles).toEqual([
    `${baseUrl}_sections.md`,
    `${baseUrl}query-missing-indexes.md`,
    `${baseUrl}query-partial-indexes.md`,
  ]);
});

it("rejects duplicate skill catalog IDs", () => {
  const skill = bundledCatalog.skills[0];

  expect(() =>
    parseSkillCatalog({ version: 1, skills: [skill, skill] }),
  ).toThrow(`Duplicate skill catalog id: ${skill.id}.`);
});

it.each(["offline", "invalid catalog"])(
  "keeps the added skills in the bundled fallback when %s",
  async (failure) => {
    vi.stubGlobal(
      "fetch",
      failure === "offline"
        ? vi.fn().mockRejectedValue(new Error("Offline"))
        : vi.fn().mockResolvedValue(Response.json({ version: 2, skills: [] })),
    );

    const result = await fetchSkillCatalog();

    expect(result.source).toBe("bundled");
    for (const { id } of ADDED_SKILLS) {
      expect(result.entries.some((skill) => skill.id === id)).toBe(true);
    }
  },
);
