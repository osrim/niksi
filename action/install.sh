#!/usr/bin/env bash
set -euo pipefail

args=(install --project --yes)
if [ -n "${INPUT_AGENT:-}" ]; then args+=(--agent "$INPUT_AGENT"); fi

status=0
nik "${args[@]}" || status=$?
if [ "$status" -ne 0 ]; then
  echo "::error::nik install exited $status. See https://github.com/osrim/niksi/blob/main/docs/ci.md#exit-codes"
fi
exit "$status"
