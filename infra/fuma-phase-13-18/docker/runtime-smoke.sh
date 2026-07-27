#!/bin/sh
set -eu
umask 077

if [ "$#" -ne 7 ]; then
  echo "usage: runtime-smoke.sh <runtime-image> <compatibility-image> <linux/arch> <source-sha> <lock-sha256> <migration-high-water> <output.json>" >&2
  exit 64
fi

runtime_image=$1
compatibility_image=$2
platform=$3
source_sha=$4
lock_hash_sha256=$5
migration_high_water=$6
output=$7
printf '%s' "$source_sha" | grep -Eq '^[a-f0-9]{40}([a-f0-9]{24})?$' || { echo "source SHA must be 40 or 64 lowercase hex characters" >&2; exit 64; }
printf '%s' "$lock_hash_sha256" | grep -Eq '^[a-f0-9]{64}$' && ! printf '%s' "$lock_hash_sha256" | grep -Eq '^0{64}$' || { echo "lock hash must be a non-placeholder SHA-256" >&2; exit 64; }
printf '%s' "$migration_high_water" | grep -Eq '^000[0-9]{3}_[a-z0-9_]+$' || { echo "invalid migration high-water mark" >&2; exit 64; }
[ ! -e "$output" ] || { echo "refusing to overwrite smoke evidence: $output" >&2; exit 73; }
case "$platform" in
  linux/amd64) expected_arch=x64 ;;
  linux/arm64) expected_arch=arm64 ;;
  *) echo "unsupported platform: $platform" >&2; exit 64 ;;
esac

assert_image_identity() {
  inspected_image=$1
  expected_user=$2
  label=$3
  inspect=$(docker image inspect "$inspected_image")
  actual_source=$(printf '%s' "$inspect" | jq -r '.[0].Config.Labels["org.opencontainers.image.revision"]')
  actual_lock=$(printf '%s' "$inspect" | jq -r '.[0].Config.Labels["ke.co.fuma.lock-hash-sha256"]')
  actual_migration=$(printf '%s' "$inspect" | jq -r '.[0].Config.Labels["ke.co.fuma.migration-high-water"]')
  actual_user=$(printf '%s' "$inspect" | jq -r '.[0].Config.User')
  actual_arch=$(printf '%s' "$inspect" | jq -r '.[0].Architecture')
  [ "$actual_source" = "$source_sha" ] || { echo "$label source label mismatch" >&2; exit 1; }
  [ "$actual_lock" = "$lock_hash_sha256" ] || { echo "$label lock label mismatch" >&2; exit 1; }
  [ "$actual_migration" = "$migration_high_water" ] || { echo "$label migration label mismatch" >&2; exit 1; }
  [ "$actual_user" = "$expected_user" ] || { echo "$label image must run as $expected_user" >&2; exit 1; }
  case "$platform:$actual_arch" in
    linux/amd64:amd64|linux/arm64:arm64) ;;
    *) echo "$label image architecture mismatch: $actual_arch" >&2; exit 1 ;;
  esac
}

assert_image_identity "$runtime_image" bun runtime
assert_image_identity "$compatibility_image" bun compatibility

role_results='[]'
for pair in web:3101 worker:3102 scheduler:3103; do
  role=${pair%:*}
  port=${pair#*:}
  name="fuma-078-${role}-$$"
  container_id=''
  cleanup() { [ -z "$container_id" ] || docker rm -f "$container_id" >/dev/null 2>&1 || true; }
  trap cleanup EXIT INT TERM
  container_id=$(docker run --detach --name "$name" --platform "$platform" \
    --env NODE_ENV=development --env FUMA_ENV=local --env FUMA_HEALTH_PORT="$port" \
    "$runtime_image" "$role")
  ready=''
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    ready=$(docker exec "$container_id" bun -e "const r=await fetch('http://127.0.0.1:${port}/readyz'); const t=await r.text(); console.log(t); if(!r.ok)process.exit(1)" 2>/dev/null || true)
    if printf '%s' "$ready" | jq -e --arg role "$role" '.role == $role and .state == "ready"' >/dev/null 2>&1; then break; fi
    attempt=$((attempt + 1))
    sleep 1
  done
  printf '%s' "$ready" | jq -e --arg role "$role" '.role == $role and .state == "ready"' >/dev/null
  logs=$(docker logs --tail 200 "$container_id" 2>&1)
  docker stop --time 10 "$container_id" >/dev/null
  exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$container_id")
  [ "$exit_code" = 0 ] || { printf '%s\n' "$logs" >&2; exit 1; }
  docker rm "$container_id" >/dev/null
  container_id=''
  trap - EXIT INT TERM
  role_results=$(printf '%s' "$role_results" | jq --arg role "$role" --argjson health "$ready" --arg logsSha "$(printf '%s' "$logs" | sha256sum | cut -d' ' -f1)" '. + [{role:$role,health:$health,logsSha256:$logsSha}]')
done

migration=$(docker run --rm --platform "$platform" "$runtime_image" migration --next=release_smoke)
printf '%s' "$migration" | grep -Eq '^000[0-9]{3}_release_smoke$'
email=$(docker run --rm --platform "$platform" \
  --env FUMA_EMAIL_EXPECT_PLATFORM=linux --env FUMA_EMAIL_EXPECT_ARCH="$expected_arch" \
  "$compatibility_image" email-compatibility)
printf '%s' "$email" | jq -e --arg arch "$expected_arch" '.passed == true and .arch == $arch' >/dev/null

mkdir -p "$(dirname "$output")"
tmp_output=$(mktemp "${output}.tmp.XXXXXX")
trap 'rm -f "$tmp_output"' EXIT INT TERM
jq -n --arg sourceSha "$source_sha" --arg lockHashSha256 "$lock_hash_sha256" \
  --arg migrationHighWaterMark "$migration_high_water" --arg platform "$platform" \
  --arg image "$runtime_image" --arg migration "$migration" \
  --argjson roles "$role_results" --argjson email "$email" \
  '{schemaVersion:1,sourceSha:$sourceSha,lockHashSha256:$lockHashSha256,migrationHighWaterMark:$migrationHighWaterMark,platform:$platform,image:$image,nonRoot:true,roles:$roles,migrationCommand:$migration,emailRenderer:$email}' > "$tmp_output"
ln "$tmp_output" "$output"
rm -f "$tmp_output"
trap - EXIT INT TERM
