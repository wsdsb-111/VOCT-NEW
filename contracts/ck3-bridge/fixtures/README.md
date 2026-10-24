# Bridge fixtures

Every fixture is a synthetic static-contract example. None is a CK3 capture or evidence that the game emitted a Hello line.

- `hello-valid.json` contains all nine declared capabilities and a concrete example load token.
- `hello-legacy.json` represents a load boundary with no Bridge Hello.
- `hello-invalid.json` uses an unsupported protocol major.
- `hello-missing-required.json` omits `character_export`, required by the conversation feature.
- `hello-optional-missing.json` omits `action_readback`; other features stay independently available while action confirmation is degraded.
- `hello-different-base-versions.json` declares different Mod/upstream base versions while retaining a supported protocol and all required capabilities; base-version metadata does not gate compatibility.
- `hello-unknown-required.json` rejects an unknown capability marked with `!`.
- `hello-unknown-optional.json` ignores an unknown capability without `!`.

The `expected` member documents protocol and per-feature outcomes. Runtime checks must still bind a parsed Hello to the current log identity and load boundary before treating it as current-session evidence.
