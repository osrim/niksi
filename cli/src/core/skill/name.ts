const STANDARD_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
const MAX_NAME = 64;

export const slugifySkillName = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

export const isValidSkillName = (name: string): boolean =>
  STANDARD_NAME.test(name) && name.length <= MAX_NAME;
