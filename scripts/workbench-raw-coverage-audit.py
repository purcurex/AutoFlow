#!/usr/bin/env python3
"""Offline raw-capture audit. Output contains aggregate counters only, never row data."""
from pathlib import Path
from collections import Counter
import argparse
import hashlib
import json
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--capture', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
CAPTURE = args.capture.resolve()
OUTPUT = args.output.resolve()
FIELDS = ['hzkj_orderstatus','hzkj_receipt_status','billstatus','hzkj_purchase_status',
          'hzkj_delivery_status','hzkj_refund_status','hzkj_use_status','hzkj_lock_store']
MISSING = '<absent>'
def canonical(v):
    if isinstance(v, (dict,list)): return json.dumps(v,ensure_ascii=False,sort_keys=True)
    if v is None: return '<null>'
    if v == '': return '<empty>'
    return str(v)
def count(rows,key): return dict(sorted(Counter(canonical(r.get(key,MISSING)) for r in rows).items()))
def audit_subset(rows):
    unfinished=[r for r in rows if r.get('hzkj_delivery_status') in ['0','1']]
    unknown=[r for r in rows if r.get('hzkj_delivery_status') not in ['0','1','2']]
    result={'rows':len(rows),'states':{f:count(rows,f) for f in FIELDS}}
    for label,rs in [('known_unfinished',unfinished),('outbound_unknown',unknown)]:
        active=[r for r in rs if r.get('hzkj_orderstatus')!='0']
        paid=[r for r in active if r.get('hzkj_receipt_status')=='1']
        result[label]={'rows':len(rs),'cancelled':len(rs)-len(active),'non_cancelled':len(active),
            'payment_non_cancelled':count(active,'hzkj_receipt_status'),
            'paid_non_cancelled_audit':count(paid,'billstatus'),
            'paid_non_cancelled_orderstatus':count(paid,'hzkj_orderstatus'),
            'paid_non_cancelled_refund':count(paid,'hzkj_refund_status'),
            'paid_non_cancelled_native_outbound':count(paid,'hzkj_delivery_status'),
            'paid_raw_shipped_audit':count([r for r in paid if r.get('hzkj_orderstatus')=='4'],'billstatus'),
            'paid_raw_shipped_outbound':count([r for r in paid if r.get('hzkj_orderstatus')=='4'],'hzkj_delivery_status'),
            'paid_raw_shipped_refund':count([r for r in paid if r.get('hzkj_orderstatus')=='4'],'hzkj_refund_status'),
            'all_orderstatus':count(rs,'hzkj_orderstatus'),
            'all_refund':count(rs,'hzkj_refund_status'),
            'payment_audit_cancelled_cross':[{'receipt':k[0],'billstatus':k[1],'cancelled':k[2],'rows':v} for k,v in sorted(Counter((r.get('hzkj_receipt_status'),r.get('billstatus'),r.get('hzkj_orderstatus')=='0') for r in rs).items())]}
    result['all_paid_non_cancelled_audit']=count([r for r in rows if r.get('hzkj_orderstatus')!='0' and r.get('hzkj_receipt_status')=='1'],'billstatus')
    return result
manifest=json.loads((CAPTURE/'raw-capture-manifest.json').read_text())
files=sorted(CAPTURE.glob('raw-orders-page-*.json'))
rows=[]; file_mismatches=[]; hash_mismatches=[]; count_mismatches=[]
manifest_by_file={Path(p['file']).name:p for p in manifest['pages']}
page_aggregate=Counter(); header_keys=Counter(); entry_keys=Counter(); logistics_keys=Counter()
entry_states={k:Counter() for k in ['hzkj_entrypurc_status','hzkj_use_stock']}
entry_count=0; empty_entries=0
for f in files:
    raw=f.read_bytes(); obj=json.loads(raw); data=obj['data']; page_rows=data['items']; rows.extend(page_rows)
    item=manifest_by_file.get(f.name)
    if item is None: file_mismatches.append(f.name)
    else:
        if hashlib.sha256(raw).hexdigest()!=item['sha256']: hash_mismatches.append(f.name)
        if len(page_rows)!=item['rowCount']: count_mismatches.append(f.name)
    page_aggregate['success_true']+=obj.get('status') is True
    page_aggregate['empty_facts']+=data.get('facts')=={}
    page_aggregate['nonempty_facts']+=bool(data.get('facts'))
    page_aggregate['hasMore_true']+=data.get('hasMore') is True
    page_aggregate['hasMore_false']+=data.get('hasMore') is False
    page_aggregate['source_version_header_present']+='sourceVersion' in data
    for r in page_rows:
        header_keys.update(r.keys()); entries=r.get('hzkj_orders_billentry',[])
        empty_entries+=not bool(entries)
        for e in entries:
            entry_count+=1;entry_keys.update(e.keys())
            for k,c in entry_states.items():c.update([canonical(e.get(k,MISSING))])
        for e in r.get('hzkj_logistics_info',[]):logistics_keys.update(e.keys())
source_files=['backend/src/modules/fop-data/workbench-queue-rules.ts',
'backend/src/modules/workbench-replica/replica-domain-normalizer.ts',
'backend/src/modules/workbench-replica/local-workbench-query.ts',
'backend/src/modules/workbench-replica/local-workbench.service.ts',
'backend/src/modules/workbench-replica/local-workbench-logistics.ts']
meta=Path('/Library/VSCode/dtr5b/datamodel/hzkj_CRM/1.5/main/hzkj_ordercenter/metadata/hzkj_orders.dym')
enums={}
for e in ET.parse(meta).getroot().iter('ComboField'):
    k=e.findtext('Key')
    if k in FIELDS+list(entry_states):enums[k]={x.findtext('Value'):x.findtext('Caption') for x in e.findall('./Items/ComboItem')}
result={
'method':'Offline analysis of every saved page; no FOP requests; no order/customer fields emitted',
'capture':{'files':len(files),'manifest_pages':len(manifest['pages']),'manifest_rows':manifest['rowCount'],
'rows':len(rows),'unique_order_ids':len({r['id'] for r in rows}),
'manifest_hash_matches':len(files)-len(hash_mismatches),'hash_mismatch_count':len(hash_mismatches),
'file_mismatch_count':len(file_mismatches),'count_mismatch_count':len(count_mismatches),
'manifest_only_files':len(set(manifest_by_file)-{f.name for f in files}),
'stable_snapshot':manifest['stableSnapshot'],'published':manifest['published'],
'cursor_exhausted':json.loads(files[-1].read_text())['data']['hasMore'] is False,
'page_aggregate':dict(page_aggregate),
'manifest_sha256':hashlib.sha256((CAPTURE/'raw-capture-manifest.json').read_bytes()).hexdigest()},
'all':audit_subset(rows),
'standard_fulfillment':audit_subset([r for r in rows if r.get('hzkj_billtype',{}).get('number')=='hzkj_orders_BT']),
'billtype_counts':dict(Counter(r.get('hzkj_billtype',{}).get('number',MISSING) for r in rows)),
'header_present_counts':dict(sorted(header_keys.items())),
'empty_timestamp_counts':{k:sum(r.get(k) in [None,''] for r in rows) for k in ['hzkj_datetimefield','hzkj_receipt_date','auditdate']},
'important_absent_headers':{f:len(rows)-header_keys[f] for f in ['hzkj_purchase_status','hzkj_total_amount','hzkj_settlecurrency','hzkj_fre_quo_amount','hzkj_fixed_tax_fee','hzkj_discount_cost','sourceVersion']},
'entries':{'rows':entry_count,'orders_with_empty_entries':empty_entries,'field_present_counts':dict(sorted(entry_keys.items())),
'raw_states':{k:dict(sorted(c.items())) for k,c in entry_states.items()}},
'logistics_field_present_counts':dict(sorted(logistics_keys.items())),
'code_sha256':{f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in source_files},
'fop_metadata_sha256':hashlib.sha256(meta.read_bytes()).hexdigest(),
'fop_metadata_enums':enums,
}
OUTPUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');OUTPUT.chmod(0o600)
print(json.dumps(result,ensure_ascii=False,indent=2))
