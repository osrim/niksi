#!/usr/bin/env bash
set -euo pipefail

report="$RUNNER_TEMP/niksi-update-report.md"
body="$RUNNER_TEMP/niksi-pull-request.md"
bot_name="github-actions[bot]"
bot_email="41898282+github-actions[bot]@users.noreply.github.com"

check_ref() {
  if [ "$INPUT_PULL_REQUEST" = true ] && [[ "${GITHUB_REF:-}" != refs/heads/* ]]; then
    echo "::error::Update mode opens a pull request only from a branch, and this run is on ${GITHUB_REF:-no ref}. Set pull-request to false to write only the report."
    exit 2
  fi
}

# actions/checkout leaves GITHUB_TOKEN in the Git config. Replace it with the token input.
use_token() {
  if [ -z "${INPUT_TOKEN:-}" ]; then return; fi
  export GH_TOKEN="$INPUT_TOKEN"
  local basic
  basic=$(printf 'x-access-token:%s' "$INPUT_TOKEN" | base64 | tr -d '\n')
  echo "::add-mask::$basic"
  export GIT_CONFIG_COUNT=2
  export GIT_CONFIG_KEY_0="http.$GITHUB_SERVER_URL/.extraheader" GIT_CONFIG_VALUE_0=""
  export GIT_CONFIG_KEY_1="http.$GITHUB_SERVER_URL/.extraheader" GIT_CONFIG_VALUE_1="AUTHORIZATION: basic $basic"
}

write_body() {
  {
    echo "\`nik update\` found skill updates. Read its review before you merge."
    echo
    if [ "${INPUT_DEFAULT_TOKEN:-}" = true ]; then
      echo "GitHub starts no workflows for a pull request that \`GITHUB_TOKEN\` opens. To run checks, close and reopen this pull request."
      echo
    fi
    if [ "$(wc -c < "$report")" -gt 60000 ]; then
      echo "The review is too long for a pull request body. Read it in the job summary: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
    else
      cat "$report"
    fi
  } > "$body"
}

push_branch() {
  if git fetch -q origin "refs/heads/$INPUT_BRANCH" 2> /dev/null \
    && [ "$(git rev-parse 'FETCH_HEAD^{tree}')" = "$(git rev-parse 'HEAD^{tree}')" ]; then
    echo "$INPUT_BRANCH already has these changes."
    return
  fi
  git push -q --force origin "HEAD:refs/heads/$INPUT_BRANCH"
}

open_pull_request() {
  local base="${GITHUB_REF#refs/heads/}" open number url
  open=$(gh pr list --head "$INPUT_BRANCH" --base "$base" --state open --json number,url \
    --jq '.[0] | select(.) | "\(.number) \(.url)"')
  number="${open%% *}"
  url="${open#* }"

  git add -A
  if git diff --cached --quiet; then
    echo "Nothing to update."
    if [ -n "$open" ]; then
      gh pr close "$number" --delete-branch --comment "\`nik update\` found nothing to update, so this pull request is no longer needed."
    fi
    return
  fi

  git switch -q -C "$INPUT_BRANCH"
  git -c user.name="$bot_name" -c user.email="$bot_email" commit -q -m "$INPUT_TITLE"
  push_branch
  write_body
  if [ -n "$open" ]; then
    gh pr edit "$number" --title "$INPUT_TITLE" --body-file "$body" > /dev/null
  else
    url=$(gh pr create --head "$INPUT_BRANCH" --base "$base" --title "$INPUT_TITLE" --body-file "$body")
  fi
  echo "pull-request-url=$url" >> "$GITHUB_OUTPUT"
}

check_ref

args=(update --project --yes --report "$report")
if [ -n "${INPUT_SOURCE:-}" ]; then args+=(--source "$INPUT_SOURCE"); else args+=(--all); fi
status=0
nik "${args[@]}" || status=$?
if [ -f "$report" ]; then
  cat "$report" >> "$GITHUB_STEP_SUMMARY"
  echo "report=$report" >> "$GITHUB_OUTPUT"
fi

case "$status" in
  0) ;;
  3) echo "::error::Critical findings blocked a skill, and only a person can approve them. Run nik update <skill> in a terminal, review the findings, and commit niksi-lock.json." ;;
  *)
    echo "::error::nik update exited $status. See https://github.com/osrim/niksi/blob/main/docs/ci.md#exit-codes"
    exit "$status"
    ;;
esac
if [ "$INPUT_PULL_REQUEST" = true ]; then
  use_token
  open_pull_request
fi
exit "$status"
