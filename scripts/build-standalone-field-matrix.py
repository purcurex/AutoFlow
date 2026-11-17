"""Export the user-requested 23-list field matrix without creating a second requirement source.

Reads local versioned mappings and FOP metadata only; never queries FOP or a database.
"""
from pathlib import Path
from html import escape
import hashlib
import importlib.util
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime/fop-local-field-matrix'
DEST = ROOT / 'docs/requirements/HyperZone23清单字段对照表.html'

subprocess.run([sys.executable, str(ROOT / 'scripts/fop-local-field-matrix/generate.py')], check=True)
document = (RUNTIME / 'matrix-reference.html').read_text()
matrix = json.loads((RUNTIME / 'matrix.json').read_text())
counts = {
    'lists': len(matrix),
    'displayFields': sum(len(section['rows']) for section in matrix),
    'mappingRows': sum(len(row['parts']) for section in matrix for row in section['rows']),
}
assert counts == {'lists': 23, 'displayFields': 287, 'mappingRows': 348}, counts
document = document.replace('待办清单数据字段对照表', 'HyperZone 23清单字段对照表')
note = '''<section aria-label="独立版说明">
<h2 id="standalone-scope">独立版说明</h2>
<p>按2026-11-12用户要求单独交付：五个工作台、23个清单、287个展示字段、348条映射。表格按“前端展示字段—本地数据库字段—FOP来源”逐项对照；支持关键词搜索、来源待确认／接口缺失筛选，以及打印／保存PDF。</p>
<p>本文件由项目现有字段定义生成，作为独立查阅快照；业务需求仍以<a href="HyperZone智能办公平台项目开发需求说明书.html">统一需求说明书</a>为准。正式副本映射与已采集模式字段分别标注，源码存在、数据库预留或Mock可用均不等于真实接通。状态标签描述当前本地映射与已保存API证据，不代表本次重新联调或全量数据完整。</p>
<p>本次仅离线核对并导出字段对照内容，未调用FOP、未补采业务数据，自动调用继续暂停。保留待提供、待确认与未接通事项；不将缺失字段推定为零或已完成。</p>
</section>'''
marker = '<article id="report" style="margin-top:28px">'
assert marker in document
document = document.replace(marker, marker + note, 1)
document = document.replace('<div class="toc"><ul>', '<div class="toc"><ul><li><a href="#standalone-scope">独立版说明</a></li>', 1)

spec = importlib.util.spec_from_file_location('theme', '/Library/VSCode/.hyperzone/html-style/render_html.py')
theme = importlib.util.module_from_spec(spec)
spec.loader.exec_module(theme)
theme.validate(document)
assert document.count('<table class="matrix">') == 23
assert document.count('class="field-group"') == 287
assert (DEST.parent / 'HyperZone智能办公平台项目开发需求说明书.html').is_file()
DEST.write_text(document)
manifest = {
    'document': str(DEST.relative_to(ROOT)),
    'requestedAt': '2026-11-12',
    **counts,
    'upstreamCalled': False,
    'databaseQueried': False,
    'sha256': hashlib.sha256(document.encode()).hexdigest(),
    'sourceEvidence': json.loads((RUNTIME / 'evidence.json').read_text()),
}
(RUNTIME / 'standalone-export.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps({k: v for k, v in manifest.items() if k != 'sourceEvidence'}, ensure_ascii=False))
