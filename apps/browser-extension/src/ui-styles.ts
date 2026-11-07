// SPDX-License-Identifier: GPL-3.0-or-later
export const OGLEANS_STYLES = `
:host {
  --og-ink: #18202b;
  --og-muted: #5b6675;
  --og-surface: rgba(249, 250, 252, 0.82);
  --og-raised: rgba(255, 255, 255, 0.72);
  --og-hover: rgba(24, 32, 43, 0.07);
  --og-line: rgba(24, 32, 43, 0.13);
  --og-accent: #235f8f;
  --og-accent-soft: rgba(35, 95, 143, 0.13);
  --og-shadow: 0 22px 70px rgba(20, 30, 44, 0.24), 0 2px 10px rgba(20, 30, 44, 0.08);
  color-scheme: light dark;
  font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.45;
}
@media (prefers-color-scheme: dark) {
  :host {
    --og-ink: #eef3f8;
    --og-muted: #aab6c5;
    --og-surface: rgba(23, 27, 34, 0.84);
    --og-raised: rgba(255, 255, 255, 0.07);
    --og-hover: rgba(255, 255, 255, 0.08);
    --og-line: rgba(255, 255, 255, 0.14);
    --og-accent: #8dc5ee;
    --og-accent-soft: rgba(141, 197, 238, 0.14);
    --og-shadow: 0 26px 80px rgba(0, 0, 0, 0.52), 0 2px 10px rgba(0, 0, 0, 0.3);
  }
}
* { box-sizing: border-box; }
button, input, textarea, a { font: inherit; }
button { color: inherit; }
.layer {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  overflow: hidden;
}
.rail {
  pointer-events: auto;
  position: fixed;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--og-line);
  border-radius: 999px;
  background: var(--og-surface);
  box-shadow: var(--og-shadow);
  backdrop-filter: blur(22px) saturate(1.25);
  -webkit-backdrop-filter: blur(22px) saturate(1.25);
  transform-origin: center bottom;
  animation: og-rise 120ms ease-out;
}
.rail[hidden], .panel[hidden], .detail[hidden], .back[hidden] { display: none !important; }
.rail button, .ghost {
  border: 0;
  border-radius: 999px;
  background: transparent;
  padding: 7px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.rail button:hover, .ghost:hover { background: var(--og-hover); }
.rail .save { background: var(--og-accent-soft); color: var(--og-accent); font-weight: 650; }
.handle {
  pointer-events: auto;
  position: fixed;
  right: 6px;
  top: 44%;
  width: 16px;
  height: 54px;
  padding: 0;
  border: 1px solid var(--og-line);
  border-radius: 999px;
  background: var(--og-surface);
  box-shadow: 0 8px 30px rgba(20, 30, 44, 0.2);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  opacity: 0.42;
  cursor: pointer;
  transition: opacity 140ms ease, width 140ms ease;
}
.handle::before {
  content: "";
  display: block;
  width: 4px;
  height: 22px;
  margin: auto;
  border-radius: 99px;
  background: currentColor;
  opacity: 0.62;
}
.handle:hover, .handle:focus-visible { opacity: 1; width: 20px; }
.panel {
  pointer-events: auto;
  position: fixed;
  right: 18px;
  bottom: 18px;
  width: min(410px, calc(100vw - 28px));
  max-height: min(74vh, 720px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--og-line);
  border-radius: 22px;
  background: var(--og-surface);
  box-shadow: var(--og-shadow);
  backdrop-filter: blur(28px) saturate(1.22);
  -webkit-backdrop-filter: blur(28px) saturate(1.22);
  overflow: hidden;
  animation: og-panel-in 160ms ease-out;
}
.panel header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 10px 18px;
}
.brand {
  font-size: 17px;
  font-weight: 720;
  letter-spacing: -0.02em;
}
.chip {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--og-accent-soft);
  color: var(--og-accent);
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.spacer { flex: 1; }
.icon {
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
}
.icon:hover { background: var(--og-hover); }
.searchbar {
  display: flex;
  gap: 8px;
  padding: 0 14px 10px;
}
.searchbar input {
  flex: 1;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 9px 12px;
  color: var(--og-ink);
  background: var(--og-raised);
  outline: none;
}
.searchbar input:focus { border-color: var(--og-accent); }
.tags {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 0 14px 10px;
  scrollbar-width: none;
}
.tags:empty { display: none; }
.tag {
  flex: 0 0 auto;
  border: 1px solid var(--og-line);
  border-radius: 999px;
  background: transparent;
  color: var(--og-muted);
  padding: 4px 9px;
  font-size: 12px;
  cursor: pointer;
}
.tag:hover { color: var(--og-ink); background: var(--og-hover); }
.list {
  overflow: auto;
  padding: 2px 8px 10px;
}
.item {
  display: block;
  width: 100%;
  border: 0;
  border-radius: 14px;
  background: transparent;
  padding: 10px 10px 11px;
  text-align: left;
  cursor: pointer;
}
.item:hover, .item:focus-visible { background: var(--og-hover); }
.quote {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--og-ink);
  font-size: 14px;
  font-weight: 560;
}
.meta {
  margin-top: 5px;
  color: var(--og-muted);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-tags {
  display: flex;
  gap: 4px;
  margin-top: 7px;
  overflow: hidden;
}
.item-tags span {
  border-radius: 99px;
  padding: 2px 7px;
  color: var(--og-accent);
  background: var(--og-accent-soft);
  font-size: 10.5px;
}
.empty {
  padding: 28px 24px 34px;
  color: var(--og-muted);
  text-align: center;
}
.detail {
  overflow: auto;
  padding: 0 16px 18px;
}
.detail .back {
  margin: 0 0 8px -6px;
}
.detail blockquote {
  margin: 4px 0 14px;
  padding: 0 0 0 13px;
  border-left: 2px solid var(--og-accent);
  color: var(--og-ink);
  font-size: 15px;
  line-height: 1.6;
}
.kicker {
  color: var(--og-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
}
.detail-row {
  margin: 10px 0;
  color: var(--og-muted);
  font-size: 12.5px;
}
.source-link { color: var(--og-accent); text-decoration: none; overflow-wrap: anywhere; }
.source-link:hover { text-decoration: underline; }
.translation {
  margin: 8px 0;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--og-accent-soft);
  color: var(--og-ink);
}
.field-label {
  display: block;
  margin: 14px 0 4px;
  color: var(--og-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.detail textarea, .detail input {
  width: 100%;
  border: 1px solid var(--og-line);
  border-radius: 11px;
  padding: 9px 10px;
  color: var(--og-ink);
  background: var(--og-raised);
  resize: vertical;
  outline: none;
}
.detail textarea:focus, .detail input:focus { border-color: var(--og-accent); }
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 14px;
}
.button {
  border: 0;
  border-radius: 10px;
  background: var(--og-accent-soft);
  color: var(--og-accent);
  padding: 8px 11px;
  cursor: pointer;
  font-weight: 600;
}
.button:hover { filter: brightness(0.96); }
.button.danger { color: #b33a3a; background: rgba(201, 71, 71, 0.12); }
.footer {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--og-line);
}
.footer .ghost { font-size: 11.5px; color: var(--og-muted); }
.toast {
  pointer-events: none;
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%) translateY(8px);
  max-width: min(520px, calc(100vw - 32px));
  border: 1px solid var(--og-line);
  border-radius: 12px;
  padding: 9px 14px;
  background: var(--og-surface);
  box-shadow: var(--og-shadow);
  color: var(--og-ink);
  font-size: 13px;
  opacity: 0;
  transition: opacity 140ms ease, transform 140ms ease;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
.toast.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
button:focus-visible, a:focus-visible {
  outline: 2px solid var(--og-accent);
  outline-offset: 2px;
}
@keyframes og-rise {
  from { opacity: 0; transform: translateY(4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes og-panel-in {
  from { opacity: 0; transform: translateY(10px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
@media (max-width: 540px) {
  .panel { right: 8px; bottom: 8px; width: calc(100vw - 16px); max-height: 82vh; }
  .rail { max-width: calc(100vw - 16px); overflow-x: auto; }
}
`;
