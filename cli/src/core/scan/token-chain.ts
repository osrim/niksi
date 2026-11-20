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

export const token = (pattern: RegExp): Token => {
  const search = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  return (line, from) => {
    search.lastIndex = from;
    const match = search.exec(line);
    return match ? { start: match.index, end: match.index + match[0].length } : undefined;
  };
};

export const anyOf =
  (...tokens: Token[]): Token =>
  (line, from) =>
    tokens.reduce<Span | undefined>((first, next) => {
      const span = next(line, from);
      return span && (first === undefined || span.start < first.start) ? span : first;
    }, undefined);

// Each token is searched once, from where the one before it ended, so a line is read once
// however often the first token repeats. That finds what `first[^\n]*?second` finds as long as
// a token that starts later never ends earlier: then if the first start fails, every later one fails.
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

// As `first[^\n]*last`: the match runs on to the last match of `last`, read once to the end.
export const greedyChain = (tokens: Token[], last: RegExp): Token => {
  const final = token(last);
  const lazy = lazyChain(...tokens, final);
  return (line, from) => {
    const found = lazy(line, from);
    if (found === undefined) return undefined;
    let end = found.end;
    for (let span = final(line, end); span !== undefined; span = final(line, span.end)) {
      end = span.end;
    }
    return { start: found.start, end };
  };
};

const LINE = /[^\n]+/gu;

// The first match of `find` within each segment. A segment is a line unless `segment` stops it sooner.
export const perLine =
  (find: Token, segment: RegExp = LINE): Finder =>
  (text) =>
    Array.from(text.matchAll(segment)).flatMap(({ 0: part, index }) => {
      const span = find(part, 0);
      return span ? [{ index: index + span.start, text: part.slice(span.start, span.end) }] : [];
    });

export const everyMatch =
  (pattern: RegExp): Finder =>
  (text) =>
    Array.from(text.matchAll(pattern), (match) => ({ index: match.index, text: match[0] }));
