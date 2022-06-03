#!/usr/bin/env bash
 
set -xe

# hide docker build output
export DOCKER_BUILDKIT=0

cd ${PROTOCOL_DIR}/creator-node

mkdir -p compose/env/tmp/file-storage-${1}
. compose/env/tmp/shellEnv${1}.sh

# build docker image without node_modules
mv node_modules /tmp/cn-node_modules
time docker build --progress=tty .
time docker-compose -f compose/docker-compose.yml build
mv node_modules/* /tmp/cn-node_modules/
rm -rf node_modules
mv /tmp/cn-node_modules node_modules

mkdir -p compose/env/tmp/file-storage-${1}
. compose/env/tmp/shellEnv${1}.sh
time docker-compose -f compose/docker-compose.yml up -d
. compose/env/unsetShellEnv.sh
