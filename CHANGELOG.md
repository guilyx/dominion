# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- A release now republishes the site, so `/play/` serves the version that was just cut.
  The release workflow pushes the version bump with the workflow token, and GitHub never
  starts a workflow from such a push, so the Pages workflow was never reaching the bump at
  all — the path filter was beside the point. A `workflow_run` trigger on the Release
  workflow is what actually does it, and a static check now fails if that trigger goes
  missing or stops pointing at Release.

## [1.2.1] - 2026-11-03

### Fixed

- The Pages workflow now rebuilds when `package.json` changes. A release bumps the version
  there and the playable page is stamped with it, so without this `/play/` kept advertising
  the previous release until an unrelated change happened to touch the game. A static check
  now fails if anything `index.html` loads is missing from that path filter.

## [1.2.0] - 2026-11-03

### Added

- A project site, published to GitHub Pages: a landing page, a how-to-play guide and
  architecture notes, with the game itself playable at `/play/` from the same single-file
  build that ships on the releases page.
- `tools/check-site-links.mjs`, which fails the build if a site link, in-page anchor or
  screenshot does not resolve, or if a screenshot is never referenced by any page. CI
  assembles the site and runs it on every pull request.

## [1.1.0] - 2026-11-03

### Added

- Desktop builds for Windows, macOS and Linux: an NSIS installer and a portable `.exe`,
  `.dmg` and `.zip` for both Mac architectures, and an AppImage and `.deb`. The game runs
  in an Electron shell with no Node access in the page.
- One-line installers. `install.sh` picks the right build for the machine, installs it,
  and on macOS clears the download quarantine so the first launch is not blocked; on
  Linux it also writes a desktop entry. `install.ps1` runs the Windows installer
  silently, or fetches the portable build with `-Portable`.
- A portable single-file build: the whole game in one HTML file, no server, no network.
- Continuous integration on every pull request: data and syntax checks, a headless
  playthrough of the portable build, and a packaging check that launches the packaged
  app and plays a land in it.
- `npm start`, a dependency-free static server, so no Python is needed to run the game
  from source on any platform.
- Villager skills: experience per job, six ranks, and a Legend who speeds up everyone
  working at the same building.
- Ages driven by Insight from scholars at a Library, unlocking buildings by era.
- Civilization-style hex adjacency for fields, mines, altars, houses, markets and
  harbours, shown in the building panel.
- New buildings and trades: library, granary, market, harbour, herbalist, tavern,
  monastery, obelisk, terraces and the Great Pyramid.
- Holy units: missionaries who preach in rival towns, and emissaries who win favour.
- Live per-minute production figures on every stockpile, with produced and consumed
  broken out in the stats tab.

### Changed

- The build menu is grouped into five categories, so it stays one screenful however
  many buildings exist, and every panel is capped to the window height.
- Slower early game: costlier buildings, slower births, and 450 renown per Tribute.
- Bigger maps with domain-warped coastlines, islets, lakes, and savanna and volcanic
  biomes.

### Fixed

- The worker-assignment panel's "available" count now matches exactly what the + button
  can assign.
- The Windows installer and portable build no longer write to the same filename.
- The package licence matches `LICENSE` (Apache-2.0).

[Unreleased]: https://github.com/guilyx/dominion/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/guilyx/dominion/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/guilyx/dominion/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/guilyx/dominion/releases/tag/v1.1.0
