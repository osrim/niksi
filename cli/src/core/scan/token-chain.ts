export interface Span {
  start: number;
  end: number;
}

// The first match that starts at or after `from`.
export type Token = (line: string, from: number) => Span | undefined;

export interface Found {
  index: number;
  text: string;
}

export type Finder = (text: string) => Found[];

// A token keeps its last answer, which holds for any later offset up to the match it found, so a
// token that is absent from the rest of a line is read to the end once. That keeps a chain linear
// when each token instance sits in one place: shared by two chains, it is asked at offsets that
// go back and forth, and rereads.
export const token = (pattern: RegExp): Token => {
  const search = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  let last: { line: string; from: number; span: Span | undefined } | undefined;
  return (line, from) => {
    const known =
      last !== undefined &&
      last.line === line &&
      last.from <= from &&
      (last.span === undefined || last.span.start >= from);
    if (!known) {
      search.lastIndex = from;
      const match = search.exec(line);
      const span = match ? { start: match.index, end: match.index + match[0].length } : undefined;
      last = { line, from, span };
    }
    return last!.span;
  };
};

export const anyOf =
  (...tokens: Token[]): Token =>
  (line, from) =>
    tokens.reduce<Span | undefined>((first, next) => {
      const span = next(line, from);
      return span && (first === undefined || span.start < first.start) ? span : first;
    }, undefined);

// Each token is searched from where the one before it ended. That finds what
// `first[^\n]*?second` finds as long as a token that starts later never ends earlier: then if
// the first start fails, every later one fails.
export const lazyChain =
  (...tokens: Token[]): Token =>
  (line, from) => {
    const [first, ...rest] = tokens;
    const head = first?.(line, from);
    if (head === undefined) return undefined;
    let end = head.end;
    for (const next of rest) {
      const span = next(line, end);
      if (span === undefined) return undefined;
      end = span.end;
    }
    return { start: head.start, end };
  };

// As `first[^\n]*last`: the match runs on to the last match of the last token.
export const greedyChain = (...tokens: Token[]): Token => {
  const lazy = lazyChain(...tokens);
  const final = tokens.at(-1);
  return (line, from) => {
    const found = lazy(line, from);
    if (found === undefined || final === undefined) return found;
    let end = found.end;
    for (let span = final(line, end); span !== undefined; span = final(line, span.end)) {
      end = span.end;
    }
    return { start: found.start, end };
  };
};

const LINE = /[^\n]+/gu;

const matchesIn = (find: Token, part: string, index: number): Found[] => {
  const found: Found[] = [];
  for (let span = find(part, 0); span !== undefined;) {
    found.push({ index: index + span.start, text: part.slice(span.start, span.end) });
    span = find(part, Math.max(span.end, span.start + 1));
  }
  return found;
};

// Each match of `find` in each segment, searched again from where the last one ended, as
// `matchAll` does. A segment is a line unless `segment` stops it sooner.
export const perSegment =
  (find: Token, segment: RegExp = LINE): Finder =>
  (text) =>
    Array.from(text.matchAll(segment)).flatMap(({ 0: part, index }) =>
      matchesIn(find, part, index),
    );

export const everyMatch =
  (pattern: RegExp): Finder =>
  (text) =>
    Array.from(text.matchAll(pattern), (match) => ({ index: match.index, text: match[0] }));
