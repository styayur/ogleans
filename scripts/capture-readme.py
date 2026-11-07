"""Capture the real extension settings, without keys or modified UI.

Run `pnpm build` and install Python Playwright's Chromium first.
"""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
extension = root / 'dist/chromium'
output = root / 'docs/assets/extension-settings-v0.2.0-alpha.1.png'
output.parent.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        '', headless=True, channel='chromium', executable_path=os.environ.get('TK_CHROMIUM_PATH'), viewport={'width': 1280, 'height': 900},
        args=[f'--disable-extensions-except={extension}', f'--load-extension={extension}'],
    )
    try:
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        extension_id = worker.url.split('/')[2]
        page = context.new_page()
        page.goto(f'chrome-extension://{extension_id}/options.html')
        page.wait_for_load_state('networkidle')
        expect(page.get_by_role('heading', name='Ogleans', exact=True)).to_be_visible()
        page.screenshot(path=str(output))
        print(f'Saved real extension settings: {output.name}')
    finally:
        context.close()
