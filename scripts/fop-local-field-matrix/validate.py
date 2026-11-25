"""Validate the retained field matrix, current definitions and code fingerprints."""
from pathlib import Path
import hashlib,json
R=Path(__file__).resolve().parents[2]
m=json.loads((R/'docs/requirements/field-matrix-manifest.json').read_text())
p=R/m['document'];html=p.read_text()
assert hashlib.sha256(p.read_bytes()).hexdigest()==m['sha256']
assert html.count('<table class="matrix">')==m['lists']==23
assert html.count('class="field-row"')==m['displayFields']
for e in m['sourceEvidence']:
 assert hashlib.sha256((R/e['path']).read_bytes()).hexdigest()==e['sha256'],e['path']
for word in ['hzkj_note','hzkj_total_amount','hzkj_fixed_tax_fee','hzkj_shipping_time','hzkj_pay_status','hz_fop_relation_refresh','complete','中文配货名']:
 assert word in html,word
for stale in ['自动调用继续暂停','待推 1688 采购','采购退款待跟进','287个展示字段','旧响应未提供，NULL']:
 assert stale not in html,stale
assert (p.parent/'HyperZone智能办公平台项目开发需求说明书.html').exists()
print(json.dumps({'ok':True,'lists':m['lists'],'fields':m['displayFields'],'sourceHashesVerified':True,'upstreamCalled':False}))
