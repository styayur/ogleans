# Collection schema v1

Collections are canonical local passages, not translation history. A translation is optional metadata on an item.

## Storage

- Key: `ogleans.collections.v1`
- Legacy keys read during migration: `translationKernel.collections`, `tk.collections`
- Maximum items: 10,000
- Maximum text per item: 10,000 characters
- Maximum note: 5,000 characters
- Maximum tags: 24, each 64 characters
- Maximum translations per item: 8
- Writes are serialized through the collection store

## Item shape

```ts
interface CollectionItem {
  schemaVersion: 1;
  id: string;
  text: string;
  originalText?: string;
  captureKind: 'original' | 'displayed-selection' | 'displayed-translation';
  translations: CollectionTranslation[];
  source: {
    url: string;
    title: string;
    author?: string;
    sourceLanguage?: string;
  };
  anchor: TextAnchor;
  tags: string[];
  note?: string;
  createdAt: string;
  updatedAt: string;
  annotation: Record<string, unknown>;
  bookmarkExports: BookmarkExport[];
}

interface CollectionTranslation {
  text: string;
  providerId?: string;
  providerLabel?: string;
  provenance: 'built-in' | 'external' | 'displayed-page';
  capturedAt: string;
}
```

`text` is always the text the user selected or the displayed excerpt. `originalText` is present only when Ogleans can identify a different original passage. `captureKind` prevents ambiguity.

## W3C annotation

The `annotation` object is compatible with the Web Annotation data model shape:

- `@context`: `http://www.w3.org/ns/anno.jsonld`
- `id`: `urn:ogleans:annotation:<collection-id>`
- `type`: `Annotation`
- `motivation`: `highlighting`
- `body`: optional `TextualBody` entries for notes and translations
- `target.source`: source URL
- `target.selector`: TextQuoteSelector and TextPositionSelector

The collection item remains the richer native record. Bookmark exports do not replace it.

## Search

Search is case-insensitive over selected text, original text, title, URL, note, tags and available translations. Tag filters require at least one selected tag per item. Results are sorted newest-first and bounded to 200 per query.

## Edits

Users can update tags and notes through the floating collection surface. Text and translation arrays are validated on import/update. The W3C annotation modification time is regenerated.

## Deletion

Deleting an item removes the Ogleans record. It does not delete a browser bookmark that was previously exported. This is intentional: bookmarks are an optional destination, not a synchronized canonical store.

## Backup and import

- JSON export includes a schema version, export type, export timestamp and all items.
- Markdown export is human-readable and not intended as a lossless restore format.
- JSON import supports `merge` (newer `updatedAt` wins per ID) and `replace`.
- Imports are bounded and validated.
- Exports contain no provider credentials or custom request headers because those fields are not part of collection records.

## Operation without translation

Creating, listing, searching, editing, deleting, importing, exporting and bookmarking items require no translation provider. The collection package has no dependency on `@ogleans/translation`, provider APIs or scheduler classes.
