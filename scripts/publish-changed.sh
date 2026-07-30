#!/usr/bin/env bash
# Publishes each workspace package whose local package.json version is newer than
# the version currently published on the npm registry. This replaces the
# "publish if version has been updated" behaviour that `bolt publish` used to
# provide automatically.
#
# Set DRY_RUN=1 to run the whole decision process and hand `--dry-run` to
# `bun publish`, so the script can be exercised end to end without releasing
# anything.
set -euo pipefail

# Publish order is explicit, and must stay in dependency order: a package must
# never be published before something it depends on.
#
# This was previously `for pkg_dir in packages/*/`, which is wrong here. Glob
# expansion is lexicographic over the whole string including the trailing slash,
# and '-' (0x2D) sorts before '/' (0x2F), so `packages/openapi-merge-cli/` came
# out BEFORE `packages/openapi-merge/`. The CLI depends on the library, so that
# ordering would publish an openapi-merge-cli release whose required
# openapi-merge version was not yet on the registry -- broken for anyone
# installing during the gap, and not something you can take back.
PUBLISH_ORDER=(
  "packages/openapi-merge"      # library; no workspace dependencies
  "packages/openapi-merge-cli"  # depends on openapi-merge
)

# True when $1 is a strictly greater semantic version than $2.
#
# The original check was `!=`, which does not match this file's own stated
# intent: a checkout whose version is *older* than the registry would attempt a
# downgrade, npm would reject it, and the whole run would fail. Only ever move
# forwards.
is_newer_version() {
  node -e '
    const [a, b] = process.argv.slice(1);
    const parts = s => s.split(".").map(n => parseInt(n, 10) || 0);
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++) {
      if ((x[i] || 0) !== (y[i] || 0)) {
        process.exit((x[i] || 0) > (y[i] || 0) ? 0 : 1);
      }
    }
    process.exit(1);
  ' "$1" "$2"
}

publish_args=()
if [ "${DRY_RUN:-}" = "1" ]; then
  echo "DRY_RUN=1: no package will actually be published."
  publish_args+=("--dry-run")
fi

for pkg_dir in "${PUBLISH_ORDER[@]}"; do
  if [ ! -f "${pkg_dir}/package.json" ]; then
    echo "ERROR: ${pkg_dir}/package.json not found. PUBLISH_ORDER is out of date." >&2
    exit 1
  fi

  name=$(node -p "require('./${pkg_dir}/package.json').name")
  local_version=$(node -p "require('./${pkg_dir}/package.json').version")
  published_version=$(npm view "$name" version 2>/dev/null || echo "0.0.0")

  if is_newer_version "$local_version" "$published_version"; then
    echo "Publishing $name@$local_version (registry has $published_version)"
    # No --production: that is an *install* flag ("don't install
    # devDependencies") and does nothing for publish. What lands in the tarball
    # is decided by the `files` field in each package.json.
    (cd "$pkg_dir" && bun publish ${publish_args[@]+"${publish_args[@]}"})
  elif [ "$local_version" = "$published_version" ]; then
    echo "Skipping $name: $local_version already published"
  else
    echo "Skipping $name: local $local_version is older than published $published_version"
  fi
done
