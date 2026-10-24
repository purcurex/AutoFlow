# 组织成员、登录账号与权限管理

更新：2026-10-23迭代。流程统一为 **先建组织 → 维护成员与账号 → 分配权限**。FOP为金蝶云苍穹上的HyperZone自研应用；此功能创建前端员工与账号，不创建FOP后台用户。

## 页面与操作

左侧系统管理菜单依次为「组织架构」「账号与权限」。组织页左侧为目录树，右上保留部门资料、上级和排序；右下为当前部门（含下级部门）的成员清单。

- **添加成员**：先选择部门，部门成员区点击添加。填写中英文姓名、员工编号、邮箱、职务、手机、所属部门及岗位档案；可同时开通登录账号，或稍后开通。
- **编辑信息**：修改员工资料和部门，关联账号的登录邮箱同步更新。岗位档案与账号访问授权独立，修改岗位不自动变更既有账号权限。
- **开通账号／编辑账号**：统一在组织架构维护登录名、邮箱、初始／重置密码和FOP关联。密码留空不重置；FOP两项清空表示解绑。密码重置后旧会话失效，需重新登录。
- **批量导入**：下载CSV模板（Excel可打开并另存为.xlsx），上传Excel／UTF-8 CSV，先预览再确认。所有行归属当前选中部门；导入仅建立员工档案，之后开通账号、分配权限。
- **删除成员**：单个操作或勾选后批量删除，确认后归档员工并停用关联账号，旧会话立即拒绝。保留历史业务身份及记录，不做级联业务删除。本人及系统管理员成员禁止删除，需先由其他管理员调整权限。
- **分配权限**：账号权限页默认查询未停用账号清单，配置系统管理、业务范围、工作台和图表权限；不再提供新增账号或FOP编辑表单。账号资料链接回组织架构，兼容历史未关联员工的账号。

只有数据库当前 `users.role=admin` 的系统管理员可操作。仅业务数据管理员没有这些管理能力；系统管理员的业务范围设为 `none` 仍可维护组织。普通员工不能读取管理目录。

## 导入约束

文件类型.xlsx或.csv，最大2MB，每次1–100名成员。Excel读取第一个工作表，固定五列表头依次为：`姓名,员工编号,邮箱,职务,手机`。姓名、编号、邮箱必填；职务和手机可空。手机和员工编号请设置为文本，避免Excel先行丢失前导零。请先删除模板演示行。

不导入密码、不开放角色或业务范围列；导入后的岗位档案为空，管理员可编辑成员档案后开通账号。预览展示原始行号及错误，检查字段格式、文件内重复和现有/已归档成员编号与邮箱重复。错误修正后重新上传；确认时再校验权限及唯一性，任一行冲突整批回滚，不跳过错误行。

清单支持按姓名、编号、邮箱、职务或手机搜索；批量选择每次最多100人。搜索、切换部门、刷新或成员调动后清除选择，避免误删不在当前清单的成员。

## 账号和历史记录

新开通账号固定为普通用户、本人业务范围，员工与部门由服务端取自档案；初始工作台授权复制岗位档案，之后在权限页独立调整。创建请求不能直接指定管理员角色或他人员工身份。一个员工最多关联一个账号，一个账号最多关联一个员工。

员工和可选账号同事务创建；重复邮箱、登录名、编号或FOP身份整体回滚。密码至少10字符且UTF-8不超过72字节，仅存bcrypt散列，不返回密码、不自动发送开通邮件。管理员需通过公司认可渠道交付初始密码。目前提供管理员密码重置，尚未提供强制首次登录改密或员工找回密码流程。

删除成员使用 `archived_at` 归档，账号设置 `account_disabled=true` 并递增 `session_version`。登录及每次鉴权均复查停用/会话版本；密码重置也递增版本。权限清单排除停用账号。历史编号、邮箱与FOP绑定继续保留，不自动复用；恢复/重新入职及身份释放是后续生命周期流程。保留历史成员的部门暂不能物理删除，部门信息明确显示原因与数量。

关联账号复用建档目录；未关联的历史账号保留原目录。员工调部门只同步仍使用本地本人身份和原部门的业务员范围，经理管理范围和外部FOP映射须单独核对。演示内部目录保留已归档身份用于历史数据；生产事实以FOP业务单据冻结归属为准。

## HTTP 契约

前缀 `/api`，管理权限和私有禁缓存，完整字段见 [OpenAPI](openapi/hyperzone-analytics.openapi.json)。

| 方法与路径 | 请求／响应 |
| --- | --- |
| `POST /organization/employees` | 员工资料、departmentId、workbenchRoles、可选account；201组织空间 |
| `PUT /organization/employees/{id}/details` | 完整员工资料、departmentId、workbenchRoles；200组织空间；不修改账号授权 |
| `PUT /organization/employees/{id}` | 兼容原部门调动 `{departmentId}`；200组织空间 |
| `POST /organization/employees/{id}/account` | username,password,fopBinding?；201组织空间 |
| `GET /organization/accounts/{id}` | 200安全账号资料：id,username,email,fopBinding；无密码或散列 |
| `PUT /organization/accounts/{id}` | username,email,password?,fopBinding?；200安全账号资料 |
| `POST /organization/employees/import-preview` | multipart/form-data：departmentId与file；201 employees,rowNumbers,errors；不落库 |
| `POST /organization/employees/import` | departmentId,employees（1–100）；201组织空间，原子保存 |
| `POST /organization/employees/remove` | ids（1–100唯一UUID）；201组织空间；归档并停用关联账号 |
| `GET /users/workbench-accounts` | 未停用账号与员工/部门摘要，仅权限页消费 |

400字段错误，401未登录/停用/旧会话，403无系统管理权限，404跨目录或成员/账号不存在，409重复身份或受保护成员，413文件过大。既有 `PUT /users/{id}/fop-binding` 保留兼容，但前端维护入口统一在组织架构。

## FOP 源码依据与接入边界

后台源码 `/Library/VSCode/dtr5b` 只读核查：

- `datamodel/BAMP/1.5/main/hzkj_xkbase_ext/metadata/hzkj_bos_user_ext.dym` 注册用户插件。
- `code/bamp/hzkj-dtr5b-bamp/src/main/java/hzkj/dtr5b/bamp/app/plugin/form/UserBillPlugin.java` 的邀请操作打开 `hzkj_user_invited` 表单，不是HTTP账号创建接口。
- `code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/employee/util/EmployeeUtil.java` 使用用户 `masterid` 对照业务用户字段，前端UUID/姓名/邮箱不能替代后台业务身份。

保存FOP租户/用户ID仅完成本地关联，不代表后台用户已验证或已获真实数据许可。真实FOP权限提供器、共享组织同步仍待接入；正式模式必须验证FOP身份及授权后再与平台权限取交集，不回退Mock。

## 后续 IT 与人工核对

- 提供FOP用户、员工、部门查询/验证接口与鉴权样本；确认id/masterid、租户边界、任职/禁用状态。
- 确认前端账号—员工—部门—FOP用户/业务员工/部门映射，单独核对业务员本人和经理管理范围。
- 明确正式共享组织、转岗/离职/重新入职、恢复归档成员、身份释放及跨系统停用同步流程。
- 上线前补齐操作审计、首次登录改密、员工找回密码和安全交付；当前管理员重置不代表完整账号生命周期。
- 验收批量失败回滚、无管理权拒绝、密码重置和删除后旧会话失效、历史客户/收款/运费/毛利不丢失及不越权。

部署依次执行 `1784734000000-LinkEmployeeAccounts`、`1784735000000-ManageOrganizationMembers`。后一迁移存在停用/撤销会话/归档数据时阻止直接回滚，避免重新激活旧账号；未修改FOP生产库。
