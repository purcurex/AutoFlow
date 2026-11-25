"""Validate current requirements, source freshness, clear gap ownership and preserved contracts."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
import hashlib,json,re,zipfile
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'docs/requirements';TITLE='HyperZone智能办公平台项目开发需求说明书'
P=DEST/(TITLE+'.html');s=P.read_text()
class Audit(HTMLParser):
 def __init__(self):
  super().__init__();self.ids=[];self.links=[];self.titles=[];self.headings=[];self.h2=[];self.tag=None
 def handle_starttag(self,t,a):
  a=dict(a)
  if 'id' in a:self.ids.append(a['id'])
  if t=='a' and 'href' in a:self.links.append(a['href'])
  if t in ['h1','h2','title']:self.tag=t
 def handle_data(self,d):
  if self.tag=='h1':self.headings.append(d)
  if self.tag=='h2':self.h2.append(d)
  if self.tag=='title':self.titles.append(d)
 def handle_endtag(self,t):
  if t==self.tag:self.tag=None
x=Audit();x.feed(s)
assert ''.join(x.headings)==TITLE and ''.join(x.titles)==TITLE
assert len(x.ids)==len(set(x.ids)),'Duplicate anchors'
assert len([h for h in x.h2 if re.match(r'0[1-6] ·',h)])==6
assert 'HyperZone 统一需求说明</h2>' in s
for link in x.links:
 u=urlsplit(link)
 if u.scheme or u.netloc:continue
 if not u.path:assert unquote(u.fragment) in x.ids,link
 else:assert (P.parent/unquote(u.path)).resolve().is_file(),link
assert 'data:image/svg+xml;base64,' in s and '@media print' in s and 'text-indent:2em' in s
assert not re.search(r'<(?:img|script|link)[^>]+(?:src|href)=["\'](?:https?:|/)',s)
# No historical rule matrix or hardcoded obsolete verification paragraph may return.
for removed in ['queue-scope-plan-history','queue-scope-history','data-order-first-id=',
 'data-scope-id=','本轮方案，待实施','8.12 · 历史方案','自动调用继续暂停','自动同步继续暂停',
 '自动采集仍暂停','真实清单尚未接通','待入库恢复为收货通知维度',
 '当前严格有效状态、归属与日期条件下未得到可汇总样本','五岗位旧分析入口迁移待实施',
 '348条','LCL01','matrix-tools']:
 assert removed not in s,removed
review=json.loads((DEST/'requirements-current-review.json').read_text())
assert review['asOf']=='2026-11-18' and review['scope']=='current-collected-implementation'
assert review['businessCodeChanged'] is True and review['fopRequests']==0
assert review['localOptimizationEvidence']=='api-integration-verification-20261116.json#localGapOptimization20261118'
assert review['localDatabaseAccess']=='source-read-only; exception-projection-v7-rebuilt' and review['historicalEvidencePreserved'] is True
# The current publication is FOP-only; historical local scope evidence remains intact.
assert re.findall(r'data-fop-gap="(F\d{2})"',s)==review['fopGapIds']
assert len(review['fopGapIds'])==10
assert 'data-local-gap=' not in s and 'data-chart-id=' not in s
for marker in ['id="scope"','id="fop"','id="sync-api"','id="relations"','id="realtime"','id="acceptance"',
 '待部署／授权','待核验','待开发','修改时间',
 'queryWorkbenchInventoryBalance','同一时间','归档','解除','已提交','幂等','全款／押金',
 '未重新调用测试环境API','不要求包裹与耗用逐行对应','7项前端']:
 assert marker in s,marker
# Allow the standard-space budget/recovery contract while retaining the concise six-section scope.
assert 10000<len(s)<50000,'Unexpected FOP-only document size'
manifest=json.loads((DEST/'build-manifest.json').read_text())
assert manifest['focus']=='fop-outstanding-requirements' and manifest['sections']==6
assert not manifest['analyticsChapter'] and not manifest['queueScopeReview'] and manifest['upstreamCalled'] is False
assert manifest['sha256']==hashlib.sha256(P.read_bytes()).hexdigest()
for path,digest in manifest['inputHashes'].items():
 assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==digest,path
assert all(p in manifest['inputHashes'] for p in review['implementationFiles'])
assert manifest['preferredSync']=='timestamp-with-reconciliation' and manifest['strictServicesOptional'] is True
contract=json.loads((ROOT/'docs/openapi/fop-replica-service-contract.json').read_text())
assert set(manifest['operations'])==set(contract['operations'])
timestamp=json.loads((ROOT/'docs/openapi/fop-timestamp-sync-contract.json').read_text())
assert timestamp['runtimeEnabled'] is True and timestamp['consistency']=='eventual-with-full-reconciliation'
assert set(timestamp['capabilities'])=={'TIME_QUERY','FULL_DETAIL','RECONCILE'}
assert timestamp['capabilities']['TIME_QUERY']['timeFields']==['createtime','modifytime']
assert timestamp['window']['interval']=='[L,U)'
assert timestamp['optionalStrictProtocol']['requiredForFirstPhase'] is False
assert timestamp['localImplementation']['automaticScheduler'] is True
assert timestamp['localImplementation']['sourceLiveVerified'] is True
api=json.loads((DEST/'api-integration-verification-20261116.json').read_text())
rate=api['publicCloudRateLimits20261125']
assert rate['standardSpaceLimits']=={'qps':20,'qpm':500,'qph':10000,'qpd':200000}
assert rate['projectDefaults']=={'qps':16,'qpm':400,'qph':8000,'qpd':160000,'minStartIntervalMs':500,'shortQueueMaxMs':5000}
assert rate['localMigrationApplied'] and not rate['productionDeploymentVerified']
assert rate['verificationFopRequests']==0 and not rate['productionPressureTest']
assert all(p in manifest['inputHashes'] for p in rate['implementationFiles'])
for marker in ['id="fop-public-cloud-rate-limits"','hz_fop_api_budgets','2526','2528','2055','FOP_RATE_LIMIT_QPS','16／400','8,000／160,000']:
 assert marker in s,marker
opportunity=api['localOpportunityManagement20261118']
assert opportunity['scope']=='local opportunity module; no submit or approval'
assert opportunity['manualFopRequests']==0 and opportunity['fopBusinessWrites']==0
assert opportunity['automaticSyncFlagsChanged'] is False
assert opportunity['validation']['backendTargeted']['failed']==0
assert opportunity['validation']['frontendTargeted']['failed']==0
assert opportunity['validation']['isolatedPostgres']['passedCount']>=16
assert opportunity['validation']['browser']['browser']['fromLeadRepeatedSameId'] is True
assert opportunity['validation']['browser']['browser']['unsavedInputGuard'] is True
assert all(p in manifest['inputHashes'] for p in opportunity['implementationFiles'])
assert 'OPPORTUNITY_VERIFICATION_PLACEHOLDER' not in s
prevention=api['salesExceptionIncrementalPrevention20261118']
assert prevention['ruleVersion']==7 and prevention['sourceRawAndDisplayUnchanged'] is True
assert prevention['projectionMismatches']==0 and prevention['dirtyRowsAfterCommit']==0
assert prevention['fopRequestsForThisRepair']==0 and prevention['fopBusinessWrites']==0
assert prevention['verification']['fullBackendSuite']['failed']==0
assert prevention['verification']['realTimestampPublisherScenarios']>=7
assert prevention['verification']['postgresMigrationRoundtrip'] is True
assert prevention['verification']['http']['persistedReasonsMatch'] is True
assert prevention['verification']['automaticSyncPreserved'] is True
assert review['databaseReadVerification']['ruleVersion']==prevention['ruleVersion']
optimization=api['localGapOptimization20261118']
assert optimization['backend']['numFailedTests']==0 and optimization['frontend']['numFailedTests']==0
assert all(optimization['build'][component]=='passed' for component in ['backend','frontend'])
assert optimization['sourceActions']['manualFopRequests']==0 and optimization['runtime']['syncFlagsChanged'] is False
assert optimization['browser']['warehouse']['chartOrders']==optimization['browser']['warehouse']['detailOrders']
normal=api['normalApiOperation20261118']
readiness=api['syncProductionReadiness20261118']
assert readiness['productionDeployed'] is False and readiness['productionRequests']==0
assert readiness['validation']['backendBuildPassed'] and readiness['validation']['isolatedRealPostgres']
assert readiness['configuration']['sameAutomaticCredentialBundle']
assert readiness['recovery']['failedWatermarkUnchanged'] and readiness['recovery']['deletionInference'] is False
assert all(p in manifest['inputHashes'] for p in readiness['implementationFiles'])
assert timestamp['localImplementation']['automaticSchedule']['productionRuntime']['liveProductionValidated'] is False
assert normal['automaticCallsEnabled'] is True and normal['paused'] is False
assert normal['frequency']['dailySlots']==27 and normal['validation']['automaticCycleSucceeded'] is True
assert manifest['timestampRuntimeEnabled'] is True
assert set(normal['scope']['entities'])==set(review['automaticEntities'])
assert api['purchaseMaterialReturnFullScan20261117']['imported'] is True
assert api['fulfillmentLineOutboundIntegration20261118']['status']=='live_fields_integrated_and_historical_backfill_committed'
assert api['supplierContactNative20261118']['status']=='connected-native-purchase-contact'
assert api['masterDataApiProposal20261117']['status']=='proposal-not-implemented'
# Historical evidence remains historical. Its paused flags or old counts must not
# be rewritten merely to make the current document agree with a newer runtime.
proof=json.loads((DEST/'analytics-verification.json').read_text())
assert proof['consistentSnapshot'] is False
assert proof['httpVerification']['readMode']=='local'
assert proof['dashboardLocalQuery']['remoteQueries'] is False
assert all(c['coverage']=='full_company_scan' and not c['consistentSnapshot'] for c in proof['captures'])
assert {x['name'] for x in proof['localSqlVerification'] if x['passed']}=={'admin','owner','empty','department'}
assert all(p in manifest['inputHashes'] for p in proof['implementationFiles'])
package=DEST/'HyperZoneFOP同步服务开发交付包.zip'
with zipfile.ZipFile(package) as z:
 expected=[DEST/"HyperZone23清单字段对照表.html",DEST/"field-matrix-manifest.json",DEST/"superseded-documents.json",DEST/'production-release-verification.json',ROOT/'docs/manuals/HyperZone生产部署指导手册.html',DEST/'requirements-current-review.json',DEST/'fop-package-logistics-gap.json',DEST/'api-integration-verification-20261116.json',ROOT/'docs/openapi/fop-api-field-audit-20261116.json',ROOT/'docs/openapi/fop-query-timestamp-capabilities.json',ROOT/'docs/openapi/fop-timestamp-paged-profile.example.json',DEST/'employee-directory-verification.json',P,ROOT/'docs/openapi/fop-replica-service-contract.json',ROOT/'docs/openapi/fop-replica-domain.schema.json',ROOT/'docs/openapi/fop-timestamp-sync-contract.json',ROOT/'docs/openapi/fop-timestamp-profile.example.json',DEST/'timestamp-verification.json',DEST/'analytics-verification.json',DEST/'purchase-return-verification.json',DEST/'sales-unpaid-verification.json',DEST/'sales-review-stock-verification.json',DEST/'business-status-verification.json']
 assert set(z.namelist())=={str(p.relative_to(ROOT/'docs')) for p in expected}
 for p in expected:assert z.read(str(p.relative_to(ROOT/'docs')))==p.read_bytes(),p
print(json.dumps({'ok':True,'sections':6,'localNarrativesPublished':False,'fopGaps':10,'currentRulesOnly':True,'timestampRuntimeEnabled':True,'sourceHashesVerified':True,'packageVerified':True,'upstreamCalled':False},ensure_ascii=False))

production=json.loads((DEST/'production-release-verification.json').read_text())
assert production['isolatedDeploymentReady'] is True
assert production['productionReleaseApproved'] is False and production['productionFopCalls']==0
assert production['verification']['runtime']['passed'] is True
assert production['verification']['runtime']['initialized'] is False
assert production['verification']['runtime']['sourceSyncedAt'] is None
if production['verification']['e2e']['failed']:
 assert production['productionReleaseApproved'] is False and production['releaseBlockers']
assert all(p in manifest['inputHashes'] for p in production['implementationFiles'])

for retired in json.loads((DEST/"superseded-documents.json").read_text()):
 assert not (ROOT/retired).exists(),retired
import subprocess,sys
subprocess.run([sys.executable,str(ROOT/"scripts/fop-local-field-matrix/validate.py")],check=True)
