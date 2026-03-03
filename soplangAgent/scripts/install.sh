#!/bin/sh
set -e

echo "Installing soplangAgent dependencies..."

if [ "${PLOINKY_RUNTIME:-}" = "bwrap" ]; then
    echo "Running under bwrap — skipping apt-get (using host packages)"
    missing=""
    for cmd in git ffmpeg; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing="$missing $cmd"
        fi
    done
    if [ -n "$missing" ]; then
        echo "ERROR: missing host packages:$missing"
        echo "  sudo apt install -y$missing"
        exit 1
    fi
else
    apt-get update && apt-get install -y git ffmpeg
fi

echo "soplangAgent dependencies OK"
