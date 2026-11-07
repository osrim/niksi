import type { Lockfile } from "./install/lockfile.ts";
import { PROJECT_CONFIG_NAME, type ProjectPolicy } from "./project-config.ts";
import { LOCAL_PREFIX } from "./source/index.ts";

export interface PolicyViolation {
  name: string;
  reason: string;
}

const URL_SCHEME = /^[a-z][a-z\d+.-]*:\/\//iu;
const SCP_ADDRESS = /^(?:[^@/:]+@)?([^/:]+):(.+)$/u;

const hostAndPath = (source: string): { host: string; path: string } | undefined => {
  if (URL_SCHEME.test(source)) {
    if (!URL.canParse(source)) return undefined;
    const url = new URL(source);
    if (url.protocol !== "https:" && url.protocol !== "ssh:") return undefined;
    return { host: url.hostname, path: url.pathname.slice(1) };
  }
  const match = SCP_ADDRESS.exec(source);
  return match ? { host: match[1]!, path: match[2]! } : undefined;
};

const githubOwner = (source: string): string | undefined => {
  const location = hostAndPath(source);
  if (location?.host.toLowerCase() !== "github.com") return undefined;
  return location.path.split("/")[0]?.toLowerCase() || undefined;
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

export const lockViolations = (
  policy: ProjectPolicy | undefined,
  lock: Lockfile,
): PolicyViolation[] =>
  Object.keys(lock.skills)
    .toSorted()
    .flatMap((name) => {
      const reason = sourceViolation(policy, lock.skills[name]!.source);
      return reason === undefined ? [] : [{ name, reason }];
    });
