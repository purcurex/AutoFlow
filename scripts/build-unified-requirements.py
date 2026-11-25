"""Build the current unified requirements from reviewed sources and preserved evidence."""
from pathlib import Path
from html import escape
import hashlib, importlib.util, json, zipfile, subprocess, sys
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'docs/requirements'
TITLE='HyperZone智能办公平台项目开发需求说明书'
SOURCE=DEST/'source/fop-sync-requirements.html'
ANALYTICS=DEST/'source/analytics.body.html'
QUEUE_SCOPE=DEST/'source/queue-scope-review.body.html'
ANALYTICS_PROOF=DEST/'analytics-verification.json'
CHAIN_PROOF=DEST/'business-chain-verification.json'
PURCHASE_RETURN_PROOF=DEST/'purchase-return-verification.json'
SALES_UNPAID_PROOF=DEST/'sales-unpaid-verification.json'
SALES_REVIEW_PROOF=DEST/'sales-review-stock-verification.json'
BUSINESS_STATUS_PROOF=DEST/'business-status-verification.json'
CONTRACT=ROOT/'docs/openapi/fop-replica-service-contract.json'
DOMAIN=ROOT/'docs/openapi/fop-replica-domain.schema.json'
TIMESTAMP=ROOT/'docs/openapi/fop-timestamp-sync-contract.json'
TIMESTAMP_PROFILE=ROOT/'docs/openapi/fop-timestamp-profile.example.json'
TIMESTAMP_PROOF=DEST/'timestamp-verification.json'
EMPLOYEE_PROOF=DEST/'employee-directory-verification.json'
API_PROOF=DEST/'api-integration-verification-20261116.json'
PACKAGE_LOGISTICS_PROOF=DEST/'fop-package-logistics-gap.json'
API_AUDIT=ROOT/'docs/openapi/fop-api-field-audit-20261116.json'
TIME_CAPABILITIES=ROOT/'docs/openapi/fop-query-timestamp-capabilities.json'
PAGED_PROFILE=ROOT/'docs/openapi/fop-timestamp-paged-profile.example.json'
OUTPUT=DEST/(TITLE+'.html')
CURRENT_REVIEW=DEST/'requirements-current-review.json'
PRODUCTION_PROOF=DEST/'production-release-verification.json'
PRODUCTION_MANUAL=ROOT/'docs/manuals/HyperZone生产部署指导手册.html'
SERVICES=[
 ('S01','快照开始','SNAPSHOT_BEGIN','同requestKey幂等；固定截止点、实体全集及各流衔接水位，有效期内稳定续读。'),
 ('S02','快照分页','SNAPSHOT_PAGE','回显快照、流和起始游标；完整组不拆页，链连续，complete=true时准确到达manifest.endCursor。'),
 ('S03','同步屏障','BARRIER','targetVector给出本轮各流目标水位；proof提供真实捕获健康和覆盖证据，不以当前时间伪造。'),
 ('S04','变更读取','CHANGES','从afterCursor连续读取到untilCursor，含删除及旧关联影响；同事件重放内容一致。'),
 ('S05','授权续验','AUTHORIZATION','校验集成公司／资源范围及人员归属；ownershipVector覆盖全部流。不是普通用户逐单授权。'),
 ('S06','数据核对','RECONCILE','同barrierId、targetVector、scopeVersion核对全部实体（含零数据）；金额按结算币种返回。'),
]
def table(head,rows,cls=''):
 return '<table class="'+cls+'"><thead><tr>'+''.join('<th>'+escape(x)+'</th>' for x in head)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+x+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table>'
def fields(value):return '<code>'+escape('、'.join(value) or '仅公共请求')+'</code>'
def build():
 subprocess.run([sys.executable,str(ROOT/"scripts/build-standalone-field-matrix.py")],check=True)
 matrix_files=[DEST/"HyperZone23清单字段对照表.html",DEST/"field-matrix-manifest.json",DEST/"superseded-documents.json"]
 contract=json.loads(CONTRACT.read_text())
 assert set(contract['operations'])=={x[2] for x in SERVICES}
 # Current requirements contain one normative rule per topic. Historical captures
 # stay in evidence JSON; never append obsolete conclusions back into the document.
 body=SOURCE.read_text()
 proof=json.loads(ANALYTICS_PROOF.read_text())
 # Local implementation narratives remain historical sources, not FOP requirements.
 css='''<style>
.sidebar h2{font-size:15px;white-space:nowrap;letter-spacing:0}.project-subtitle{display:block;color:#c4d7e8;font-size:12px;margin-top:5px}.cover h1{font-size:30px}.cover .subtitle{font-size:16px}
section{margin-bottom:36px}section h3{margin-top:24px}p{text-indent:2em}h1,h2,h3,summary{text-indent:0}table{table-layout:fixed;width:100%}th,td{vertical-align:top;overflow-wrap:anywhere}th:first-child,td:first-child{width:120px;white-space:nowrap;overflow-wrap:normal}code{white-space:normal;overflow-wrap:anywhere;font-size:12px}.services th:nth-child(2){width:21%}.services th:nth-child(3){width:31%}.configuration th:nth-child(2){width:40%}
.callout{background:#eff8f8;border-left:3px solid #087f8c;padding:14px 18px;margin:20px 0}.callout>strong{display:block}.callout p{margin:5px 0}.flow{display:flex;gap:8px;align-items:stretch;margin:24px 0}.flow>div{flex:1;min-width:0;background:#eaf1f7;border:1px solid #cfdee8;border-radius:8px;padding:14px 10px;text-align:center}.flow b,.flow span{display:block}.flow span{font-size:12px;margin-top:6px;color:#526879}.flow i{align-self:center;font-style:normal;color:#087f8c}.anchor{display:block;scroll-margin-top:16px}
.gap-table th:first-child,.gap-table td:first-child{width:150px;white-space:normal;overflow-wrap:anywhere}
.analytics-section th:first-child,.analytics-section td:first-child{width:15%;white-space:normal;overflow-wrap:anywhere}.analytics-section .req-table{font-size:13px}.analytics-section h3{scroll-margin-top:20px}
.queue-scope-section h3{scroll-margin-top:20px}.queue-scope-section table{font-size:13px}.queue-scope-section th:first-child,.queue-scope-section td:first-child{width:120px;white-space:normal;overflow-wrap:anywhere}.scope-flow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0;counter-reset:scope-stage}.scope-flow>div{background:#eaf1f7;border:1px solid #cfdee8;border-radius:8px;padding:16px;counter-increment:scope-stage}.scope-flow b,.scope-flow span{display:block}.scope-flow b:before{content:counter(scope-stage) ' · ';color:#087f8c}.scope-flow span{font-size:13px;color:#526879;margin-top:6px}
@media(max-width:1050px){.flow{display:grid;grid-template-columns:1fr}.flow i{transform:rotate(90deg);justify-self:center}.flow>div{text-align:left}.cover h1{font-size:25px}}
@media(max-width:760px){table{min-width:700px}.sidebar h2{font-size:15px}}
@media(max-width:760px){.scope-flow{grid-template-columns:1fr}.queue-scope-section table{min-width:780px}}
@media print{table{min-width:0!important;font-size:10px}th:first-child,td:first-child{width:95px}code{font-size:9px}.flow{display:flex}.flow i{transform:none}.flow>div{padding:8px;font-size:10px}.flow span{font-size:9px}section{break-before:auto}.callout{break-inside:avoid}}
@media print{.queue-scope-section table{font-size:10px}.queue-scope-section th:first-child,.queue-scope-section td:first-child{width:80px}.scope-flow{grid-template-columns:repeat(3,minmax(0,1fr));break-inside:avoid}.scope-flow>div{padding:8px}.scope-flow span{font-size:10px}}
</style>'''
 spec=importlib.util.spec_from_file_location('hz_theme','/Library/VSCode/.hyperzone/html-style/render_html.py')
 theme=importlib.util.module_from_spec(spec);spec.loader.exec_module(theme)
 document=theme.render(TITLE,'FOP改造需求 · 接口补充 · 源端核验 · 交付验收',css+body,'FOP待办精简版','2026-11-25')
 document=document.replace('<h2>'+TITLE+'</h2>','<h2>HyperZone 统一需求说明</h2><small class="project-subtitle">智能办公平台项目</small>',1)
 theme.validate(document);OUTPUT.write_text(document)
 inputs=matrix_files+[CURRENT_REVIEW,PACKAGE_LOGISTICS_PROOF,API_PROOF,API_AUDIT,TIME_CAPABILITIES,PAGED_PROFILE,EMPLOYEE_PROOF,SOURCE,CONTRACT,DOMAIN,TIMESTAMP,TIMESTAMP_PROFILE,TIMESTAMP_PROOF,ANALYTICS,QUEUE_SCOPE,ANALYTICS_PROOF,PURCHASE_RETURN_PROOF,SALES_UNPAID_PROOF,SALES_REVIEW_PROOF,BUSINESS_STATUS_PROOF,Path(__file__).resolve()]
 # Chapter 05 describes implemented request/timing behavior; detect stale code evidence.
 inputs += [ROOT/p for p in [
  'backend/src/database/migrations/1794770000000-TimestampQueryReplica.ts',
  'backend/src/modules/workbench-replica/timestamp-sync.ts',
  'backend/src/modules/workbench-replica/timestamp-postgres.ts',
  'backend/src/modules/workbench-replica/timestamp-http-source.ts',
  'backend/src/modules/workbench-replica/timestamp-status.ts',
  'scripts/workbench-timestamp-sync.mjs',
  'frontend/src/composables/useProductExpansion.ts',
  'frontend/src/components/autoflow/ProductExpansionButton.vue',
  'frontend/src/views/autoflow/RmaOrdersView.vue',
  'frontend/src/views/autoflow/PurchaseReturnsView.vue',
  'frontend/src/components/autoflow/CollapsibleProductLines.vue',
  'frontend/src/components/autoflow/PurchaseReturnOrdersTable.vue',
  'frontend/src/components/autoflow/RmaOrdersTable.vue',
  'frontend/src/views/autoflow/PurchaseGroupsView.vue',
  'frontend/src/views/autoflow/StockOrdersView.vue',
  'frontend/src/views/autoflow/ReceiptNoticesView.vue',
  'backend/src/modules/fop-data/procurement-groups.ts',
  'backend/src/modules/fop-data/collected-native-facts.ts',
  'backend/src/modules/workbench-replica/local-workbench.service.ts',
  'scripts/workbench-purchase-return-capture.mjs',
  'scripts/fop-workbench-openapi.mjs',
  'frontend/src/components/autoflow/WorkbenchReplicaControls.vue',
  'frontend/src/utils/workbench-navigation-sync.ts',
  'frontend/src/utils/workbench-counts.ts',
  'frontend/src/utils/business-years.ts',
  'backend/src/modules/fop-data/fop-business-time.ts',
  'frontend/src/api/workbench-dashboard.ts',
  'frontend/src/api/fop-dashboard.ts',
  'frontend/src/views/autoflow/FopOrdersView.vue',
  'frontend/src/views/autoflow/FopDashboardView.vue',
  'frontend/src/composables/useDateRangeQuery.ts',
  'frontend/src/components/charts/LocalDashboardAnalytics.vue',
  'frontend/src/api/local-dashboard-analytics.ts',
  'backend/src/modules/workbench-replica/dashboard-analytics-query.ts',
  'frontend/src/components/order-volume/OrderVolumeAnalysis.vue',
  'frontend/src/views/autoflow/SalesPerformanceView.vue',
  'backend/src/modules/workbench-replica/replica-sync-policy.ts',
  'backend/src/modules/workbench-replica/replica-schedule.ts',
  'backend/src/modules/workbench-replica/replica-sync.service.ts',
  'backend/src/modules/workbench-replica/replica-authorization.service.ts',
 ]]
 inputs+=[ROOT/p for p in proof['implementationFiles']]
 # Chapter 08 distinguishes static proposals from the implemented sales unpaid rule.
 inputs += [ROOT/p for p in [
  'frontend/src/utils/workbench.ts',
  'frontend/src/views/autoflow/WorkbenchView.vue',
  'frontend/src/utils/completed-orders.ts',
  'backend/src/modules/fop-data/workbench-queue-rules.ts',
  'backend/src/modules/fop-data/dashboard-queues.ts',
  'backend/src/modules/workbench-replica/collected-workbench-query.ts',
  'backend/src/modules/workbench-replica/collected-sales-source-status.ts',
  'scripts/workbench-sales-source-status.cjs',
  'scripts/workbench-analytics-import.cjs',
  'backend/src/modules/workbench-replica/collected-workbench.service.ts',
  'backend/src/modules/workbench-replica/collected-product-display.ts',
  'backend/src/modules/workbench-replica/collected-product-display.spec.ts',
  'backend/src/modules/fop-data/collected-native-facts.ts',
  'frontend/src/utils/product-display.ts',
  'frontend/src/tests/CollapsibleProductLines.test.ts',
  'frontend/src/tests/useProductExpansion.test.ts',
  'backend/src/modules/workbench-replica/collected-allocation-query.ts',
  'backend/src/modules/workbench-replica/collected-stock-query.ts',
  'backend/src/modules/fop-data/collected-stock-native.ts',
  'backend/src/modules/fop-data/order-business-status.ts',
  'backend/src/modules/fop-data/order-dispatch-status.ts',
  'frontend/src/utils/order-dispatch-status.ts',
  'backend/src/modules/workbench-replica/collected-dispatch-status.ts',
  'backend/src/modules/fop-data/fulfillment-source-status.ts',
  'frontend/src/utils/fulfillment-source-status.ts',
  'backend/src/modules/fop-data/fop-order-export.ts',
  'scripts/workbench-business-status.cjs',
  'scripts/workbench-sales-source-payment-status.cjs',
  'backend/src/modules/workbench-replica/collected-sales-source-status.ts',
  'backend/src/modules/fop-data/fop-stock.ts',
  'backend/src/modules/fop-data/fop-stock.types.ts',
  'backend/src/modules/fop-data/fop-stock.dto.ts',
  'backend/src/modules/fop-data/fop-stock-export.ts',
  'frontend/src/api/fop-stock.ts',
  'backend/src/modules/fop-data/collected-stock-normalizer.ts',
  'scripts/workbench-stock-native.cjs',
  'frontend/src/views/autoflow/StockOrdersView.vue',
  'backend/src/modules/workbench-replica/collected-rma-query.ts',
  'backend/src/modules/workbench-replica/receipt-notices.ts',
 ]]
 chain_proof=json.loads(CHAIN_PROOF.read_text())
 inputs += [CHAIN_PROOF]+[ROOT/p for p in chain_proof['implementationFiles']]
 employee_proof=json.loads(EMPLOYEE_PROOF.read_text())
 inputs += [ROOT/p for p in employee_proof['implementationFiles']]
 api_proof=json.loads(API_PROOF.read_text())
 inputs += [ROOT/p for p in api_proof['implementationFiles']]
 review=json.loads(CURRENT_REVIEW.read_text())
 inputs += [ROOT/p for p in review['implementationFiles']]
 production_proof=json.loads(PRODUCTION_PROOF.read_text())
 inputs += [PRODUCTION_PROOF]+[ROOT/p for p in production_proof['implementationFiles']]
 manifest={'document':str(OUTPUT.relative_to(ROOT)),'audience':'FOP and local application developers','focus':'fop-outstanding-requirements','preferredSync':'timestamp-with-reconciliation','timestampRuntimeEnabled':api_proof.get('normalApiOperation20261118',{}).get('automaticCallsEnabled') is True,'strictServicesOptional':True,'sections':6,'analyticsChapter':False,'queueScopeReview':False,'services':[x[0] for x in SERVICES],'operations':[x[2] for x in SERVICES],'upstreamCalled':False,'sha256':hashlib.sha256(document.encode()).hexdigest(),'inputHashes':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}}
 (DEST/'build-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 index={'document':'../requirements/'+OUTPUT.name,'focus':'fop-outstanding-requirements','preferredSync':'timestamp-with-reconciliation','firstPhaseCapabilities':['TIME_QUERY','FULL_DETAIL','RECONCILE'],'strictServicesOptional':True,'services':[{'id':code,'operation':key,'title':label,'anchor':'sync-api','optional':True} for code,label,key,_ in SERVICES]}
 (ROOT/'docs/integrations/fop-extension-requirements-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
 package=DEST/'HyperZoneFOP同步服务开发交付包.zip'
 with zipfile.ZipFile(package,'w',zipfile.ZIP_DEFLATED) as z:
  for p in matrix_files+[PRODUCTION_PROOF,PRODUCTION_MANUAL,CURRENT_REVIEW,PACKAGE_LOGISTICS_PROOF,API_PROOF,API_AUDIT,TIME_CAPABILITIES,PAGED_PROFILE,EMPLOYEE_PROOF,OUTPUT,CONTRACT,DOMAIN,TIMESTAMP,TIMESTAMP_PROFILE,TIMESTAMP_PROOF,ANALYTICS_PROOF,PURCHASE_RETURN_PROOF,SALES_UNPAID_PROOF,SALES_REVIEW_PROOF,BUSINESS_STATUS_PROOF]:z.write(p,str(p.relative_to(ROOT/'docs')))
 print(json.dumps({'document':str(OUTPUT),'sections':6,'preferredSync':'timestamp-with-reconciliation','optionalStrictServices':6,'timestampRuntimeEnabled':api_proof.get('normalApiOperation20261118',{}).get('automaticCallsEnabled') is True,'htmlBytes':OUTPUT.stat().st_size,'package':str(package),'upstreamCalled':False},ensure_ascii=False))
if __name__=='__main__':build()
