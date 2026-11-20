#!/usr/bin/env bash
# Stage and promote one tested revision on the existing cloud.ipollo.net Compose installation.
set -euo pipefail
umask 077
action=${1:?stage, cutover or inspect}
revision=${2:?exact Git revision}
release=${3:?release directory}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
[[ "$release" =~ ^/opt/ipollowork/releases/[a-zA-Z0-9._-]+$ ]]
work=ipollowork-work-1
pg=ipollowork-postgres-1
version=$(git -C "$release/source.git" show "$revision:services/ipollowork/package.json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["version"])')
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
tag=ipollowork-work:$version-${revision:0:10}
mkdir -p "$release"
exec 9>/var/lock/ipollowork-work-rollout.lock
flock -n 9
live=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$work")
[[ "$live" == /opt/ipollowork/releases/* ]]
cd "$live"
schema() { docker exec "$pg" sh -ec 'exec psql -XqAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT max(version) FROM service_schema"'; }
http() { curl --noproxy '*' --resolve cloud.ipollo.net:443:127.0.0.1 --max-time 5 "$@"; }
ready() {
  for _ in $(seq 1 25); do
    if curl -fsS --max-time 2 http://127.0.0.1:4785/api/health >/dev/null 2>&1 && http -fsS https://cloud.ipollo.net/api/health >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}
compose=(docker compose -p ipollowork)
IFS=, read -r -a files <<< "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$work")"
for file in "${files[@]}"; do [[ "$file" == /opt/ipollowork/releases/* ]]; test -f "$file"; compose+=(-f "$file"); done
assert_changes() {
  "${compose[@]}" -f "$release/release.compose.yml" config --format json | python3 -c '
import copy,json,sys
before=json.load(open(sys.argv[1])); after=json.load(sys.stdin)
old=before["services"]["work"]; new=after["services"]["work"]
assert new["image"]==sys.argv[2]
assert old.get("environment",{}).get("NODE_OPTIONS","") in ("","--max-old-space-size=1024"), "Existing Node flags need review"
assert old.get("logging",{}).get("driver","json-file")=="json-file", "Existing logging needs review"
assert int(new["mem_limit"])==2147483648 and new["pids_limit"]==256
assert new["stop_grace_period"]=="40s"
assert new["environment"]["NODE_OPTIONS"]=="--max-old-space-size=1024"
assert new["logging"]=={"driver":"json-file","options":{"max-size":"10m","max-file":"3"}}
for key in ("image","mem_limit","pids_limit","stop_grace_period","logging"):
    if key in old: new[key]=copy.deepcopy(old[key])
    else: new.pop(key,None)
if "NODE_OPTIONS" in old.get("environment",{}): new["environment"]["NODE_OPTIONS"]=old["environment"]["NODE_OPTIONS"]
else: new["environment"].pop("NODE_OPTIONS",None)
assert before==after, "Unreviewed Compose change"
' <("${compose[@]}" config --format json) "$tag"
}
case "$action" in
  inspect)
    docker inspect -f 'image={{.Config.Image}} running={{.State.Running}} restarts={{.RestartCount}}' "$work"
    docker image inspect -f 'revision={{index .Config.Labels "org.opencontainers.image.revision"}}' "$(docker inspect -f '{{.Image}}' "$work")"
    printf 'schema=%s\n' "$(schema)"
    http -fsS https://cloud.ipollo.net/api/health
    ;;
  stage)
    [[ "$(schema)" =~ ^(19|20)$ ]]
    schema > "$release/previous-schema"
    ready
    test ! -e "$release/candidate-id"
    current=$(docker inspect -f '{{.Image}}' "$work")
    if test -n "${EXPECTED_PREVIOUS_REVISION:-}"; then test "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$current")" = "$EXPECTED_PREVIOUS_REVISION"; fi
    docker inspect -f '{{.Config.Image}}' "$work" > "$release/previous-tag"
    printf '%s\n' "$current" > "$release/previous-id"
    test "$(git -C "$release/source.git" rev-parse FETCH_HEAD)" = "$revision"
    mkdir -p "$release/context"
    git -C "$release/source.git" archive "$revision" services/ipollowork | tar -x -C "$release/context"
    base=$(cat "$release/previous-tag")
    [[ "$base" =~ ^ipollowork-work:[a-zA-Z0-9._-]+$ ]]
    node_image=${ROLLOUT_NODE_IMAGE:-node:24.22.3-bookworm-slim}
    [[ "$node_image" =~ ^[a-zA-Z0-9./:_@-]+$ ]]
    docker run --rm --network=none --entrypoint node "$node_image" -e 'if(process.versions.node!=="24.22.3")process.exit(1)'
    docker build --pull=false --target runtime --build-arg "NODE_IMAGE=$node_image" --label "org.opencontainers.image.revision=$revision" --label "org.opencontainers.image.version=$version" -t "$tag" "$release/context/services/ipollowork" > "$release/build.log" 2>&1 || { tail -n 25 "$release/build.log"; exit 1; }
    docker run --rm --network=none --entrypoint node "$tag" --input-type=module -e 'import assert from "node:assert/strict";import{readFileSync,existsSync}from"node:fs";await import("/app/dist/server/app.js");await import("/app/dist/server/http-server.js");assert.match(readFileSync("/app/dist/server/organization-publications.js","utf8"),/organization-templates/);assert.match(readFileSync("/app/dist/server/admission.js","utf8"),/SERVICE_QUEUE_TIMEOUT/);assert.equal(JSON.parse(readFileSync("/app/package.json")).version,process.argv[1]);for(const name of ["admin","migrate","backup"])assert.ok(existsSync("/app/dist/server/cli/"+name+".js"));assert.ok(existsSync("/app/dist/server/migration-pg-020.sql"));console.log("Candidate imports, compiled operations, migration and version verified")' "$version"
    cat > "$release/release.compose.yml" <<EOF
services:
  work:
    image: $tag
    mem_limit: 2g
    pids_limit: 256
    stop_grace_period: 40s
    environment:
      NODE_OPTIONS: --max-old-space-size=1024
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"
EOF
    printf 'services:\n  work:\n    image: %s\n' "$base" > "$release/rollback.compose.yml"
    assert_changes
    docker image inspect -f '{{.Id}}' "$tag" > "$release/candidate-id"
    printf 'Candidate staged: %s\n' "$revision"
    ;;
  cutover)
    test "$(schema)" = "$(cat "$release/previous-schema")"
    ready
    test "$(docker inspect -f '{{.Image}}' "$work")" = "$(cat "$release/previous-id")"
    test "$(docker image inspect -f '{{.Id}}' "$tag")" = "$(cat "$release/candidate-id")"
    assert_changes
    backup="$release/backup-$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -m 700 "$backup"
    docker exec "$pg" sh -ec 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup/production.pgdump"
    docker exec -i "$pg" pg_restore -l < "$backup/production.pgdump" > "$backup/production.list"
    grep -q 'TABLE DATA.*service_schema' "$backup/production.list"
    docker cp "$work:/data/auth.secret" "$backup/auth.secret"
    chmod 600 "$backup/auth.secret"
    test -s "$backup/auth.secret"
    if test -f "$live/.env"; then cp -- "$live/.env" "$backup/service.env"; chmod 600 "$backup/service.env"; fi
    printf 'Database, authentication secret and configuration backup verified\n'
    if "${compose[@]}" -f "$release/release.compose.yml" up -d --no-deps --no-build --pull never work && ready &&
       test "$(schema)" = 20 && test "$(docker inspect -f '{{.Image}}' "$work")" = "$(cat "$release/candidate-id")" &&
       http -fsS https://cloud.ipollo.net/api/ready >/dev/null &&
       test "$(http -sS -o /dev/null -w '%{http_code}' https://cloud.ipollo.net/api/v1/me/organization-templates)" = 401 &&
       test "$(http -sS -o /dev/null -w '%{http_code}' https://cloud.ipollo.net/api/v1/admin/runtime)" = 401 &&
       cmp -s <(docker exec "$work" cat /data/auth.secret) "$backup/auth.secret" &&
       cmp -s <(docker exec "$work" cat /app/dist/web/index.html) <(http -fsS https://cloud.ipollo.net/); then
      printf 'revision=%s\nverified_at=%s\nbackup=%s\n' "$revision" "$(date -u +%FT%TZ)" "$backup" > "$release/verified.txt"
      docker inspect -f 'image={{.Config.Image}} running={{.State.Running}} restarts={{.RestartCount}} memory_limit={{.HostConfig.Memory}}' "$work"
      http -fsS https://cloud.ipollo.net/api/ready
      printf '\nDeployment verified: %s\n' "$revision"
    else
      if test "$(schema)" != "$(cat "$release/previous-schema")"; then
        echo 'Verification failed after forward migration; backup retained. Fix forward or restore under a maintenance window. Refusing an incompatible image rollback.'
        exit 1
      fi
      echo 'Verification failed before migration; restoring previous image and configuration'
      "${compose[@]}" -f "$release/rollback.compose.yml" up -d --no-deps --no-build --pull never work
      ready
      test "$(docker inspect -f '{{.Image}}' "$work")" = "$(cat "$release/previous-id")"
      exit 1
    fi
    ;;
  *) exit 2 ;;
esac
