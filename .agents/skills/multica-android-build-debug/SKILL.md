---
name: multica-android-build-debug
description: Use when modifying, building, or debugging the Multica Android app in apps/mobile, especially for release APK output, Expo/Gradle issues, backend selection, default tab/route behavior, Android keyboard/composer layout, adaptive icon alignment, or arm64-v8a packaging.
---

# Multica Android Build Debug

Use this skill when the task is about `apps/mobile/` on Android and the answer must be operational, not conceptual: change code, build an APK, debug Android-only UI behavior, or verify a release artifact.

Start by reading the root `CLAUDE.md` and `apps/mobile/CLAUDE.md`. Mobile must mirror web semantics before changing UI, routing, counts, or workflow.

## Primary Files

- Build and env:
  - `apps/mobile/package.json`
  - `apps/mobile/app.config.ts`
  - `apps/mobile/.env.example`
  - `apps/mobile/android/app/src/main/AndroidManifest.xml`
  - `apps/mobile/data/backend-config.ts`
- Workspace entry and tab routing:
  - `apps/mobile/app/index.tsx`
  - `apps/mobile/app/(app)/select-workspace.tsx`
  - `apps/mobile/app/(app)/[workspace]/switch-workspace.tsx`
  - `apps/mobile/app/(app)/[workspace]/more/settings.tsx`
  - `apps/mobile/app/(app)/[workspace]/(tabs)/_layout.tsx`
  - `apps/mobile/app/(app)/[workspace]/(tabs)/more.tsx`
- Chat/composer/keyboard:
  - `apps/mobile/app/(app)/[workspace]/(tabs)/chat.tsx`
  - `apps/mobile/components/composer/message-composer.tsx`
  - `apps/mobile/components/chat/chat-composer.tsx`
  - `apps/mobile/components/chat/chat-message-list.tsx`
- Android icons:
  - `apps/mobile/assets/android-icon.png`
  - `apps/mobile/assets/android-adaptive-foreground.png`

## Workflow

1. Classify the task first.
   - JS/UI behavior only: route order, composer layout, keyboard spacing, backend picker labels.
   - Expo config/build behavior: env, package ids, adaptive icon wiring.
   - Native Android build/output: Gradle, APK, ABI targeting, manifest behavior.
2. Read the matching web/mobile parity source before editing.
   - For chat/inbox/issue behavior, inspect the corresponding `packages/views/` or `packages/core/` implementation first, then mirror only the mobile-specific interaction difference.
3. Change the minimum set of files that own the behavior.
4. Verify in this order:
   - typecheck
   - Android release build if requested
   - required local redeploy after code changes
   - report APK path and hash if an installable artifact was produced

## Build Commands

Assume this local environment unless the repo has changed:

- Node: `~/sdk/node/bin`
- JDK: `~/sdk/jdk-tmp/jdk-21.0.11+10/Contents/Home`
- Android SDK: `~/Library/Android/sdk`

Typecheck mobile:

```bash
PATH="$HOME/sdk/node/bin:$PATH" \
JAVA_HOME="$HOME/sdk/jdk-tmp/jdk-21.0.11+10/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
bash -lc 'corepack pnpm -C apps/mobile typecheck'
```

Build a production `arm64-v8a` release APK only:

```bash
PATH="$HOME/sdk/node/bin:$HOME/sdk/jdk-tmp/jdk-21.0.11+10/Contents/Home/bin:$PATH" \
JAVA_HOME="$HOME/sdk/jdk-tmp/jdk-21.0.11+10/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
bash -lc '
  set -a
  source apps/mobile/.env.production
  set +a
  export APP_ENV=production CI=1 EXPO_NO_INTERACTIVE=1
  cd apps/mobile/android
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
'
```

APK output:

```bash
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Artifact hash:

```bash
shasum -a 256 apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

If the repo code changed, run the required local redeploy before declaring the task done:

```bash
bash scripts/redeploy-selfhost-dev.sh
```

## Android-Specific Pitfalls

### Default landing screen or tab order looks wrong

- Do not only reorder `Tabs.Screen`.
- Also check every redirect or workspace-entry path that still targets `/${slug}/inbox`.
- For this repo, default landing to Chat can require coordinated edits in:
  - `app/index.tsx`
  - `select-workspace.tsx`
  - `switch-workspace.tsx`
  - `more/settings.tsx`
  - `(tabs)/more.tsx`
  - `(tabs)/_layout.tsx`
- If tabs must open on Chat, set `unstable_settings.initialRouteName = "chat"` in `(tabs)/_layout.tsx`.

### Chat composer leaves a gap above the Android keyboard

- First suspect the bottom tab bar still reserving space. Check `tabBarHideOnKeyboard: true` in `(tabs)/_layout.tsx`.
- Then inspect `KeyboardStickyView` ownership. Avoid stacking a screen-level keyboard avoider on top of a composer that already uses `KeyboardStickyView`.
- Check for double safe-area application in `message-composer.tsx`:
  - composer container bottom padding
  - `KeyboardStickyView offset`
  - any extra bottom padding on the message list
- In this repo, the stable pattern is the shared full-card composer in `components/composer/message-composer.tsx`, not separate chat/comment implementations.

### Android icon looks too high after install

- The launcher usually shows the adaptive icon, not the legacy square icon.
- Fix the optical center in `apps/mobile/assets/android-adaptive-foreground.png`; changing only `android-icon.png` often does not fix launcher placement.
- Keep in mind Android launcher masks crop and scale the foreground, so visual center is not the mathematical center.

### Backend selection or default backend is wrong

- `apps/mobile/data/backend-config.ts` is the source of truth for the built-in backend list and persisted selection.
- `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WEB_URL` define the build-time default backend.
- If the task says to add or prefer `agent.diff.host`, update `BACKEND_OPTIONS` and verify the label, API URL, web URL, and persisted-store behavior together.

## Completion Checklist

- `git status` shows only intended changes plus any known unrelated dirt.
- Mobile typecheck passed.
- If requested, APK built successfully and the response includes the exact output path and SHA-256.
- If code changed, `scripts/redeploy-selfhost-dev.sh` was run.
- Final response calls out anything not verified on a physical Android device.
