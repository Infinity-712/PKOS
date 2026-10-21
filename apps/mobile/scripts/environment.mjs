export function childEnvironment(source = process.env) {
  const allowed = new Set(['path', 'systemroot', 'windir', 'comspec', 'pathext', 'temp', 'tmp', 'tmpdir', 'home', 'userprofile', 'localappdata', 'appdata']);
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.has(key.toLowerCase()) && typeof value === 'string'));
}

// Native builds alone need these paths; test servers retain the smaller whitelist.
export function androidBuildEnvironment(source = process.env) {
  const env = childEnvironment(source);
  for (const name of ['JAVA_HOME', 'ANDROID_HOME', 'GRADLE_USER_HOME']) {
    if (source[name]) env[name] = source[name];
  }
  return env;
}
