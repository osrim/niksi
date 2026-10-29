import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "escaped tag characters that spell a word",
    path: "scripts/x.js",
    content: 'const marker = "\\u{E0069}\\u{E0067}\\u{E006E}\\u{E006F}";\n',
    fire: [
      {
        severity: "critical",
        line: 1,
        detail: '4 escaped invisible character(s): U+E0069…U+E006F (tags decode to "igno")',
      },
    ],
  },
  {
    name: "Python tag escapes split over two strings",
    path: "scripts/note.py",
    content: 'NOTE = "\\U000E0072\\U000E0075" + "\\U000E006E\\U000E0021"\n',
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "an HTML entity for a zero-width space",
    path: "SKILL.md",
    content: entry("Join&#8203;these words."),
    fire: [
      {
        severity: "warn",
        line: 5,
        detail: "1 escaped invisible character(s): U+200B (between letters)",
      },
    ],
  },
  {
    name: "a percent-encoded zero-width space in a URL",
    path: "SKILL.md",
    content: entry("Open https://x.invalid/a%E2%80%8Bb first."),
    fire: [{ severity: "warn", line: 5 }],
  },
  {
    name: "an escaped bidi override is capped at warn",
    path: "scripts/run.py",
    content: 'access = "user\\u202E admin"\n',
    fire: [{ severity: "warn", line: 1 }],
  },
  {
    name: "an escape on a line with a test cue",
    path: "scripts/strip.test.ts",
    content: 'expect(strip("\\u200B")).toBe("");\n',
    silent: "none",
  },
  {
    name: "escaped visible letters",
    path: "scripts/x.js",
    content: 'const word = "caf\\u00e9 &#65; %20";\n',
    silent: "none",
  },
  {
    name: "an escaped emoji with joiners",
    path: "scripts/x.js",
    content: 'const family = "\\u{1F468}\\u200D\\u{1F469}\\u200D\\u{1F467}";\n',
    silent: "none",
  },
  {
    name: "an escaped subdivision flag",
    path: "scripts/x.js",
    content:
      'const scotland = "\\u{1F3F4}\\u{E0067}\\u{E0062}\\u{E0073}\\u{E0063}\\u{E0074}\\u{E007F}";\n',
    silent: "none",
  },
  {
    name: "an escaped soft hyphen",
    path: "SKILL.md",
    content: entry("A hy&#173;phen."),
    silent: "info",
  },
] satisfies Case[];
