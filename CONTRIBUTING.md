# Contributing to Vetch

Thanks for helping improve Vetch. These notes keep the project maintainable and easy to review.

## Getting ready

- Node.js 22+
- pnpm 11.1.2 (the exact version is declared in `package.json` for Corepack)
- Rust stable (install via [rustup](https://rustup.rs/))
- Platform system packages for Tauri — see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
pnpm install
pnpm run setup
pnpm run dev
```

## Useful scripts

| Command | Purpose |
| --- | --- |
| `pnpm run dev` | Launch the Tauri desktop app with hot reload |
| `pnpm run dev:vite` | Frontend-only Vite server (no native engine) |
| `pnpm run setup` | Download yt-dlp / FFmpeg / Deno for this platform |
| `pnpm run check` | Ultracite lint, i18n parity, TypeScript, cargo check |
| `pnpm test` | Run Vitest unit tests |
| `pnpm run build` | Production Tauri bundle |
| `pnpm run fix` | Auto-fix formatting and lint issues |

## Coding standards

- This project uses **Ultracite** (Biome under the hood). Run `pnpm run fix` before committing.
- Prefer clear, explicit TypeScript. Avoid `any`; use `unknown` when the type is genuinely unknown.
- Keep React components focused. Hook dependencies must be complete.
- i18n keys in `src/locales/en.json` and `src/locales/zh-CN.json` must stay in sync — `pnpm run check:i18n` enforces this.
- Rust code lives under `src-tauri/src/`. Match the existing style (early returns, descriptive errors, camelCase serde).

## Project structure

```text
src/                  React frontend
src/components/       UI components
src/locales/          Translations
src/lib/              Tauri invoke bindings and helpers
src-tauri/src/        Rust backend (downloader, storage, browser)
scripts/              Dev tooling and binary setup
.github/workflows/    CI and multi-platform release
```

## Pull requests

1. Keep PRs focused — one concern per PR when possible.
2. Run `pnpm run check && pnpm test` locally before opening a PR.
3. Update locales if you add user-facing strings.
4. Describe the user-visible change and any follow-up work in the PR body.

## Reporting issues

- Include OS, architecture, and Vetch version.
- For download failures, attach the per-task log (expand the row → Logs), but remove credentials, cookies, private URLs, tokens, and sensitive local paths first.
- Search existing issues before filing a duplicate.
- Report suspected vulnerabilities privately according to [SECURITY.md](SECURITY.md), never in a public issue.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
