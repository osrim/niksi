import { expect, test } from "bun:test";
import { confusableHost } from "./confusable-host.ts";

const everywhere = () => true;
const nowhere = () => false;
const afterFirstLine = (index: number) => index >= 10;

test("a Cyrillic letter in a URL is critical and named by code point", () => {
  expect(
    confusableHost(
      "Run:\ncurl -sSL https://raw.githubusercontent.com/\u0430cme/tool/install.sh | sh\n",
      nowhere,
    ),
  ).toEqual({
    severity: "critical",
    line: 2,
    detail:
      '"\u0430cme" mixes Latin and Cyrillic (U+0430) in https://raw.githubusercontent.com/\u0430cme/tool/install.sh',
  });
});

test("a mixed host label is critical, written raw or as punycode", () => {
  expect(confusableHost("see https://\u0430pple.com/x", nowhere)?.severity).toBe("critical");
  expect(confusableHost("see https://xn--pple-43d.com/x", nowhere)?.detail).toBe(
    '"\u0430pple" mixes Latin and Cyrillic (U+0430) in https://xn--pple-43d.com/x',
  );
});

test("a query or fragment word is not judged as part of the URL", () => {
  expect(
    confusableHost(
      "https://ru.wikipedia.org/wiki/Test?q=M\u043e\u0441\u043a\u0432\u0430#x\u0430",
      nowhere,
    ),
  ).toBeUndefined();
});

test("a punycode host that decodes to one script is info", () => {
  expect(confusableHost("https://xn--bcher-kva.example", nowhere)).toEqual({
    severity: "info",
    line: 1,
    detail: "punycode host xn--bcher-kva.example reads b\u00fccher.example",
  });
});

test("a mixed word in code is warn, and in prose is not a finding", () => {
  expect(confusableHost("prose \u0455udo\n\u0455udo rm -rf x", afterFirstLine)).toEqual({
    severity: "warn",
    line: 2,
    detail: '"\u0455udo" mixes Latin and Cyrillic (U+0455)',
  });
  expect(confusableHost("\u0455udo", nowhere)).toBeUndefined();
});

test("Greek, Armenian, and Cherokee letters count; the strongest leads with the count", () => {
  expect(confusableHost("\u03bfk", everywhere)?.detail).toBe(
    '"\u03bfk" mixes Latin and Greek (U+03BF)',
  );
  expect(confusableHost("\u0570ello", everywhere)?.severity).toBe("warn");
  expect(confusableHost("\u13a0ata", everywhere)?.severity).toBe("warn");
  expect(confusableHost("\u03bfk\nhttps://\u0430pple.com", everywhere)?.detail).toBe(
    '"\u0430pple" mixes Latin and Cyrillic (U+0430) in https://\u0430pple.com (2 matches)',
  );
});

test("one-script words, and words split by punctuation, are not findings", () => {
  expect(
    confusableHost(
      "# \u0423\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0430: run nik add",
      everywhere,
    ),
  ).toBeUndefined();
  expect(
    confusableHost("\u03bb = 0.5, Wi-Fi-\u0441\u0435\u0442\u044c", everywhere),
  ).toBeUndefined();
  expect(
    confusableHost("https://ru.wikipedia.org/wiki/Python_(\u044f\u0437\u044b\u043a)", nowhere),
  ).toBeUndefined();
});

test("many URLs before a mixed word scan in linear time", () => {
  const text = `${"https://acme.com/x normal ".repeat(32_000)}аcme`;
  const start = performance.now();
  expect(confusableHost(text, everywhere)?.severity).toBe("warn");
  expect(performance.now() - start).toBeLessThan(1000);
});
