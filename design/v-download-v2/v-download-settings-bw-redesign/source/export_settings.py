from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'source' / 'settings_board.html').read_text(encoding='utf-8')
OUT = ROOT / 'exports' / 'png'
OUT.mkdir(parents=True, exist_ok=True)
SCREENS = [
    ('01-preferences-general', 'settings_general'),
    ('02-preferences-downloads', 'settings_downloads'),
    ('03-preferences-browser-cookies', 'settings_browser'),
    ('04-preferences-sites', 'settings_sites'),
    ('05-preferences-advanced', 'settings_advanced'),
    ('06-compact-settings-modal', 'settings_compact'),
]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    page.set_content(HTML, wait_until='load')
    page.add_style_tag(content='html,body{margin:0!important;} .board{padding:0!important;gap:0!important;background:#050505!important;} .screen{margin:0!important;border-radius:0!important;border:0!important;box-shadow:none!important;width:1440px!important;height:1000px!important;flex:0 0 1000px!important;}')
    for name, sid in SCREENS:
        loc = page.locator(f'#{sid}')
        loc.scroll_into_view_if_needed()
        path = OUT / f'{name}.png'
        loc.screenshot(path=str(path), timeout=30000)
        im = Image.open(path).convert('L').convert('RGB')
        im.save(path, optimize=True)
        print(path)
    browser.close()
