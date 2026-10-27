# Contributing to MiaoMemo

Thanks for your interest in contributing!

## Prerequisites

- Windows 10/11 with WebView2 Runtime
- Node.js 20+
- Rust stable with the MSVC toolchain
- Visual Studio Build Tools with the "Desktop development with C++" workload

## Getting Started

```bash
npm install
npm run dev
```

## Tests

```bash
npm test          # JS + Rust unit tests
npm run test:js
npm run test:rust
```

For GUI regressions, follow [`tests/MANUAL.md`](tests/MANUAL.md) and inspect the
on-disk `notes.json` after each case.

## Pull Request Process

1. Fork the repository and create your branch from `main`.
2. Test your changes with `npm test` and, for UI work, the manual checklist.
3. Ensure the app builds successfully with `npm run build`.
4. Update the README/AGENTS if your change introduces new features, commands, or
   architectural constraints.

## Code Style

- Follow the existing code style and naming conventions.
- Keep functions small and focused.
- No external libraries without a good reason — MiaoMemo is intentionally
  dependency-light.
- For Rust, run `cargo fmt` and preferably `cargo clippy` before submitting.

## Reporting Bugs

Open an issue with:
- Your Windows version and WebView2 version
- Steps to reproduce
- Expected vs actual behavior
- Screenshots and the relevant `notes.json` excerpt if applicable
