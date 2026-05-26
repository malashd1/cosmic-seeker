#!/usr/bin/env node
//
// CosmicSeeker — release APK builder.
//
//   COSMIC_KEYSTORE_PATH=~/keys/cosmic-release.jks \
//   COSMIC_KEYSTORE_PASSWORD=... \
//   COSMIC_KEY_ALIAS=cosmic \
//   COSMIC_KEY_PASSWORD=... \
//     npm run android:apk:release
//
// What it does:
//   1. Sanity-check env vars + keystore existence.
//   2. `npm run build`         — Vite production bundle.
//   3. `npx cap sync android`  — copy dist/ into the Capacitor Android project.
//   4. `./gradlew assembleRelease` — Gradle picks up the env vars via the
//      signing block in `android/app/build.gradle`, producing a signed +
//      zipaligned `app-release.apk` (Gradle zipaligns automatically when
//      signed in-tree, no separate `zipalign` call needed).
//   5. Copy the artifact to `~/Downloads/CosmicSeeker-release.apk` and to
//      `dist-release/CosmicSeeker-release.apk` so CI runners can publish it.
//
// Failure modes:
//   - Missing env var      → exit 2 with the var name and a `keytool -genkey`
//                            example.
//   - Keystore file absent → exit 3 with the full resolved path.
//   - Gradle failure       → exit 4, Gradle's own logs are already on stdout.
//
// The script does NOT log or echo the keystore password. It also does NOT
// commit the artifact anywhere — keystore handling is the operator's job.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = path.join(REPO_ROOT, 'android');
const APK_BUILT  = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const OUT_DIR    = path.join(REPO_ROOT, 'dist-release');
const OUT_FILE   = path.join(OUT_DIR, 'CosmicSeeker-release.apk');
const DOWNLOADS_FALLBACK = path.join(homedir(), 'Downloads', 'CosmicSeeker-release.apk');

const REQUIRED_VARS = [
  'COSMIC_KEYSTORE_PATH',
  'COSMIC_KEYSTORE_PASSWORD',
  'COSMIC_KEY_ALIAS',
  'COSMIC_KEY_PASSWORD',
];

function die(code, msg, hint) {
  console.error(`\n✖ ${msg}`);
  if (hint) console.error(`\n${hint}`);
  process.exit(code);
}

function step(label, cmd) {
  console.log(`\n▸ ${label}`);
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: REPO_ROOT, stdio: 'inherit', shell: true });
}

function gradleStep(label, taskArgs) {
  console.log(`\n▸ ${label}`);
  console.log(`  $ (in android/) ./gradlew ${taskArgs}`);
  execSync(`./gradlew ${taskArgs}`, { cwd: ANDROID_DIR, stdio: 'inherit', shell: true });
}

function expandPath(p) {
  return p?.startsWith('~') ? path.join(homedir(), p.slice(1)) : p;
}

// 1. Validate env.
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length) {
  die(2, `missing required env var(s): ${missing.join(', ')}`,
`To mint a fresh keystore (one-time per release line):

  keytool -genkeypair -v \\
    -keystore ~/keys/cosmic-release.jks \\
    -storetype JKS \\
    -keyalg RSA -keysize 4096 -validity 10000 \\
    -alias cosmic

Then export the four vars (use a secret manager for the passwords):

  export COSMIC_KEYSTORE_PATH=~/keys/cosmic-release.jks
  export COSMIC_KEYSTORE_PASSWORD=...
  export COSMIC_KEY_ALIAS=cosmic
  export COSMIC_KEY_PASSWORD=...

And re-run \`npm run android:apk:release\`.`);
}

const keystorePath = expandPath(process.env.COSMIC_KEYSTORE_PATH);
if (!existsSync(keystorePath)) {
  die(3, `keystore file not found: ${keystorePath}`,
      `Either fix COSMIC_KEYSTORE_PATH or generate one with the keytool example shown by the missing-env-var error.`);
}
process.env.COSMIC_KEYSTORE_PATH = keystorePath; // pass the expanded value to Gradle

console.log(`▸ keystore: ${keystorePath}`);
console.log(`▸ alias:    ${process.env.COSMIC_KEY_ALIAS}`);

// 2. Vite production bundle.
try {
  step('Vite build', 'npm run build');
} catch { die(4, 'npm run build failed'); }

// 3. Capacitor sync.
try {
  step('Capacitor sync', 'npx cap sync android');
} catch { die(4, 'npx cap sync android failed'); }

// 4. Gradle assembleRelease.
try {
  gradleStep('Gradle assembleRelease', 'assembleRelease');
} catch { die(4, 'Gradle assembleRelease failed — check the log above'); }

// 5. Copy artifact.
if (!existsSync(APK_BUILT)) {
  die(4, `expected APK at ${APK_BUILT} but it isn't there.
Was the signing config wired correctly? Inspect the Gradle log for "Variant 'release' is missing"`);
}
mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(APK_BUILT, OUT_FILE);
try { copyFileSync(APK_BUILT, DOWNLOADS_FALLBACK); } catch { /* Downloads may not exist on CI */ }
const sz = statSync(OUT_FILE).size;
console.log(`
✔ Release APK built.
   artifact : ${OUT_FILE}  (${(sz / 1024 / 1024).toFixed(2)} MB)
   mirrored : ${DOWNLOADS_FALLBACK}

Verify the signature:
  apksigner verify --verbose ${OUT_FILE}

Install on a device:
  adb install -r ${OUT_FILE}
`);
