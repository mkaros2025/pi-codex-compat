# Native binary provenance

The bundled native files were copied from the focused upstream package at
`IgorWarzocha/howaboua-pi-stuff` revision
`4593f066d447925eae8e3106435f117236690f9e`. The per-platform SHA-256 records
for `apply_patch` live beside each binary in `src/tools/apply-patch/bin/`.
No local rebuild or reproducible-build claim is made here.

Known source metadata recorded by that upstream tree:

| Helper | Upstream component | Revision |
| --- | --- | --- |
| `apply_patch` | `openai/codex` | `c4017a87aacc7558002b7cb510025e967c1d765e` |
| `exec_bridge` | `openai/codex` path tools | `d36a3ead3c896d0552207763ef483262bce9ac73` |
| `exec_bridge` | `openai/codex` `codex-utils-pty` | `b545c94041017d000e2c8b2f6272705d21b85dfb` |
| `view_image` | `openai/codex` `codex-utils-image` | `b545c94041017d000e2c8b2f6272705d21b85dfb` |

These component revisions describe the known upstream source inputs; they do
not establish the build provenance of the copied binaries. OpenAI Codex
license and notice text are included in `LICENSE-APACHE-2.0` and `NOTICE`.
The TypeScript adapter remains under the MIT license in `LICENSE`.
