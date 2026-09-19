import * as p from "@clack/prompts";
import prettyBytes from "pretty-bytes";
import { basename, dirname, relative } from "node:path";
import { readLock } from "../core/install/lockfile.ts";
import {
  deleteCandidate,
  prunePlan,
  storeEntryPath,
  type PruneCandidate,
} from "../core/install/store.ts";
import { storeDir, type Scope } from "../core/paths.ts";
import { confirm, land } from "../ui/flow.ts";
import type { CommandHelp } from "../ui/help.ts";
import { migrateIfLegacy } from "../ui/migrate.ts";
import { bold, dim, pad, tildify } from "../ui/style.ts";

export const help: CommandHelp = {
  description: [
    "Delete store entries that no lockfile records, and temporary directories from an interrupted download.",
    "Entries in the global lockfile and in the current project's lockfile stay, so `nik install` works without the network.",
    "`prune` never touches installed skills, links, copies, or lockfiles. It takes no scope flags because the store is one directory for every scope.",
  ].join(" "),
  examples: ["$ nik prune", "$ nik prune -y"],
};

interface PruneOptions {
  yes?: boolean;
}

const SCOPES: Scope[] = ["global", "project"];

const keptEntries = async (): Promise<Set<string>> => {
  const kept = new Set<string>();
  for (const scope of SCOPES) {
    for (const [name, entry] of Object.entries((await readLock(scope)).skills)) {
      kept.add(storeEntryPath(entry.source, name, entry.integrity));
    }
  }
  return kept;
};

const entries = (n: number): string => `${n} store ${n === 1 ? "entry" : "entries"}`;

const printPlan = (plan: PruneCandidate[]): void => {
  const nameWidth = Math.max(...plan.map(({ path }) => Bun.stringWidth(basename(path))));
  for (const [dir, items] of Map.groupBy(plan, ({ path }) => dirname(path))) {
    const source = relative(storeDir(), dir);
    p.log.message([
      bold(source === "" ? tildify(dir) : source),
      ...items.map(
        ({ path, bytes }) => `  ${pad(basename(path), nameWidth)}  ${dim(prettyBytes(bytes))}`,
      ),
    ]);
  }
};

export const run = async (options: PruneOptions): Promise<void> => {
  p.intro("nik prune");
  for (const scope of SCOPES) await migrateIfLegacy(scope);
  const plan = await prunePlan(await keptEntries());
  if (plan.length === 0) {
    p.outro("Nothing to prune.");
    return;
  }
  printPlan(plan);
  const total = plan.reduce((sum, candidate) => sum + candidate.bytes, 0);

  const proceed = await confirm(`Delete ${entries(plan.length)} (${prettyBytes(total)})?`, {
    yes: options.yes,
    command: "prune",
    initialValue: false,
  });
  if (!proceed) {
    p.outro("Nothing selected.");
    return;
  }

  let freed = 0;
  await land({
    items: plan,
    name: ({ path }) => basename(path),
    apply: async (candidate) => {
      await deleteCandidate(candidate);
      freed += candidate.bytes;
      return { success: "removed" };
    },
    scope: "global",
    lock: null,
    outro: (pruned) => `Pruned ${entries(pruned)}, freed ${prettyBytes(freed)}.`,
  });
};
