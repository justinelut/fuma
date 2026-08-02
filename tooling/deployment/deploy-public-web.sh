#!/usr/bin/env bash
set -euo pipefail

manifest="${1:-}"
expected_image="${2:-}"
source_sha="${3:-}"
[[ -f "$manifest" ]] || { echo 'rendered manifest is missing' >&2; exit 64; }
[[ "$expected_image" =~ ^ghcr\.io/[a-z0-9/-]+@sha256:[a-f0-9]{64}$ ]] || { echo 'immutable image is invalid' >&2; exit 64; }
[[ "$source_sha" =~ ^[a-f0-9]{40}$ ]] || { echo 'source SHA is invalid' >&2; exit 64; }
[[ "$(uname -m)" == aarch64 ]] || { echo 'deployment host is not ARM64' >&2; exit 65; }

if sudo -n k3s kubectl version --client >/dev/null 2>&1; then
  kubectl_mode=k3s
elif sudo -n kubectl version --client >/dev/null 2>&1; then
  kubectl_mode=kubectl
else
  echo 'no non-interactive kubectl authority' >&2
  exit 69
fi
k() {
  if [[ "$kubectl_mode" == k3s ]]; then sudo -n k3s kubectl "$@"; else sudo -n kubectl "$@"; fi
}

previous_image="$(k -n fuma get deployment public-web -o jsonpath='{.spec.template.spec.containers[?(@.name=="web")].image}' 2>/dev/null || true)"
created_new=0
[[ -n "$previous_image" ]] || created_new=1

failure_diagnostics() {
  local rc=$?
  trap - ERR
  echo "public Web rollout failed with exit ${rc}" >&2
  k -n fuma get deployment,replicaset,pod,service,ingressroute -o wide 2>&1 || true
  k -n fuma get events --sort-by=.lastTimestamp 2>&1 | tail -40 || true
  k -n fuma describe deployment public-web 2>&1 | tail -120 || true
  k -n fuma logs deployment/public-web --all-containers=true --tail=200 2>&1 || true
  k -n fuma logs deployment/public-web --all-containers=true --previous --tail=200 2>&1 || true
  if [[ -n "$previous_image" ]]; then
    echo "rolling back to ${previous_image}" >&2
    k -n fuma set image deployment/public-web "web=${previous_image}" || true
    k -n fuma rollout status deployment/public-web --timeout=5m || true
  elif [[ "$created_new" -eq 1 ]]; then
    echo 'removing failed new public route and deployment' >&2
    k -n fuma delete ingressroute public-web --ignore-not-found || true
    k -n fuma delete deployment public-web --ignore-not-found || true
  fi
  exit "$rc"
}
trap failure_diagnostics ERR

k apply --dry-run=server -f "$manifest" >/dev/null
k apply -f "$manifest"

k -n fuma rollout status deployment/public-web --timeout=8m &
rollout_pid=$!
while kill -0 "$rollout_pid" 2>/dev/null; do
  sleep 10
  echo "---- $(date -u +%Y-%m-%dT%H:%M:%SZ) public Web rollout ----"
  k -n fuma get pods -l app=public-web -o wide || true
  newest="$(k -n fuma get pods -l app=public-web --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}' 2>/dev/null || true)"
  if [[ -n "$newest" ]]; then k -n fuma logs "$newest" --tail=30 2>/dev/null || true; fi
done
wait "$rollout_pid"

current_image="$(k -n fuma get deployment public-web -o jsonpath='{.spec.template.spec.containers[?(@.name=="web")].image}')"
ready="$(k -n fuma get deployment public-web -o jsonpath='{.status.readyReplicas}')"
[[ "$current_image" == "$expected_image" ]]
[[ "$ready" == '2' ]]
k -n fuma get deployment,pod,service,ingressroute -o wide
rm -f "$manifest"
trap - ERR
printf 'deployment=public-web source_sha=%s image=%s previous_image=%s ready_replicas=%s\n' \
  "$source_sha" "$current_image" "${previous_image:-none}" "$ready"
