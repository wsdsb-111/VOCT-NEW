# Repository Guidelines

## Project Structure & Module Organization

This repository is a Windows-packaged VOTC application for Crusader Kings III.

- `resources/app/out/main/main.js`: bundled Electron main-process logic.
- `resources/app/out/renderer/`: bundled renderer assets.
- `resources/app/default_userdata/`: default prompts, localization, and action scripts.
- `scripts/`: migration utilities and regression tests, including `test-action-system.js`.
- `locales/`: Electron UI translations.
- `README.md` and `README_摘要系统.md`: architecture, release notes, and summary behavior.
- `VOTC.exe`: packaged application entry point.

Prefer editing the smallest relevant packaged file. Preserve existing user-data formats and do not commit API keys or `%APPDATA%\VOTC` data.

## Scoped Instructions

This repository uses layered `AGENTS.md` files. Read the guide closest to the file being changed:

- `resources/app/out/main/AGENTS.md`: bundled main-process behavior and prompt/action routing.
- `resources/app/default_userdata/actions/standard/AGENTS.md`: shipped CK3 action definitions.
- `scripts/AGENTS.md`: regression tests and maintenance scripts.


## Build, Test, and Development Commands

Run from the repository root in PowerShell:

```powershell
node scripts\test-action-system.js
node --check resources\app\out\main\main.js
```

The first command runs action-trigger and action-script regression checks. The second validates bundled main-process syntax. There is no root `package.json` build script; dependencies and metadata are under `resources/app/package.json`. Launch `VOTC.exe` for manual smoke testing after code changes.

## Coding Style & Naming Conventions

Use JavaScript with two-space indentation, semicolons, and `camelCase` for variables/functions. Use `PascalCase` for classes and descriptive action IDs such as `becomeLoversWith`. Keep action definitions in `resources/app/default_userdata/actions/standard/` and declare registry metadata such as `triggerCategories` when adding an action. Match the surrounding bundled style; avoid broad formatting or generated-file rewrites.

## Testing Guidelines

Add deterministic cases to `scripts/test-action-system.js` for every new trigger, including positive, question/future, failed-attempt, and descriptive-dialogue cases. Run the regression script and `node --check` before submitting. Use `node scripts\test-release.js` as the release gate; `scripts\test-manifest.js` is the single inventory for direct and nested checks, and CI executes the same entry point. Manual testing should cover the relevant CK3 log/data path and the configured model provider.

## Commit & Pull Request Guidelines

Recent commits use concise Chinese phase/fix summaries, for example `v6.4动作模型优化第一阶段` and `v6.3第六阶段Bug修复`. Follow that style: state the version or phase and the user-visible change. Pull requests should describe behavior changes, list validation commands, mention affected packaged paths, and include screenshots or usage statistics for UI/token/cache changes. Keep unrelated generated assets out of the change.

## Security & Configuration Tips

Never commit API keys, provider configuration, game saves, logs, summaries, or usage analytics. Treat `resources/app/default_userdata/` as shipped defaults; changes there can be copied into user data on startup. Back up local summaries before migration or destructive maintenance.
