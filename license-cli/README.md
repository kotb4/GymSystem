# GymSystem License CLI (license-cli/)

Standalone offline-license tool for the GymSystem desktop app. It signs
Per-machine `.lic` activation files with Ed25519 — **no server contact, no
internet, no third-party dependencies** (uses only `node:crypto`).

The tool lives in its own folder so you can carry it with you (e.g. on a
USB stick) independent of the app source. It is a **developer / owners' tool**
— the client-facing app never contains this folder or the private key.

## Folder contents

```
license-cli/
  LicenseTool.bat      # double-click shortcut -> license-cli.bat menu
  License Tool.bat     # same, alternate name (space)
  license-cli.bat      # the interactive menu (English only)
  license-tool.mjs     # the actual CLI (keygen / hwid / issue / issue-here)
  package.json         # minimal self-contained package ("bin": gymsystem-license)
  config/              # CREATED on keygen — PRIVATE KEY HERE, NEVER SHIP
  license.lic          # output file (gitignored)
```

## Quick start

1. **Double-click `LicenseTool.bat`** (or `License Tool.bat`) — a clean menu
   with options:
   - `[1] Show HWID`
   - `[2] Issue a license for this machine`
   - `[3] Show license-tool help`
   - `[4] Open license-cli folder`
   - `[5] Exit`

2. On a **fresh install**, first generate a keypair:
   `npm run license:keygen` (from the project root) — this creates
   `license-cli/config/id_ed25519_private.pem` and
   `license-cli/config/id_ed25519_public.pem`.

3. **Embed the public key** in the app:
   copy the contents of `config/id_ed25519_public.pem` into
   `server/license/crypto.ts` as `EMBEDDED_PUBLIC_PEM`. Without this the app
   will reject licenses signed by your private key.

4. **Issue a license for the current machine** from the menu (option 2) or:
   `npm run license:issue-here -- --gym "MyGym" --days 365`
   → writes `license-cli/license.lic`.

5. Deliver that `.lic` file (or its text content) to the client. On the app's
   activation screen they paste it or drop the file — the app verifies the
   signature, HWID, and expiry entirely offline.

## CLI commands (direct)

Run from this folder (`license-cli/`), or use the corresponding `npm run
license:*` scripts from the project root:

```
node license-tool.mjs keygen [dir]                                # make keypair
node license-tool.mjs hwid [--json]                               # this machine's HWID
node license-tool.mjs issue <hwid> [--gym N] [--days N] [--until YYYY-MM-DD] [--key p] [--out p]
node license-tool.mjs issue-here [--gym N] [--days N] [--until YYYY-MM-DD] [--key p] [--out p]
```

### Flags
- `--gym`  license holder name (default `GymSystem`)
- `--days` validity in days from now (default `365`)
- `--until` exact expiry date `YYYY-MM-DD` (overrides `--days`)
- `--key`  path to a private PEM (default `config/id_ed25519_private.pem`)
- `--out`  path to write the `.lic` (default `license-cli/license.lic`)

## Security notes
- **The private key must never be committed** (`config/`, `*.pem`, `license.lic`
  are in the repo `.gitignore`). Anyone holding the private key can forge
  licenses.
- HWID is derived from the Windows `MachineGuid`, hostname, platform, arch,
  and MAC addresses — a license is bound to one machine.
- The app enforces signed + HWID + expiry checks on every activation read and
  re-checks expiry on a 15-minute clock tick.

## Embedding a NEW public key (license rotation)
1. `node license-tool.mjs keygen`
2. Replace `EMBEDDED_PUBLIC_PEM` in `server/license/crypto.ts` with the new
   `id_ed25519_public.pem` contents.
3. Rebuild + redeploy. Existing `.lic` files issued with the OLD key become
   invalid — rotate keys deliberately, not casually.