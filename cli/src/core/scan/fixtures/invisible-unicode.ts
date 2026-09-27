import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "a Unicode tag character",
    path: "SKILL.md",
    content: entry("hello\u{E0041}world"),
    fire: [{ severity: "critical" }],
  },
  {
    name: "a zero-width space",
    path: "SKILL.md",
    content: entry("hello​world"),
    fire: [{ severity: "critical" }],
  },
  {
    name: "a bidi override",
    path: "scripts/run.py",
    content: "access = 'user‮ ⁦# admin⁩ ⁦'\n",
    fire: [{ severity: "critical" }],
  },
  {
    name: "a byte-order mark after the start",
    path: "SKILL.md",
    content: entry("hello﻿world"),
    fire: [{ severity: "critical" }],
  },
  {
    name: "a leading byte-order mark",
    path: "SKILL.md",
    content: `﻿${entry("plain text")}`,
    silent: "none",
  },
  {
    name: "accented letters",
    path: "SKILL.md",
    content: entry("café, naïve, Södermalm"),
    silent: "none",
  },
  {
    name: "F3 joiners inside an emoji",
    path: "SKILL.md",
    content: entry("\u{1F468}‍\u{1F469}‍\u{1F467} family"),
    silent: "critical",
    known: "F3, L04",
  },
  {
    name: "P9 a word joiner inside a sentence",
    path: "SKILL.md",
    content: entry("Do⁠not disclose this step."),
    silent: "none",
    known: "P9, L04",
  },
] satisfies Case[];
