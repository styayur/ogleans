# Migrating Translation Kernel v0.1 to Ogleans v0.2

## Configuration

Ogleans accepts `schemaVersion: 1` configuration and migrates it to `schemaVersion: 2` when loaded.

Preserved fields:

- source and target language;
- display mode and placement;
- provider definitions, base URLs, model names, keys, headers and timeouts;
- primary and fallback provider IDs;
- site rules;
- custom URL actions.

New defaults added by migration:

- translation mode `built-in`;
- round-robin strategy;
- global concurrency `3`;
- one retry and a 20-second scheduler timeout;
- provider concurrency `1` and weight `1`;
- default gesture and keyboard mappings;
- collection dictionary and bookmark settings;
- optional bookmarks disabled.

After migration, configuration validation still applies. Invalid or unsafe entries reject rather than silently becoming permissive. Exported configuration remains secret-redacted.

## Stored collections

v0.1 did not ship a collection UI, but imports may have used provisional keys. Ogleans reads:

- `ogleans.collections.v1` (current)
- `translationKernel.collections`
- `tk.collections`

When the current key is absent, a legacy key can be used as the source. Existing legacy keys are not deleted by the read path, which keeps migration recoverable.

## Translation nodes

Generated translation nodes are page-session data and are not stored. Restore or reload the page after changing extension identity or path. No page-history database exists.

## Unpacked extension IDs

Repository rename does not by itself define browser compatibility. For an unpacked Chrome extension, the extension ID may depend on the installation path. If moving from the old folder to a new one changes that ID, local extension storage may not be visible in the new installation.

Before moving an unpacked installation:

1. Export configuration without secrets.
2. Use **Backup JSON** for collections.
3. Load Ogleans from its new folder.
4. Re-enter provider secrets.
5. Import configuration and collections.

There is no claim that an unpacked extension ID can always be preserved across arbitrary path or packaging changes.

## Rollback

Ogleans stores configuration under the existing `config` key and collection data under a new versioned key. Keep a v0.2 JSON collection backup before rolling back. A v0.1 build does not understand collection records or v2 configuration fields.

## Firefox

Firefox packaging was not independently validated for v0.1 or v0.2. Migration does not add a Firefox support claim.
