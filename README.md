# Vinted Dataset

`vinted-dataset` is a standalone scraper and JSON dataset generator for Vinted metadata.

It is meant as a practical replacement for stale static datasets such as `teddy-vltn/vinted-dataset`, with a focus on:

- current catalog trees
- current brand ids
- current color ids
- current status ids
- region-aware output
- publishable JSON snapshots committed into the repository

The project is intentionally simple:

- a Playwright-based scraper in `src/`
- generated dataset files in `output/`
- an optional tiny HTTP server for serving the latest local snapshot

## Why this exists

Vinted metadata changes over time.

Static datasets become outdated quickly:

- categories are added or moved
- new brands appear
- region coverage changes
- localized labels differ across markets

At the same time, Vinted does not expose a stable public dataset endpoint for all of this. The relevant data is available through a mix of:

- server-rendered page payloads
- internal filter endpoints
- market-specific localized catalog pages

This repository automates collecting that data and exporting it back into plain JSON files that can be reused by other projects.

## Why Playwright instead of plain HTTP

Vinted currently protects important endpoints behind anti-bot systems such as Cloudflare challenges and DataDome-style checks.

That means:

- direct `fetch` / `axios` / raw HTTP scraping is unreliable
- internal APIs often return `403` or `503` without a valid browser session
- HTML alone is not enough for all metadata

This scraper first creates a real browser session with Playwright, then uses that same session to read:

- catalog tree data embedded in Next.js / Flight payloads
- filter metadata from Vinted internal JSON endpoints

That is the main design decision of this repository.

## What gets generated

The dataset is written into `output/`.

Current files:

- `output/brand.json`
- `output/colors.json`
- `output/statuses.json`
- `output/sizes.json`
- `output/regions.json`
- `output/_meta.json`
- `output/<region>/groups.json`

Example layout:

```text
output/
  _meta.json
  brand.json
  colors.json
  regions.json
  sizes.json
  statuses.json
  de/
    groups.json
  fr/
    groups.json
  it/
    groups.json
  ...
```

## Output format

### `brand.json`

Flat object mapping brand label to brand id:

```json
{
  "Nike": "53",
  "adidas": "14",
  "Balenciaga": "2369"
}
```

### `colors.json`

Flat array of color objects:

```json
[
  {
    "id": "1",
    "label": "Black",
    "hex": "#000000"
  }
]
```

Note:

- `hex` is only present when Vinted exposes it
- not every market returns the same color labels

### `statuses.json`

Flat array of status objects:

```json
[
  {
    "id": "1",
    "label": "Uusi ilman hintalappua",
    "type": "default"
  }
]
```

Important:

- labels are localized by the market the scraper used
- ids stay stable
- if you need multilingual labels, collect and merge them across regions in your own downstream pipeline

### `sizes.json`

Object keyed by size-group id:

```json
{
  "4": {
    "XS / 34": 2,
    "S / 36": 3
  }
}
```

Important:

- size-group coverage depends on what Vinted exposes through filter responses
- this file may remain sparse unless size extraction is extended further

### `<region>/groups.json`

Nested category tree for one Vinted market:

```json
{
  "Women": {
    "id": 1904,
    "slug": "WOMEN_ROOT",
    "children": {
      "Clothing": {
        "id": 4,
        "slug": "CLOTHING",
        "children": {}
      }
    }
  }
}
```

Node shape:

- `id`: Vinted catalog id
- `slug`: catalog code or generated fallback
- `size_id`: optional
- `children`: nested subcategories

### `_meta.json`

Metadata about the generated snapshot:

```json
{
  "generated_at": "2026-04-05T19:50:00.000Z",
  "region_count": 25,
  "roots": [],
  "scraped_regions": ["de", "fr", "it"]
}
```

## Repository structure

```text
src/
  cli.js
  config.js
  service.js

output/
  ...

package.json
Dockerfile
README.md
```

### `src/cli.js`

Entry point for:

- `scrape`
- `serve`

### `src/config.js`

Static configuration:

- supported regions
- default root catalogs
- brand search alphabet

### `src/service.js`

Core implementation:

- browser bootstrap
- catalog tree extraction
- filter endpoint calls
- JSON writing
- optional HTTP server

## Installation

Requirements:

- Node.js 20+
- npm
- Playwright Chromium

Setup:

```bash
npm install
npx playwright install chromium
```

## Usage

### Full scrape

```bash
npm run scrape
```

This will:

- create or update `output/`
- scrape all configured regions
- merge results into existing JSON files
- preserve already scraped regions on later runs

### Scrape specific regions only

```bash
REGION_CODES=de npm run scrape
REGION_CODES=de,fr,it npm run scrape
REGION_CODES=at,ie,gr npm run scrape
```

This is useful when:

- you want to bootstrap quickly
- a few markets are missing
- you want to refresh one subset without touching everything

### Control which region is used for brand discovery

```bash
REGION_CODES=de,fr BRAND_REGION=de npm run scrape
```

Brand discovery is the slowest part of the scraper.

By default, one region is used as the primary source for `brand.json`.

### Run non-headless for debugging

```bash
HEADLESS=false REGION_CODES=de npm run scrape
```

This is useful when:

- browser startup works but the scraper fails later
- you want to inspect challenge pages manually
- Vinted changes frontend behavior

## Incremental behavior

Scrapes are incremental by design.

The scraper does not wipe the dataset folder before every run.

That means:

- existing region files remain in place
- later runs can add missing markets
- global files such as `brand.json` are merged with existing data
- `_meta.json` tracks which regions have already been scraped

This is important if you plan to commit `output/` into the repository.

## Serving the dataset locally

The project also includes a minimal HTTP server:

```bash
npm run serve
```

Optional:

```bash
PORT=4010 npm run serve
```

Endpoints:

- `GET /health`
- `GET /dataset`
- `GET /dataset/brand.json`
- `GET /dataset/colors.json`
- `GET /dataset/statuses.json`
- `POST /refresh`

This is intentionally small and local-first. It is not meant to be a production API platform.

## Docker

A simple Dockerfile is included.

Build:

```bash
docker build -t vinted-dataset-service .
```

Run:

```bash
docker run --rm -p 4010:4010 vinted-dataset-service
```

If you want to persist output outside the container, mount a volume and set `DATASET_OUTPUT_DIR`.

## Environment variables

Supported variables:

- `REGION_CODES`
- `BRAND_REGION`
- `HEADLESS`
- `PORT`
- `DATASET_OUTPUT_DIR`

Examples:

```bash
REGION_CODES=de,fr BRAND_REGION=de npm run scrape
HEADLESS=false REGION_CODES=de npm run scrape
PORT=4010 npm run serve
DATASET_OUTPUT_DIR=./output npm run scrape
```

## Current scraping strategy

At a high level:

1. Launch Chromium with Playwright.
2. Open a Vinted catalog page to establish a valid browser session.
3. Read root catalogs from embedded Next.js / Flight payloads.
4. Walk each root catalog page and extract nested category trees.
5. Query internal filter endpoints for brands, colors, sizes, and statuses.
6. Merge results into JSON snapshots under `output/`.

For brands specifically:

- the scraper uses a prefix-based search strategy
- this is slower than the other metadata collectors
- this is currently the most practical way to enumerate many brand ids

## Known limitations

This repository is practical, not perfect.

Current limitations:

- Vinted can change frontend payload structure at any time
- anti-bot behavior can change without notice
- brand discovery is expensive and may still miss edge cases
- status labels are localized, not automatically multilingual
- size coverage is less complete than category coverage
- some regions may temporarily fail depending on Vinted availability
- duplicate brand ids with different labels can exist across markets

## When it breaks

The first places to inspect are:

- `src/service.js`
- `src/config.js`

Most likely breakpoints:

- catalog tree extraction from `self.__next_f.push(...)`
- internal filter endpoint parameters
- anti-bot/session behavior
- localized response shapes

Recommended debugging workflow:

1. Run with `HEADLESS=false`.
2. Limit to one region:

```bash
REGION_CODES=de npm run scrape
```

3. Watch console output.
4. Check which step failed:
   - browser launch
   - root discovery
   - catalog extraction
   - brand collection
   - filter collection

## Committing `output/` to the repo

This repository is designed to support committed snapshots.

A practical workflow:

1. Run a refresh locally.
2. Review changes in `output/`.
3. Commit both code and updated dataset files.
4. Publish the repository.

That gives users:

- the scraper itself
- a usable current snapshot immediately after clone

## Suggested publish workflow

If you move this out into its own GitHub repository, a sensible layout is:

- keep `src/`
- keep `output/`
- keep `package.json`
- keep `Dockerfile`
- keep this README
- remove unrelated Vintrack-specific files

You can then publish it as:

- a scraper tool
- a JSON dataset repository
- both

## Disclaimer

This project relies on Vinted’s live website behavior and internal responses.

Use it responsibly and expect maintenance work over time.

This is not an official Vinted project and has no guarantee of long-term API stability.
