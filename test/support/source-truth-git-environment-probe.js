// Trusted fixture endpoint; all reported values are assigned by the control.
const paths = ["HOME", "TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR"];
const keys = [...paths, "PATH", "NODE_DISABLE_COMPILE_CACHE", "NODE_OPTIONS", "NODE_COMPILE_CACHE", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM", "GIT_ASKPASS", "GIT_TERMINAL_PROMPT", "GIT_NO_LAZY_FETCH", "GIT_NO_REPLACE_OBJECTS", "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_999", "GIT_CONFIG_VALUE_999", "HTTP_PROXY", "HTTPS_PROXY", "SOURCE_TRUTH_HTTP_HOME"];
for (let i = 0; i < Number(process.env.GIT_CONFIG_COUNT); i++) keys.push(`GIT_CONFIG_KEY_${i}`, `GIT_CONFIG_VALUE_${i}`);
process.stdout.write(JSON.stringify({ cwd: process.cwd(), env: Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])) }));
