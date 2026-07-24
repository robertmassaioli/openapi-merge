#!/usr/bin/env bash
# Publishes each workspace package whose local package.json version is newer
# than the version currently published on the npm registry. This replaces the
# "publish if version has been updated" behaviour that `bolt publish` used to
# provide automatically.
set -euo pipefail

for pkg_dir in packages/*/; do
  pkg_dir="${pkg_dir%/}"
  name=$(node -p "require('./${pkg_dir}/package.json').name")
  local_version=$(node -p "require('./${pkg_dir}/package.json').version")
  published_version=$(npm view "$name" version 2>/dev/null || echo "0.0.0")

  if [ "$local_version" != "$published_version" ]; then
    echo "Publishing $name@$local_version (registry has $published_version)"
    (cd "$pkg_dir" && bun publish --production)
  else
    echo "Skipping $name: $local_version already published"
  fi
done
