# V9.3.4 Source Guidelines

`src/app/` is the editable runtime source. `scripts/build-runtime.js` maps Main, Preload and Renderer to `resources/app/out` and default assets/package metadata to `resources/app`. Edit source first; generated resources are kept for direct VOTC.exe use and existing contract tests, then verified against the build.

Preserve JavaScript structure, Prompt bytes, cache IDs, IPC keys and the existing protocol 3.0/storage 2.5 contracts. V9.3.4 retires the Memory4/Durable production path and presents historical conversation memory as `Legacy Summary`; do not reintroduce Memory4 initialization, repository ports, Sidecar reads/writes, Year/Life generation or background rebuilds. Keep Legacy data in the existing summary files and index transaction. Current implementation and verification status are linked from `docs/current/v9/V9_3_4_IMPLEMENTATION_REPORT.md` and `docs/current/v9/V9_3_4_VERIFICATION_REPORT.md`.

All payload files are listed in `build/runtime-inputs.json`. Add deliberate source files there using the existing mapping. No secrets, user profiles, saves, logs, summaries, untracked local artifacts or Three-Mod code may enter source or build outputs. Source bytes are preserved by `.gitattributes`; do not normalize Prompt content.

Build tools use Node built-ins only. Runtime dependencies remain vendored in `resources/app/node_modules`, checked by `build/runtime-dependencies.lock.json`; do not install, upgrade or rebuild native dependencies as part of a source build. The existing Electron shell is reused, not rebuilt from Electron source.
