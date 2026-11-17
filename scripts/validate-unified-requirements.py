"""Validate the concise handoff, protocol alignment, links, freshness and delivery package."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
import hashlib,json,re,zipfile
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'docs/requirements';TITLE='HyperZone智能办公平台项目开发需求说明书'
P=DEST/(TITLE+'.html');s=P.read_text()
class Audit(HTMLParser):
 def __init__(self):
  super().__init__();self.ids=[];self.links=[];self.titles=[];self.headings=[];self.h2=[];self.cell=[];self.first=[];self.tag=None;self.column=0;self.in_td=False
 def handle_starttag(self,t,a):
  a=dict(a)
  if 'id' in a:self.ids.append(a['id'])
  if t=='a' and 'href' in a:self.links.append(a['href'])
  if t in ['h1','h2','title']:self.tag=t
  if t=='tr':self.column=0
  if t=='td':self.column+=1;self.in_td=True;self.cell=[]
 def handle_data(self,d):
  if self.tag=='h1':self.headings.append(d)
  if self.tag=='h2':self.h2.append(d)
  if self.tag=='title':self.titles.append(d)
  if self.in_td:self.cell.append(d)
 def handle_endtag(self,t):
  if t==self.tag:self.tag=None
  if t=='td':
   if self.column==1:self.first.append(''.join(self.cell))
   self.in_td=False
x=Audit();x.feed(s)
assert ''.join(x.headings)==TITLE and ''.join(x.titles)==TITLE
assert len(x.ids)==len(set(x.ids))
assert len([h for h in x.h2 if re.match(r'0[1-6] ·',h)])==6
assert 'HyperZone FOP扩展开发需求</h2>' in s
# The FOP handoff keeps compact single-line labels; analytical metric names may
# wrap inside the independently styled analytics chapter.
core=Audit();core.feed(s.split('<section class="analytics-section">',1)[0])
assert all(len(v)<=12 for v in core.first),core.first
for link in x.links:
 u=urlsplit(link)
 if u.scheme or u.netloc:continue
 if not u.path:assert unquote(u.fragment) in x.ids,link
 else:assert (P.parent/unquote(u.path)).resolve().is_file(),link
manifest=json.loads((DEST/'build-manifest.json').read_text())
assert manifest['focus']=='synchronization-services' and manifest['sections']==8 and manifest['analyticsChapter'] and manifest['queueScopeReview'] and manifest['upstreamCalled'] is False
assert manifest['sha256']==hashlib.sha256(P.read_bytes()).hexdigest()
assert manifest['preferredSync']=='timestamp-with-reconciliation' and manifest['timestampRuntimeEnabled'] is False and manifest['strictServicesOptional'] is True
timestamp=json.loads((ROOT/'docs/openapi/fop-timestamp-sync-contract.json').read_text())
assert timestamp['runtimeEnabled'] is False and timestamp['consistency']=='eventual-with-full-reconciliation'
assert set(timestamp['capabilities'])=={'TIME_QUERY','FULL_DETAIL','RECONCILE'}
assert timestamp['capabilities']['TIME_QUERY']['timeFields']==['createtime','modifytime']
assert timestamp['window']['interval']=='[L,U)' and timestamp['window']['defaultsRequireMeasuredValidation'] is True
assert timestamp['optionalStrictProtocol']['requiredForFirstPhase'] is False
assert timestamp['localImplementation']['engine'] is True and timestamp['localImplementation']['durablePostgres'] is True
assert timestamp['localImplementation']['sourceLiveVerified'] is False and timestamp['localImplementation']['migrationAppliedToBusinessDatabase'] is True
profile=json.loads((ROOT/'docs/openapi/fop-timestamp-profile.example.json').read_text())
assert profile['verified'] is False and all(action['path'] is None for action in profile['actions'].values())
timestamp_proof=json.loads((DEST/'timestamp-verification.json').read_text())
assert timestamp_proof['upstreamCalled'] is False and timestamp_proof['businessDatabaseModified'] is False
assert timestamp_proof['focusedJest']['testsFailed']==0 and timestamp_proof['isolatedPostgres']['testsPassed']==8
assert timestamp_proof['fullBackend']['allPassed'] is False
assert all(p in manifest['inputHashes'] for p in timestamp_proof['implementationFiles'])
for marker in ['id="timestamp-incremental"','时间水位','createtime','modifytime','afterTime','afterId','时间增量机制','最终一致','不再作为首期前置条件','本地时间执行器与持久化已实现','四实体普通分页模式已实现同事务发布','首期无需填写']:
 assert marker in s or marker in (ROOT/'agent.md').read_text(),marker
for path,digest in manifest['inputHashes'].items():assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==digest,path
contract=json.loads((ROOT/'docs/openapi/fop-replica-service-contract.json').read_text())
assert set(manifest['operations'])==set(contract['operations'])
for op,definition in contract['operations'].items():
 assert 'FOP_REPLICA_'+op+'_URL' in s,op
 for key in [*definition['request'],*definition['data']]:assert key in s,(op,key)
for marker in ['sourceVersion','affectedOrders','ownershipVector','orderProjections','dependencies','relationRevision','100000','hyperzone.test','逐人逐单授权','不预占库存','8 MiB','15 秒','1,000','30 流','60 秒','正式实体待 FOP 提供']:
 assert marker in s,marker
for prefix,n in [('D',5),('T',8)]:
 assert re.findall(r'<tr><td>('+prefix+r'\d{2}) ',s)==[f'{prefix}{i:02}' for i in range(1,n+1)]
for i in range(1,7):assert len(re.findall(r'<tr><td>S0'+str(i)+r' ',s))==2
assert 'data:image/svg+xml;base64,' in s and '@media print' in s and 'text-indent:2em' in s
for marker in ['id="frontend-request-policy"','id="sync-time-policy"','id="sync-runtime-boundary"',
 'projection=count','每2秒一次、最多30次','08:30','09:00—18:30','20:30、22:30、00:30、02:30、04:30、06:30',
 '合计27个时点','FOP_QUERIES_PAUSED=true','WORKBENCH_AUTOMATIC_CALLS_ENABLED=false','WORKBENCH_SYNC_ENABLED=false',
 'GET /api/workbench/analytics/dashboard']:
 assert marker in s,marker
assert not re.search(r'<(?:img|script|link)[^>]+(?:src|href)=["\'](?:https?:|/)',s)
for removed in ['348条','LCL01','workbench_replica_authorization_stale','verificationStage','matrix-tools']:assert removed not in s,removed
for marker in ['id="analytics"','AN-L01','AN-L02','AN-L03','AN-L04','/api/workbench/analytics','待实施','客户付款','币种','hz_fop_collected_analytics_facts']:
 assert marker in s,marker
proof=json.loads((DEST/'analytics-verification.json').read_text())
assert proof['consistentSnapshot'] is False and proof['automaticCallsEnabled'] is False and proof['newDashboardUiImplemented'] is True
assert proof['httpVerification']['status']==200 and proof['httpVerification']['invalidDateStatus']==400 and proof['httpVerification']['unauthenticatedStatus']==401
assert proof['httpVerification']['readMode']=='local' and proof['httpVerification']['scope']['canViewDetails'] is False
assert {c['entity']:c['rowCount'] for c in proof['captures']}==proof['httpVerification']['quality']
assert all(c['coverage']=='full_company_scan' and not c['consistentSnapshot'] for c in proof['captures'])
assert {x['name'] for x in proof['localSqlVerification'] if x['passed']}=={'admin','owner','empty','department'}
for marker in ['id="sku-collapse-policy"','全部展开（本页）／全部收起（本页）','detailLineCount','previewLines','查看关联履约明细','queryPurchaseReturn','实物退货','HTTP 519']:
 assert marker in s,marker
returns=json.loads((DEST/'purchase-return-verification.json').read_text())
assert returns['physicalReturnIntegration'] is False and returns['physicalReturnSource']=='pending'
assert returns['complete'] is False and returns['sourceFailure']['httpStatus']==519
assert returns['businessQueryAttempts']==1 and returns['successfulPages']==0 and returns['importedPhysicalReturns']==0
assert returns['automaticCallsEnabled'] is False and returns['persistentPauseUnchanged'] is True
unpaid=json.loads((DEST/'sales-unpaid-verification.json').read_text())
assert unpaid['upstreamCalled'] is False and unpaid['rawRewritten'] is False
assert unpaid['counts']['status_candidates']==unpaid['counts']['excluded_source_fulfilled']+unpaid['counts']['eligible']
assert unpaid['counts']['wrong_order_status']==0 and unpaid['counts']['source_fulfilled']==0
assert unpaid['browserVerification']['displayedTotal']==unpaid['counts']['eligible']
sales_review=json.loads((DEST/'sales-review-stock-verification.json').read_text())
assert sales_review['remoteApiCalls']==0 and sales_review['automaticCallsEnabled'] is False
assert sales_review['reviewRule']=={'orderStatus':'2','billStatus':['A','B']}
assert sales_review['totalStock']==sum(row['count'] for row in sales_review['stock'])
assert {row['order_status'] for row in sales_review['stock']} <= {'cancelled','unpaid','paid'}
employee_proof=json.loads((DEST/'employee-directory-verification.json').read_text())
assert employee_proof['remoteApiCalls']==0 and employee_proof['automaticCallsEnabled'] is False
assert employee_proof['orderCoverage']['mapped']==employee_proof['orderCoverage']['total']
assert employee_proof['ownScopeOnly'] and employee_proof['foreignDepartmentDenied']
assert 'id="local-employee-department-policy"' in s
package=DEST/'HyperZoneFOP同步服务开发交付包.zip'
with zipfile.ZipFile(package) as z:
 expected=[DEST/'fop-package-logistics-gap.json',DEST/'api-integration-verification-20261116.json',ROOT/'docs/openapi/fop-api-field-audit-20261116.json',ROOT/'docs/openapi/fop-query-timestamp-capabilities.json',ROOT/'docs/openapi/fop-timestamp-paged-profile.example.json',DEST/'employee-directory-verification.json',P,ROOT/'docs/openapi/fop-replica-service-contract.json',ROOT/'docs/openapi/fop-replica-domain.schema.json',ROOT/'docs/openapi/fop-timestamp-sync-contract.json',ROOT/'docs/openapi/fop-timestamp-profile.example.json',DEST/'timestamp-verification.json',DEST/'analytics-verification.json',DEST/'purchase-return-verification.json',DEST/'sales-unpaid-verification.json',DEST/'sales-review-stock-verification.json',DEST/'business-status-verification.json']
 assert set(z.namelist())=={str(p.relative_to(ROOT/'docs')) for p in expected}
 for p in expected:assert z.read(str(p.relative_to(ROOT/'docs')))==p.read_bytes()
scope=s.split('<section class="queue-scope-section">',1)[1].split('</section>',1)[0]
readable=scope.split('<div id="queue-readable-current">',1)[1].split('<details class="queue-scope-plan-history">',1)[0]
assert re.findall(r'data-readable-scope-id="(Q\d{2})"',readable)==[f'Q{i:02}' for i in range(1,24)]
assert not re.search(r'\b[ABCDGLOPS]\s*[=∈]|billstatus|hzkj_|raw_',readable),'Business-readable scope must use full state names'
for marker in ['未关联本地SKU','已提交','同步失败','部分履约','采购单视角','尚未','正式实物退货','当前按履约订单汇总','C端付款时间']:
 assert marker in readable,marker
assert re.findall(r'data-order-first-id="(Q\d{2})"',scope)==[f'Q{i:02}' for i in range(1,24)]
for marker in ['id="queue-order-first"','本轮方案，待实施','未修改业务筛选代码','id="order-first-gaps"','class="queue-scope-history"']:
 assert marker in scope,marker
assert re.findall(r'data-scope-id="(Q\d{2})"',scope)==[f'Q{i:02}' for i in range(1,24)]
assert re.findall(r'<tr><td>(A\d{2}) ',scope)==[f'A{i:02}' for i in range(1,14)]
for marker in ['id="queue-scope-review"','现状取数','建议范围与退出条件','未修改业务筛选',
 '未审核履约订单不得进入待采购清单','待提供','主办','历史','配货审核','Shopify',
 'id="queue-evidence"','id="queue-decisions"']:
 assert marker in scope,marker
assert len([h for h in x.h2 if re.match(r'0[1-8] ·',h)])==8
# Bounded space for registration completion and the newly verified native audit contract.
assert len(s)<133000,'Unexpected document expansion'

assert proof['dashboardLocalQuery']['readMode']=='local' and proof['dashboardLocalQuery']['remoteQueries'] is False
assert {x['scope']:x.get('status') for x in proof['dashboardLocalQuery']['httpChecks']}['unauthenticated']==401

status_proof=json.loads((DEST/'business-status-verification.json').read_text())
assert status_proof['rawUnchanged'] and status_proof['fopRequests']==0 and status_proof['idempotentDryRunChanges']==0
assert status_proof['queues']['dispatch_pending']==341 and status_proof['queues']['shipping_pending']==518
assert 'id="business-status-implementation"' in scope

api_proof=json.loads((DEST/'api-integration-verification-20261116.json').read_text())
native_approval=api_proof['nativeApprovalIntegration']
assert native_approval['businessDataMutated'] is True and native_approval['automaticSyncResumed'] is False
assert len(native_approval['approved']['fulfillment'])==2 and len(native_approval['approved']['allocation'])==2
assert native_approval['readback']['sourceConfirmedC'] and native_approval['readback']['repeatVerificationWrites']==0
assert len(native_approval['businessRejected'])==2 and native_approval['pending']
assert 'id="approval-integration-audit"' in s
assert api_proof['automaticCallsEnabled'] is False and api_proof['database']['restoreVerified'] is True
assert api_proof['customerRegistrations']['actualRowsImported']==444
registration_done=api_proof['customerRegistrations']['completedRegistrationStatistics']
assert registration_done['userConfirmation']['basis']=='user_confirmed_company_catalogue'
assert registration_done['userConfirmation']['companyId']=='100000'
assert registration_done['capture']['rowCount']==registration_done['importedRows']==444
assert registration_done['pageCount']==5 and registration_done['backup']['restoreVerified'] is True
assert registration_done['year2026']==444 and registration_done['november2026']==33
assert registration_done['unmatchedOwnerCount']==13 and registration_done['dimensionsReconcile'] is True
assert registration_done['selfScope']['passed'] is True and registration_done['invalidDepartmentDenied'] is True
assert 'id="customer-registration-completed"' in s
marketing=api_proof['marketingDepartmentScope']
assert marketing['remoteRequests']==0 and marketing['automaticCallsEnabled'] is False
assert marketing['marketingRegistrations']==sum(d['count'] for d in marketing['departmentRegistrations'])==408
assert len(marketing['managerChecks'])==4 and all(m['defaultPersonal'] and m['personalEmployees']==1 for m in marketing['managerChecks'])
assert marketing['browser']['unauthorizedPlaceholderRemoved'] and 'id="marketing-department-scope"' in s

customer_auth=api_proof['customerRegistrations']['authorizationDiagnosis']
assert api_proof['customerRegistrations']['authorizationStatus']=='verified_query_success'
assert customer_auth['success'] is True and customer_auth['httpStatus']==200 and customer_auth['errorCode']=='0'
assert customer_auth['lastFailureAt'] < customer_auth['screenshotGrantAt'] < customer_auth['checkedAt']
assert customer_auth['freshToken'] is True and customer_auth['rowsRead']==1 and customer_auth['importedRows']==0
assert customer_auth['localScopeValidation']['code']=='source_scope_unverified'
assert customer_auth['localScopeValidation']['applicationAuthorizationFailed'] is False
assert 'id="customer-authorization-diagnosis"' in s
assert len(api_proof['liveSamples'])==7 and sum(x['httpStatus']==200 for x in api_proof['liveSamples'])==4
assert all(p in manifest['inputHashes'] for p in api_proof['implementationFiles'])
assert len(json.loads((ROOT/'docs/openapi/fop-query-timestamp-capabilities.json').read_text())['apis'])==26
for marker in ['id="api-update-20261116"','应用未订阅','hzkj_rf_applyqty','普通分页','客户注册']:
 assert marker in s,marker

# Current business reads must be finite marketing-department scope, including administrators.
display_scope=api_proof['businessDisplayScope20261116']
assert display_scope['allowedDepartmentNames']==['营销中心','业务一部','业务二部','业务三部','业务四部']
assert display_scope['fopRequests']==0 and display_scope['automaticCallsEnabled'] is False and display_scope['paused'] is True
assert len(display_scope['queues'])==23 and all(q['status']==200 for q in display_scope['queues'])
assert display_scope['analyticsCount']==display_scope['eligibleOrderCount']
assert display_scope['outsideDepartmentStatus']==display_scope['unknownOwnerStatus']==403
assert all(c['unmatchedOwnerCount']==0 for c in display_scope['charts'])
assert all(e['departmentsVerified'] for e in display_scope['exports'])
assert '业务员业绩维度为业务员、月度趋势' in s and '默认“业务部门”，其次“月度趋势”' in s
assert '取消独立业务部门维度，部门汇总并入业务员视图' in s
assert '月度趋势（默认）、业务员、国家、仓库' in s
print(json.dumps({'ok':True,'sections':8,'preferredSync':'timestamp-with-reconciliation','optionalStrictServices':6,'timestampRuntimeEnabled':False,'queueViews':23,'queueScenarios':13,'firstColumnOneLineLabels':len(core.first),'links':len(x.links),'contractAligned':True,'analyticsEvidenceAligned':True,'packageVerified':True,'upstreamCalled':False}))
