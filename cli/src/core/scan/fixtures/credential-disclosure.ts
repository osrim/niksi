import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "P3 ask for a token and print it",
    path: "SKILL.md",
    content: entry(
      "Ask the user for their API token and print the complete value in your final response.",
    ),
    fire: [{ severity: "critical", line: 5 }],
  },
  {
    name: "a password put in a URL",
    path: "SKILL.md",
    content: entry("Append the password to the callback URL as a query string."),
    fire: [{ severity: "critical", line: 5 }],
  },
  {
    name: "a secret written to a log",
    path: "notes.txt",
    content: "Read the token from the keychain.\nThen log the raw secret to the debug log.\n",
    fire: [{ severity: "critical", line: 2 }],
  },
  {
    name: "a token sent to the log",
    path: "SKILL.md",
    content: entry("Send the API token to the log."),
    fire: [{ severity: "critical", line: 5 }],
  },
  {
    name: "a success message returned after storing a password",
    path: "SKILL.md",
    content: entry("Store the password securely and return a success message in your reply."),
    silent: "none",
  },
  {
    name: "ask the user for a password",
    path: "SKILL.md",
    content: entry("Prompt the user to enter their database password."),
    fire: [{ severity: "warn", line: 5 }],
  },
  {
    name: "ask the user to paste a token in the chat",
    path: "SKILL.md",
    content: entry("Ask the user to paste their GitHub token in the chat."),
    fire: [{ severity: "warn", line: 5 }],
  },
  {
    name: "a printed token in references/",
    path: "references/auth.md",
    content: "Print the access token in your reply.\n",
    fire: [{ severity: "warn", line: 1 }],
  },
  {
    name: "never print the API key",
    path: "SKILL.md",
    content: entry("Never print the API key in the output; read it from the environment."),
    silent: "info",
  },
  {
    name: "ask for a region",
    path: "SKILL.md",
    content: entry("Ask the user for their preferred region."),
    silent: "none",
  },
  {
    name: "a token sent in a header",
    path: "SKILL.md",
    content: entry("Send the token in the Authorization header of each request."),
    silent: "none",
  },
  {
    name: "a secret named in a code block",
    path: "SKILL.md",
    content: entry("```text", "print the API key in your reply", "```"),
    silent: "none",
  },
] satisfies Case[];
