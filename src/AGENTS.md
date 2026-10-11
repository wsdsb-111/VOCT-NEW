# V9.1 Source Guidelines

`src/app/` is the editable runtime source. `scripts/build-runtime.js` maps Main, Preload and Renderer to `resources/app/out` and default assets/package metadata to `resources/app`. Edit source first; generated resources are kept for direct VOTC.exe use and existing contract tests, then verified against the build.

Preserve current JavaScript structure, Prompt bytes, cache block IDs, IPC, persisted keys and Memory 4.0/protocol 3.0/storage 2.5. The Renderer ESM still contains existing bundled vendor code; component extraction belongs to V9.5. V9.1 does not change Context, Memory, Provider or Bridge behavior.

All payload files are listed in `build/runtime-inputs.json`. Add deliberate source files there using the existing mapping. No secrets, user profiles, saves, logs, summaries, untracked local artifacts or Three-Mod code may enter source or build outputs. Source bytes are preserved by `.gitattributes`; do not normalize Prompt content.

Build tools use Node built-ins only. Runtime dependencies remain vendored in `resources/app/node_modules`, checked by `build/runtime-dependencies.lock.json`; do not install, upgrade or rebuild native dependencies as part of a source build. The existing Electron shell is reused, not rebuilt from Electron source.
