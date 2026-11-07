# Event API v1

`events.on(name, handler)` returns unsubscribe. Events are synchronous, each handler receives a separate structured-clone snapshot, and exceptions are isolated. Internal state and DOM anchors are never delivered.

| Event                                             | Payload                    |
| ------------------------------------------------- | -------------------------- |
| `document.detected`, `document.changed`           | Universal DocumentNode     |
| `segment.detected`, `segment.translation.started` | TranslationSegment         |
| `segment.translated`                              | TranslationResult          |
| `segment.translation.failed`                      | `{id,error}`               |
| `selection.changed`                               | SelectionContext           |
| `translation.started`                             | `{count}`                  |
| `translation.completed`                           | `{count, failed?, total?}` |
| `translation.cancelled`                           | `{count}`                  |

`translation.completed` may report partial success: `count` is the number of successful results, `failed` is the number of failed tasks, and `total` is the number of segments considered by the run. A failure in one provider does not discard successful results from other providers.

After `pnpm build`:

```js
import { EventBus } from './dist/sdk/index.js';
const events = new EventBus((error) => console.error(error));
const off = events.on('segment.translated', (result) =>
  console.log(result.id, result.text),
);
events.emit('segment.translated', { id: 'one', text: '你好' });
off();
```

The browser translation port streams scheduler task/result/failure events to the content coordinator. The content coordinator emits segment-level and aggregate kernel events after validating results. Gesture and collection UI state are kept out of provider event payloads so boundaries remain serializable.
