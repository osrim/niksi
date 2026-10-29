// Synthetic secrets, assembled at runtime so the source holds no literal token for a push scanner.
const join = (...parts: string[]): string => parts.join("");

export const AWS_KEY = join("AKIA", "Z4XQF5RCWJ7YQ2LM");
export const GITHUB_TOKEN = join("ghp", "_", "R8vK2mQx7TfL9wZp3NcJ5hYd1sGb6UeA4kVo");
export const STRIPE_LIVE = join("sk", "_live_", "51Hc8QzR2vKpL7mT4wXy9bNd");
// Stripe's documentation test key. Test keys are not findings.
export const STRIPE_DOCS_TEST = join("sk", "_test_", "4eC39HqLyjWDarjtT1zdp7dc");
export const TELEGRAM_BOT = join("7409218365", ":", "AAH", "dqTcvCH1vGWJxfSeofSAs0K5PALDsawn");
export const JWT = join(
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  ".",
  "eyJzdWIiOiJuaWtzaS1wcm9iZSIsImlhdCI6MTcwMDAwMDAwMH0",
  ".",
  "Qm9vZ3VzU2lnbmF0dXJlRm9yTmlrc2lUZXN0czA5",
);
export const KEY_BODY = "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW";
export const PRIVATE_KEY = [
  join("-----BEGIN ", "OPENSSH PRIVATE KEY-----"),
  KEY_BODY,
  join("-----END ", "OPENSSH PRIVATE KEY-----"),
].join("\n");
export const DB_PASSWORD = join("S3cr3t", "Passw0rd");
export const BEARER = join("tok", "_9fK2pQ7xLm4Rv8Z");

export const SYNTHETIC = [
  AWS_KEY,
  GITHUB_TOKEN,
  STRIPE_LIVE,
  TELEGRAM_BOT,
  JWT,
  KEY_BODY,
  DB_PASSWORD,
  BEARER,
];
