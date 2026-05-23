from pathlib import Path
from reportlab.pdfgen import canvas
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
imgs = sorted((ROOT/'exports/png').glob('*.png'))
if not imgs:
    raise SystemExit('No PNG exports found. Run source/export_mockups.py first.')
out = ROOT/'exports/pdf/v-download-bw-redesign-mockups.pdf'
out.parent.mkdir(parents=True, exist_ok=True)
c = canvas.Canvas(str(out), pagesize=(1440, 1000), pageCompression=1)
for p in imgs:
    with Image.open(p) as im:
        w, h = im.size
    c.setPageSize((w, h))
    c.drawImage(str(p), 0, 0, width=w, height=h, preserveAspectRatio=False, mask='auto')
    c.showPage()
c.save()
print(out)
