# Media repository guidance

The portable content root for MyGita, served at `https://media.gitajyoti.org/`. Read `README.md` for the full contract.

## Ownership
- Claude owns `media` (content, registries, manifests, inventories, scripts, tests, publishing).
- If you are Codex: do not edit this repo; hand media changes to Claude through the user.

## Workflow
1. Approval first: propose the change and wait for the user's explicit yes. Reading, analysing and running tests need no approval.
2. Plan first: number the steps, and end each with a check that can be run ("Accept when: …").
3. Tests first. Never change a test only to make half-done code pass.
4. Finish each step with tests green, then propose a commit (author vjmaker <vijayakumar.puttaraju@gmail.com>; no AI or assistant attribution).
5. Checkpoint after each step: what is done, in progress and not started, plus the files touched. For work across repos, record it in `mygita-app/context/now.md`.
6. Kit changes needed from Codex go in mygita's feature file (Open section, with an id and a status), following `mygita-app/context/README.md`.

## Layout
- `book/<book>/`: canonical structured content (`manifest.json`, `verses/`, `experience/`, `registry/`, `runtime/`, …). Books: `bhagavad-gita`, `ganesha-atharva`, `purusha-sukta`.
- `audio/`, `image/`, `video/`, `deck/`: binary media, loaded on demand. Don't read or grep these.
- `registry/`: shared CSVs (contributors, cue purposes, languages).
- `catalog.json`: books and mount inventory parts. `files.json`: hash, size, MIME type and contract for every physical path. Both are generated, so don't hand-edit them.
- `media.ver`: identifies the active root catalog.

## Commands
- `pnpm build:inventory`: run after physical files or book manifests change.
- `pnpm test`, then `pnpm validate`.
- `pnpm publish`: publishing needs the user's explicit yes. Order: files and secondary mounts first, then `catalog.json`, with `media.ver` last.

## Consumers
`mygita-app` (Content-Kit) and `media-admin` read this format. Changing the structure or contract affects both.
