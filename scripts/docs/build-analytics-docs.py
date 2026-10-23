#!/usr/bin/env python3
"""Build the field dictionary from OpenAPI and render the shared HyperZone HTML.

python -m pip install -r scripts/docs/requirements.txt
python scripts/docs/build-analytics-docs.py --style-root /path/to/hyperzone/html-style
"""
import argparse
import importlib.util
import json
import re
from pathlib import Path

import markdown
from openapi_spec_validator import validate_spec
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / 'docs/openapi/hyperzone-analytics.openapi.json'
DOCS = ROOT / 'docs/analytics'
REQUEST_QUERIES = {
    '/autoflow/integrations/fop/receipts': 'from=2026-09-01&to=2026-10-22&warehouse=ALL&workbenchRole=sales&page=1&pageSize=20',
    '/autoflow/integrations/fop/order-volume/receipts': 'category=customer&from=2026-09-01&to=2026-10-22&warehouse=ALL&workbenchRole=sales&seriesId=total&page=1&pageSize=20',
    '/autoflow/integrations/fop/order-volume': 'category=organization&grain=month&year=2026&warehouse=ALL',
    '/autoflow/integrations/fop/order-volume/orders': 'category=customer&from=2026-01-01&to=2026-10-22&warehouse=ALL&workbenchRole=sales&seriesId=total&page=1&pageSize=20',
    '/autoflow/integrations/fop/order-volume/customers': 'keyword=C001&page=1&pageSize=10',
    '/autoflow/integrations/fop/fulfillment-orders': 'queue=allocation&workbenchRole=allocation&page=1&pageSize=20',
    '/autoflow/integrations/fop/dashboard': 'from=2026-10-16&to=2026-10-22&year=2026',
    '/users/workbench-accounts': 'page=1&pageSize=20',
}


def cell(value):
    return str(value).replace('|', '&#124;').replace('\n', '<br>')


def type_name(schema):
    if '$ref' in schema:
        return schema['$ref'].rsplit('/', 1)[-1]
    if 'const' in schema:
        return json.dumps(schema['const'], ensure_ascii=False)
    kind = schema.get('type')
    if kind == 'array':
        return type_name(schema.get('items', {})) + '[]'
    if isinstance(kind, list):
        return ' / '.join(kind)
    if kind:
        return kind + (f" ({schema['format']})" if 'format' in schema else '')
    for key in ('oneOf', 'anyOf', 'allOf'):
        if key in schema:
            return f' {key} '.join(type_name(x) for x in schema[key])
    return '见 schema'


def constraints(schema):
    notes = []
    for key in ('enum', 'default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'uniqueItems', 'additionalProperties'):
        if key in schema:
            value = schema[key]
            if isinstance(value, dict):
                value = type_name(value)
            notes.append(f'{key}={json.dumps(value, ensure_ascii=False)}')
    if 'examples' in schema:
        notes.append('example=' + json.dumps(schema['examples'][0], ensure_ascii=False))
    return '; '.join(notes) or '—'


def ref(spec, value):
    if '$ref' not in value:
        return value
    target = spec
    for part in value['$ref'].split('/')[1:]:
        target = target[part.replace('~1', '/').replace('~0', '~')]
    return {**target, **{k: v for k, v in value.items() if k != '$ref'}}


def field_rows(schema, prefix=''):
    required = schema.get('required', [])
    rows = []
    for name, value in schema.get('properties', {}).items():
        path = prefix + name
        rows.append(f"| `{path}` | {cell(type_name(value))} | {'是' if name in required else '否'} | {cell(value.get('description', '见引用模型/接口说明'))} | {cell(constraints(value))} |")
        if value.get('type') == 'object':
            rows.extend(field_rows(value, path + '.'))
        if value.get('type') == 'array':
            rows.extend(field_rows(value.get('items', {}), path + '[].'))
    return rows


def appendix(text):
    result = []
    fenced = False
    for index, line in enumerate(text.splitlines()):
        if index == 0 and line.startswith('# '):
            continue
        if line.startswith('```'):
            fenced = not fenced
        if not fenced and re.match(r'^#{1,5} ', line):
            line = '#' + line
        result.append(line)
    return '\n'.join(result)


def build(spec):
    parts = [(DOCS / 'REQUIREMENTS_OVERVIEW.md').read_text(), appendix((DOCS / 'FOLLOW_UP_CHECKLIST.md').read_text())]
    operations = [(path, method, operation) for path, entry in spec['paths'].items() for method, operation in entry.items() if method in ('get', 'post', 'put', 'patch', 'delete')]
    parts += ['## 8. OpenAPI 接口清单与请求/响应定义',
              f"本规范覆盖 **{len(operations)} 个操作、{len(spec['components']['schemas'])} 个数据模型**。以下清单由同目录 OpenAPI JSON 生成。Base URL 为 `/api`，表中路径不重复此前缀。响应为实际裸 JSON，不额外包装成 `{{code,data}}`。时间序列数值数组必须与对应时间轴等长：counts 对应 registrations、amounts 对应 months、values 及 warehouses 内数组对应 periods；items/series/options 等集合不适用。该跨字段规则需联调测试，单纯 schema 校验不能证明。",
              '| 方法 | 路径 | operationId | 用途 |', '| --- | --- | --- | --- |']
    for path, method, operation in operations:
        parts.append(f"| {method.upper()} | `{path}` | `{operation['operationId']}` | {cell(operation.get('summary', ''))} |")
    parts.append('\n### 8.1 公共鉴权与响应说明\n')
    parts.append(spec.get('info', {}).get('description', ''))
    for name, scheme in spec['components'].get('securitySchemes', {}).items():
        parts.append(f"- `{name}`：{scheme.get('description', '')}；type={scheme.get('type')}，in={scheme.get('in', 'Authorization')}，name={scheme.get('name', scheme.get('scheme', ''))}。")
    for index, (path, method, operation) in enumerate(operations, 2):
        parts.append(f"\n### 8.{index} {operation.get('summary', operation['operationId'])}\n\n`{method.upper()} /api{path}` · operationId: `{operation['operationId']}`\n")
        parts.append(operation.get('description', ''))
        if operation.get('x-implementation-status'):
            parts.append('\n实现状态：' + cell(operation['x-implementation-status']))
        parts.append('\n鉴权：`' + json.dumps(operation.get('security', spec.get('security', [])), ensure_ascii=False) + '`。')
        request_path = path.replace('{role}', 'sales').replace('{id}', '00000000-0000-4000-8000-000000000001')
        if path in REQUEST_QUERIES:
            request_path += '?' + REQUEST_QUERIES[path]
        parts.append(f'\n请求示例（日期和主体为脱敏样例，联调时替换）：\n\n```http\n{method.upper()} /api{request_path}\nAuthorization: Bearer <有效会话JWT>\nAccept: application/json\n```')
        if operation.get('x-cross-parameter-rules'):
            parts.append('\n交叉参数规则：\n\n```json\n' + json.dumps(operation['x-cross-parameter-rules'], ensure_ascii=False, indent=2) + '\n```')
        parameters = [ref(spec, parameter) for parameter in spec['paths'][path].get('parameters', []) + operation.get('parameters', [])]
        if parameters:
            parts += ['\n| 参数 | 位置 | 类型 | 必填 | 说明 | 约束/默认值 |', '| --- | --- | --- | --- | --- | --- |']
            for p in parameters:
                schema = ref(spec, p.get('schema', {}))
                parts.append(f"| `{p['name']}` | {p['in']} | {cell(type_name(p.get('schema', {})))} | {'是' if p.get('required') else '否'} | {cell(p.get('description', schema.get('description', '—')))} | {cell(constraints(schema))} |")
        else:
            parts.append('\n无查询/路径参数。')
        if 'requestBody' in operation:
            body = ref(spec, operation['requestBody'])
            for media, content in body.get('content', {}).items():
                parts.append(f"\n请求体：`{media}`；必需：{body.get('required', False)}；模型：`{type_name(content.get('schema', {}))}`。{body.get('description', '')}")
                if 'example' in content:
                    parts.append('\n```json\n' + json.dumps(content['example'], ensure_ascii=False, indent=2) + '\n```')
        parts += ['\n| 状态码 | 说明 | Content-Type / 响应模型 |', '| --- | --- | --- |']
        for status, raw in operation['responses'].items():
            response = ref(spec, raw)
            contents = '; '.join(f"{m}: {type_name(c.get('schema', {}))}" for m, c in response.get('content', {}).items()) or '无响应体'
            parts.append(f"| {status} | {cell(response.get('description', ''))} | {cell(contents)} |")
        for status, raw in operation['responses'].items():
            if not status.startswith('2'):
                continue
            response = ref(spec, raw)
            for media, content in response.get('content', {}).items():
                if 'example' in content:
                    parts.append(f'\n{status} 响应示例（{media}）：\n\n```json\n' + json.dumps(content['example'], ensure_ascii=False, indent=2) + '\n```')
        if 'x-source-files' in operation:
            parts.append('\n实现证据：' + ', '.join('`' + cell(f) + '`' for f in operation['x-source-files']) + '。')
    parts += ['\n## 9. 字段级数据字典',
              '模型引用按名称交叉查阅。例如 `OrderVolumeData.series[] → VolumeSeries.amounts → VolumeAmounts`；每一层字段均在下表列出。必填是相对于当前父对象；父对象本身可选时不强制创建。可空只以类型中的 `null` 或 `anyOf/oneOf` null 分支为准。示例不是生产值。内部 FOP 提供器模型若标注为内部，则不能从浏览器直接传入。']
    for name, schema in spec['components']['schemas'].items():
        parts.append(f'\n### {name}\n')
        parts.append(schema.get('description', ''))
        rows = field_rows(schema)
        if rows:
            parts += ['\n| 字段路径 | 类型/引用 | 必填 | 说明 | 约束/示例 |', '| --- | --- | --- | --- | --- |', *rows]
        else:
            parts.append(f"类型：`{type_name(schema)}`；约束：{constraints(schema)}。")
        for key in ('oneOf', 'anyOf', 'allOf'):
            if key in schema:
                parts.append(f"组合规则 `{key}`：" + ', '.join(f'`{type_name(s)}`' for s in schema[key]) + '。完整约束见 OpenAPI JSON。')
        if schema.get('examples'):
            parts.append('\n```json\n' + json.dumps(schema['examples'][0], ensure_ascii=False, indent=2) + '\n```')
    for title, filename in [('10. 前端功能诊断与复现证据', 'ECHARTS_FRONTEND_AUDIT.md'), ('11. 后端契约诊断与生产接入差距', 'ECHARTS_BACKEND_CONTRACT_AUDIT.md'), ('12. 本次验证记录与限制', 'VERIFICATION.md'), ('13. HyperZone FOP 源码字段映射', 'HYPERZONE_FOP_SOURCE_MAPPING.md')]:
        parts.append(f'\n## {title}\n\n' + appendix((DOCS / filename).read_text()))
    parts.append('\n## 14. 规范来源与文档再生成\n\nOpenAPI 结构参考 [OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html)。产品事实来自本仓库源码和本次诊断，不来自通用规范。HTML 使用项目共享 HyperZone 样式、内嵌 CSS 和透明 SVG Logo，可离线打开及打印。\n\n```sh\npython3 -m venv .runtime/local-demo/docs-venv\n.runtime/local-demo/docs-venv/bin/pip install -r scripts/docs/requirements.txt\n.runtime/local-demo/docs-venv/bin/python scripts/docs/build-analytics-docs.py \\\n  --style-root /Library/VSCode/.hyperzone/html-style\n```\n\n`REQUIREMENTS_OVERVIEW.md` 是业务需求源，接口及字段表从 OpenAPI JSON 生成；修改后执行上述脚本同步两种交付格式。不同机器需提供同版本 HyperZone 共享样式目录；生成后的 HTML 本身无此路径依赖。\n')
    text = '\n\n'.join(parts).rstrip() + '\n'
    # Table rows must remain adjacent for Markdown to render field dictionaries.
    return re.sub(r'(?m)(^\|[^\n]*\|)\n\n(?=\|)', r'\1\n', text)


def validate_examples(spec):
    schemas = spec['components']['schemas']
    checked = 0
    for name, schema in schemas.items():
        validator = Draft202012Validator({**schema, 'components': spec['components']}, format_checker=FormatChecker())
        for example in schema.get('examples', []):
            validator.validate(example)
            checked += 1
    for path in spec['paths'].values():
        for method, operation in path.items():
            if method not in ('get', 'post', 'put', 'patch', 'delete'):
                continue
            bodies = [ref(spec, response) for response in operation['responses'].values()]
            if 'requestBody' in operation:
                bodies.append(ref(spec, operation['requestBody']))
            for body in bodies:
                for media in body.get('content', {}).values():
                    samples = ([media['example']] if 'example' in media else []) + [ref(spec, e)['value'] for e in media.get('examples', {}).values() if 'value' in ref(spec, e)]
                    for sample in samples:
                        Draft202012Validator({**media.get('schema', {}), 'components': spec['components']}, format_checker=FormatChecker()).validate(sample)
                        checked += 1
    return checked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--style-root', type=Path, default=Path('/Library/VSCode/.hyperzone/html-style'))
    args = parser.parse_args()
    spec = json.loads(SPEC.read_text())
    validate_spec(spec)
    examples = validate_examples(spec)
    text = build(spec)
    md_path = DOCS / 'HYPERZONE_ECHARTS_API_REQUIREMENTS.md'
    md_path.write_text(text)
    body = markdown.markdown(text, extensions=['tables', 'fenced_code', 'sane_lists'])
    expected_field_tables = sum(bool(field_rows(schema)) for schema in spec['components']['schemas'].values())
    expected_response_tables = sum(method in ('get', 'post', 'put', 'patch', 'delete') for entry in spec['paths'].values() for method in entry)
    if body.count('<th>字段路径</th>') != expected_field_tables or body.count('<th>状态码</th>') != expected_response_tables:
        raise ValueError('Generated HTML is missing API or field dictionary tables')
    body = re.sub(r'<h1>.*?</h1>', '', body, count=1, flags=re.S)
    body = re.sub(r'<a href="(https?://[^\"]+)"', r'<a href="\1" rel="noopener noreferrer"', body)
    loader = importlib.util.spec_from_file_location('hyperzone_style', args.style_root / 'render_html.py')
    renderer = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(renderer)
    html = renderer.render('ECharts 诊断与 API 对接需求', 'HyperZone 智能办公平台 · 字段级契约、统计口径与 FOP 接入验收', body, 'OpenAPI 3.1.1', '2026-10-22')
    renderer.validate(html)
    out = DOCS / 'HYPERZONE_ECHARTS_API_REQUIREMENTS.html'
    out.write_text(html)
    print(f'OpenAPI validated; schema examples checked: {examples}')
    print(f'Markdown: {md_path} ({len(text.splitlines())} lines)')
    print(f'HTML: {out} ({out.stat().st_size} bytes); anchors and embedded logos validated')


if __name__ == '__main__':
    main()
