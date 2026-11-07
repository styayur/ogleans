# Browser bookmark integration

Browser bookmarks are an optional export destination. The canonical collection stays in Ogleans.

## Permission model

- `bookmarks` is declared as a Chrome optional permission.
- It is not requested at install time.
- The settings page requests it only after an explicit user action.
- If permission is missing, native export returns `BOOKMARK_PERMISSION_REQUIRED`.
- HTML bookmark file export does not require bookmark permission.

## Native export behavior

For each selected collection item:

1. Check whether a recorded bookmark ID still exists.
2. If no valid recorded bookmark exists, search for the same Text Fragment URL.
3. If a duplicate exists, record it without creating another bookmark.
4. Otherwise create a bookmark in the configured folder.
5. Record bookmark ID, folder and export time in the collection item.

Ogleans never updates or deletes existing browser bookmarks. The folder is created under Chrome's Other Bookmarks area if it does not exist.

## Data limitation

Browser bookmarks have a limited metadata model: title, URL and folder. Ogleans therefore keeps tags, notes, original/displayed text, translations, anchors and annotation data in local collection storage. Exporting to bookmarks never discards richer collection data.

## HTML fallback

`bookmarksHtml(items, folder)` produces a Netscape Bookmark File with:

- selected collection items only;
- escaped titles and URLs;
- Text Fragment URLs;
- no provider credentials.

The browser downloads this file. Importing it is controlled by the user and the destination browser; Ogleans does not silently merge it back into existing browser bookmarks.

## Deletion semantics

Deleting a collection item does not delete a browser bookmark. This avoids destructive cross-system synchronization and keeps exported bookmarks under the browser's ownership.
