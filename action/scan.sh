#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$INPUT_PATH" && pwd)
project="$RUNNER_TEMP/niksi-scan"
audit="$RUNNER_TEMP/niksi-audit.json"

count() {
  jq "[.skills[].findings[] | select(.severity == \"$1\")] | length" "$audit"
}

badge() {
  local workflow="${GITHUB_WORKFLOW_REF#"$GITHUB_REPOSITORY/.github/workflows/"}"
  workflow="${workflow%%@*}"
  echo "[![niksi scan]($GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/workflows/$workflow/badge.svg)](https://github.com/osrim/niksi)"
}

rm -rf "$project"
mkdir -p "$project"
git init -q "$project"
cd "$project"

# The copies land in a temporary project, so skipping critical approval only lets
# audit count every finding. The add records those findings as accepted, so audit
# exits 1 for them, and the step fails on the critical count instead.
nik add "$source_dir" --all --project --yes --copy --path skills --dangerous-skip-critical-approval
status=0
nik audit --project --json > "$audit" || status=$?
case "$status" in
  0 | 1 | 3) ;;
  *)
    echo "::error::nik audit exited $status. See https://github.com/osrim/niksi/blob/main/docs/ci.md#exit-codes"
    exit "$status"
    ;;
esac

recorded=$(jq '.skills | length' niksi-lock.json)
skills=$(jq '.skills | length' "$audit")
critical=$(count critical)
warn=$(count warn)
info=$(count info)
noun=skills
if [ "$skills" -eq 1 ]; then noun=skill; fi
line="Scanned $skills $noun: $critical critical, $warn warn, $info info findings."
echo "$line"
echo "badge=$(badge)" >> "$GITHUB_OUTPUT"
{
  echo "## nik scan"
  echo
  echo "$line"
  echo
  echo "Add this badge to your README:"
  echo
  echo '```markdown'
  badge
  echo '```'
} >> "$GITHUB_STEP_SUMMARY"

# Audit exits 1 for a warn or accepted finding, or for a skill it cannot read, which it
# leaves out of the JSON.
if [ "$status" -eq 1 ] && [ "$skills" -eq "$recorded" ]; then status=0; fi
if [ "$critical" -gt 0 ]; then
  status=3
  echo "::error::$critical critical finding(s). See https://github.com/osrim/niksi/blob/main/docs/ci.md#exit-codes"
elif [ "$status" -ne 0 ]; then
  echo "::error::nik audit exited $status. See https://github.com/osrim/niksi/blob/main/docs/ci.md#exit-codes"
fi
exit "$status"
