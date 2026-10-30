#!/bin/sh
# Fetches jsPDF and the app's three fonts from npm (the sandbox may not reach
# the CDN or Google Fonts), into /tmp/jspdf and /tmp/fonts.
set -e
mkdir -p /tmp/jspdf /tmp/fonts
cd /tmp/jspdf && npm pack jspdf@2.5.1 >/dev/null && tar xzf jspdf-2.5.1.tgz
cd /tmp/fonts
for f in inter space-grotesk jetbrains-mono; do
  npm pack @fontsource/$f@5.3.0 >/dev/null && mkdir -p fontsource-$f && tar xzf fontsource-$f-5.3.0.tgz -C fontsource-$f
done
python3 - <<'PY'
import re, os
out = []
for fam, ws in [('inter', [300,400,500,600,700,800]), ('space-grotesk', [500,600,700]), ('jetbrains-mono', [400,500])]:
    for w in ws:
        css = open(f'fontsource-{fam}/package/latin-{w}.css').read()
        out.append(re.sub(r"url\(\./files/([^)]+)\)", lambda m: f"url(https://fonts.gstatic.com/local/{fam}/{m.group(1)})", css))
open('fonts.css', 'w').write('\n'.join(out))
PY
echo "ready: /tmp/jspdf /tmp/fonts"
