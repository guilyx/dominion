# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/guilyx/baw/commits/main
