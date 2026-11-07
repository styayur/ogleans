// SPDX-License-Identifier: GPL-3.0-or-later
import './ui.css';
import type { KernelConfig } from '../../../packages/config/src/index';
const statusNode = document.querySelector<HTMLElement>('#status')!;
const modeSelect = document.querySelector<HTMLSelectElement>('#mode')!;
const translationMode =
  document.querySelector<HTMLElement>('#translation-mode')!;
const translateButton = document.getElementById(
  'translate',
) as HTMLButtonElement;
const stopButton = document.getElementById('stop') as HTMLButtonElement;
const restoreButton = document.getElementById('restore') as HTMLButtonElement;
let providerOrigins: string[] = [];
let config: KernelConfig;
async function control(
  action: string,
  mode?: string,
): Promise<Record<string, unknown>> {
  const reply = await chrome.runtime.sendMessage({
    kind: 'control',
    action,
    mode,
  });
  if (!reply.ok) throw new Error(reply.error);
  return reply.result as Record<string, unknown>;
}
function updateStatus(result: Record<string, unknown>): void {
  statusNode.textContent = String(result.status ?? 'Ready');
  if (typeof result.mode === 'string') modeSelect.value = result.mode;
  if (typeof result.translationMode === 'string')
    translationMode.textContent =
      result.translationMode === 'built-in'
        ? 'Built-in'
        : result.translationMode === 'external'
          ? 'External'
          : 'Off';
}
async function run(action: string): Promise<void> {
  try {
    updateStatus(await control(action));
  } catch (error) {
    statusNode.textContent =
      error instanceof Error ? error.message : 'Ogleans request failed';
  }
}
document
  .getElementById('collections')!
  .addEventListener('click', () => void run('collection.open'));
document
  .getElementById('settings')!
  .addEventListener('click', () => void chrome.runtime.openOptionsPage());
document.getElementById('translate')!.addEventListener('click', () => {
  if (config?.translation.mode !== 'built-in') {
    statusNode.textContent =
      'Built-in translation is disabled. Gestures and collections remain available.';
    return;
  }
  void chrome.permissions
    .request({ origins: providerOrigins })
    .then(async (granted) => {
      if (!granted) throw new Error('Provider permission denied');
      await run('translate');
    })
    .catch((error) => {
      statusNode.textContent = error.message;
    });
});
stopButton.addEventListener('click', () => void run('stop'));
restoreButton.addEventListener('click', () => void run('restore'));
modeSelect.addEventListener('change', () => {
  void chrome.runtime
    .sendMessage({ kind: 'control', action: 'mode', mode: modeSelect.value })
    .then((reply) => {
      if (!reply.ok) throw new Error(reply.error);
      updateStatus(reply.result);
    })
    .catch((error) => {
      statusNode.textContent = error.message;
    });
});
void chrome.runtime
  .sendMessage({ kind: 'config.get' })
  .then((reply) => {
    if (!reply.ok) throw new Error(reply.error);
    config = reply.result as KernelConfig;
    translationMode.textContent =
      config.translation.mode === 'built-in'
        ? 'Built-in'
        : config.translation.mode === 'external'
          ? 'External'
          : 'Off';
    const enabled = config.translation.mode === 'built-in';
    translateButton.disabled = !enabled;
    stopButton.disabled = !enabled;
    restoreButton.disabled = !enabled;
    providerOrigins = [
      ...new Set(
        config.providers.map(
          (provider) => `${new URL(provider.baseUrl).origin}/*`,
        ),
      ),
    ];
    for (const action of config.actions) {
      const actionButton = document.createElement('button');
      actionButton.textContent = action.name;
      actionButton.addEventListener('click', () => {
        void chrome.runtime
          .sendMessage({ kind: 'action.run', id: action.id })
          .then((response) => {
            statusNode.textContent = response.ok ? 'Opened' : response.error;
          });
      });
      document.getElementById('actions')!.append(actionButton);
    }
    return control('activate');
  })
  .then(updateStatus)
  .catch((error) => {
    statusNode.textContent = error.message;
  });
