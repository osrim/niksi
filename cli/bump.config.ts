// Use `bun run release`: `bunx bumpp` runs an unpinned bumpp with push rights.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "bumpp";

// The lines under `## [version]` up to the next `## ` heading, as release.yml extracts them.
const changelogEntry = (changelog: string, version: string): string => {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) return "";
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
};

export default defineConfig({
  execute: (operation) => {
    const { newVersion, updatedFiles } = operation.state;
    const changelog = resolve(operation.options.cwd, "..", "CHANGELOG.md");
    if (changelogEntry(readFileSync(changelog, "utf8"), newVersion).trim() === "") {
      throw new Error(
        `CHANGELOG.md has no entry for ${newVersion}. Run /start-release ${newVersion} first. ` +
          "To undo the bump: git restore package.json",
      );
    }
    operation.update({ updatedFiles: [...updatedFiles, changelog] });
  },
});
