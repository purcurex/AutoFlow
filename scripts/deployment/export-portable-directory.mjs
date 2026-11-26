import {mkdirSync,writeFileSync,readFileSync,cpSync} from 'node:fs'
import {resolve} from 'node:path'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readSyncConfig,syncDatabaseOptions} from '../workbench-sync-runtime.mjs'
import {columns,validateBundle} from './portable-directory.mjs'
const require=createRequire(new URL('../../backend/package.json',import.meta.url)),root=resolve(import.meta.dirname,'../..')
const {DataSource}=require('typeorm'),db=new DataSource(syncDatabaseOptions(readSyncConfig()))
const out=resolve(process.argv[2]||root+'/artifacts/HyperZone-基础资料迁移包-20261125');mkdirSync(out,{recursive:true})
await db.initialize()
try{
 const runner=db.createQueryRunner();await runner.connect();await runner.startTransaction('REPEATABLE READ')
 let users,nodes,employees
 try{users=await runner.query('SELECT '+columns.users.join(',')+',fop_binding_details FROM users ORDER BY email');nodes=await runner.query('SELECT '+columns.organization_nodes.join(',')+' FROM organization_nodes ORDER BY sort_order,id');employees=await runner.query('SELECT '+columns.organization_employees.join(',')+' FROM organization_employees ORDER BY name');await runner.commitTransaction()}catch(e){await runner.rollbackTransaction();throw e}finally{await runner.release()}
 const {effectiveWorkbenchRoles}=require('./dist/src/modules/users/workbench-role.js'),{resolveChartAccess}=require('./dist/src/modules/users/chart-permissions.js')
 const pick=(o,keys)=>Object.fromEntries(keys.map(k=>[k,o[k]]))
 const warnings=[],nodeIds=new Set(nodes.map(n=>n.id)),employeeIds=new Set(employees.map(e=>e.id))
 const b={schemaVersion:1,kind:'hyperzone-portable-directory',exportedAt:new Date().toISOString(),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),users:users.map(u=>{
  const row=pick(u,columns.users)
  if(row.business_employee_id&&!employeeIds.has(row.business_employee_id)){warnings.push(u.email+'：清除源环境业务人员内码；导入后按工号重新绑定');row.business_employee_id=null}
  if(row.business_department_id&&!nodeIds.has(row.business_department_id)){warnings.push(u.email+'：清除源环境业务部门内码');row.business_department_id=null}
  if(row.business_role==='none'&&row.workbench_roles.length)warnings.push(u.email+'：已配置入口，但业务范围为 none；当前前端路由仍限制进入业务页，需管理员明确数据范围后使用')
  return row
 }),organization_nodes:nodes,organization_employees:employees.map(e=>({...e,archived_at:e.archived_at?.toISOString()??null}))}
 validateBundle(b)
 const wb={sales:'销售',procurement:'采购',allocation:'配货',dispatch:'发运',warehouse:'仓库'}
 const chartNames={registrations:'客户注册统计',department_receipts:'部门业绩',salesperson_receipts:'业务员业绩',order_volume:'订单量',customer_orders:'客户订单',freight:'物流运费',sales_performance:'业绩收入与毛利（工作台入口隐藏）'}
 const path=id=>{const parts=[],seen=new Set();while(id){if(seen.has(id))throw Error('cycle');seen.add(id);const n=nodes.find(n=>n.id===id);if(!n)break;parts.unshift(n.name);id=n.parent_id}return parts.join(' / ')}
 const menus=[['/dashboard','Dashboard','业务范围非none；图表再按图表授权'],['/','我的工作台','业务范围非none；各工作台按有效入口权限'],...['workflows','leads','opportunities','outreach','quotes','follow-ups'].map((p,i)=>['/'+p,['客户开发','客户线索','商机管理','客户沟通','客户报价','客户跟进'][i],'业务范围非none，且customer_orders图表可见（当前侧栏规则）']),['/prompt-templates','提示词模板','业务范围非none'],['/settings','个人设置','登录账号'],['/organization','组织架构','系统管理员 users.role=admin'],['/admin/workbenches','工作台权限','系统管理员 users.role=admin']]
 const bindings=users.map(u=>({email:u.email,localUserId:u.id,localEmployeeId:employees.find(e=>e.account_id===u.id)?.id??null,localName:employees.find(e=>e.account_id===u.id)?.name??u.username,employeeNumber:u.fop_binding_details?.employeeNumber??null,expectedFopUsername:u.fop_binding_details?.username??null,status:u.fop_binding_details?.employeeNumber?'待生产目录核验':'待补工号',source:'local_database'}))
 // Candidate numbers come from the FOP employee screenshots supplied in this conversation;
 // they are not verified production bindings and never enter the imported users table.
 const historical={betty:['ID-000048','Betty'],calvin:['ID-000026','panzifan'],chloe:['ID-000032','Chloe'],daijing:['ID-000030','daijing'],eva:['ID-000024','liushumin'],heidi:['ID-000047','Heidi'],iris:['ID-000034','Iris'],jennie:['ID-000033','Jennie'],joy:['ID-000045','Joy'],kiki:['ID-000029','yangying'],liora:['ID-000046','Liora'],luna:['ID-000041','Luna'],mia:['ID-000042','Mia'],nayah:['ID-000036','chennuo'],reid:['ID-000035','huangjunpeng'],sean:['ID-000027','yangsushuai'],serena:['ID-000037','liujiaqi'],stella:['ID-000044','Stella']}
 for(const target of bindings){const hint=historical[target.email.split('@')[0]];if(!target.employeeNumber&&hint){target.employeeNumber=hint[0];target.expectedFopUsername=hint[1];target.status='历史附件候选，待生产目录复核';target.source='user_supplied_fop_employee_screenshots'}}
 warnings.push('ethan@hzdrop.com与admin@hzdrop.com可能对应同一Ethan；目前工号ID-000016保留在admin目标，禁止重复绑定。Carmen、袁金发尚无工号依据。')
 const charts=[],accounts=users.map(u=>{const p={role:u.role,businessRole:u.business_role,businessDepartmentId:u.business_department_id,businessEmployeeId:u.business_employee_id,workbenchRoles:u.workbench_roles,chartPermissions:u.chart_permissions,dataDisplayScope:u.data_display_scope,accountDisabled:u.account_disabled,fopBindingDetails:u.fop_binding_details};const actual=effectiveWorkbenchRoles(p);for(const c of resolveChartAccess(p))charts.push({email:u.email,...c});const e=employees.find(e=>e.account_id===u.id);if(e&&JSON.stringify(e.workbench_roles)!==JSON.stringify(u.workbench_roles))warnings.push(u.email+'：员工档案与账号工作台配置不同；如实导出，以账号有效权限为准');return [e?.name??u.username,u.email,path(e?.department_id),u.role==='admin'?'系统管理员':'普通账号',u.business_role,u.data_display_scope,u.workbench_roles.map(x=>wb[x]).join('、'),actual.map(x=>wb[x]).join('、'),u.account_disabled?'停用':'启用',bindings.find(t=>t.email===u.email).employeeNumber??'待补工号']})
 writeFileSync(out+'/directory.json',JSON.stringify(b,null,2)+'\n',{mode:0o600})
 writeFileSync(out+'/fop-binding-targets.json',JSON.stringify({schemaVersion:1,matchBy:'employeeNumber',bindings},null,2)+'\n',{mode:0o600})
 writeFileSync(out+'/menu-policy.json',JSON.stringify({schemaVersion:1,source:'frontend/src/components/layout/Sidebar.vue + router + backend role/chart policy',codeManaged:true,menus:menus.map(([path,name,rule])=>({path,name,rule})),effectiveCharts:charts},null,2)+'\n',{mode:0o600})
 const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
 const table=(headers,rows)=>'<div class="table-wrap"><table><thead><tr>'+headers.map(v=>'<th>'+h(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+h(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'
 const intro=`<h2>导入范围与使用方法</h2><p>本包为本地数据库一致性快照，共${users.length}个账号、${employees.length}名员工、${nodes.length}个组织及部门节点。保留本地UUID、部门树、账号角色、工作台配置和图表授权；不包含密码、密码散列、令牌、FOP测试内码、业务订单或同步水位。菜单由应用代码控制，menu-policy.json为规则清单，不能通过修改此文件单独增加菜单权限。</p><p>在生产资源包中先完成数据库迁移，将本包中的portable-directory.mjs复制到scripts/deployment/。使用已迁移且组织账号为空的库；本工具替代首次admin初始化，不要先执行initialize-production.mjs admin。已有账号的生产库不覆盖，冲突时停止。完全一致的重复导入不写入、不重设密码；新账号密码由部署环境的DIRECTORY_INITIAL_PASSWORD设置并分别散列。</p><pre>node scripts/deployment/migrate-compiled.mjs run
node scripts/deployment/portable-directory.mjs /secure/directory.json /secure/production.env --check
node scripts/deployment/portable-directory.mjs /secure/directory.json /secure/production.env --execute</pre><p>production.env需设置NODE_ENV=production、DB_HOST、DB_PORT、DB_USERNAME、DB_PASSWORD、DB_DATABASE、DB_SSL以及DIRECTORY_INITIAL_PASSWORD。请使用Node.js 22及对应版本部署资源，根目录安装项目依赖。导入后再用initialize-production.mjs batch准备正式租户批次，并按既有部署手册启用同步。</p><h2>FOP生产绑定</h2><p>工号一致可用于跨环境匹配，不能据此复制人员内码、masterId、任职ID或测试租户。fop-binding-targets.json保存${bindings.filter(x=>x.employeeNumber).length}个工号匹配目标（含历史附件候选，来源逐项标明）；其他工号留空。先配置生产集成凭据和李铭嵩的正式代理用户名，通过人员目录获取启用员工，按工号唯一匹配；多结果、停用、重名或缺工号保留待处理。不得只凭中文名自动绑定。</p><p>使用本项目现有管理员接口GET /api/users/fop-employees分页查询，PUT /api/users/:id/kingdee-binding提交employeeNumber、employeeId、membershipId；接口执行生产身份验证和唯一绑定校验。导入工具不调用FOP、不伪造verifiedAt。李铭嵩的本地登录账号与FOP代理身份是不同配置；需以生产目录实际用户名为准。当前未连接生产环境，未执行生产绑定。</p>`
 const body=intro+'<h2>账号与权限总表</h2>'+table(['员工','登录邮箱','部门路径','系统角色','业务范围角色','展示偏好','配置工作台','有效工作台','状态','FOP工号'],accounts)+'<p>business_role：admin为业务全范围，不等同于系统管理员；department_manager为部门范围（展示偏好self时记录查询收窄本人）；salesperson为本人；none为空。图表范围按下表及当前本地组织校验，数据权限不随入口扩大。</p><h2>组织部门</h2>'+table(['名称','类型','完整路径','本地ID'],nodes.map(n=>[n.name,n.kind,path(n.id),n.id]))+'<h2>菜单权限</h2>'+table(['路径','名称','显示规则'],menus)+'<h2>逐账号图表授权结果</h2>'+table(['邮箱','图表','可见','数据范围','部门汇总','明细','导出'],charts.map(c=>[c.email,chartNames[c.chartId],c.visible?'是':'否',c.scopeLabel,c.summaryDepartments.join('、'),c.canViewDetails?'是':'否',c.canExport?'是':'否']))+'<h2>当前核查事项</h2><ul>'+[...new Set(warnings)].map(w=>'<li>'+h(w)+'</li>').join('')+'</ul><p>上述差异如实保留，未擅自修改本地授权。配置快照、导入验证与生产FOP绑定为不同步骤；具体演练结果见verification.json。</p>'
 writeFileSync(out+'/content.html',body)
 execFileSync('python3',['/Library/VSCode/.hyperzone/html-style/render_html.py','--title','HyperZone组织账号权限清单与生产导入说明','--subtitle','本地基础资料快照 · 生产工号匹配 · 菜单与图表授权','--content',out+'/content.html','--output',out+'/组织账号权限清单.html'],{stdio:'pipe'})
 cpSync(root+'/scripts/deployment/portable-directory.mjs',out+'/portable-directory.mjs')
 writeFileSync(out+'/export-summary.json',JSON.stringify({accounts:users.length,employees:employees.length,nodes:nodes.length,recordedEmployeeNumbers:bindings.filter(b=>b.employeeNumber).length,warnings,productionConnected:false},null,2))
 const sha=createHash('sha256').update(readFileSync(out+'/directory.json')).digest('hex');writeFileSync(out+'/directory.json.sha256',sha+'  directory.json\n')
 console.log(JSON.stringify({out,accounts:users.length,employees:employees.length,nodes:nodes.length,recordedEmployeeNumbers:bindings.filter(b=>b.employeeNumber).length,warnings:warnings.length}))
}finally{await db.destroy()}
