"""Build and validate the curated FOP-only development requirements, offline."""
from pathlib import Path
from html import escape, unescape
from html.parser import HTMLParser
import hashlib
import importlib.util
import json
import re

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/integrations'
TITLE = 'HyperZone智能办公平台项目FOP扩展开发需求'
CORE = OUT / 'source/fop-extension-requirements.core.html'
VERSION = '1.4'

spec = importlib.util.spec_from_file_location(
    'hyperzone', '/Library/VSCode/.hyperzone/html-style/render_html.py')
theme = importlib.util.module_from_spec(spec)
spec.loader.exec_module(theme)
body = CORE.read_text()

# This handoff owns FOP source requirements, not a copy of receiver internals.
for pattern in [r'\bB\d{2}\b', r'\bM\d{2}\b', r'\bBFF\b', r'\bDTO\b',
                r'hz_fop_', r'REPLICA_ENTITY_FIELDS', r'data-local-state=',
                r'frontendBffDevelopment', r'本地改造', r'本项目前端']:
    assert not re.search(pattern, body), f'Non-FOP implementation content: {pattern}'

class RequirementAudit(HTMLParser):
    """Collect actual requirement rows and enforce concise first columns."""
    def __init__(self):
        super().__init__()
        self.section = None
        self.row = None
        self.cell = None
        self.rows = {}
        self.links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'h2':
            self.section = attrs['id']
        if tag == 'tr':
            self.row = []
        if tag in ('td', 'th'):
            self.cell = ''
        if tag == 'br' and self.cell is not None:
            self.cell += ' '
        if tag == 'a':
            self.links.append(attrs.get('href', ''))

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if tag in ('td', 'th'):
            self.row.append(self.cell.strip())
            self.cell = None
        if tag == 'tr':
            assert self.row and len(self.row[0]) <= 12, self.row
            self.rows.setdefault(self.section, []).append(self.row)
            self.row = None

audit = RequirementAudit()
audit.feed(body)

sections = re.findall(r'<h2 id="([^"]+)">(.*?)</h2>', body)
short_navigation = {
    'scope': '目标与结论', 'coverage': '业务范围', 'architecture': '改造方案',
    'entities': '目标单据', 'fields': '字段要求', 'sync-api': '同步 API',
    'audit': '审核操作', 'inventory': '两类库存', 'contacts': '供应商联系',
    'interception': '当前订单拦截', 'backlog': 'FOP 待办',
    'future': '未来配货与变更', 'acceptance': '功能验收', 'delivery': '联调与交付',
}
assert [key for key, _ in sections] == list(short_navigation)

def requirement_codes(prefix):
    result = []
    for rows in audit.rows.values():
        for row in rows:
            match = re.match(rf'({prefix}\d{{2}})\s', row[0])
            if match:
                result.append(match[1])
    assert len(result) == len(set(result)), f'Duplicate {prefix} requirement code'
    return result

expected = {'C': 12, 'E': 15, 'S': 6, 'A': 5, 'L': 5, 'T': 16}
codes = {prefix: requirement_codes(prefix) for prefix in expected}
for prefix, count in expected.items():
    assert codes[prefix] == [f'{prefix}{i:02}' for i in range(1, count + 1)], codes[prefix]

# Count curated FOP objects/field requirements directly; never import local DB mappings.
entity_requirements = audit.rows['entities'][1:]
field_rows = audit.rows['fields']
field_requirements = [row for row in field_rows if row[0] not in ('字段事项', '字段对象')]
source_codes = sorted(set(re.findall(r'\b(?:hzkj|im)_[a-z][a-z0-9_]*\b', body)))
for href in audit.links:
    if href and not href.startswith(('#', 'https://', 'http://')):
        assert (OUT / href.split('#')[0]).is_file(), f'Missing linked reference: {href}'
assert audit.links.count('HyperZone待办清单数据字段对照表.html') == 1

html = theme.render(
    TITLE, 'FOP 业务字段与接口交付 · 当前扩展与未来版本分开验收', body,
    'V1.4 · FOP 开发交付范围', '2026-11-12')
nav_index = 0

def concise_nav(match):
    global nav_index
    anchor, label = match.groups()
    nav_index += 1
    return (f'<li><a href="#{anchor}" title="{escape(unescape(label), quote=True)}">'
            f'{nav_index:02} · {short_navigation[anchor]}</a></li>')

html = re.sub(r'<li><a href="#([^"]+)">(.*?)</a></li>', concise_nav, html)
assert nav_index == len(sections)
html = html.replace(
    f'<h2>{TITLE}</h2>',
    '<h2>HyperZone FOP扩展开发需求</h2><small class="project-subtitle">智能办公平台项目</small>', 1)
theme.validate(html)
assert 'text-indent:2em' in html.replace(' ', '')
assert 'white-space:nowrap' in html
assert '@media print' in html and '@media' in html

index = {
    'title': TITLE, 'document': TITLE + '.html', 'version': VERSION, 'date': '2026-11-12',
    'timezone': 'America/Los_Angeles', 'scope': 'fop_development_only',
    'status': 'requirements_pending_fop_delivery_and_integration',
    'sections': [{'anchor': key, 'title': unescape(label)} for key, label in sections],
    'confirm': codes['C'], 'fopDevelopment': codes['E'], 'synchronizationApis': codes['S'],
    'auditCapabilities': codes['A'], 'contactCapabilities': codes['L'], 'acceptance': codes['T'],
    'currentRelease': {'fopDevelopment': [code for code in codes['E'] if code not in ('E13', 'E15')],
                       'acceptance': codes['T'][:14]},
    'futureReleaseOnly': {'fopDevelopment': ['E13', 'E15'], 'acceptance': ['T15', 'T16']},
    'fopEntityRequirementCount': len(entity_requirements),
    'fopFieldRequirementCount': len(field_requirements),
    'fopSourceCodes': source_codes,
    'coreSha256': hashlib.sha256(CORE.read_bytes()).hexdigest(),
    'fopCalledDuringDocumentBuild': False,
}
(OUT / 'source/fop-extension-requirements.body.html').write_text(body)
(OUT / f'{TITLE}.html').write_text(html)
(OUT / 'fop-extension-requirements-index.json').write_text(
    json.dumps(index, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({
    'document': str(OUT / f'{TITLE}.html'), 'version': VERSION,
    'sections': len(sections), 'fopEntityRequirements': len(entity_requirements),
    'fopFieldRequirements': len(field_requirements), 'requirementCounts': expected,
    'bytes': len(html.encode()), 'fopCalled': False,
}, ensure_ascii=False))
