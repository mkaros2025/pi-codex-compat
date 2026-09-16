# pi-codex-compat

Focused fork of the Codex tool adapter for Pi. It keeps only:

- `exec_command`
- `write_stdin`
- `apply_patch`
- `view_image`

The tools activate automatically for model IDs beginning with `gpt` by default.
Use `auto`, `on`, or `off` in the global `pi-codex-compat.json`, and adjust
`modelPrefixes` when needed.

```bash
pi install git:github.com/mkaros2025/pi-codex-compat
```

The Git installation loads the tracked TypeScript source directly. The npm
package uses its compiled `dist` entrypoint.

After publishing the npm package:

```bash
pi install npm:@mkaros2025/pi-codex-compat
```

See [`packages/pi-codex-compat/README.md`](./packages/pi-codex-compat/README.md).

The TypeScript adapter retains its upstream MIT license and attribution.
Bundled native helpers are derived from OpenAI Codex and redistributed under
Apache-2.0; see the package notices.
