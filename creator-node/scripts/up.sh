#!/usr/bin/env bash
 
set -xe

cd ${PROTOCOL_DIR}/creator-node

mkdir -p compose/env/tmp/file-storage-${1}
. compose/env/tmp/shellEnv${1}.sh

# build docker image without node_modules
if [[ "${1}" == 1 ]]; then
    mv node_modules /tmp/cn-node_modules
    time docker-compose -f compose/docker-compose.yml build
    [ -d node_modules ] && mv node_modules/* /tmp/cn-node_modules/ || true
    rm -rf node_modules
    mv /tmp/cn-node_modules node_modules
fi

mkdir -p compose/env/tmp/file-storage-${1}
. compose/env/tmp/shellEnv${1}.sh
time docker-compose -f compose/docker-compose.yml up -d
. compose/env/unsetShellEnv.sh
