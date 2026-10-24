# V9.6 Mod source audit

The maintained Mod source is `ck3-mod/`. The installed Workshop directory is an input for read-only comparison only.

The exact upstream is `Voices-of-the-Court/votc_mod` commit `0cf4845a69f9e8633333ca04e558afe8216490f2` (base version 2.0.4). The maintained local snapshot is Workshop version 2.0.5. Source dispositions are recorded in `source-dispositions.json`; every path is relative. That record preserves the user-authorized snapshot without inferring authorship or claiming every historical change was independently reviewed.

The source manifest's `gameCompatibility.target` (`CK3 1.20.*`) records the descriptor target only. `verifiedVersions` is empty; no in-game CK3 version has been verified by this source contract.

## Commands

```powershell
node scripts/audit-v96-source/audit.js --mod-dir ck3-mod --upstream-dir <fixed-upstream-checkout> --upstream-revision 0cf4845a69f9e8633333ca04e558afe8216490f2
node scripts/audit-v96-source/generate-inputs.js
node scripts/audit-v96-source/generate-inputs.js --write
node scripts/verify-ck3-mod-source.js --mod-dir ck3-mod --upstream-dir <fixed-upstream-checkout> --upstream-revision 0cf4845a69f9e8633333ca04e558afe8216490f2
node scripts/build-ck3-mod-source.js --output-dir .build/ck3-mod-build
node scripts/verify-ck3-mod-source.js --mod-dir .build/ck3-mod-build
```

`audit.js` is read-only. It compares the supplied local Mod snapshot to repository `ck3-mod/`, then compares `ck3-mod/` to the pinned upstream when `--upstream-dir` is supplied. Reports distinguish raw byte equality from equality after UTF-8 BOM and line-ending normalization. `generate-inputs.js` prints a preview by default and writes only `build/ck3-mod-inputs.json` when explicitly passed `--write`. The source verifier rejects symlinks, escaping or non-normalized paths, case-colliding names, unlisted files, unexpected executables, and any file hash or size mismatch. The optional upstream directory must be supplied with the exact revision argument; that argument identifies the selected pinned source and does not independently prove how the directory was obtained.

The Mod candidate build copies only the 97 manifest-listed files into a new directory below `.build/`. It does not create an EXE or ZIP and does not install or upload to Steam Workshop. `artifactSha256` is the SHA-256 of the canonical Mod payload file list, not an archive hash.

All public JSON reports contain relative paths and omit the caller's absolute input paths. The tests and fixtures are static contracts; they do not prove CK3 engine parsing, Hello emission, current-session log binding, game compatibility, or a successful Action/Letter effect.
