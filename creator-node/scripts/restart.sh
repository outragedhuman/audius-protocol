#!/usr/bin/env bash

set -xe

# show docker build output
export DOCKER_BUILDKIT=1

cd ${PROTOCOL_DIR}/creator-node

. compose/env/unsetShellEnv.sh
. compose/env/tmp/shellEnv${1}.sh
docker-compose -f compose/docker-compose.yml down --remove-orphans

(
    cd libs/
    npm run init-local update-cnode-config ${1}
)

. compose/env/tmp/shellEnv${1}.sh

# build docker image without node_modules
mv node_modules /tmp/cn-node_modules
time docker build --progress=plain .
time docker-compose -f compose/docker-compose.yml build
[ -d node_modules ] && mv node_modules/* /tmp/cn-node_modules/
rm -rf node_modules
mv /tmp/cn-node_modules node_modules

. compose/env/tmp/shellEnv${1}.sh
time docker-compose -f compose/docker-compose.yml up -d
. compose/env/unsetShellEnv.sh
