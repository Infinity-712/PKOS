#!/usr/bin/env bash
set -euo pipefail

PKOS_CORE_ROOT="${PKOS_CORE_ROOT:-$(pwd)}"
PKOS_DATA_ROOT="${PKOS_DATA_ROOT:-/home/infinity/data/pkos-vault}"

export PKOS_DATA_ROOT

echo "[pkos-smoke] core root: ${PKOS_CORE_ROOT}"
echo "[pkos-smoke] data root: ${PKOS_DATA_ROOT}"

cd "${PKOS_CORE_ROOT}"
mkdir -p "${PKOS_DATA_ROOT}"

echo "[pkos-smoke] paths"
python3 -B -m tools.pkos paths --json

echo "[pkos-smoke] doctor"
python3 -B -m tools.pkos doctor --json

echo "[pkos-smoke] append inbox"
python3 -B -m tools.pkos inbox-append --capture-type note --content "server smoke test inbox" --source manual --json

echo "[pkos-smoke] append state"
python3 -B -m tools.pkos state-append --energy low --mood calm --body tired --source manual --json

echo "[pkos-smoke] gen flow"
python3 -B -m tools.pkos gen-flow

echo "[pkos-smoke] export agent context"
python3 -B -m tools.pkos export-agent-context --print

echo "[pkos-smoke] validate"
python3 -B -m tools.pkos validate

echo "[pkos-smoke] ok"
