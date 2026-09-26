// Regroups GitHub's generated release notes by the conventional-commit type of each PR title.
const ENTRY = /^\* (.+) by @\S+ in \S+\/pull\/(\d+)$/u;
const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?!?: (.+)$/u;
const GROUPS: Record<string, string> = { feat: "Features", fix: "Fixes" };

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const releaseNotes = (generated: string): string => {
  const groups = new Map<string, string[]>([
    ["Features", []],
    ["Fixes", []],
    ["Other", []],
  ]);
  const rest: string[] = [];
  let inChanges = false;
  for (const line of generated.split("\n")) {
    if (line.startsWith("## ")) {
      inChanges = line === "## What's Changed";
      if (!inChanges) rest.push(`#${line}`);
      continue;
    }
    const entry = inChanges ? ENTRY.exec(line) : null;
    if (!entry?.[1]) {
      rest.push(line);
      continue;
    }
    const [, type = "", subject = entry[1]] = CONVENTIONAL.exec(entry[1]) ?? [];
    groups.get(GROUPS[type] ?? "Other")?.push(`- ${capitalize(subject)} (#${entry[2]})`);
  }
  const sections = [...groups]
    .filter(([, items]) => items.length > 0)
    .map(([title, items]) => `### ${title}\n\n${items.join("\n")}`);
  return `${["## Release notes", ...sections, rest.join("\n").trim()].filter(Boolean).join("\n\n")}\n`;
};

if (import.meta.main) {
  process.stdout.write(releaseNotes(await Bun.stdin.text()));
}
