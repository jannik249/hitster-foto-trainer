#!/usr/bin/env python3
"""Baut aus www/ eine einzelne, eigenstaendige HTML-Datei (dist/hitster-foto-trainer.html).

Die Datei laesst sich per Doppelklick im Browser oeffnen (ohne Server, ohne
Internet) – praktisch zum schnellen Ausprobieren, unabhaengig von der APK.
"""
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
www = root / "www"
out_dir = root / "dist"
out_dir.mkdir(exist_ok=True)

html = (www / "index.html").read_text(encoding="utf-8")
css = (www / "style.css").read_text(encoding="utf-8")
js = (www / "app.js").read_text(encoding="utf-8")

html, n_css = re.subn(
    r'<link rel="stylesheet" href="style\.css">',
    lambda m: "<style>\n" + css + "\n</style>",
    html,
)
html, n_js = re.subn(
    r'<script src="app\.js"></script>',
    lambda m: "<script>\n" + js + "\n</script>",
    html,
)
if n_css != 1 or n_js != 1:
    raise SystemExit("Konnte style.css/app.js nicht einbetten (Platzhalter nicht gefunden).")

target = out_dir / "hitster-foto-trainer.html"
target.write_text(html, encoding="utf-8")
print(f"OK: {target} ({target.stat().st_size // 1024} KB)")
