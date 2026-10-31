// Use `bun run release`: `bunx bumpp` runs an unpinned bumpp with push rights.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "bumpp";

export default defineConfig({
  execute: (operation) => {
    const { newVersion, updatedFiles } = operation.state;
    const changelog = resolve(operation.options.cwd, "..", "CHANGELOG.md");
    if (!readFileSync(changelog, "utf8").includes(`\n## [${newVersion}]`)) {
      throw new Error(
        `CHANGELOG.md has no entry for ${newVersion}. Run /start-release ${newVersion} first. ` +
          "To undo the bump: git restore package.json",
      );
    }
    operation.update({ updatedFiles: [...updatedFiles, changelog] });
  },
});
