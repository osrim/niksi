export interface Located {
  line: number;
}

export interface Pair<A, B> {
  anchor: A;
  partner: B;
}

export interface CombineOptions<A, B> {
  // Most lines between anchor and partner. Omitted means anywhere: callers pass one file's matches.
  within?: number;
  // Only a partner with the same key as the anchor counts.
  key?: (item: A | B) => unknown;
  // Only a partner on or before the anchor's line counts.
  before?: boolean;
}

interface Entry<B> {
  line: number;
  order: number;
  partner: B;
}

// Per key, one entry per line in line order: the line's first partner in input order wins every tie on that line.
const byLine = <B extends Located>(
  partners: readonly B[],
  key: (partner: B) => unknown,
): Map<unknown, Entry<B>[]> => {
  const groups = new Map<unknown, Entry<B>[]>();
  partners.forEach((partner, order) => {
    const name = key(partner);
    const group = groups.get(name) ?? [];
    group.push({ line: partner.line, order, partner });
    groups.set(name, group);
  });
  for (const [name, group] of groups) {
    const sorted = group.toSorted((a, b) => a.line - b.line || a.order - b.order);
    groups.set(
      name,
      sorted.filter((entry, i) => i === 0 || sorted[i - 1]!.line !== entry.line),
    );
  }
  return groups;
};

const firstAfter = (entries: readonly Entry<unknown>[], line: number): number => {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle]!.line <= line) low = middle + 1;
    else high = middle;
  }
  return low;
};

// On equal distance the partner earlier in the input wins.
const closer = <B>(
  line: number,
  a: Entry<B> | undefined,
  b: Entry<B> | undefined,
): Entry<B> | undefined => {
  if (!a || !b) return a ?? b;
  const gap = Math.abs(a.line - line) - Math.abs(b.line - line);
  return gap < 0 || (gap === 0 && a.order < b.order) ? a : b;
};

// Indexes the partners once, then finds an anchor's nearest partner in log time.
export const nearest = <A extends Located, B extends Located>(
  partners: readonly B[],
  { within = Infinity, key = () => undefined, before = false }: CombineOptions<A, B> = {},
): ((anchor: A) => B | undefined) => {
  const groups = byLine(partners, key);
  return (anchor) => {
    const entries = groups.get(key(anchor));
    if (!entries) return undefined;
    const after = firstAfter(entries, anchor.line);
    const found = closer(anchor.line, entries[after - 1], before ? undefined : entries[after]);
    return found && Math.abs(found.line - anchor.line) <= within ? found.partner : undefined;
  };
};

export const combine = <A extends Located, B extends Located>(
  anchors: readonly A[],
  partners: readonly B[],
  options: CombineOptions<A, B> = {},
): Pair<A, B>[] => {
  const find = nearest(partners, options);
  return anchors.flatMap((anchor) => {
    const partner = find(anchor);
    return partner === undefined ? [] : [{ anchor, partner }];
  });
};
