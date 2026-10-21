import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import * as environments from '../scripts/environment.mjs';

test('Android child receives only scoped toolchain paths, not credentials or JVM injection', () => {
  assert.equal(typeof environments.androidBuildEnvironment, 'function');
  const env = environments.androidBuildEnvironment({ PATH: 'existing', JAVA_HOME: 'jdk', ANDROID_HOME: 'sdk', GRADLE_USER_HOME: 'cache', TEMP: 'temp', ANDROID_SDK_ROOT: 'old', DEEPSEEK_API_KEY: 'secret', JAVA_TOOL_OPTIONS: 'unsafe', GRADLE_OPTS: 'unsafe' });
  assert.equal(env.JAVA_HOME, 'jdk');
  assert.equal(env.ANDROID_HOME, 'sdk');
  assert.equal(env.GRADLE_USER_HOME, 'cache');
  assert.equal(env.PATH, 'existing');
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
  assert.equal(env.ANDROID_SDK_ROOT, undefined);
  assert.equal(env.GRADLE_OPTS, undefined);
  assert.equal(env.JAVA_TOOL_OPTIONS, undefined);
  assert.equal(environments.childEnvironment({ JAVA_HOME: 'jdk', GRADLE_USER_HOME: 'cache' }).JAVA_HOME, undefined);
});

test('Android verification does not bypass execution policy', () => {
  assert.doesNotMatch(readFileSync(new URL('../scripts/android.mjs', import.meta.url), 'utf8'), /ExecutionPolicy.{0,20}Bypass/);
});

test('fresh PowerShell loads config paths containing spaces and preserves PATH; conflicts fail', { skip: process.platform !== 'win32' }, () => {
  const helper = resolve('scripts/android-env.ps1');
  assert.ok(existsSync(helper), 'environment helper not implemented');
  const root = mkdtempSync(join(tmpdir(), 'pkos android env '));
  try {
    const jdk = join(root, 'test jbr');
    const sdk = join(root, 'test sdk');
    const cache = join(root, 'test cache');
    mkdirSync(join(jdk, 'bin'), { recursive: true });
    mkdirSync(sdk);
    for (const name of ['java.exe', 'javac.exe']) writeFileSync(join(jdk, 'bin', name), 'path-validation fixture, not executable');
    const config = join(root, 'paths.json');
    writeFileSync(config, JSON.stringify({ javaHome: jdk, sdkRoot: sdk, gradleUserHome: cache, tempRoot: join(root, 'temp') }));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, '.local'));
    const defaultHelper = join(root, 'scripts', 'android-env.ps1');
    copyFileSync(helper, defaultHelper);
    copyFileSync(config, join(root, '.local', 'android-toolchain.json'));
    const quote = value => `'${value.replaceAll("'", "''")}'`;
    const defaultResult = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop'; . ${quote(defaultHelper)}; Write-Output $env:JAVA_HOME`], { encoding: 'utf8', env: environments.childEnvironment() });
    assert.equal(defaultResult.status, 0, defaultResult.stderr);
    assert.equal(defaultResult.stdout.trim(), jdk);
    const invoke = suffix => spawnSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop'; $before=$env:PATH; . ${quote(defaultHelper)} -ConfigPath ${quote(config)}; ${suffix}`], { encoding: 'utf8', env: { ...environments.childEnvironment(), JAVA_HOME: 'wrong inherited jdk', ANDROID_SDK_ROOT: 'different sdk' } });
    const result = invoke("[ordered]@{java=$env:JAVA_HOME;sdk=$env:ANDROID_HOME;old=$env:ANDROID_SDK_ROOT;cache=$env:GRADLE_USER_HOME;preserved=$env:PATH.EndsWith($before)} | ConvertTo-Json -Compress");
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(value.java, jdk);
    assert.equal(value.sdk, sdk);
    assert.equal(value.old, sdk);
    assert.equal(value.cache, cache);
    assert.equal(value.preserved, true);
    assert.match(result.stdout + result.stderr, /ANDROID_SDK_ROOT/);
    for (const separator of ['=', ':', ' ', '\t']) {
      writeFileSync(join(cache, 'gradle.properties'), `org.gradle.java.home${separator}C:/unrelated-jdk\n`);
      const conflict = invoke('');
      assert.notEqual(conflict.status, 0, `JVM override accepted with ${JSON.stringify(separator)}`);
      assert.match(conflict.stderr, /org.gradle.java.home/);
    }
    for (const properties of ['org.gradle.java.\\u0068ome=C:/unrelated-jdk\n', 'org.gradle.java.\\\nhome=C:/unrelated-jdk\n']) {
      writeFileSync(join(cache, 'gradle.properties'), properties);
      const conflict = invoke('');
      assert.notEqual(conflict.status, 0, 'Ambiguous properties must be reviewed explicitly');
      assert.match(conflict.stderr, /Escaped keys or continued lines/);
    }
    writeFileSync(join(cache, 'gradle.properties'), '# no JVM override\n');
    mkdirSync(join(root, 'android'));
    for (const separator of ['=', ':', ' ', '\t']) {
      writeFileSync(join(root, 'android', 'local.properties'), `sdk.dir${separator}C:/unrelated-sdk\n`);
      const conflict = invoke('');
      assert.notEqual(conflict.status, 0, `SDK conflict accepted with ${JSON.stringify(separator)}`);
      assert.match(conflict.stderr, /sdk.dir conflicts/);
    }
    writeFileSync(join(root, 'android', 'local.properties'), 'sdk.\\u0064ir=C:/unrelated-sdk\n');
    const escapedSdk = invoke('');
    assert.notEqual(escapedSdk.status, 0);
    assert.match(escapedSdk.stderr, /Escaped keys or continued lines/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
