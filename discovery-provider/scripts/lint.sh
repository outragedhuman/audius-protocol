#!/usr/bin/env bash

if [ -n "${FIX_LINT}" ]; then
  ISORT_FLAG=
  BLACK_FLAG=
else
  ISORT_FLAG='--check-only'
  BLACK_FLAG='--check'
fi

set -ex

cd $PROTOCOL_DIR
flake8 /audius-discovery-provider/src/
flake8 /audius-discovery-provider/integration_tests/
isort ${ISORT_FLAG} /audius-discovery-provider/src/
isort ${ISORT_FLAG} /audius-discovery-provider/alembic/
isort ${ISORT_FLAG} /audius-discovery-provider/integration_tests/
black ${BLACK_FLAG} /audius-discovery-provider/src/
black ${BLACK_FLAG} /audius-discovery-provider/integration_tests/
# mypy --ignore-missing-imports --follow-imports=silent --show-column-numbers /audius-discovery-provider/src/
