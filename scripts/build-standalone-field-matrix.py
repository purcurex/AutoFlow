"""Publish the retained current field reference and reproducible source hashes."""
from pathlib import Path
import hashlib, importlib.util,json
R=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('matrix',R/'scripts/fop-local-field-matrix/generate.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
document,matrix,evidence=module.build()
p=R/'docs/requirements/HyperZone23清单字段对照表.html';p.write_text(document)
manifest={'document':str(p.relative_to(R)),'updatedAt':'2026-11-25','lists':len(matrix),'displayFields':sum(len(s['rows']) for s in matrix),'upstreamCalled':False,'databaseQueried':False,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'sourceEvidence':evidence}
(R/'docs/requirements/field-matrix-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in manifest.items() if k!='sourceEvidence'},ensure_ascii=False))
