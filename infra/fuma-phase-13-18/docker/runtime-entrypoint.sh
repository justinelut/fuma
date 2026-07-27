#!/bin/sh
set -eu

command_name="${1:-web}"
if [ "$#" -gt 0 ]; then
  shift
fi

case "$command_name" in
  web|worker|scheduler)
    export FUMA_ROLE="$command_name"
    exec bun --cwd=apps/studio run "fuma:$command_name" "$@"
    ;;
  migration)
    exec bun --cwd=apps/studio run fuma:migrate "$@"
    ;;
  email-compatibility)
    exec bun apps/studio/server/fuma/email/compatibility/architectureProbe.ts "$@"
    ;;
  *)
    echo "unsupported Fuma runtime command: $command_name" >&2
    exit 64
    ;;
esac
