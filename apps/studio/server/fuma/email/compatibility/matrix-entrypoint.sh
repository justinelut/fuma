#!/bin/sh
set -eu

: "${FUMA_EMAIL_EXPECT_ARCH:?FUMA_EMAIL_EXPECT_ARCH is required}"
SOURCE=/source
WORK=/work

rm -rf "$WORK"
mkdir -p "$WORK/apps/control-surfaces" "$WORK/apps/web"
cp "$SOURCE/package.json" "$SOURCE/bun.lock" "$SOURCE/tsconfig.base.json" "$WORK/"
cp -a "$SOURCE/apps/studio" "$WORK/apps/studio"
cp "$SOURCE/apps/control-surfaces/package.json" "$WORK/apps/control-surfaces/package.json"
cp "$SOURCE/apps/web/package.json" "$WORK/apps/web/package.json"
cp -a "$SOURCE/packages" "$WORK/packages"
cp -a "$SOURCE/vendor" "$WORK/vendor"
find "$WORK" -type d \( -name node_modules -o -name .next -o -name .react-email -o -name dist -o -name build \) -prune -exec rm -rf '{}' +

cd "$WORK"
FUMA_EMAIL_EXPECT_PLATFORM=linux \
FUMA_EMAIL_EXPECT_ARCH="$FUMA_EMAIL_EXPECT_ARCH" \
bun run apps/studio/scripts/fuma-email-compatibility-target.ts
