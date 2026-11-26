"""Build deterministic preset variants from the existing vector art and shared palettes."""
from pathlib import Path
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'frontend/public/avatars'
OUTPUT = SOURCE / 'themes'
PALETTES = ROOT / 'frontend/src/theme/palettes.json'

# Recolor decorative layers only. Skin, fur, facial features and warm highlights stay original.
ACCENTS = {
    'ocean': {'#CAD9E3': 'soft', '#A9BDC9': 'mid', '#96A8B2': 'deep'},
    'mint': {}, 'iris': {'#C7B6DD': 'mid'}, 'rose': {}, 'amber': {},
    'slate': {'#79A688': 'accent'},
    'navy': {'#33465E': 'accent', '#1E303F': 'deep'},
    'graphite': {'#46515B': 'accent'},
    'violet': {'#8B789F': 'accent', '#D5C7E1': 'soft'},
    'blush': {'#637C74': 'accent', '#D9E3D8': 'soft'},
    'cedar': {'#64C5AC': 'soft', '#2FA78D': 'mid', '#168578': 'accent', '#156C60': 'deep', '#289D7B': 'accent', '#8DD6B7': 'soft'},
    'ink': {'#377FCE': 'mid', '#246AB8': 'accent', '#57AADB': 'mid', '#4E96CF': 'accent'},
    'summit': {'#6AB9D1': 'soft', '#278BA9': 'mid', '#186E8B': 'deep', '#54B99B': 'mid', '#289786': 'accent', '#B9EAD2': 'soft'},
    'sail': {'#46C6D8': 'soft', '#218FC1': 'mid', '#208EBA': 'accent', '#194C6E': 'deep', '#1C557A': 'deep', '#CDF6F6': 'soft'},
    'peony': {'#D9A3B6': 'accent', '#ECC4D0': 'soft'},
    'pearl': {'#C7B9DC': 'mid', '#B59BBE': 'accent'},
    'butterfly': {'#ABBAAD': 'accent', '#DBC0CD': 'soft'},
    'swan': {'#A6C3CE': 'mid', '#E8F2F3': 'soft'},
}


def mix(a, b, weight):
    rgb = lambda color: [int(color[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x * weight + y * (1 - weight)):02X}' for x, y in zip(rgb(a), rgb(b)))


def tones(palette, mode):
    primary, soft, link, sidebar, _ = palette[mode]
    if mode == 'light':
        return dict(background=soft, sky=mix(primary, '#FFFFFF', .26),
                    accent=primary, mid=mix(primary, '#FFFFFF', .65),
                    soft=mix(primary, '#FFFFFF', .28), deep=mix(primary, sidebar, .55))
    return dict(background=soft, sky=mix(soft, link, .80),
                accent=palette['chartDetail']['dark'], mid=mix(link, soft, .65),
                soft=mix(link, soft, .36), deep=mix(primary, sidebar, .65))


def render(source, avatar_id, colors):
    root = ET.fromstring(source)
    namespace = {'s': 'http://www.w3.org/2000/svg'}
    assert root.attrib['viewBox'] == '0 0 128 128'
    assert not re.search(r'<(?:script|foreignObject|image)\b|\bon\w+=|\bhref=', source, re.I)
    substitutions = {old: colors[role] for old, role in ACCENTS[avatar_id].items()}
    for old in substitutions:
        assert old in source, f'{avatar_id}: missing decorative color {old}'
    sky = root.find('.//s:linearGradient[@id="sky"]', namespace)
    if sky is not None:
        stops = list(sky)
        substitutions[stops[0].attrib['stop-color']] = colors['sky']
        substitutions[stops[-1].attrib['stop-color']] = colors['background']
    else:
        background = root.find('s:rect', namespace)
        assert background is not None and background.attrib.get('width') == '128'
        substitutions[background.attrib['fill']] = colors['background']
    # One pass avoids recursively replacing a newly assigned color.
    themed = re.sub(r'#[0-9A-Fa-f]{6}\b', lambda match: substitutions.get(match[0].upper(), match[0]), source)
    return themed.rstrip() + '\n'


def build(check=False):
    palettes = json.loads(PALETTES.read_text())
    sources = {path.stem.removeprefix('preset-'): path for path in SOURCE.glob('preset-*.svg')}
    assert set(sources) == set(ACCENTS), 'Register each preset decorative palette before generating variants'
    expected = {}
    for palette, values in palettes.items():
        for mode in ('light', 'dark'):
            for avatar_id, path in sorted(sources.items()):
                key = f'{palette}/{mode}/{path.name}'
                expected[key] = render(path.read_text(), avatar_id, tones(values, mode)).encode()
    manifest = {
        'paletteSource': 'frontend/src/theme/palettes.json',
        'paletteSha256': hashlib.sha256(PALETTES.read_bytes()).hexdigest(),
        'presets': len(sources), 'themes': len(palettes) * 2,
        'sources': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for _, path in sorted(sources.items())},
        'files': {key: hashlib.sha256(value).hexdigest() for key, value in sorted(expected.items())},
    }
    expected['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    actual = {str(path.relative_to(OUTPUT)) for path in OUTPUT.rglob('*') if path.is_file()} if OUTPUT.exists() else set()
    if check:
        assert actual == set(expected), 'Run python3 scripts/build-avatar-assets.py to update avatar assets'
        for key, data in expected.items():
            assert (OUTPUT / key).read_bytes() == data, f'Stale avatar: {key}'
    else:
        for key, data in expected.items():
            path = OUTPUT / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        for key in actual - set(expected):
            (OUTPUT / key).unlink()
    print(f'Avatar assets: {len(sources)} presets × {len(palettes) * 2} themes verified' if check else f'Avatar assets: generated {len(expected) - 1} variants')


if __name__ == '__main__':
    build('--check' in sys.argv)
