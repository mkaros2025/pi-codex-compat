# pi-codex-tools

Focused fork of the Codex tool adapter for Pi. It keeps only:

- `exec_command`
- `write_stdin`
- `apply_patch`
- `view_image`

The tools activate automatically for model IDs beginning with `gpt` by default.
Use `auto`, `on`, or `off` in `pi-codex-tools.json`, and adjust
`modelPrefixes` when needed. Project settings are read only for trusted folders.

```bash
pi install git:github.com/mkaros2025/pi-codex-tools
```

See [`packages/pi-codex-conversion/README.md`](./packages/pi-codex-conversion/README.md).

The TypeScript adapter retains its upstream MIT license and attribution.
Bundled native helpers are derived from OpenAI Codex and redistributed under
Apache-2.0; see the package notices.
