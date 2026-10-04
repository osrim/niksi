import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { writeFiles, type SkillFile } from "../skill/files.ts";
import { tildify } from "../paths.ts";
import { present } from "./target.ts";

export class RecoveryError extends Error {
  constructor(
    cause: unknown,
    target: string,
    readonly recovery: string,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `${reason}\nThe previous files are in ${tildify(recovery)}. Move them to ${tildify(target)} to restore the skill.`,
      { cause },
    );
  }
}

const discard = (path: string): Promise<void> =>
  rm(path, { recursive: true, force: true }).catch(() => undefined);

// The work directory sits beside the target so every rename stays on one filesystem.
const prepare = async (target: string, files: SkillFile[]): Promise<string> => {
  await mkdir(dirname(target), { recursive: true });
  const work = await mkdtemp(join(dirname(target), `.${basename(target)}.niksi-`));
  try {
    await writeFiles(join(work, "new"), files);
  } catch (e) {
    await discard(work);
    throw e;
  }
  return work;
};

const swap = async (target: string, work: string): Promise<void> => {
  const prepared = join(work, "new");
  if (!present(target)) {
    await rename(prepared, target);
    return;
  }
  const previous = join(work, "old");
  await rename(target, previous);
  try {
    await rename(prepared, target);
  } catch (e) {
    await rename(previous, target).catch(() => {
      throw new RecoveryError(e, target, previous);
    });
    throw e;
  }
};

export const replaceDir = async (
  target: string,
  files: SkillFile[],
): Promise<string | undefined> => {
  const work = await prepare(target, files);
  try {
    await swap(target, work);
  } catch (e) {
    if (!(e instanceof RecoveryError)) await discard(work);
    throw e;
  }
  return rm(work, { recursive: true, force: true }).then(
    () => undefined,
    () => work,
  );
};
