from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'source' / 'design_board.html').read_text(encoding='utf-8')
OUT = ROOT / 'exports' / 'png'
OUT.mkdir(parents=True, exist_ok=True)
SCREENS = [
    ('00-cover','cover'),
    ('01-main-queue-dashboard','main_queue'),
    ('02-empty-first-launch','empty_state'),
    ('03-paste-url-flow','paste_url'),
    ('04-scanning-state','scanning_state'),
    ('05-format-picker','format_picker'),
    ('06-playlist-detected','playlist_detected'),
    ('07-active-downloads','active_downloads'),
    ('08-completed-detail','completed_detail'),
    ('09-error-recovery','error_recovery'),
    ('10-preferences-general','preferences_general'),
    ('11-preferences-browser','preferences_browser'),
    ('12-extension-guide','extension_guide'),
    ('13-compact-mode','compact_mode'),
    ('14-component-library','component_library'),
    ('15-white-mode','light_mode'),
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
