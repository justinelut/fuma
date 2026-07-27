#!/bin/sh
set -eu
umask 077

if [ "$#" -ne 6 ]; then
  echo "usage: public-web-smoke.sh <image> <linux/arch> <source-sha> <lock-sha256> <migration-high-water> <output.json>" >&2
  exit 64
fi

image=$1
platform=$2
source_sha=$3
lock_hash_sha256=$4
migration_high_water=$5
output=$6
printf '%s' "$source_sha" | grep -Eq '^[a-f0-9]{40}([a-f0-9]{24})?$' || { echo "source SHA must be 40 or 64 lowercase hex characters" >&2; exit 64; }
printf '%s' "$lock_hash_sha256" | grep -Eq '^[a-f0-9]{64}$' && ! printf '%s' "$lock_hash_sha256" | grep -Eq '^0{64}$' || { echo "lock hash must be a non-placeholder SHA-256" >&2; exit 64; }
printf '%s' "$migration_high_water" | grep -Eq '^000[0-9]{3}_[a-z0-9_]+$' || { echo "invalid migration high-water mark" >&2; exit 64; }
[ ! -e "$output" ] || { echo "refusing to overwrite smoke evidence: $output" >&2; exit 73; }
case "$platform" in
  linux/amd64|linux/arm64) ;;
  *) echo "unsupported platform: $platform" >&2; exit 64 ;;
esac
inspect=$(docker image inspect "$image")
actual_source=$(printf '%s' "$inspect" | jq -r '.[0].Config.Labels["org.opencontainers.image.revision"]')
actual_lock=$(printf '%s' "$inspect" | jq -r '.[0].Config.Labels["ke.co.fuma.lock-hash-sha256"]')
actual_migration=$(printf '%s' "$inspect" | jq -r '.[0].Config.Labels["ke.co.fuma.migration-high-water"]')
actual_user=$(printf '%s' "$inspect" | jq -r '.[0].Config.User')
actual_arch=$(printf '%s' "$inspect" | jq -r '.[0].Architecture')
[ "$actual_source" = "$source_sha" ] || { echo "public-web source label mismatch" >&2; exit 1; }
[ "$actual_lock" = "$lock_hash_sha256" ] || { echo "public-web lock label mismatch" >&2; exit 1; }
[ "$actual_migration" = "$migration_high_water" ] || { echo "public-web migration label mismatch" >&2; exit 1; }
[ "$actual_user" = "10001:10001" ] || { echo "public-web image must run as 10001:10001" >&2; exit 1; }
case "$platform:$actual_arch" in
  linux/amd64:amd64|linux/arm64:arm64) ;;
  *) echo "public-web image architecture mismatch: $actual_arch" >&2; exit 1 ;;
esac

name="fuma-078-public-web-$$"
container_id=''
cleanup() { [ -z "$container_id" ] || docker rm -f "$container_id" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
container_id=$(docker run --detach --name "$name" --platform "$platform" "$image")
response=''
attempt=0
while [ "$attempt" -lt 60 ]; do
  response=$(docker exec "$container_id" node -e "const h=require('node:http'),c=require('node:crypto');const q=h.get({hostname:'127.0.0.1',port:3002,path:'/',headers:{host:'fuma.co.ke'}},r=>{const b=[];r.on('data',v=>b.push(v));r.on('end',()=>{const x=Buffer.concat(b);console.log(JSON.stringify({status:r.statusCode,bytes:x.length,bodySha256:c.createHash('sha256').update(x).digest('hex')}));if(r.statusCode!==200)process.exit(1)})});q.on('error',()=>process.exit(1))" 2>/dev/null || true)
  if printf '%s' "$response" | jq -e '.status == 200 and .bytes > 0' >/dev/null 2>&1; then break; fi
  attempt=$((attempt + 1))
  sleep 1
done
printf '%s' "$response" | jq -e '.status == 200 and .bytes > 0' >/dev/null
logs=$(docker logs --tail 200 "$container_id" 2>&1)
docker stop --time 10 "$container_id" >/dev/null
exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$container_id")
case "$exit_code" in
  0|143) ;;
  *) printf '%s\n' "$logs" >&2; exit 1 ;;
esac
docker rm "$container_id" >/dev/null
container_id=''
trap - EXIT INT TERM

mkdir -p "$(dirname "$output")"
tmp_output=$(mktemp "${output}.tmp.XXXXXX")
trap 'rm -f "$tmp_output"' EXIT INT TERM
jq -n --arg sourceSha "$source_sha" --arg lockHashSha256 "$lock_hash_sha256" \
  --arg migrationHighWaterMark "$migration_high_water" --arg platform "$platform" --arg image "$image" \
  --arg logsSha "$(printf '%s' "$logs" | sha256sum | cut -d' ' -f1)" --argjson response "$response" \
  '{schemaVersion:1,sourceSha:$sourceSha,lockHashSha256:$lockHashSha256,migrationHighWaterMark:$migrationHighWaterMark,platform:$platform,image:$image,nonRoot:true,response:$response,logsSha256:$logsSha,acceptanceScope:"container-http-liveness-not-browser-or-public-host"}' > "$tmp_output"
ln "$tmp_output" "$output"
rm -f "$tmp_output"
trap - EXIT INT TERM
