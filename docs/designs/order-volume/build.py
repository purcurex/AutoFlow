"""Build a standalone design prototype with shared HyperZone branding and local ECharts."""
from pathlib import Path
import importlib.util

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
renderer_path = Path('/Library/VSCode/.hyperzone/html-style/render_html.py')
spec = importlib.util.spec_from_file_location('hyperzone_html', renderer_path)
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
body = (HERE / 'body.html').read_text()
scripts = ''
for source in [ROOT / 'node_modules/echarts/dist/echarts.min.js', HERE / 'model.cjs', HERE / 'ui.js', HERE / 'customer-ui.js']:
    scripts += '\n<script>\n' + source.read_text().replace('</script', '<\\/script') + '\n</script>\n'
document = renderer.render('业务订单量分析 · 设计与交互原型', '综合订单分析与独立客户查询：保留前十客户＋其他排名，搜索单客户并查看月、周、日订单趋势。', body, '设计稿 v1.2', '2026-10-22')
document = document.replace('</body>', scripts + '\n</body>')
renderer.validate(document)
target = HERE.parent / 'HyperZone订单量分析设计.html'
target.write_text(document)
print(target)
