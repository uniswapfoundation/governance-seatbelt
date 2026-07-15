#!/usr/bin/env bash

set -euo pipefail

bun run setup
bun run sim "$@"
cd frontend
exec bun dev
