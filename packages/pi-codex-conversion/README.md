# pi-codex-compat

A small Pi extension that exposes four Codex-shaped tools:

- `exec_command` — persistent shell sessions
- `write_stdin` — write to or poll a session
- `apply_patch` — apply Codex patch text
- `view_image` — return a local image to the model

The extension changes only the active tool set. It does not register a provider,
rewrite requests, alter authentication, manage context, or add Code/Notebook
modes.

## Activation

Tools are registered at startup and enabled on every `session_start` and
`model_select` event:

- `auto` (default): enable when the model ID starts with one of `modelPrefixes`
- `on`: enable for every model
- `off`: never enable

Configuration is independent of other extensions:

```json
{
  "mode": "auto",
  "modelPrefixes": ["gpt"]
}
```

Global config: `~/.pi/agent/pi-codex-tools.json`
Trusted project config: `<project>/.pi/pi-codex-tools.json`

A trusted project file overrides the global values. Untrusted project files are
ignored. Use `/codex-tools` to inspect settings, or:

```text
/codex-tools auto
/codex-tools on
/codex-tools off
/codex-tools prefixes gpt,o3
/codex-tools project auto
```

## Permission system

When `@gotgenes/pi-permission-system` is installed, `apply_patch` checks every
update source for `path_read` and `path_write`, every move destination for
`path_write`, and adds the matching external-directory surfaces outside the
working directory before mutating files. `ask` and `deny` results are never
silently treated as allows; if a service announced for this session cannot be
loaded, the patch is refused. An unannounced, absent optional service adds no
extra check. `write_stdin` remains an ordinary separately gated tool. To gate
`exec_command` through the permission system's shell parser, add this to its
permission-system config:

```json
{
  "shellTools": {
    "exec_command": {
      "commandArgument": "cmd",
      "workdirArgument": "workdir"
    }
  }
}
```

`write_stdin` writes to an already-started interactive shell; configure and
review `exec_command` before allowing additional input.

## Install from this repository

```bash
pi install git:github.com/mkaros2025/pi-codex-tools
```

The Git installation loads the tracked TypeScript source directly. The npm
package uses its compiled `dist` entrypoint.

After publishing the npm package:

```bash
pi install npm:@mkaros2025/pi-codex-compat
```

Native helpers are bundled for Linux, macOS and Windows on x64 and arm64.

This is a focused fork of
[`pi-codex-conversion`](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/4593f066d447925eae8e3106435f117236690f9e/packages/pi-codex-conversion).
The TypeScript adapter remains MIT-licensed. Bundled native helpers are derived
from OpenAI Codex under Apache-2.0; see `NOTICE`, `UPSTREAM-NATIVE.md`, and
`THIRD_PARTY-NATIVE.md` for the fixed native dependency inventory and license texts.
