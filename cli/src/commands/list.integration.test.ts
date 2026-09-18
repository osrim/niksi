import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

let tmp: string;
const cli = join(import.meta.dir, "..", "index.ts");

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-list-cli-test-")));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("list --global --json reports the legacy lockfile it read", async () => {
  const home = join(tmp, "home");
  const legacy = join(tmp, "data", "niksi", "niksi-lock.json");
  await mkdir(dirname(legacy), { recursive: true });
  await writeFile(legacy, '{"lockfileVersion":1,"skills":{}}\n');

  const child = Bun.spawn([process.execPath, cli, "list", "--global", "--json"], {
    cwd: tmp,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(tmp, "config"),
      XDG_DATA_HOME: join(tmp, "data"),
      NIKSI_HOME: undefined,
      CI: "1",
      NO_COLOR: "1",
      TERM: "dumb",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout).lockfile).toBe(legacy);
});
