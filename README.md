# MyGita media

This repository is the portable content root used locally and at `https://media.gitajyoti.org/`.

Its stable top-level contract uses singular media names:

- `book/` contains canonical structured content, localized metadata, reusable resource catalogs and experience associations.
- `audio/`, `image/` and `video/` contain binary media. Binary media is loaded on demand.
- `media.ver` cheaply identifies the active root catalog.
- `catalog.json` declares books and split-ready mount inventory parts. Its mount `prefixes` remain authoritative transitional runtime routing metadata until the Tranche 2 inventory cutover; they do not define Content-Kit ownership.
- `files.json` explicitly records every physical path's hash, size, MIME type and Content-Kit contract.

MyGita owns the application, product identity, renderer configuration, interface translations and Content-Kit implementation. This repository owns mutable scripture content. Logical paths remain the readable identity used by books, collections and experiences.

Run `pnpm build:inventory` after physical files or book manifests change, then run `pnpm test`. A content deployment must publish files and secondary mounts before the primary `catalog.json`, with `media.ver` last. Full writable multi-mount publication arrives in Content-Kit 3 Tranche 2.
