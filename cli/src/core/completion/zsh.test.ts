import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnTerminal } from "../../test-cli.ts";
import { fixtureSpec, stubNik } from "./test-fixture.ts";
import { zshScript } from "./zsh.ts";

let tmp: string;
let stub: { bin: string; argsFile: string };

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "nik-zsh-"));
  stub = await stubNik(tmp);
  await writeFile(join(tmp, "_nik"), zshScript(fixtureSpec));
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

interface Step {
  type: string;
  shows: string;
}

const KILL_LINE = "\x15";

// Types each line with a Tab, then waits for the text the completion should show.
const completeInZsh = async (steps: Step[]): Promise<string[]> => {
  const setup = `PS1='%% '; fpath=(${tmp} $fpath); autoload -U compinit; compinit -u -D; print READ''Y\r`;
  const seen: string[] = [];
  let searchFrom = 0;
  let started = false;
  let guard: Timer | undefined;
  await spawnTerminal(
    ["zsh", "-f", "-i"],
    { cwd: tmp, env: { ...process.env, PATH: `${stub.bin}:${process.env.PATH}`, TERM: "dumb" } },
    (output, terminal) => {
      if (!started) {
        started = true;
        terminal.write(setup);
        guard = setTimeout(() => terminal.write("\x03exit\r"), 4_000);
        return;
      }
      if (seen.length > steps.length) return;
      const wanted = seen.length === 0 ? "READY\r\n" : steps[seen.length - 1]!.shows;
      const at = output.indexOf(wanted, searchFrom);
      if (at === -1) return;
      searchFrom = at + wanted.length;
      const next = steps[seen.length];
      seen.push(wanted);
      terminal.write(next ? `${KILL_LINE}${next.type}\t` : `${KILL_LINE}exit\r`);
    },
  );
  clearTimeout(guard);
  return seen.slice(1);
};

test.skipIf(!Bun.which("zsh"))(
  "zsh completes commands, flags, values, and skill names",
  async () => {
    const steps: Step[] = [
      { type: "nik pr", shows: "nik prune " },
      { type: "nik ", shows: "completion  -- Print a completion script" },
      { type: "nik add --rep", shows: "nik add --report " },
      { type: "nik add x --agent qw", shows: "--agent qwen " },
      { type: "nik completion ", shows: "bash  fish  zsh" },
      { type: "nik rm -g g", shows: "nik rm -g grilling " },
      { type: "nik rm th", shows: "nik rm the\\ writing\\ whip " },
      { type: "nik -g pr", shows: "nik -g prune " },
      { type: "nik -g rm gr", shows: "nik -g rm grilling " },
    ];
    expect(await completeInZsh(steps)).toEqual(steps.map((step) => step.shows));
    expect((await readFile(stub.argsFile, "utf8")).split("\n")).toEqual([
      "__complete-skills",
      "remove",
      "-g",
      "",
    ]);
  },
);
