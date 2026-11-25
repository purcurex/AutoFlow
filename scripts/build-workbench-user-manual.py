#!/usr/bin/env python3
"""Build the self-contained workbench manual from reviewed text and UI captures."""
from pathlib import Path
import base64
import html
import json
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/manuals/source/workbench-manual.json'
SHOTS = ROOT / 'docs/assets/manual-20261125'
OUTPUT = ROOT / 'docs/manuals/HyperZone五工作台待办清单操作手册.html'
RENDERER = Path('/Library/VSCode/.hyperzone/html-style/render_html.py')

def main():
    source = json.loads(SOURCE.read_text(encoding='utf-8'))
    parts = ['<style>.manual-shot{margin:20px 0}.manual-shot img{width:100%;height:auto;border:1px solid #dbe5ed;border-radius:8px;cursor:zoom-in}.manual-shot figcaption{font-size:12px;color:#5b6e80;text-align:center;margin-top:8px}.manual-shot a{display:block} section{scroll-margin-top:24px} @media print{.manual-shot{break-inside:avoid}}</style>']
    seen = set()
    count = 0
    for section in source['sections']:
        assert section['id'] not in seen, section['id']
        seen.add(section['id'])
        parts.append(f'<section id="{html.escape(section["id"])}"><h2>{html.escape(section["title"])}</h2>{section["body"]}')
        if section.get('image'):
            path = SHOTS / (section['image'] + '.jpg')
            encoded = base64.b64encode(path.read_bytes()).decode('ascii')
            uri = 'data:image/jpeg;base64,' + encoded
            count += 1
            # A native dialog preserves standalone viewing without external images.
            parts.append(f'<figure class="manual-shot"><img src="{uri}" alt="{html.escape(section["title"])}操作界面" loading="lazy" tabindex="0" onclick="openShot(this)" onkeydown="if(event.key===\'Enter\')openShot(this)"><figcaption>图{count} · {html.escape(section["title"])} · 典雅紫浅色 · 点击图片放大</figcaption></figure>')
        parts.append('</section>')
    parts.append('''<dialog id="shot-view" style="width:96vw;max-width:none;padding:12px;border:1px solid #dbe5ed;border-radius:10px"><button onclick="this.parentElement.close()" autofocus>关闭大图</button><div style="overflow:auto;max-height:85vh"><img id="shot-full" alt="放大界面" style="width:2560px;max-width:none"></div></dialog><script>function openShot(el){const d=document.getElementById('shot-view');document.getElementById('shot-full').src=el.src;d.showModal()}</script>''')
    with tempfile.TemporaryDirectory() as temp:
        body = Path(temp) / 'body.html'
        body.write_text('\n'.join(parts), encoding='utf-8')
        subprocess.run(['python3', str(RENDERER), '--title', '五工作台待办清单操作手册', '--subtitle', '查询、审核、采购跟进、配货与仓库协同', '--version', source['version'], '--date', source['date'], '--content', str(body), '--output', str(OUTPUT)], check=True)
    print(f'Built {len(seen)} sections, {count} screenshots: {OUTPUT}')

if __name__ == '__main__':
    main()
