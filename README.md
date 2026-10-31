# MyGita media

This repository is the portable content root used locally and at `https://media.gitajyoti.org/`.

Its stable top-level contract uses singular media names:

- `book/` contains canonical structured content, localized metadata, reusable resource catalogs and experience associations.
- `audio/`, `image/` and `video/` contain binary media. Binary media is loaded on demand.
- `catalog.json` is the atomic root catalog. Every path declared by the root and book manifests is relative to this repository root.

MyGita owns the application, product identity, renderer configuration, interface translations and schema implementation. This repository owns mutable scripture content. Existing audio paths remain supported while scripture-scoped paths are introduced in a later compatibility migration.

Run `npm test` before publishing. A content deployment must publish files and book manifests before publishing `catalog.json`.
