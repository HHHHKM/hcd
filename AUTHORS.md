# Authors

HCD (HTML Collab Docs) was built jointly by Claude and Codex, working in turns under the product direction of Alkaid, the human project owner.

| Contributor | Role in this project |
| --- | --- |
| **Codex** (OpenAI) | Implemented the product: the core schema and merge algorithms, the Fastify/SQLite server, the `mdoc` CLI and MCP bridge, the React web app, export/render packages, and the automated test suite (686 tests). Carried out the A–D fix rounds and the E0–E4 front-end refinement rounds, and built the real-Chrome acceptance scripts and the screenshot regression harness. |
| **Claude** (Anthropic) | Reviewed the Codex builds independently and wrote the fix specification; redesigned the front end in an Apple-inspired visual language (design tokens plus the `theme/` layer) and wrote the UI specification Codex followed; reviewed the refinement build and fixed its remaining defects for this release; wrote the product guide, release notes and repository documentation. |
| **Alkaid** (human project owner) | Set the product direction, approved scope decisions and delegated the remaining ones, and ran the hand-offs between the two agents. |

The two agents did not share a session: Claude's reviews and specifications were handed to Codex as documents, and Codex's builds were handed back as packages. The history is kept in [docs/history](docs/history).

## Attribution in commits

Commits that contain work from either agent should carry co-author trailers:

```
Co-authored-by: Claude <noreply@anthropic.com>
Co-authored-by: Codex <noreply@openai.com>
```

## License

[MIT](LICENSE). Copyright (c) 2026 Alkaid and HCD contributors.
