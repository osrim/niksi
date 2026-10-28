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
  related?: (anchor: A, partner: B) => boolean;
}

export const combine = <A extends Located, B extends Located>(
  anchors: readonly A[],
  partners: readonly B[],
  { within = Infinity, related = () => true }: CombineOptions<A, B> = {},
): Pair<A, B>[] =>
  anchors.flatMap((anchor) => {
    const distance = (partner: B): number => Math.abs(partner.line - anchor.line);
    const nearest = partners
      .filter((partner) => distance(partner) <= within && related(anchor, partner))
      .reduce<B | undefined>(
        (best, partner) => (best && distance(best) <= distance(partner) ? best : partner),
        undefined,
      );
    return nearest ? [{ anchor, partner: nearest }] : [];
  });
