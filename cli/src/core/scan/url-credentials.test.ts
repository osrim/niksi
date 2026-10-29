import { expect, test } from "bun:test";
import { BEARER, DB_PASSWORD } from "./test-secrets.ts";
import { urlCredentials } from "./url-credentials.ts";

test("a URL credential is reported up to its host, strongest first, with the count", () => {
  expect(
    urlCredentials(`a postgres://u:password@db/x\nb mysql://root:${DB_PASSWORD}@sql.dev:3306/x\n`),
  ).toEqual({
    severity: "warn",
    line: 2,
    detail: `mysql://root:${DB_PASSWORD}@sql.dev (2 matches)`,
  });
});

test("an env reference or template as the URL password is a placeholder", () => {
  expect(urlCredentials("redis://app:${REDIS_PASSWORD}@cache.dev")?.severity).toBe("info");
});

test("a header literal needs eight characters and no leading $", () => {
  expect(urlCredentials(`--header="Authorization: Token ${BEARER}"`)?.severity).toBe("warn");
  expect(urlCredentials('-H "Authorization: Basic $(printf u:p | base64)"')).toBeUndefined();
  expect(urlCredentials("-H 'Authorization: Bearer 1234567'")).toBeUndefined();
});
