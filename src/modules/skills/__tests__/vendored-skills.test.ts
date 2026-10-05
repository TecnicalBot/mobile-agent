import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { parseSkillMarkdown } from "../skill-markdown";

const skillsDir = path.resolve(__dirname, "../../../../catalog/skills");

it("every vendored SKILL.md parses", () => {
  const dirs = fs.readdirSync(skillsDir).filter((d) =>
    fs.statSync(path.join(skillsDir, d)).isDirectory(),
  );
  expect(dirs.length).toBeGreaterThan(1);
  for (const d of dirs) {
    const md = fs.readFileSync(path.join(skillsDir, d, "SKILL.md"), "utf8");
    const parsed = parseSkillMarkdown(md);
    expect(parsed.title.length).toBeGreaterThan(0);
  }
});
