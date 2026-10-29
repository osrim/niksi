import { expect, test } from "bun:test";
import { base64Exec } from "./base64-exec.ts";
import { shellStatements } from "./shell.ts";

const noProseContext = { afterProhibition: () => false, demoted: () => false };

const inScript = (...lines: string[]) => {
  const text = lines.join("\n");
  return base64Exec(text, shellStatements(text, false), noProseContext);
};

test("a shell decoder piped into an interpreter that reads stdin", () => {
  expect(inScript("printf '\\x63\\x75\\x72\\x6c' | sh")?.severity).toBe("critical");
  expect(inScript("echo -e '\\x63\\x75\\x72\\x6c' | bash")?.severity).toBe("critical");
  expect(inScript("xxd -r -p payload.hex | sh")?.severity).toBe("critical");
  expect(inScript("openssl enc -d -base64 -in payload.b64 | python3")?.severity).toBe("critical");
  expect(inScript("cat payload.txt | rev | sh")?.severity).toBe("critical");
  expect(inScript("gunzip -c payload.gz | sudo bash -s")?.severity).toBe("critical");
});

test("a decoder that feeds data to a script or a file is not a match", () => {
  expect(inScript("xxd -r -p payload.hex | python3 parse.py")).toBeUndefined();
  expect(inScript("printf '\\x63' > out.bin")).toBeUndefined();
  expect(inScript("echo '\\x63' | sh")).toBeUndefined();
  expect(inScript("sh install.sh | rev")).toBeUndefined();
  expect(inScript("git rev-parse HEAD | sh")).toBeUndefined();
});

test("a decoder inside a substitution that eval, source, or sh -c runs", () => {
  expect(inScript('eval "$(xxd -r -p payload.hex)"')?.severity).toBe("critical");
  expect(inScript("source <(echo cGF5bG9hZA== | base64 -d)")?.severity).toBe("critical");
  expect(inScript('sh -c "$(rev < payload.txt)"')?.severity).toBe("critical");
  expect(inScript('cat "$(xxd -r -p name.hex)"')).toBeUndefined();
});

test("Python and JavaScript decoders passed to exec, eval, or new Function", () => {
  expect(inScript('exec("".join(map(chr, [105, 109])))')?.severity).toBe("critical");
  expect(inScript("exec(zlib.decompress(blob))")?.severity).toBe("critical");
  expect(inScript("eval(codecs.decode(blob, 'rot13'))")?.severity).toBe("critical");
  expect(inScript("exec(bytes.fromhex(blob))")?.severity).toBe("critical");
  expect(inScript("exec(marshal.loads(blob))")?.severity).toBe("critical");
  expect(inScript("eval(String.fromCharCode(99, 117))")?.severity).toBe("critical");
  expect(inScript('new Function(Buffer.from(blob, "base64").toString())()')?.severity).toBe(
    "critical",
  );
  expect(inScript("pattern = re.compile(source)")).toBeUndefined();
});

test("a call name built from pieces and os.system through __import__", () => {
  expect(inScript('getattr(builtins, "ex"+"ec")(code)')?.severity).toBe("critical");
  expect(inScript('__import__("os").system(cmd)')?.severity).toBe("critical");
  expect(inScript('getattr(obj, "name")(arg)')).toBeUndefined();
});

test("one line counts once, and a comment drops one level", () => {
  expect(inScript("echo cGF5bG9hZA== | base64 -d | sh", "data = base64.b64decode(blob)")).toEqual({
    severity: "critical",
    line: 1,
    detail: "echo cGF5bG9hZA== | base64 -d | sh",
  });
  expect(inScript("# echo cGF5bG9hZA== | base64 -d | sh")?.severity).toBe("warn");
});
