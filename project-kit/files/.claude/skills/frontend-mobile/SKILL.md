---
name: frontend-mobile
description: The mobile-specific deltas on top of frontend - touch targets, gesture and system-back navigation, soft keyboard, loading and offline handling, iOS and Android patterns, runtime permissions, and secure on-device storage. Use together with frontend when the target is a mobile app.
when_to_use: mobile app, iOS, Android, React Native, Expo, Flutter, offline, push permission, keychain
---

# Frontend — mobile

The mobile deltas on top of `frontend` (render every state, values from the
source, typed API calls, the shared security model). Load both for a mobile task;
this file adds only what the device changes.

## Workflow

```
Mobile delta:
- [ ] 1. Touch targets and gestures; system back behaves
- [ ] 2. Soft keyboard never hides the input; loading and offline states explicit
- [ ] 3. Platform patterns for iOS and Android
- [ ] 4. Permissions asked at the trigger, with the reason; secrets in Keychain or Keystore; ATS on
```

## Start when

The target is a mobile app — iOS, Android, React Native, Expo or Flutter. A web
target → use `frontend-web` instead.

## Touch and navigation

- Touch targets 44pt (iOS) / 48dp (Android); pad a small icon, do not shrink its
  tap area.
- iOS swipe-back works on every pushed screen; the Android system back button is
  never trapped; bottom navigation holds at most five items.

## Keyboard, loading, offline

- **Soft keyboard**: scroll the content above it; dismiss it on scroll or a tap
  outside.
- **Loading**: skeletons for content areas; a spinner only for an action; never
  block the whole screen for a background operation.
- **Offline**: an explicit no-network state; cached reads work offline; queue
  writes for reconnect when the feature calls for it.

## Platform patterns

iOS action sheets slide up from the bottom, the destructive action in red at the
bottom; Android uses snackbars and a FAB; not a web-style centred modal on iOS.

## Permissions and storage

- **Runtime permissions** requested at the trigger that uses them, with the reason
  — never at launch, and never for a capability the feature does not use.
- **Secrets in Keychain (iOS) or Keystore (Android)**, never `AsyncStorage`,
  `SharedPreferences`, `UserDefaults` or a plain file — plain storage is readable
  on a rooted device.
- A **build-time public prefix** (`EXPO_PUBLIC_*`) is compiled into the binary; no
  secret goes there.
- **Transport security** (ATS) stays on; never allow cleartext or trust-all
  certificates to make a request pass in a test.

## Output

Folds into the `frontend` report: the mobile screens built, and any permission,
secure-storage or platform-pattern concern surfaced
(Communication, Report of finished work).
