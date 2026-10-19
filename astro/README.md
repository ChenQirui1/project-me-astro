# project-me

Personal site — Astro, statically built, deployed to Cloudflare Workers.
Images live in R2; projects are authored in Confluence and published selectively.

## Commands

| Command                | Action                                                        |
| :--------------------- | :------------------------------------------------------------ |
| `pnpm dev`             | Dev server at `localhost:4321` (serves `/img/*` from `assets/`) |
| `pnpm build`           | Static build to `./dist/`                                      |
| `pnpm preview:cf`      | Build, then serve via `wrangler dev` — exercises the real Worker + R2 binding |
| `pnpm test`            | Unit tests for the Confluence → Markdown conversion & metadata parsing            |
| `pnpm sync:confluence` | Pull published Confluence pages into `src/content/projects/`         |
| `pnpm assets:push`     | Upload changed files in `assets/` to R2                        |
| `pnpm assets:pull <key>` | Fetch one object out of R2 into `assets/`                    |
| `pnpm deploy`          | Build and deploy to Cloudflare Workers                         |
| `pnpm build:ci`        | What Cloudflare runs: sync Confluence, push assets, then build |

Copy `.env.example` to `.env` before running the sync.

## Images (R2)

The bucket `project-me-assets` is **private** — nothing is publicly reachable on
R2 itself. Every read goes through `worker/index.ts`, the Worker holding the
only binding to it, which serves same-origin URLs:

```
assets/projects/clearweb.png   →   r2://project-me-assets/projects/clearweb.png
                               →   https://<site>/img/projects/clearweb.png
```

`assets/` is the local mirror and the thing you edit; `pnpm assets:push` uploads
whatever changed, tracked by md5 in a `.manifest.json` key **in the bucket**.
It lives there rather than in git because `assets/confluence/` is rebuilt from
Confluence on every build and is no longer committed — a manifest in the repo
would go stale at once and force a full re-upload each time. `walk()` skips
dotfiles and the Worker refuses dot-prefixed keys, so it is neither uploaded as
an asset nor readable at `/img/.manifest.json`.

Reference images through `asset()` from `src/lib/assets.ts`. It maps a content
key to `/img/...` and passes absolute URLs through untouched, so the gallery's
Unsplash links keep working:

```astro
import { asset } from "../lib/assets";
<img src={asset(project.data.thumbnail)} />
```

Responses carry `max-age=86400, stale-while-revalidate=604800`. Keys are stable
paths overwritten in place, so responses are deliberately **not** `immutable` —
a replaced image propagates within a day rather than being pinned for a year.
The Worker also honours `Range` and `If-None-Match` (304).

The Worker doesn't run under `astro dev`, so `integrations/dev-assets.mjs`
wires an equivalent `/img/*` route into the dev server reading from `assets/`.
The same URL therefore works in dev, under `wrangler dev`, and in prod.

## Projects (Confluence)

Confluence is the working archive — every project lives there, however
unfinished. This site is the **curated publishing layer** on top of it: only
what you explicitly publish crosses over.

**To publish:** set the page's **status** to `Ready for Publish` — the lozenge
in the Confluence page header, next to the title. The next run of
A Confluence automation rule POSTs the Cloudflare deploy hook, which starts a
build that converts the page to Markdown, mirrors its attachments into R2, and
deploys. **Change the status** and the project is deleted from the site on the
next build.

Two separate questions decide what crosses over:

| Question | Answered by |
| :--- | :--- |
| Is this a project page at all? | where it sits — only pages under `CONFLUENCE_ROOT` |
| Is it ready to be seen? | the page status in the page header |

| Page status | Effect |
| :--- | :--- |
| `Ready for Publish` | published to the site |
| `Rough draft`, `In progress`, `Ready for review`, `Verified` | withheld |
| *(no status)* | withheld — so a new page is safe by default |

Both questions are CQL clauses, so Confluence does the filtering and the sync
only ever downloads pages that are actually publishable. Notes, templates and
scratch pages elsewhere in the space are never considered, and the section pages
(`Creative Works`, `Research`, …) are withheld for free by never carrying the
status. No labels are involved, and nothing in the page body decides anything.

The status name is exact — it is matched by Confluence, not parsed here — so a
status that doesn't exist matches nothing and publishes nothing. `pnpm
sync:confluence --dry-run` lists every page it considered and withheld, which is
the quickest way to see why something isn't appearing.

**Indexing lag.** CQL reads Confluence's search index, which trails a status
change by anything from seconds to minutes. A sync started immediately after you
set a status can still miss it, and the following run picks it up. So if a page
plainly shows the status in its header but `--dry-run` reports it withheld, wait
and re-run before going looking for a bug — that gap is expected. `GET
/rest/api/content/<id>/state` reads live and bypasses the index, which is the
way to tell the two apart.

**Setup, once:** `Ready for Publish` is a *custom* content state and has to
exist before it can be set. Confluence ships `Rough draft`, `In progress`,
`Ready for review` and `Verified`; add `Ready for Publish` in **Space settings →
Content states** for the Portfolio space. To use one of the built-in states
instead, point `CONFLUENCE_PUBLISH_STATUS` at it and skip the custom one.

### Metadata block

Put a metadata block at the top of each project page. Either a two-column table
or labelled lines work, and the bullet style the older pages use is understood
too:

```text
Slug: take-a-seat
Year: 2023
Project type: VR artwork
Discipline: VR, 3D
Context: Independent
Status: completed
Documentation: complete
Featured: yes
```

Placeholders (`[TBD]`, `n/a`, `—`) count as absent rather than publishing the
literal text, so a scaffolded page is safe to leave sitting in the tree. The
block is stripped from the body so it doesn't render twice.

Recognized fields: `Slug`, `Year`, `Project type`, `Discipline(s)`, `Context`,
`Status`, `Documentation`, `Publication`, `Featured`, `Hero media`, `Summary`,
`Role`, `Collaborators`.

Every field here is **descriptive only** — none of them decide what publishes;
the page status does that, on its own. In particular `Status` means where the
project itself stands (ongoing, completed, archived, abandoned) and shows up in
the catalogue record at the bottom of the project page: a completed project can
sit unpublished, and an ongoing one can be live. `Publication` and
`Documentation` are recorded in the frontmatter in the same descriptive way.

`Featured` pins a project to the top of `/projects`. Where the page sits in the
Confluence tree becomes its `category` / `subcategory` — `Portfolio Home >
Digital Products > Tools > ClearWeb` yields category "Digital Products",
subcategory "Tools".

### Hand-authored vs synced

Both live in `src/content/projects/`. A file carrying `confluenceId` in its
frontmatter is **generated** and will be overwritten; a file without it is
hand-authored and the sync never touches it.

If a Confluence page's slug collides with a hand-authored file, the sync
**skips it and says so** rather than overwriting your work. Delete the local
file to hand that slug over to Confluence.

### How the conversion works

Confluence "storage format" is XHTML carrying namespaced `ac:`/`ri:` elements
that Turndown can't read. `scripts/confluence-storage.mjs` lowers those to plain
HTML first — code macros to fenced blocks, info/note/warning panels to
blockquotes, `ac:image` to `<img>` pointing at the R2 proxy, internal `ac:link`s
to `/projects/...` when the target is also published (and to plain text when it isn't,
so unsynced pages never leak a dead link) — and only then runs Turndown.

`pnpm test` covers that conversion with fixtures. Run it before trusting a
change to the conversion — it is the only guard against a mangled post.

### Running it by hand

```sh
pnpm sync:confluence --dry-run   # report what would change, write nothing
pnpm sync:confluence
pnpm assets:push
```

## Deployment

Static output served from Cloudflare Workers. `wrangler.jsonc` holds the Worker
name, the `dist/` assets binding, the `/img/*` `run_worker_first` route, and the
R2 binding. Every path except `/img/*` is served straight from static assets
without invoking the Worker at all.

```sh
pnpm deploy   # build and deploy from your machine
```

CI runs the same thing from `.github/workflows/deploy.yml`: `pnpm build:ci`,
which syncs Confluence, mirrors attachments to R2, then builds, followed by
`wrangler deploy`. **Synced content never enters git** — it exists only in the
runner and in the deployed output. Confluence stays the archive; the repo stays
code and styling.

Two things deploy, and both run that same build, so every deploy carries the
current code *and* the current Confluence content:

| Trigger | Mechanism |
| :--- | :--- |
| Push to `master` | `on: push` |
| Confluence publish | `repository_dispatch`, fired by a Confluence automation rule |

GitHub Actions is the builder rather than Cloudflare Workers Builds, which
rejects its own freshly-issued build tokens ("the build token selected for this
build has been deleted or rolled"). Nothing about the runtime changes — only
who runs the build — and Actions minutes are free and unlimited on a public
repo. If Workers Builds is ever fixed, the equivalent setup is a deploy hook
POSTed from the same Confluence rule; disconnect the git integration first so
the two don't both deploy.

Required repository **secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`. Required
**variable**: `CONFLUENCE_ROOT`. Optional variables:
`CONFLUENCE_PUBLISH_STATUS`, `CONFLUENCE_SPACE_KEY`.

`CLOUDFLARE_API_TOKEN` needs two permissions, because one token both deploys
and writes assets: **Workers Scripts: Edit** and **Workers R2 Storage: Edit**.

A failed build leaves the previous deployment live, so an expired Confluence
token cannot take the site down.
