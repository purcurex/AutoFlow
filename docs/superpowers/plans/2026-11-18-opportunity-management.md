# 商机管理实施计划

**目标：** 客户线索下新增本地商机业务单据和列表；用户已确认仅保存、跟进，不实现提交审核。

**架构：** NestJS独立opportunities模块、PostgreSQL主表和跟进历史表、Vue列表及详情页。复用readBusinessOwners限制个人／部门／公司本地业务范围，写入仅本人或同公司系统管理员。线索关联来自同范围已有Lead，生成时归属保持线索业务员，重复点击复用同一商机。无FOP网络请求或FOP业务写入，现有同步配置不变。

**参考：** 用户三张附件；FOP hzkj_customer_followup.dym及CustomerF7Plugin.java。商机阶段与日均量保留原始选项；国家本地ISO二字码名单、中文标签，城市文本。国家城市真实FOP档案未采集，不能描述为已接通。

**字段：** 单号、本地状态暂存、业务员、来源线索、客户名称、商机阶段、预计日均量、预计月订单额USD、主要产品、国家、城市、客户经营范围、WhatsApp、店铺链接、登记日期、最后跟进日期、本周跟进情况、下周计划、问题反馈、创建／修改时间、版本。

**交互：** /opportunities列表与/opportunities/:id详情；/opportunities/new独立新增。列表客户、业务员、阶段、国家、日期查询；阶段色标、分页、截断文本1秒提示、导出当前筛选。详情保存基本资料；跟进反馈单独追加日期/阶段/量/金额/本周/下周/问题历史并更新表头。来源线索可返回，线索列表/详情均提供生成商机。

## 后端契约

- GET /api/opportunities/options -> {stages:[{value,label}],dailyVolumes:[{value,label}],countries:[{value,label}],currency:'USD'}。
- GET /api/opportunities?search&stage&country&ownerId&from&to&page&pageSize -> {items,total,page,pageSize,owners:[{id,name}]}。
- GET /api/opportunities/:id -> Opportunity（含followUps数组）。
- POST /api/opportunities -> CreateOpportunity，业务员服务器取当前账号。
- POST /api/opportunities/from-lead/:leadId -> Opportunity，幂等返回已存在商机。
- PATCH /api/opportunities/:id -> fields + version，版本冲突返回409。
- POST /api/opportunities/:id/follow-ups -> {version,followedOn,stage,dailyVolume,monthlyAmount,currentFollowUp,nextFollowUpPlan,problemFeedback}。
- DELETE /api/opportunities/:id?version= -> 软删除；界面确认，保留历史。
- GET /api/opportunities/export -> 当前筛选Excel，最大10000行，所有读出复核权限。
- Opportunity字段：id,number,ownerUserId,ownerName,sourceLeadId,sourceLeadName,status:'draft',customerName,stage,dailyVolume,monthlyAmount(精确十进制字符串),currency:'USD',mainProducts,country,city,businessScope,whatsapp,storeUrl,registeredOn,lastFollowedOn,currentFollowUp,nextFollowUpPlan,problemFeedback,version,createdAt,updatedAt,canEdit,canDelete,followUps?。
- 保存允许草稿缺阶段、量、产品、跟进信息；客户名称必填，有值的国家/阶段/量/金额/URL必须合法。跟进提交必须日期、阶段、量、金额、目前跟进、下一步计划；完整必填项在表单明确标星，不将未知金额默认为业务事实0。

## 任务

- [ ] 后端先写权限、枚举、金额、生成幂等、版本冲突、跟进历史、导出测试并观察失败，完成实体、迁移、模块、API。
- [ ] 前端先写新增、关联生成、筛选、冲突反馈、跟进历史及菜单路由测试，完成页面与入口。
- [ ] 使用隔离PostgreSQL验证迁移与事务；备份后仅应用新增商机迁移，保留现有业务数据。
- [ ] 前后端构建、针对性回归；使用本地临时验收数据核对真实HTTP、刷新持久化和2560×1440页面。
- [ ] 更新唯一统一需求（保留8章结构），新增本地商机字段来源、权限、API与验收；构建、校验、交付。

## 验证重点

1. 跨账号／跨公司线索或商机不可访问；禁用账号不可写。
2. 金额非负，最多2位小数且不经浮点丢精度；无金额保留null。
3. 同线索并发生成只保留一张有效商机；重复请求不覆盖已有编辑。
4. 并发编辑按version冲突，跟进原子追加历史并更新本单，旧日期不能覆盖最新跟进概况。
5. 导出与列表相同权限和筛选；XSS/公式字符串按文本，外链仅http/https。

**执行：** 用户已要求完成开发并明确无提交审核；在当前共享工作区按上面边界实施，不提交或回退其他聊天改动。

## 执行与验证结果

　　本地表、接口、商机列表、详情、线索关联生成及跟进已实现。本期不包含提交审核。验证结果：后端商机专项28项、前端专项21项、隔离PostgreSQL的16组场景通过，前后端构建通过；后端全量2486项通过、218项跳过。2560×1440浏览器已验证新增保存、刷新读取、线索关联与重复生成、跟进回写、未保存资料保护、筛选及Excel导出；本地新表迁移已应用，验收临时数据已清理。前端全量回归1098项通过、11项失败、2项跳过，失败位于工作台审核、分析路由、筛选摘要和刷新导航等测试，需继续处理；本轮商机功能专项验证不代表全项目回归通过。证据见api-integration-verification-20261116.json的localOpportunityManagement20261118。
