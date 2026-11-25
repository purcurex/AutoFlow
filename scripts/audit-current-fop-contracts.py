"""Inventory current DTS exports without publishing employee data or credentials."""
from pathlib import Path
import json, zipfile, hashlib
root=Path(__file__).resolve().parents[2]/'API接口文档'
exports=[]; inventory=[]
for path in sorted(root.iterdir()):
 if path.suffix not in ('.dts','.zip','.md'): continue
 inventory.append({'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
 if path.suffix=='.dts': entries=[(path.name,path.read_text())]
 elif path.suffix=='.zip':
  with zipfile.ZipFile(path) as z: entries=[(n,z.read(n).decode('utf-8-sig')) for n in z.namelist() if n.endswith('.dts')]
 else: continue
 for name,contents in entries:
  for line in contents.splitlines():
   if '@ISC@' not in line: continue
   try: rows=json.loads(line.split('@ISC@',1)[1])
   except ValueError: continue
   for r in rows:
    if r.get('_Type_') not in ('openapi_apilist','openapi_customapi'): continue
    exports.append({'file':name,'entity':r.get('_Type_'),'number':r.get('number'),'url':r.get('urlformat'),'class':r.get('classname'), 'request':[{'name':p.get('paramname'),'type':p.get('paramtype'),'required':p.get('must')} for p in r.get('bodyentryentity',[])], 'response':[{'name':p.get('respparamname'),'type':p.get('respparamtype')} for p in r.get('respentryentity',[])]})
print(json.dumps({'files':inventory,'exports':exports},ensure_ascii=False,indent=2))
