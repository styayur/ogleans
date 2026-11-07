# Annotation and anchor specification

Ogleans uses W3C Web Annotation-compatible selectors as a portable description of a saved passage. It does not claim that every anchor can always be restored.

## Selectors

### TextQuoteSelector

```ts
{
  type: 'TextQuoteSelector',
  exact: 'selected text',
  prefix?: 'up to 48 characters before',
  suffix?: 'up to 48 characters after'
}
```

The exact quote is the primary portable locator. Prefix and suffix disambiguate repeated occurrences.

### TextPositionSelector

```ts
{
  type: 'TextPositionSelector',
  start: 123,
  end: 156
}
```

Offsets are computed from a normalized DOM text index that skips scripts, styles, form text areas, Ogleans UI and Ogleans-generated translation spans. Position is a hint, not proof that the page still has the same structure.

## Resolution order

1. Build a fresh DOM text index.
2. Find all exact quote occurrences.
3. Score each occurrence using matching prefix and suffix.
4. Use the best occurrence.
5. Create a DOM Range for CSS Highlight API display.
6. Fall back to the stored position only when quote search has no result.

If no range can be created, the collection remains readable and the UI states that the anchor may be unavailable or the page text changed.

## Text Fragments

Ogleans adds a Text Fragment navigation URL of the form:

```text
https://example.org/article#:~:text=prefix-,exact,-suffix
```

Text Fragment support is browser-dependent. It is an additional navigation mechanism, not a restore guarantee. Client routing, changed text, blocked fragments and browser behavior may prevent scrolling to the quote.

## Displayed text

A selection may exist in generated translation output or in output from another extension. In that case:

- `captureKind` is `displayed-translation` when Ogleans knows the provenance;
- `captureKind` is `displayed-selection` when only visible text is known;
- `originalText` is omitted unless Ogleans can reliably identify it.

The anchor exact text remains the visible selected passage. This is preferable to inventing an original passage that the user did not actually select.

## Failure cases

Exact anchor restoration can fail when:

- the source page is unavailable;
- the article is edited or replaced;
- the same quote repeats and context changed;
- the browser does not support Text Fragments;
- another script replaces or virtualizes the page DOM;
- the selected text came from a cross-origin frame or shadow root outside adapter support.

Ogleans reports these limitations rather than implying durable page restoration.

## Privacy

Selectors, fragments, notes and translations remain in local collection storage. A source link containing a Text Fragment is opened only when the user chooses to navigate to it.
