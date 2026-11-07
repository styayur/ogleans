// SPDX-License-Identifier: GPL-3.0-or-later
import './ui.css';
import {
  parseConfig,
  exportConfigPart,
  importConfig,
  type ConfigPart,
  type KernelConfig,
  type ProviderConfig,
} from '../../../packages/config/src/index';
import {
  detectGestureConflicts,
  formatGestureSequence,
  parseGestureSequence,
  type GestureMapping,
  type KeyboardMapping,
} from '../../../packages/gesture/src/index';

const ACTIONS = [
  ['collection.save', 'Save selection'],
  ['collection.open', 'Open collection'],
  ['collection.previous', 'Previous passage'],
  ['collection.next', 'Next passage'],
  ['translation.toggle', 'Toggle translation'],
  ['translation.restore', 'Restore original'],
  ['translation.mode', 'Cycle display mode'],
  ['dictionary.open', 'Open dictionary'],
  ['panel.hide', 'Hide panel'],
] as const;
const field = <T extends HTMLElement = HTMLInputElement>(id: string): T =>
  document.getElementById(id) as T;
const status = document.getElementById('status')!;
const gestureStatus = document.getElementById('gesture-status')!;
let current: KernelConfig;
let customCounter = 0;
async function send<T = unknown>(message: unknown): Promise<T> {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error ?? 'Request failed');
  return reply.result as T;
}
function download(
  filename: string,
  content: string,
  mime = 'application/json',
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function choices(): void {
  const ids = [
    ...document.querySelectorAll<HTMLInputElement>('[data-field="id"]'),
  ].map((input) => input.value);
  for (const name of ['primary', 'fallback']) {
    const select = field<HTMLSelectElement>(name);
    const selected = select.value;
    select.replaceChildren();
    if (name === 'fallback') select.add(new Option('None', ''));
    ids.forEach((id) => select.add(new Option(id, id)));
    if (ids.includes(selected)) select.value = selected;
  }
}
function providerRow(provider: ProviderConfig): void {
  const row = document.createElement('div');
  row.className = 'provider';
  const grid = document.createElement('div');
  grid.className = 'grid three';
  const fields: Array<[string, string, string, string]> = [
    ['enabled', 'Enabled', '', 'checkbox'],
    ['id', 'Provider ID', provider.id, 'text'],
    ['kind', 'Kind', provider.kind, 'kind'],
    ['baseUrl', 'Base URL', provider.baseUrl, 'text'],
    ['model', 'Model', provider.model ?? '', 'text'],
    ['apiKey', 'API key', provider.apiKey ?? '', 'password'],
    ['timeoutMs', 'Timeout (ms)', String(provider.timeoutMs), 'number'],
    ['concurrency', 'Concurrency', String(provider.concurrency ?? 1), 'number'],
    ['weight', 'Weight', String(provider.weight ?? 1), 'number'],
    [
      'languages',
      'Languages',
      (provider.languages ?? ['*']).join(', '),
      'text',
    ],
    [
      'rateRequests',
      'Rate requests',
      String(provider.rateLimit?.requests ?? 0),
      'number',
    ],
    [
      'rateWindowMs',
      'Rate window (ms)',
      String(provider.rateLimit?.windowMs ?? 0),
      'number',
    ],
  ];
  for (const [key, title, value, type] of fields) {
    const label = document.createElement('label');
    label.append(title);
    let input: HTMLInputElement | HTMLSelectElement;
    if (type === 'kind') {
      input = document.createElement('select');
      for (const kind of ['google', 'openai', 'ollama'])
        input.add(new Option(kind, kind));
      input.value = value;
    } else {
      const text = document.createElement('input');
      text.type = type;
      text.value = value;
      if (type === 'checkbox') {
        text.checked = provider.enabled !== false;
        text.value = 'true';
      }
      input = text;
    }
    input.dataset.field = key;
    label.append(input);
    grid.append(label);
    if (key === 'id') input.addEventListener('input', choices);
  }
  const headersLabel = document.createElement('label');
  headersLabel.append('Custom headers JSON');
  const headers = document.createElement('textarea');
  headers.rows = 2;
  headers.spellcheck = false;
  headers.dataset.field = 'headers';
  headers.value = JSON.stringify(provider.headers ?? {}, null, 2);
  headersLabel.append(headers);
  row.append(grid, headersLabel);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove provider';
  remove.addEventListener('click', () => {
    row.remove();
    choices();
  });
  row.append(remove);
  field('providers').append(row);
  choices();
}
function actionSelect(action?: string): HTMLSelectElement {
  const select = document.createElement('select');
  for (const [id, title] of ACTIONS) select.add(new Option(title, id));
  if (action) select.value = action;
  return select;
}
function gestureRow(mapping: GestureMapping): void {
  const row = document.createElement('div');
  row.className = 'mapping-row gesture-row';
  row.dataset.id = mapping.id;
  const sequence = document.createElement('input');
  sequence.value = formatGestureSequence(mapping.sequence);
  sequence.placeholder = 'up,right';
  sequence.dataset.field = 'sequence';
  const select = actionSelect(mapping.action);
  select.dataset.field = 'action';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-button';
  remove.textContent = '×';
  remove.setAttribute('aria-label', 'Remove gesture mapping');
  remove.addEventListener('click', () => {
    row.remove();
    updateGestureStatus();
  });
  row.append(sequence, select, remove);
  sequence.addEventListener('input', updateGestureStatus);
  select.addEventListener('change', updateGestureStatus);
  field('gesture-mappings').append(row);
  updateGestureStatus();
}
function keyboardRow(mapping: KeyboardMapping): void {
  const row = document.createElement('div');
  row.className = 'mapping-row keyboard-row';
  row.dataset.id = mapping.id;
  const combo = document.createElement('input');
  combo.value = mapping.combo;
  combo.placeholder = 'Alt+Shift+S';
  combo.dataset.field = 'combo';
  const select = actionSelect(mapping.action);
  select.dataset.field = 'action';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-button';
  remove.textContent = '×';
  remove.setAttribute('aria-label', 'Remove keyboard mapping');
  remove.addEventListener('click', () => {
    row.remove();
    updateGestureStatus();
  });
  row.append(combo, select, remove);
  combo.addEventListener('input', updateGestureStatus);
  select.addEventListener('change', updateGestureStatus);
  field('keyboard-mappings').append(row);
  updateGestureStatus();
}
function readGestureMappings(): GestureMapping[] {
  return [...document.querySelectorAll<HTMLElement>('.gesture-row')].map(
    (row) => ({
      id: row.dataset.id!,
      action: row.querySelector<HTMLSelectElement>('[data-field="action"]')!
        .value,
      sequence: parseGestureSequence(
        row.querySelector<HTMLInputElement>('[data-field="sequence"]')!.value,
      ),
    }),
  );
}
function readKeyboardMappings(): KeyboardMapping[] {
  return [...document.querySelectorAll<HTMLElement>('.keyboard-row')].map(
    (row) => ({
      id: row.dataset.id!,
      action: row.querySelector<HTMLSelectElement>('[data-field="action"]')!
        .value,
      combo: row.querySelector<HTMLInputElement>('[data-field="combo"]')!.value,
    }),
  );
}
function updateGestureStatus(): void {
  try {
    const conflicts = detectGestureConflicts(
      readGestureMappings(),
      readKeyboardMappings(),
    );
    const errors = conflicts.filter(
      (conflict) => conflict.severity === 'error',
    );
    gestureStatus.textContent = conflicts.length
      ? conflicts
          .map(
            (conflict) =>
              `${conflict.severity === 'error' ? 'Error' : 'Notice'}: ${conflict.message}`,
          )
          .join(' ')
      : 'No gesture conflicts detected.';
    gestureStatus.dataset.severity = errors.length
      ? 'error'
      : conflicts.length
        ? 'warning'
        : 'ok';
  } catch (error) {
    gestureStatus.textContent = message(error);
    gestureStatus.dataset.severity = 'error';
  }
}
function fill(config: KernelConfig): void {
  current = config;
  field<HTMLSelectElement>('translation-mode').value = config.translation.mode;
  field<HTMLSelectElement>('strategy').value = config.translation.strategy;
  field('global-concurrency').value = String(
    config.translation.globalConcurrency,
  );
  field('source').value = config.sourceLanguage;
  field('target').value = config.targetLanguage;
  field('retries').value = String(config.translation.retries);
  field('translation-timeout').value = String(config.translation.timeoutMs);
  field<HTMLSelectElement>('mode').value = config.mode;
  field<HTMLSelectElement>('placement').value = config.placement;
  field<HTMLTextAreaElement>('terminology').value =
    config.translation.terminology;
  field<HTMLInputElement>('fallback-enabled').checked =
    config.translation.fallbackEnabled;
  field('providers').replaceChildren();
  config.providers.forEach(providerRow);
  field<HTMLSelectElement>('primary').value = config.primary;
  field<HTMLSelectElement>('fallback').value = config.fallback ?? '';
  field<HTMLSelectElement>('gesture-trigger').value = config.gestures.trigger;
  field('gesture-threshold').value = String(config.gestures.thresholdPx);
  field<HTMLInputElement>('show-handle').checked = config.gestures.showHandle;
  field('gesture-mappings').replaceChildren();
  config.gestures.mappings.forEach(gestureRow);
  field('keyboard-mappings').replaceChildren();
  config.gestures.keyboard.forEach(keyboardRow);
  field<HTMLInputElement>('bookmarks-enabled').checked =
    config.collection.bookmarksEnabled;
  field('bookmark-folder').value = config.collection.bookmarkFolder;
  field('dictionary-url').value = config.collection.dictionaryUrlTemplate;
  field<HTMLSelectElement>('dictionary-mode').value =
    config.collection.dictionaryOpenMode;
  field<HTMLTextAreaElement>('rules').value = JSON.stringify(
    config.rules,
    null,
    2,
  );
  field<HTMLTextAreaElement>('actions').value = JSON.stringify(
    config.actions,
    null,
    2,
  );
  updateGestureStatus();
}
function readProvider(row: Element): ProviderConfig {
  const value = (name: string): string =>
    row.querySelector<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >(`[data-field="${name}"]`)?.value ?? '';
  const checked =
    row.querySelector<HTMLInputElement>('[data-field="enabled"]')?.checked ??
    true;
  const rateRequests = Number(value('rateRequests'));
  const rateWindowMs = Number(value('rateWindowMs'));
  const headers = JSON.parse(value('headers') || '{}') as Record<
    string,
    string
  >;
  return {
    id: value('id'),
    kind: value('kind') as ProviderConfig['kind'],
    baseUrl: value('baseUrl'),
    timeoutMs: Number(value('timeoutMs')),
    enabled: checked,
    concurrency: Number(value('concurrency')),
    weight: Number(value('weight')),
    languages: value('languages')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    ...(value('model') ? { model: value('model') } : {}),
    ...(value('apiKey') ? { apiKey: value('apiKey') } : {}),
    ...(rateRequests && rateWindowMs
      ? { rateLimit: { requests: rateRequests, windowMs: rateWindowMs } }
      : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  };
}
function read(): KernelConfig {
  const providers = [
    ...document.querySelectorAll<HTMLElement>('.provider'),
  ].map(readProvider);
  return parseConfig({
    ...current,
    sourceLanguage: field('source').value,
    targetLanguage: field('target').value,
    mode: field<HTMLSelectElement>('mode').value,
    placement: field<HTMLSelectElement>('placement').value,
    primary: field<HTMLSelectElement>('primary').value,
    fallback: field<HTMLSelectElement>('fallback').value || undefined,
    providers,
    translation: {
      ...current.translation,
      mode: field<HTMLSelectElement>('translation-mode').value,
      strategy: field<HTMLSelectElement>('strategy').value,
      globalConcurrency: Number(field('global-concurrency').value),
      retries: Number(field('retries').value),
      timeoutMs: Number(field('translation-timeout').value),
      terminology: field<HTMLTextAreaElement>('terminology').value,
      fallbackEnabled: field<HTMLInputElement>('fallback-enabled').checked,
    },
    gestures: {
      ...current.gestures,
      trigger: field<HTMLSelectElement>('gesture-trigger').value,
      thresholdPx: Number(field('gesture-threshold').value),
      showHandle: field<HTMLInputElement>('show-handle').checked,
      mappings: readGestureMappings(),
      keyboard: readKeyboardMappings(),
    },
    collection: {
      ...current.collection,
      bookmarksEnabled: field<HTMLInputElement>('bookmarks-enabled').checked,
      bookmarkFolder: field('bookmark-folder').value,
      dictionaryUrlTemplate: field('dictionary-url').value,
      dictionaryOpenMode: field<HTMLSelectElement>('dictionary-mode').value,
    },
    rules: JSON.parse(field<HTMLTextAreaElement>('rules').value),
    actions: JSON.parse(field<HTMLTextAreaElement>('actions').value),
  });
}
async function save(config: KernelConfig): Promise<void> {
  if (config.translation.mode === 'built-in') {
    const origins = [
      ...new Set(
        config.providers.map(
          (provider) => `${new URL(provider.baseUrl).origin}/*`,
        ),
      ),
    ];
    if (origins.length && !(await chrome.permissions.request({ origins })))
      throw new Error('Provider host permission was denied');
  }
  if (config.collection.bookmarksEnabled) {
    const granted = await chrome.permissions.contains({
      permissions: ['bookmarks'],
    });
    if (!granted)
      throw new Error(
        'Use “Request bookmark permission” before enabling native bookmark export.',
      );
  }
  await send({ kind: 'config.set', config });
  fill(config);
  status.textContent = 'Settings saved';
}
function failure(error: unknown): void {
  status.textContent = message(error);
}
document.getElementById('config')!.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    void save(read()).catch(failure);
  } catch (error) {
    failure(error);
  }
});
document.getElementById('add-provider')!.addEventListener('click', () => {
  providerRow({
    id: `provider-${Date.now()}-${++customCounter}`,
    kind: 'openai',
    baseUrl: 'https://example.org/v1',
    model: 'model-name',
    timeoutMs: 20000,
    enabled: true,
    concurrency: 2,
    weight: 1,
    languages: ['*'],
  });
});
document.getElementById('add-gesture')!.addEventListener('click', () => {
  gestureRow({
    id: `custom-${Date.now()}-${++customCounter}`,
    action: 'collection.open',
    sequence: ['up', 'left'],
  });
});
document.getElementById('add-keyboard')!.addEventListener('click', () => {
  keyboardRow({
    id: `custom-key-${Date.now()}-${++customCounter}`,
    action: 'collection.open',
    combo: 'Alt+Shift+O',
  });
});
document.getElementById('enable-bookmarks')!.addEventListener('click', () => {
  void chrome.permissions
    .request({ permissions: ['bookmarks'] })
    .then((granted) => {
      field<HTMLInputElement>('bookmarks-enabled').checked = granted;
      status.textContent = granted
        ? 'Bookmark permission granted'
        : 'Bookmark permission denied; HTML bookmark export remains available.';
    })
    .catch(failure);
});
document.getElementById('export')!.addEventListener('click', () => {
  try {
    const config = read();
    const part = field<HTMLSelectElement>('export-part').value as ConfigPart;
    download(
      part === 'config' ? 'config.json' : `${part}.json`,
      exportConfigPart(config, part),
    );
    status.textContent = 'Configuration exported without secrets';
  } catch (error) {
    failure(error);
  }
});
field<HTMLInputElement>('import').addEventListener('change', () => {
  const file = field<HTMLInputElement>('import').files?.[0];
  if (!file) return;
  void file
    .text()
    .then((text) => importConfig(JSON.parse(text), current))
    .then((config) => {
      fill(config);
      status.textContent = 'Imported for review. Save settings to apply.';
    })
    .catch(failure);
});
document.getElementById('reset')!.addEventListener('click', () => {
  void send({ kind: 'config.reset' })
    .then(() => send<KernelConfig>({ kind: 'config.get' }))
    .then((config) => {
      fill(config);
      status.textContent = 'Settings reset. Collections were kept.';
    })
    .catch(failure);
});
document
  .getElementById('export-collection-json')!
  .addEventListener('click', () => {
    void send<string>({ kind: 'collection.export', format: 'json' })
      .then((content) => download('ogleans-collection.json', content))
      .then(() => {
        status.textContent = 'Collection backup exported';
      })
      .catch(failure);
  });
document
  .getElementById('export-collection-markdown')!
  .addEventListener('click', () => {
    void send<string>({ kind: 'collection.export', format: 'markdown' })
      .then((content) =>
        download('ogleans-collection.md', content, 'text/markdown'),
      )
      .then(() => {
        status.textContent = 'Markdown collection exported';
      })
      .catch(failure);
  });
field<HTMLInputElement>('import-collection').addEventListener('change', () => {
  const file = field<HTMLInputElement>('import-collection').files?.[0];
  if (!file) return;
  void file
    .text()
    .then((data) => send({ kind: 'collection.import', data }))
    .then(() => {
      field<HTMLInputElement>('import-collection').value = '';
      status.textContent = 'Collection imported';
    })
    .catch(failure);
});
void send<KernelConfig>({ kind: 'config.get' })
  .then(async (config) => {
    const granted = await chrome.permissions.contains({
      permissions: ['bookmarks'],
    });
    if (config.collection.bookmarksEnabled && !granted) {
      config.collection.bookmarksEnabled = false;
      status.textContent =
        'Bookmark permission is no longer granted. HTML export remains available.';
    }
    fill(config);
  })
  .catch(failure);
