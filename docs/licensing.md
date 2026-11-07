# License boundaries

The studio policy categorizes reusable engines as MPL-2.0 and full applications as GPL/AGPL. Ogleans deliberately keeps both categories:

| Path/artifact                                                                 | License                                                                                |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/**`, `examples/**`                                                  | MPL-2.0 reusable engine, gesture/scheduler/collection modules and integration examples |
| `apps/browser-extension/**`                                                   | GPL-3.0-or-later full application                                                      |
| root project documents, `docs/**`, `tests/**`, `scripts/**`, CI/configuration | MPL-2.0 supporting the reusable software project                                       |
| `ogleans-sdk-*.zip`                                                           | MPL-2.0; bundled ESM reusable library                                                  |
| `ogleans-chromium-*.zip`                                                      | GPL-3.0-or-later combined application, with included MPL-source notices                |
| third-party files/dependencies                                                | Original upstream terms                                                                |

MPL-covered files are not designated Incompatible With Secondary Licenses. MPL Section 3.3 permits their inclusion in the GPL application; the original reusable source files remain available under MPL. Release source is the tagged public repository. There is no proprietary dual-license exception, CLA or reassignment of third-party rights.

The rename from Translation Kernel does not relicense existing or new code. The v0.1 browser application, third-party dependencies and documentation retain their original copyright and license terms. See [NOTICE](../NOTICE) and [THIRD_PARTY.md](../THIRD_PARTY.md).
