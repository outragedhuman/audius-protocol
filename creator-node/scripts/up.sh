#!/usr/bin/env bash
 
set -xe

cd ${PROTOCOL_DIR}/creator-node

mkdir -p compose/env/tmp/file-storage-${1}
. compose/env/tmp/shellEnv${1}.sh

function return_node_modules() {
    # if ./node_modules has been created and modified, copy it's content to /tmp
    if [[ -d node_modules ]]; then
        mv node_modules/* /tmp/cn-node_modules/ || true
    fi

    # always ensure no ./node_modules (to prevent ./node_modules/node_modules/*)
    rm -rf node_modules

    # return node_modules
    mv /tmp/cn-node_modules node_modules
}

# build docker image without node_modules
if [[ "${1}" == 1 ]]; then
    # mv ./node_modules away, temporarily
    mv node_modules /tmp/cn-node_modules

    # build image and always return ./node_modules
    time docker-compose -f compose/docker-compose.yml build \
        && return_node_modules \
        || (return_node_modules && exit 1)
fi

mkdir -p compose/env/tmp/file-storage-${1}
. compose/env/tmp/shellEnv${1}.sh
time docker-compose -f compose/docker-compose.yml up -d
. compose/env/unsetShellEnv.sh
