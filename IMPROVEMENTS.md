# Future Improvements

Tracked improvements for the Tilt Launcher project. Items are roughly prioritized.

## Publishing & Distribution

- [ ] **CHANGELOG.md** — Add a changelog for the SDK and sidecar packages. Consider using [Changesets](https://github.com/changesets/changesets) for automated changelog generation from commit messages.
- [ ] **Platform-specific sidecar binaries** — Currently the sidecar is compiled for the host platform only (macOS arm64). Use a CI matrix build to compile for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`. Distribute via the `optionalDependencies` pattern (see esbuild, biome, turbo for reference).
- [ ] **Automated npm publish via CI** — The GitHub Action at `.github/workflows/publish-packages.yml` currently requires manual `workflow_dispatch`. Consider triggering automatically on git tag push (`v*`).
- [ ] **Windows sidecar support** — Add `win32-x64` compilation target and update the sidecar's `os` field.

## Code Quality

- [ ] **Shared ESLint config for publishable packages** — The root ESLint config is Svelte-coupled. Create a lightweight TS-only config for SDK and sidecar.
- [ ] **Monorepo tooling evaluation** — Evaluate [Changesets](https://github.com/changesets/changesets) or [Nx](https://nx.dev) for version management if the number of publishable packages grows beyond 2-3.

## SDK

- [ ] **Fix pre-existing TS lint in `sdk.e2e.test.ts`** — Line 161: `snap.envs[ENV_ID]?.status` — the optional chaining makes the type `string | undefined`, but `toContain` expects `string`.
