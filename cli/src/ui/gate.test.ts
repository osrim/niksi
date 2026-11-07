import { afterEach, describe, expect, test } from "bun:test";
import type { Finding } from "../core/scan/index.ts";
import { MODE_EXEC, MODE_FILE, type SkillFile } from "../core/skill/files.ts";
import { captureOutput, setInteractive } from "../test-output.ts";
import { renderFrontmatter, reviewSkills, stopsOn } from "./gate.ts";

const finding = (severity: Finding["severity"], rule: Finding["rule"]): Finding => ({
  severity,
  confidence: "high",
  rule,
  help: `${rule} help`,
  detail: `${rule} fired`,
});

describe("stopsOn", () => {
  test("info findings alone pass", () => {
    expect(stopsOn([finding("info", "external-url")], {})).toBeNull();
  });

  test("a warn finding stops", () => {
    expect(stopsOn([finding("info", "external-url"), finding("warn", "executable")], {})).toBe(
      "warn",
    );
  });

  test("a critical finding outranks a warn finding", () => {
    expect(
      stopsOn([finding("warn", "executable"), finding("critical", "curl-pipe-shell")], {}),
    ).toBe("critical");
  });

  test("-y skips the warn stop", () => {
    expect(stopsOn([finding("warn", "executable")], { yes: true })).toBeNull();
  });

  test("-y never answers the critical gate", () => {
    expect(stopsOn([finding("critical", "hooks")], { yes: true })).toBe("critical");
  });

  test("an unset -y stops like a false one", () => {
    expect(stopsOn([finding("warn", "executable")], {})).toBe("warn");
  });

  test.each([
    { critical: "critical", warn: "warn", mixed: "critical" },
    { yes: false, critical: "critical", warn: "warn", mixed: "critical" },
    { yes: true, critical: "critical", warn: null, mixed: "critical" },
    { dangerousSkipCriticalApproval: false, critical: "critical", warn: "warn", mixed: "critical" },
    {
      yes: false,
      dangerousSkipCriticalApproval: false,
      critical: "critical",
      warn: "warn",
      mixed: "critical",
    },
    {
      yes: true,
      dangerousSkipCriticalApproval: false,
      critical: "critical",
      warn: null,
      mixed: "critical",
    },
    { dangerousSkipCriticalApproval: true, critical: null, warn: "warn", mixed: "warn" },
    {
      yes: false,
      dangerousSkipCriticalApproval: true,
      critical: null,
      warn: "warn",
      mixed: "warn",
    },
    { yes: true, dangerousSkipCriticalApproval: true, critical: null, warn: null, mixed: null },
  ])("review options %j preserve independent approval and warn stops", (options) => {
    expect(stopsOn([finding("critical", "hooks")], options)).toBe(options.critical);
    expect(stopsOn([finding("warn", "executable")], options)).toBe(options.warn);
    expect(stopsOn([finding("critical", "hooks"), finding("warn", "executable")], options)).toBe(
      options.mixed,
    );
    expect(stopsOn([finding("info", "external-url")], options)).toBeNull();
    expect(stopsOn([], options)).toBeNull();
  });
});

describe("stopsOn with denyWarn", () => {
  test("a warn finding needs approval like a critical one", () => {
    expect(stopsOn([finding("warn", "executable")], { denyWarn: true })).toBe("critical");
  });

  test("-y does not accept a warn finding", () => {
    expect(stopsOn([finding("warn", "executable")], { yes: true, denyWarn: true })).toBe(
      "critical",
    );
  });

  test("the dangerous flag skips it, as it skips a critical finding", () => {
    expect(
      stopsOn([finding("warn", "executable")], {
        dangerousSkipCriticalApproval: true,
        denyWarn: true,
      }),
    ).toBeNull();
  });

  test("info findings still pass", () => {
    expect(stopsOn([finding("info", "external-url")], { yes: true, denyWarn: true })).toBeNull();
  });
});

const skillMd = (text: string): SkillFile => ({
  path: "SKILL.md",
  content: Buffer.from(text),
  mode: MODE_FILE,
});

describe("renderFrontmatter", () => {
  test("shows description and allowed-tools from SKILL.md", () => {
    expect(
      renderFrontmatter([
        skillMd(
          "---\nname: x\ndescription: Fetch weather\nallowed-tools: Bash(curl:*), Read\n---\n",
        ),
      ]),
    ).toEqual(["description: Fetch weather", "allowed-tools: Bash(curl:*), Read"]);
  });

  test("joins an allowed-tools list", () => {
    expect(renderFrontmatter([skillMd("---\nallowed-tools:\n  - Read\n  - Grep\n---\n")])).toEqual([
      "allowed-tools: Read, Grep",
    ]);
  });

  test("skips a missing key", () => {
    expect(renderFrontmatter([skillMd("---\nname: x\ndescription: only this\n---\n")])).toEqual([
      "description: only this",
    ]);
  });

  test("shows nothing without frontmatter, SKILL.md, or valid YAML", () => {
    expect(renderFrontmatter([skillMd("# no frontmatter\n")])).toEqual([]);
    expect(renderFrontmatter([])).toEqual([]);
    expect(renderFrontmatter([skillMd("---\ndescription: [unclosed\n---\n")])).toEqual([]);
  });

  test("escapes control characters in a value", () => {
    expect(renderFrontmatter([skillMd('---\ndescription: "a\\eb"\n---\n')])).toEqual([
      "description: a^[b",
    ]);
  });
});

describe("reviewSkills", () => {
  const savedExitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = savedExitCode;
  });

  test("returns the findings of every reviewed skill, blocked or approved", async () => {
    const output = captureOutput();
    const restoreTty = setInteractive(false);
    try {
      const clean = { name: "clean", files: [skillMd("---\nname: clean\n---\n")] };
      const hooked = {
        name: "hooked",
        files: [
          skillMd("---\nname: hooked\n---\n"),
          { path: "hooks.json", content: Buffer.from("{}\n"), mode: MODE_FILE },
        ],
      };

      const result = await reviewSkills([clean, hooked], { yes: true });

      expect(result.approved).toEqual([clean]);
      expect(result.blocked).toEqual([hooked]);
      expect(result.findings.get("clean")).toEqual([]);
      expect(result.findings.get("hooked")?.map(({ severity }) => severity)).toContain("critical");
    } finally {
      restoreTty();
      output.restore();
    }
  });

  test("with denyWarn, a warn finding blocks the skill without a terminal and names the rule", async () => {
    const output = captureOutput();
    const restoreTty = setInteractive(false);
    try {
      const script = {
        name: "script",
        files: [
          skillMd("---\nname: script\n---\n"),
          { path: "run.sh", content: Buffer.from("echo hi\n"), mode: MODE_EXEC },
        ],
      };

      const result = await reviewSkills([script], { yes: true, denyWarn: true });

      expect(result.blocked).toEqual([script]);
      expect(process.exitCode).toBe(3);
      expect(output.text()).toContain(
        "script: review warn findings in a terminal. niksi.json sets policy.denyWarn.",
      );
    } finally {
      restoreTty();
      output.restore();
    }
  });
});
