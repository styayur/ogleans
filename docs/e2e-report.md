# Browser E2E report

## Result

**19/19 Chromium extension tests passed** locally on 2026-11-07.

- Runner: Playwright `1.64.1`
- Browser: Chromium `156.0.8078.4`
- Host: Windows local test run
- Extension: built `dist/chromium`, MV3 service worker
- Test-only manifest modification: localhost host grant and `bookmarks` permission for destructive bookmark API testing
- Release manifest assertion: `bookmarks` remains an optional permission and is not in required permissions

## Acceptance coverage

### Translation and rendering

- Six article fixtures: static, Wikipedia-like, GitHub-like, SPA, dynamic mutation and large.
- Translation, display-mode changes, restore, retranslation and listener preservation.
- Dynamic paragraph insertion and SPA text updates.
- 250-paragraph browser stress fixture.
- Fallback provider behavior, reverse direction, stop, failure status and restore.
- Secrets unavailable to content script.
- React and Vue reconciliation without losing framework updates.

### Concurrent providers

- Two local providers, round-robin assignment, provider concurrency and global concurrency.
- Completed paragraphs retain source order.
- Both providers receive work.
- Provider-level result provenance appears in rendered translation spans.
- Recorded server maximum concurrency is at least 2.

### Gestures and interaction

- Custom mapping added through settings and persisted.
- Duplicate mapping conflict shown before save.
- Keyboard alternatives save selections.
- Ordinary click does not trigger an action.
- Alt + click without movement does not trigger an action.
- Native context menu event remains available for an ordinary right click.
- Alt + drag intentionally saves the previously selected passage.
- Escape closes the floating collection panel.

### Translation independence acceptance

Both `external` and `disabled` modes were tested end-to-end:

- no Ogleans translation spans are created;
- gestures remain active;
- selection capture remains active;
- collection remains active;
- annotations and tags can be edited;
- search works;
- Markdown and JSON exports work;
- external mode records the item as a displayed selection rather than inventing original text.

This is the defining acceptance condition for v0.2.0-alpha.1.

### Collections and bookmarks

- Collection creation, persistence, search, notes, tags and editing.
- Markdown and JSON export contents.
- Native bookmark export in an actual Chromium bookmark store.
- Existing bookmark preservation.
- Duplicate bookmark export does not create duplicates.
- Optional permission declaration is checked from the release manifest.
- Netscape HTML bookmark fallback downloads and contains bounded collection data.

## Screenshots produced by E2E

- [Settings](assets/extension-settings-v0.2.0-alpha.1.png)
- [Collection while translation is disabled](assets/collection-disabled.png)
- [Collection while external mode is active](assets/collection-external.png)

## Limitations

- Firefox packaging was not run and is not claimed as supported.
- Arbitrary third-party translation extensions cannot be automated because they do not expose a universal public API.
- Browser-native translation could not be asserted headlessly; the documented workflow is passive.
- The browser stress fixture is 250 paragraphs. Larger scanner scale is covered by the performance benchmark.
- Test-only grants are not part of the release manifest.
- CI results for the final commit are recorded separately in the pull request and release notes.
