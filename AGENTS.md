# Repository instructions

- This repository contains one focused package at `packages/pi-codex-compat`.
- Keep the public surface limited to `exec_command`, `write_stdin`, `apply_patch`, and `view_image`.
- Keep tool schemas, descriptions, prompt snippets, and results compact; do not repeat the same contract across them.
- Do not add provider registration, request rewriting, authentication, context management, Code/Notebook modes, or voice features.
- Keep model activation in `src/model.ts` and config persistence in `src/config.ts`.
- Keep configuration global at `~/.pi/agent/pi-codex-compat.json`.
- Keep tests for independent parser, executor, result, and activation contracts; do not encode model-following mistakes as tests.
- Never ship local paths, personal names, or machine-specific assumptions.
- Run `npm run check` and `npm run build` from `packages/pi-codex-compat` before delivery.
- Preserve MIT attribution for the adapter and Apache-2.0 attribution for bundled native helpers.
