#!/bin/sh
# Writes config.js from the API_BASE env var so the image works in any environment.
set -eu

CONFIG_FILE=/usr/share/nginx/html/config.js
api_base=$(printf '%s' "${API_BASE:-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

printf 'window.RADIOWAVE_CONFIG = { apiBase: "%s" };\n' "$api_base" > "$CONFIG_FILE"
echo "radiowave: API_BASE='${API_BASE:-}'"
