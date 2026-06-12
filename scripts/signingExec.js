const { execFileSync } = require('child_process');

/**
 * Run a signing / notarization CLI with a HARD timeout.
 *
 * `codesign --timestamp` and `xcrun stapler staple` make network calls to Apple
 * (timestamp.apple.com / the ticket-distribution servers) and have NO
 * client-side timeout — when an Apple server stalls they block forever and wedge
 * the whole build. Three consecutive v0.9.7 release runs hung 90-160 min at
 * exactly `codesign --timestamp` (orphaned `codesign` in the cleanup logs).
 *
 * We spawn the tool DIRECTLY via `execFileSync` (no `/bin/sh -c`) so that when
 * Node's timeout elapses, the SIGKILL lands on the real process. A string-form
 * `execSync` runs through a shell, and for a compound/forking command the kill
 * hits the shell while the tool orphans — re-introducing the exact hang. Direct
 * spawn also keeps the signing identity / paths out of a shell command string.
 *
 * Never throws — returns false on failure or timeout so callers decide how to
 * degrade. (Do NOT use this for `notarytool submit`: that needs the password
 * passed via a shell env var to keep it out of the process argv, and notarytool
 * already bounds itself with `--timeout`.)
 *
 * @param {string} file  executable, e.g. 'codesign' or 'xcrun'
 * @param {string[]} args
 * @param {{ timeoutMs: number, label: string }} opts
 * @returns {boolean} true on clean exit, false on failure/timeout
 */
function runBounded(file, args, { timeoutMs, label }) {
  try {
    execFileSync(file, args, { stdio: 'inherit', timeout: timeoutMs, killSignal: 'SIGKILL' });
    return true;
  } catch (error) {
    // On a Node sync-spawn timeout, `error.code === 'ETIMEDOUT'` is the reliable
    // signal (`error.killed` is undefined on the sync path).
    const timedOut = Boolean(error && error.code === 'ETIMEDOUT');
    const detail = timedOut
      ? `timed out after ${Math.round(timeoutMs / 1000)}s (no response — in CI usually a locked signing keychain)`
      : 'failed';
    console.warn(`${label}: ${detail}: ${error && error.message}`);
    return false;
  }
}

module.exports = { runBounded };
