const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runBounded } = require('./signingExec');

/**
 * afterAllArtifactBuild — notarize + staple the .dmg artifacts.
 *
 * `afterSign` notarizes and staples the .app. But the .app and the .dmg carry
 * SEPARATE notarization tickets, and an un-notarized dmg downloaded via a
 * browser (which sets the quarantine bit) is rejected by Gatekeeper as
 * "<app> is damaged and can't be opened" — even when the app inside is
 * perfectly notarized. That shipped once (rc.2.1). This hook closes the gap so
 * the disk image the user actually double-clicks is itself notarized.
 *
 * Mirrors afterSign's contract: failure is non-fatal and loud. The release
 * smoke gate (`scripts/release-smoke-macos.sh`) is the hard stop that refuses
 * to publish an unstapled dmg, so a transient notary stall degrades to "gate
 * blocks publish" rather than "broken dmg silently ships".
 *
 * @param {{ artifactPaths: string[], outDir: string }} buildResult
 */
exports.default = async function notarizeDmg(buildResult) {
  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith('.dmg'));
  if (dmgs.length === 0) {
    return;
  }

  const appleId = process.env.appleId;
  const appleIdPassword = process.env.appleIdPassword;
  const teamId = process.env.teamId;
  if (!appleId || !appleIdPassword || !teamId) {
    console.log('notarizeDmg: skipping — missing Apple ID credentials');
    return;
  }

  // The dmg must be code-signed with Developer ID BEFORE notarizing. A merely
  // notarized+stapled-but-unsigned dmg is still rejected by Gatekeeper as
  // "no usable signature" (proven on rc.2.1) — stapling a ticket is not enough,
  // spctl requires a primary signature too. CI passes the identity as CSC_NAME.
  const identity = process.env.CSC_NAME || process.env.identity;
  if (!identity) {
    console.log('notarizeDmg: skipping — no signing identity (CSC_NAME) available');
    return;
  }

  for (const dmg of dmgs) {
    const name = path.basename(dmg);
    try {
      console.log(`notarizeDmg: code-signing ${name} with Developer ID…`);
      signDmgWithTimestamp(identity, dmg);

      console.log(`notarizeDmg: submitting ${name} to Apple notary service…`);
      const submitCmd = [
        'xcrun notarytool submit',
        `"${dmg}"`,
        `--apple-id "${appleId}"`,
        `--team-id "${teamId}"`,
        '--password "$NOTARYTOOL_PWD"',
        '--wait',
        '--timeout 20m',
      ].join(' ');
      execSync(submitCmd, {
        stdio: 'inherit',
        env: { ...process.env, NOTARYTOOL_PWD: appleIdPassword },
      });

      // Staple the ticket so Gatekeeper validates the dmg offline. `stapler`
      // contacts Apple's ticket servers with no client timeout, so bound it too.
      if (!runBounded('xcrun', ['stapler', 'staple', dmg], { timeoutMs: 300000, label: `notarizeDmg: stapling ${name}` })) {
        throw new Error(`stapler staple failed or timed out for ${name}`);
      }
      console.log(`notarizeDmg: stapled ${name}`);

      // Stapling rewrites the dmg bytes, so the updater metadata that referenced
      // the pre-staple dmg is now stale. Repair the sha512/size in latest-mac.yml.
      repairUpdaterMetadata(buildResult.outDir, dmg);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`::warning title=DMG notarization not completed::${name}: ${message}`);
      console.warn(
        `⚠️ ${name} ships signed-but-unstapled. The release smoke gate will block publishing it — re-run once Apple's notary recovers.`
      );
    }
  }
};

/**
 * Code-sign the dmg with a HARD timeout, signature verification, and retries.
 *
 * `codesign --timestamp` contacts Apple's secure timestamp server
 * (timestamp.apple.com). codesign has no client-side timeout, so when that
 * server stalls codesign blocks forever and wedges the whole build — three
 * consecutive v0.9.7 release runs hung 90-160 min at exactly this step (both
 * arch legs, orphaned `codesign` processes) until cancelled. The caller's
 * try/catch only anticipated notary *failure*; a *hang* never throws, so it
 * never degraded gracefully.
 *
 * `runBounded` spawns codesign DIRECTLY (no shell) so the timeout's SIGKILL
 * lands on codesign itself. Two further guards from the cross-audit: (1) a
 * SIGKILLed attempt can leave a partial signature, so before each retry we clear
 * it (`--remove-signature`, best-effort) rather than let `--force` layer onto a
 * corrupt one; (2) codesign can exit 0 yet leave an *invalid* dmg signature
 * (Apple TN2206), so we `--verify --strict` before trusting it.
 *
 * On exhaustion we throw so the caller degrades to "signed-but-unstapled" and
 * the release smoke gate blocks publishing; CI auto-retry — or a later run once
 * the TSA recovers — then produces a clean dmg. A no-timestamp fallback is NOT a
 * viable degradation: Apple notarization REQUIRES a secure timestamp, so an
 * un-timestamped dmg would be rejected by notarytool anyway.
 */
function signDmgWithTimestamp(identity, dmg) {
  const SIGN_MS = 180000; // 3 min ceiling per timestamped sign (healthy: seconds)
  const SHORT_MS = 60000; // local, no-network codesign ops
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      // Clear any partial signature a SIGKILLed prior attempt may have left.
      runBounded('codesign', ['--remove-signature', dmg], {
        timeoutMs: SHORT_MS,
        label: `notarizeDmg: clearing partial signature before retry ${attempt}`,
      });
    }
    const signed = runBounded('codesign', ['--force', '--sign', identity, '--timestamp', dmg], {
      timeoutMs: SIGN_MS,
      label: `notarizeDmg: codesign attempt ${attempt}/${MAX_ATTEMPTS}`,
    });
    if (
      signed &&
      runBounded('codesign', ['--verify', '--strict', dmg], {
        timeoutMs: SHORT_MS,
        label: `notarizeDmg: verifying signature (attempt ${attempt}/${MAX_ATTEMPTS})`,
      })
    ) {
      return;
    }
  }
  throw new Error(
    `notarizeDmg: dmg codesign + verify failed after ${MAX_ATTEMPTS} attempts (likely an Apple timestamp-server outage)`
  );
}

/**
 * Update the dmg's sha512 + size in latest-mac.yml after stapling changed its
 * bytes. electron-builder writes sha512 as base64 of the raw SHA-512 digest.
 * Edits are surgical (only the entry whose url matches this dmg) and skipped
 * entirely if the yml or entry is absent — never throws into the caller.
 */
function repairUpdaterMetadata(outDir, dmgPath) {
  try {
    const yml = path.join(outDir, 'latest-mac.yml');
    if (!fs.existsSync(yml)) {
      return;
    }
    const name = path.basename(dmgPath);
    const buf = fs.readFileSync(dmgPath);
    const sha512 = crypto.createHash('sha512').update(buf).digest('base64');
    const size = buf.length;

    const lines = fs.readFileSync(yml, 'utf8').split('\n');
    let urlIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`url: ${name}`)) {
        urlIdx = i;
        break;
      }
    }
    if (urlIdx === -1) {
      return; // dmg not listed in the updater manifest (mac updates via the zip)
    }
    // sha512 + size are the two lines that follow this url within its block.
    for (let i = urlIdx + 1; i < Math.min(urlIdx + 4, lines.length); i++) {
      lines[i] = lines[i]
        .replace(/(\s*sha512:\s*).*/, `$1${sha512}`)
        .replace(/(\s*size:\s*).*/, `$1${size}`);
    }
    fs.writeFileSync(yml, lines.join('\n'));
    console.log(`notarizeDmg: repaired updater metadata for ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`notarizeDmg: could not repair updater metadata: ${message}`);
  }
}
