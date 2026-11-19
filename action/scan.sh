#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$INPUT_PATH" && pwd)

badge() {
  local workflow="${GITHUB_WORKFLOW_REF#"$GITHUB_REPOSITORY/.github/workflows/"}"
  workflow="${workflow%%@*}"
  echo "[![niksi scan]($GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/workflows/$workflow/badge.svg)](https://github.com/osrim/niksi)"
}

status=0
stop_marker=$(od -An -N16 -tx1 /dev/urandom | tr -d '[:space:]')
{
  # Keep the scan log and the workflow markers on the same stream.
  printf '::stop-commands::%s\n' "$stop_marker"
  stats=$(nik __scan-source "$source_dir" 2>&3) || status=$?
  printf '::%s::\n' "$stop_marker"
} 3>&1
case "$status" in
  0) ;;
  2)
    echo "::error::Scan mode needs niksi 0.5.0 or later. Update the action and any version override."
    exit 1
    ;;
  *) exit "$status" ;;
esac
counts=$(jq -r '[.skills, .critical, .warn, .info] | @tsv' <<< "$stats")
IFS=$'\t' read -r skills critical warn info <<< "$counts"
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

if [ "$critical" -gt 0 ]; then
  echo "::error::$critical critical finding(s). See https://github.com/osrim/niksi/blob/main/docs/ci.md#exit-codes"
  exit 3
fi
