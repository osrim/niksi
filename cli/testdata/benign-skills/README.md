# Benign skill corpus

Published skills, vendored as test data for `cli/src/core/scan/fixtures.test.ts`. The scan must report no `critical` finding on any of them. The test counts and prints `warn` and `info` findings. Tests read these files offline; nothing fetches them.

| directory | source | commit | license |
| --- | --- | --- | --- |
| `superpowers/` | [obra/superpowers](https://github.com/obra/superpowers) `skills/` | `8ca22dba9a94f28898bbce59f2537ff4d87c747d` | MIT, in `superpowers/LICENSE` |
| `anthropic-skills/` | [anthropics/skills](https://github.com/anthropics/skills) `skills/` | `33375500bcea98d610eb30ce10ac4e59b89c390d` | Apache-2.0, in each skill's `LICENSE.txt` |

`anthropic-skills/` holds the Apache-2.0 skills only. It leaves out `docx`, `pdf`, `pptx` and `xlsx`, which are all rights reserved, and `doc-coauthoring`, which has no license file. It also leaves out `canvas-design` and `claude-api` for size.

The files are unchanged copies. To move a source to a newer commit, replace its directory, update the commit above, and update the skill count in the test.
