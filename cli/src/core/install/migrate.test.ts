import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { legacyLayoutPresent, migrateLegacyLayout } from "./migrate.ts";
import { BLOCK_BEGIN, BLOCK_END } from "./exclude.ts";
import { git } from "../source/git.ts";
import { captureEnv } from "../../test-env.ts";
import { USAGE_ERROR } from "../usage.ts";

const restoreEnv = captureEnv(
  "HOME",
  "NIKSI_HOME",
  "SKI_HOME",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "CLAUDE_HOME",
);
const cwd = process.cwd();
let tmp: string;
let n = 0;

const LOCK = `${JSON.stringify(
  {
    lockfileVersion: 1,
    skills: {
      demo: {
        source: "https://github.com/o/r",
        path: "",
        integrity: "sha256-qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
        track: "auto",
      },
    },
  },
  null,
  2,
)}\n`;

const LEGACY_BLOCK =
  "# >>> ski: managed skill links (rebuilt by `ski install`)\n.claude/skills/demo\n# <<< ski\n";

const oldSkill = async (skillsRoot: string, linkDir: string): Promise<void> => {
  await mkdir(join(skillsRoot, "demo"), { recursive: true });
  await writeFile(join(skillsRoot, "demo", "SKILL.md"), "x\n");
  await mkdir(linkDir, { recursive: true });
  await symlink(relative(linkDir, join(skillsRoot, "demo")), join(linkDir, "demo"));
};

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-migrate-test-")));
  process.env.HOME = join(tmp, "home");
  process.env.CLAUDE_HOME = join(tmp, "home", ".claude");
  process.env.XDG_DATA_HOME = join(tmp, "xdg", "data");
  process.env.XDG_CONFIG_HOME = join(tmp, "xdg", "config");
  process.env.XDG_CACHE_HOME = join(tmp, "xdg", "cache");
  delete process.env.NIKSI_HOME;
  delete process.env.SKI_HOME;
  await mkdir(process.env.HOME, { recursive: true });
});

afterEach(() => process.chdir(cwd));

afterAll(async () => {
  process.chdir(cwd);
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

test("a ski 0.2 project is moved to the niksi layout once", async () => {
  const root = join(tmp, `p${n++}`);
  await mkdir(root, { recursive: true });
  expect((await git(["init", "--quiet"], root)).code).toBe(0);
  await writeFile(join(root, "ski-lock.json"), LOCK);
  await oldSkill(join(root, ".ski", "skills"), join(root, ".claude", "skills"));
  await mkdir(join(root, ".git", "info"), { recursive: true });
  await mkdir(join(tmp, "xdg", "config", "ski"), { recursive: true });
  await writeFile(join(tmp, "xdg", "config", "ski", "config.json"), '{"scope":"global"}\n');
  await writeFile(join(root, ".git", "info", "exclude"), `*.log\n${LEGACY_BLOCK}`);
  process.chdir(join(root, ".claude"));

  expect(legacyLayoutPresent("project")).toBe(true);
  await migrateLegacyLayout("project");

  expect(await readFile(join(root, "niksi-lock.json"), "utf8")).toBe(LOCK);
  expect(existsSync(join(root, "ski-lock.json"))).toBe(false);
  expect(existsSync(join(root, ".ski"))).toBe(false);
  expect(await readFile(join(root, ".niksi", "skills", "demo", "SKILL.md"), "utf8")).toBe("x\n");
  const link = join(root, ".claude", "skills", "demo");
  expect(await readlink(link)).toBe(join("..", "..", ".niksi", "skills", "demo"));
  expect(await realpath(link)).toBe(join(root, ".niksi", "skills", "demo"));
  expect(await readFile(join(root, ".git", "info", "exclude"), "utf8")).toBe(
    `*.log\n${BLOCK_BEGIN}\n.claude/skills/demo\n${BLOCK_END}\n`,
  );
  expect(await readFile(join(tmp, "xdg", "config", "niksi", "config.json"), "utf8")).toBe(
    '{"scope":"global"}\n',
  );
  expect(existsSync(join(tmp, "xdg", "config", "ski"))).toBe(false);

  expect(legacyLayoutPresent("project")).toBe(false);
  await migrateLegacyLayout("project");
  expect(await readlink(link)).toBe(join("..", "..", ".niksi", "skills", "demo"));
});

test("a pulled niksi-lock.json beside a local .ski still moves the directory", async () => {
  const root = join(tmp, `p${n++}`);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "niksi-lock.json"), LOCK);
  await oldSkill(join(root, ".ski", "skills"), join(root, ".claude", "skills"));
  process.chdir(root);

  expect(legacyLayoutPresent("project")).toBe(true);
  await migrateLegacyLayout("project");

  expect(existsSync(join(root, ".ski"))).toBe(false);
  expect(await realpath(join(root, ".claude", "skills", "demo"))).toBe(
    join(root, ".niksi", "skills", "demo"),
  );
});

test("a project without ski files needs nothing", async () => {
  const root = join(tmp, `p${n++}`);
  await mkdir(join(root, ".claude"), { recursive: true });
  process.chdir(root);
  expect(legacyLayoutPresent("project")).toBe(false);
});

test("the global ski files move into niksi roots a project run already created", async () => {
  const data = join(tmp, "xdg", "data");
  const config = join(tmp, "xdg", "config");
  const cache = join(tmp, "xdg", "cache");
  await mkdir(join(data, "niksi", "store"), { recursive: true });
  await mkdir(join(data, "ski", "store", "old"), { recursive: true });
  await mkdir(join(config, "niksi"), { recursive: true });
  await writeFile(join(config, "niksi", "config.json"), "{}\n");
  await mkdir(join(cache, "niksi"), { recursive: true });
  await writeFile(join(cache, "niksi", "last-update-check"), "new");
  await mkdir(join(config, "ski"), { recursive: true });
  await writeFile(join(config, "ski", "ski-lock.json"), LOCK);
  await mkdir(join(cache, "ski"), { recursive: true });
  await writeFile(join(cache, "ski", "last-update-check"), "{}");
  await oldSkill(join(data, "ski", "skills"), join(tmp, "home", ".claude", "skills"));
  process.chdir(tmp);

  expect(legacyLayoutPresent("global")).toBe(true);
  await migrateLegacyLayout("global");

  for (const dir of [data, config, cache]) expect(existsSync(join(dir, "ski"))).toBe(false);
  expect(await readFile(join(config, "niksi", "niksi-lock.json"), "utf8")).toBe(LOCK);
  expect(await readFile(join(config, "niksi", "config.json"), "utf8")).toBe("{}\n");
  expect(existsSync(join(config, "ski"))).toBe(false);
  expect(existsSync(join(data, "niksi", "store"))).toBe(true);
  expect(await readFile(join(cache, "niksi", "last-update-check"), "utf8")).toBe("new");
  expect(existsSync(join(data, "niksi", "store", "old"))).toBe(false);
  const link = join(tmp, "home", ".claude", "skills", "demo");
  expect(await realpath(link)).toBe(join(data, "niksi", "skills", "demo"));
  expect(legacyLayoutPresent("global")).toBe(false);
  await migrateLegacyLayout("global");
  expect(await realpath(link)).toBe(join(data, "niksi", "skills", "demo"));
});

test("SKI_HOME without NIKSI_HOME is a usage error", () => {
  process.env.SKI_HOME = "/opt/ski";
  try {
    expect(() => legacyLayoutPresent("global")).toThrow(
      expect.objectContaining({
        name: USAGE_ERROR,
        message: "SKI_HOME was renamed to NIKSI_HOME.",
      }),
    );
  } finally {
    delete process.env.SKI_HOME;
  }
});
