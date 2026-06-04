#!/bin/bash
set -e

export HOME=/workspace/.claude_home
mkdir -p "$HOME"

exec claude "$@"
