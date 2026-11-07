import { PROJECT_CONFIG_NAME, type ProjectPolicy } from "./project-config.ts";
import { LOCAL_PREFIX } from "./source/index.ts";

export interface PolicyViolation {
  name: string;
  reason: string;
}

// Match the raw source id, never a URL parser: WHATWG URL reads `\` as `/` and drops tabs,
// while Git's curl connects to another host. Anything unusual fails the match and is refused.
const GITHUB_URL = /^(?:https|ssh):\/\/(?:[A-Za-z0-9._~-]+@)?([A-Za-z0-9.-]+)(?::\d+)?\/(.+)$/u;
const GITHUB_ADDRESS = /^(?:[A-Za-z0-9._~-]+@)?([A-Za-z0-9.-]+):(?!\/)(.+)$/u;
const PATH_SEGMENT = /^(?!\.\.?$)[A-Za-z0-9._-]+$/u;

const githubOwner = (source: string): string | undefined => {
  const [, host = "", path = ""] = GITHUB_URL.exec(source) ?? GITHUB_ADDRESS.exec(source) ?? [];
  if (host.toLowerCase() !== "github.com") return undefined;
  const segments = path.replace(/\/$/u, "").split("/");
  return segments.every((segment) => PATH_SEGMENT.test(segment))
    ? segments[0]!.toLowerCase()
    : undefined;
};

const allowsSource = (policy: ProjectPolicy | undefined, source: string): boolean => {
  const sources = policy?.sources;
  if (sources === undefined || source.startsWith(LOCAL_PREFIX)) return true;
  if (sources.git?.includes(source)) return true;
  const owner = githubOwner(source);
  return owner !== undefined && (sources.github ?? []).some((org) => org.toLowerCase() === owner);
};

export const sourceViolation = (
  policy: ProjectPolicy | undefined,
  source: string,
): string | undefined =>
  allowsSource(policy, source)
    ? undefined
    : `source ${source} is not allowed by ${PROJECT_CONFIG_NAME}`;

export const policyViolations = (
  policy: ProjectPolicy | undefined,
  skills: { name: string; source: string }[],
): PolicyViolation[] =>
  skills
    .flatMap(({ name, source }) => {
      const reason = sourceViolation(policy, source);
      return reason === undefined ? [] : [{ name, reason }];
    })
    .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
