import { legacyLayoutPresent, migrateLegacyLayout } from "../core/install/migrate.ts";
import type { Scope } from "../core/paths.ts";
import { withSpinner } from "./prompt.ts";

export const migrateIfLegacy = async (scope: Scope, silent = false): Promise<void> => {
  if (!legacyLayoutPresent(scope)) return;
  if (silent) return migrateLegacyLayout(scope);
  await withSpinner(
    "Migrating to new version",
    () => migrateLegacyLayout(scope),
    () => "Migration complete",
  );
};
