"""Assemble the TechStar Store specification from its HTML parts and render a PDF.

Usage:  python build.py
Output: docs/TechStar-Store-Technical-Specification.html  (assembled source)
        docs/TechStar-Store-Technical-Specification.pdf   (printed via headless Chrome)
"""
import os
import glob
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
OUT_HTML = os.path.join(HERE, 'TechStar-Store-Technical-Specification.html')
OUT_PDF = os.path.join(HERE, 'TechStar-Store-Technical-Specification.pdf')

CHROME_CANDIDATES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
]


def assemble():
    parts = sorted(glob.glob(os.path.join(SRC, '*.html')))
    if not parts:
        sys.exit('No parts found in ' + SRC)
    chunks = []
    for p in parts:
        with open(p, encoding='utf-8') as fh:
            chunks.append(fh.read())
    body = '\n'.join(chunks) + '\n</body>\n</html>\n'
    with open(OUT_HTML, 'w', encoding='utf-8') as fh:
        fh.write(body)
    print('Assembled %d parts -> %s (%.1f KB)'
          % (len(parts), os.path.basename(OUT_HTML), len(body) / 1024.0))
    return parts


def find_chrome():
    for c in CHROME_CANDIDATES:
        if os.path.exists(c):
            return c
    sys.exit('No Chrome or Edge binary found.')


def render():
    chrome = find_chrome()
    url = 'file:///' + OUT_HTML.replace('\\', '/').replace(' ', '%20')
    cmd = [
        chrome,
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-pdf-header-footer',
        '--run-all-compositor-stages-before-draw',
        '--virtual-time-budget=30000',
        '--print-to-pdf=' + OUT_PDF,
        url,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if not os.path.exists(OUT_PDF):
        print(res.stdout)
        print(res.stderr)
        sys.exit('PDF was not produced.')
    print('Rendered -> %s (%.1f KB)' % (os.path.basename(OUT_PDF), os.path.getsize(OUT_PDF) / 1024.0))


if __name__ == '__main__':
    assemble()
    render()
