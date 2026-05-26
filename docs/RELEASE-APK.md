# Building a signed CosmicSeeker release APK

The Seeker dApp Store, Google Play, and direct-install distribution all
require an APK signed with a stable upload keystore. This guide covers the
one-time keystore mint and the per-release build command.

```bash
npm run android:apk:release
```

…produces `dist-release/CosmicSeeker-release.apk` (also mirrored into
`~/Downloads/`). Everything below is the manual setup that has to happen
once per release line.

> **Treat the keystore like a master credential.** Lose it and you can
> never update the published app — Google Play / Seeker dApp Store enforce
> "same signer == same app." Back it up to two physically different
> encrypted locations and store the passwords in a secret manager.

## 1 · Mint a keystore (one-time)

```bash
mkdir -p ~/keys
keytool -genkeypair -v \
  -keystore  ~/keys/cosmic-release.jks \
  -storetype JKS \
  -keyalg    RSA -keysize 4096 -validity 10000 \
  -alias     cosmic
```

`keytool` will prompt you for:

- **Keystore password** — encrypts the keystore file.
- **Key password** — encrypts the private key inside it. You can reuse the
  keystore password if your secret store prefers single-secret hygiene.
- A "first and last name / org / city / country" DN. Anything reasonable
  works; the Play / Seeker store identity comes from the bundle id
  (`xyz.cosmicseeker.app`), not the cert subject.

Verify it's readable:

```bash
keytool -list -v -keystore ~/keys/cosmic-release.jks -alias cosmic
```

## 2 · Export the four env vars

```bash
export COSMIC_KEYSTORE_PATH=~/keys/cosmic-release.jks
export COSMIC_KEYSTORE_PASSWORD='…'   # don't put real values in shell history
export COSMIC_KEY_ALIAS=cosmic
export COSMIC_KEY_PASSWORD='…'
```

Recommended: use `direnv` + an `.envrc.local` that the gitignore already
covers, or a secret-manager wrapper like `op run --env-file=...` (1Password
CLI).

## 3 · Build

```bash
npm run android:apk:release
```

What it does (`scripts/build-release-apk.mjs`):

1. Validates that the four env vars are present and the keystore file
   exists — exits 2 / 3 with a `keytool -genkey` example otherwise.
2. `npm run build` — Vite production bundle into `dist/`.
3. `npx cap sync android` — copies `dist/` into the Capacitor project.
4. `./gradlew assembleRelease` — Gradle reads the env vars via the
   `signingConfigs.release` block in `android/app/build.gradle` and emits
   `app-release.apk` already signed + zipaligned.
5. Copies the artifact to `dist-release/CosmicSeeker-release.apk` and
   `~/Downloads/CosmicSeeker-release.apk`.

## 4 · Verify the signature

```bash
apksigner verify --verbose --print-certs dist-release/CosmicSeeker-release.apk
```

Expect "Verifies / v1: true / v2: true" plus the cert SHA-256 — record
that fingerprint somewhere safe; the Seeker dApp Store will refuse a
future update that doesn't match it.

## 5 · Install + smoke-test

```bash
adb install -r dist-release/CosmicSeeker-release.apk
adb logcat | grep -i 'cosmic\|capacitor\|skr'
```

## 6 · Rotate

If a keystore leaks, **you cannot rotate within the same app id.** Mint a
fresh keystore + bump the bundle id (e.g. `xyz.cosmicseeker.app2`),
publish as a new listing, and deprecate the old one. Plan accordingly.

## CI hook (sketch)

```yaml
- name: Build release APK
  env:
    COSMIC_KEYSTORE_PATH:     ${{ secrets.COSMIC_KEYSTORE_PATH }}
    COSMIC_KEYSTORE_PASSWORD: ${{ secrets.COSMIC_KEYSTORE_PASSWORD }}
    COSMIC_KEY_ALIAS:         ${{ secrets.COSMIC_KEY_ALIAS }}
    COSMIC_KEY_PASSWORD:      ${{ secrets.COSMIC_KEY_PASSWORD }}
  run: npm run android:apk:release

- uses: actions/upload-artifact@v4
  with:
    name: cosmic-release-apk
    path: dist-release/CosmicSeeker-release.apk
```

The keystore itself ships into the runner via `base64 -d` of a separate
GitHub Actions secret that holds the `.jks` blob.
