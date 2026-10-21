import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { build, mobileRoot } from './build.mjs';
import { childEnvironment, androidBuildEnvironment } from './environment.mjs';
import { capacitorConfig } from './network.mjs';

const android = resolve(mobileRoot, 'android');
const mainAssets = resolve(android, 'app/src/main/assets');
const debugAssets = resolve(android, 'app/src/debug/assets');

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: mobileRoot, stdio: 'inherit', shell: false, env: childEnvironment(), ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${program}`);
}

function sync() {
  build(false);
  run(process.execPath, [resolve(mobileRoot, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android']);
  build(true);
  mkdirSync(debugAssets, { recursive: true });
  cpSync(resolve(mobileRoot, 'dist'), join(debugAssets, 'public'), { recursive: true });
  writeFileSync(join(debugAssets, 'capacitor.config.json'), JSON.stringify(capacitorConfig(true), null, 2));
  verifyAssets();
}

function verifyAssets() {
  for (const [assets, scheme] of [[mainAssets, 'https'], [debugAssets, 'http']]) {
    const config = JSON.parse(readFileSync(join(assets, 'capacitor.config.json'), 'utf8'));
    assert.equal(config.server.androidScheme, scheme);
    assert.equal(config.server.url, undefined);
    assert.equal(config.server.cleartext, false);
    assert.equal(config.android.allowMixedContent, false);
    assert.equal(config.plugins.CapacitorHttp.enabled, false);
    const html = readFileSync(join(assets, 'public/index.html'), 'utf8');
    assert.match(html, scheme === 'https' ? /connect-src 'none'/ : /connect-src http:\/\/127\.0\.0\.1:\d+/);
  }
  console.log('ANDROID_SYNCED_ASSETS_OK (not a merged Manifest or APK verification)');
}

function doctor() {
  const java = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin/java.exe') : 'java';
  const javac = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin/javac.exe') : 'javac';
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.LOCALAPPDATA || '', 'Android/Sdk');
  const javaResult = spawnSync(java, ['-version'], { encoding: 'utf8', env: childEnvironment(), shell: false });
  const compiler = spawnSync(javac, ['-version'], { encoding: 'utf8', env: childEnvironment(), shell: false });
  const javaVersion = (javaResult.stderr || javaResult.stdout || '').trim();
  const major = Number(/(?:version\s+"|openjdk\s+)(\d+)/.exec(javaVersion)?.[1] || 0);
  const compilerVersion = (compiler.stdout || compiler.stderr || '').trim();
  const compilerMajor = Number(/javac (\d+)/.exec(compilerVersion)?.[1] || 0);
  const buildTools = existsSync(join(sdk, 'build-tools')) ? readdirSync(join(sdk, 'build-tools')).filter(v => existsSync(join(sdk, 'build-tools', v, 'aapt2.exe'))) : [];
  const adb = join(sdk, 'platform-tools/adb.exe');
  const missing = [];
  if (Number(process.versions.node.split('.')[0]) < 24) missing.push('Node 24+');
  if (javaResult.status !== 0 || compiler.status !== 0 || major < 21 || major > 24 || compilerMajor !== major) missing.push('Matching java/javac 21..24 (Gradle 8.14.3 compatibility)');
  if (!existsSync(join(sdk, 'platforms/android-36/android.jar'))) missing.push('Android SDK Platform 36');
  if (!buildTools.includes('35.0.0')) missing.push('Android SDK Build Tools 35.0.0 (AGP 8.13 default)');
  if (!existsSync(adb)) missing.push('Android platform-tools / adb (device verification)');
  if (process.env.ANDROID_HOME && process.env.ANDROID_SDK_ROOT && resolve(process.env.ANDROID_HOME).toLowerCase() !== resolve(process.env.ANDROID_SDK_ROOT).toLowerCase()) missing.push('Conflicting ANDROID_HOME / ANDROID_SDK_ROOT; load android-env.ps1');
  console.log(JSON.stringify({ node: process.version, javaPath: java, java: javaVersion || 'not found', javac: compilerVersion || 'not found', sdk, buildTools, adb: existsSync(adb) ? adb : 'not found', gradleUserHome: process.env.GRADLE_USER_HOME || '(user default)', gradleWrapper: '8.14.3', missing }, null, 2));
  return { java, sdk, missing };
}

try {
  const command = process.argv[2];
  if (command === 'doctor') {
    if (doctor().missing.length) process.exitCode = 1;
  } else if (command === 'sync') sync();
  else if (command === 'verify') {
    verifyAssets();
    run('powershell.exe', ['-NoProfile', '-File', resolve(mobileRoot, 'scripts/verify-android.ps1')]);
  } else if (command === 'debug') {
    const tools = doctor();
    if (tools.missing.length) throw new Error('APK_BUILD_BLOCKED: required Android tools are missing; no licenses accepted or tools installed');
    sync();
    const env = { ...androidBuildEnvironment(), ANDROID_HOME: tools.sdk };
    run(tools.java, ['-classpath', resolve(android, 'gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', '--no-daemon', '--console=plain', '-Pandroid.builder.sdkDownload=false', ':app:assembleDebug', ':app:processReleaseMainManifest'], { cwd: android, env });
    run('powershell.exe', ['-NoProfile', '-File', resolve(mobileRoot, 'scripts/verify-android.ps1')]);
    const apk = resolve(android, 'app/build/outputs/apk/debug/app-debug.apk');
    const bytes = readFileSync(apk);
    console.log(JSON.stringify({ result: 'APK_BUILD_OK', path: apk, bytes: statSync(apk).size, sha256: createHash('sha256').update(bytes).digest('hex'), applicationId: 'dev.pkos.mobile.compat', versionName: '0.1.0-compat', versionCode: 1, debug: true }, null, 2));
  } else throw new Error('Usage: android.mjs doctor|sync|debug|verify');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
