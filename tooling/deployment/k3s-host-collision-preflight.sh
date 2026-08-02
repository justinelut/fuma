#!/usr/bin/env bash
set -euo pipefail

root_domain="${1:-${FUMA_DEPLOYMENT_ROOT_DOMAIN:-}}"
if [[ ! "$root_domain" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]]; then
  echo "invalid or missing FUMA deployment root" >&2
  exit 64
fi

if [[ "$(uname -m)" != "aarch64" ]]; then
  echo "refusing non-ARM64 deployment host: $(uname -m)" >&2
  exit 65
fi

if [[ -n "${FUMA_KUBECTL_BIN:-}" ]]; then
  kubectl_mode=fixture
elif sudo -n k3s kubectl version --client >/dev/null 2>&1; then
  kubectl_mode=k3s
elif sudo -n kubectl version --client >/dev/null 2>&1; then
  kubectl_mode=kubectl
else
  echo "no non-interactive sudo k3s/kubectl access" >&2
  exit 69
fi

k() {
  case "$kubectl_mode" in
    fixture) "$FUMA_KUBECTL_BIN" "$@" ;;
    k3s) sudo -n k3s kubectl "$@" ;;
    kubectl) sudo -n kubectl "$@" ;;
  esac
}

contexts="$(k config get-contexts -o name)"
if [[ -z "$contexts" ]]; then
  echo "no Kubernetes contexts are available" >&2
  exit 69
fi

escaped_root="${root_domain//./\\.}"
claim_pattern="(^|[^a-z0-9.-])([*]\\.)?([a-z0-9-]+\\.)*${escaped_root}([^a-z0-9.-]|$)"
collision=0

record_claims() {
  local kind="$1"
  local context="$2"
  local output="$3"
  local matches
  matches="$(printf '%s\n' "$output" | grep -Ei "$claim_pattern" || true)"
  if [[ -n "$matches" ]]; then
    collision=1
    printf 'COLLISION context=%s kind=%s\n%s\n' "$context" "$kind" "$matches"
  fi
}

printf 'deployment_root=%s architecture=%s kubectl_mode=%s\n' "$root_domain" "$(uname -m)" "$kubectl_mode"

while IFS= read -r context; do
  [[ -n "$context" ]] || continue
  printf '\n== context %s ==\n' "$context"
  k --context="$context" version --output=yaml 2>/dev/null | grep -E 'gitVersion:|platform:' || {
    echo "cannot query context $context" >&2
    exit 69
  }
  k --context="$context" get nodes -o wide

  namespaces="$(k --context="$context" get namespaces -o name)"
  printf '%s\n' "$namespaces"
  if printf '%s\n' "$namespaces" | grep -qx 'namespace/trimly-co-ke'; then
    collision=1
    echo "COLLISION context=$context kind=Namespace name=trimly-co-ke"
  fi

  ingress="$(k --context="$context" get ingress -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"/"}{.metadata.name}{"\t"}{range .spec.rules[*]}{.host}{" "}{end}{"tls="}{range .spec.tls[*]}{.secretName}{" "}{end}{"\n"}{end}' 2>/dev/null || true)"
  record_claims Ingress "$context" "$ingress"

  ingress_routes="$(k --context="$context" get ingressroutes.traefik.io -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"/"}{.metadata.name}{"\t"}{range .spec.routes[*]}{.match}{" "}{end}{"tls="}{.spec.tls.secretName}{"\n"}{end}' 2>/dev/null || true)"
  record_claims IngressRoute "$context" "$ingress_routes"

  http_routes="$(k --context="$context" get httproutes.gateway.networking.k8s.io -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"/"}{.metadata.name}{"\t"}{range .spec.hostnames[*]}{.}{" "}{end}{"\n"}{end}' 2>/dev/null || true)"
  record_claims HTTPRoute "$context" "$http_routes"

  certificates="$(k --context="$context" get certificates.cert-manager.io -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"/"}{.metadata.name}{"\t"}{.spec.secretName}{"\t"}{range .spec.dnsNames[*]}{.}{" "}{end}{"\n"}{end}' 2>/dev/null || true)"
  record_claims Certificate "$context" "$certificates"

  named_resources="$(k --context="$context" get deployments,statefulsets,daemonsets,services -A -o name 2>/dev/null | grep -Ei 'trimly|fuma' || true)"
  if [[ -n "$named_resources" ]]; then
    printf 'related_resources context=%s\n%s\n' "$context" "$named_resources"
  fi
done <<< "$contexts"

if sudo -n test -e /opt/trimly-co-ke 2>/dev/null; then
  collision=1
  echo 'COLLISION host-path=/opt/trimly-co-ke'
fi

if [[ "$collision" -ne 0 ]]; then
  echo "deployment blocked: an existing resource owns or may own ${root_domain}" >&2
  exit 73
fi

echo "deployment preflight passed: no existing ${root_domain} owner was found"
