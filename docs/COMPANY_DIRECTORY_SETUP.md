# 公司账号初始化与多人联调

本次通讯录共36名员工，另有唯一非员工测试管理员 `admin@hzdrop.com`。员工登录邮箱使用英文名小写加 `@hzdrop.com`。初始口令通过私下交接的文件提供；数据库只保存bcrypt散列，Git不保存口令、通讯录或数据库备份。

## 账号与权限

| 人员 | 系统管理 | 业务范围 | 分析 |
| --- | --- | --- | --- |
| Ethan、Robin、Nora、Mason、XinKe | 有 | 公司业务、全部工作台 | 全部已授权分析 |
| Cici、Dolly、Wendy、Eileen | 无 | 各自业务部门及下级 | 部门范围 |
| 普通销售、营销伙伴 | 无 | 本人 | 本人范围 |
| 订单、采购、物流、仓库、信息管理 | 无 | 全部工作台待办、订单记录 | 营销中心四个业务部门的注册、回款、订单汇总；无客户/业务员分析明细、个人业绩及物流财务明细 |
| Carmen、Eva、Chloe | 无 | 暂无业务数据 | 不开放 |
| admin@hzdrop.com | 有 | 公司业务、全部工作台 | 本地测试管理员 |

系统管理角色与业务角色独立。协同人员的 `businessRole=admin` 表示公司订单范围，不是系统管理员。`chartPermissions.dataScope=none` 阻断分析记录读取；组织汇总仍需FOP独立授权。订单待办查询与Excel导出沿用订单读取权限。客户开发的聚合及客户记录查询同样拒绝明确禁用客户分析的账号。

通讯录主部门用于初始归属；兼任部门、英文名、源账号、原邮箱、性别、座机和地址保存为原始资料，供管理员在组织成员编辑界面查看，不根据兼任部门自动扩权。相同手机号不作为身份匹配依据。FOP用户ID与通讯录账号、本地员工UUID均不等同。

## Git与本地数据库的关系

Git传递应用代码、迁移和导入程序，**不会同步数据库中的用户、组织、权限或密码**。迁移建立结构，不会自动导入真实人员。每台电脑应配置自己的后端 `.env` 并运行迁移。

推荐各自使用独立本地数据库，使用同一份通讯录及本工具初始化基础数据。该方式不会复制笔记、订单缓存及其他开发数据，本地UUID也可能不同；两台电脑对接同一个员工时，应分别绑定同一真实FOP身份，并核实业务员工/部门ID映射。

需要完整重现当前环境时，使用PostgreSQL备份/恢复，包括用户散列、组织ID、权限和其他数据。它是一次性快照，不是双向实时同步。不要将整库备份提交Git，也不要把整库恢复覆盖已有同事数据库；优先恢复到新建数据库，核对后切换连接。跨环境迁移细节参见 `AUTOFLOW_NEW_ENVIRONMENT_DEPLOYMENT_GUIDE_ZH-CN.md`。

## 同事初始化步骤

1. 拉取包含本功能的代码，根目录执行 `npm ci`。
2. 配置 `backend/.env` 的本地PostgreSQL、JWT等连接信息，确保不是FOP生产数据库。执行 `npm run db:migrate`。
3. 私下取得原始通讯录及初始口令文件。口令文件应只允许本人读取；报告、备份放在根目录 `.runtime/company-directory/`（Git忽略）。不要把源表放进仓库跟踪目录。
4. 在根目录执行预览：

```sh
npm run directory:import --workspace=backend -- \
  --file /absolute/path/华智云服通讯录.xlsx \
  --report ../.runtime/company-directory/preview.json
```

5. 核对36人及权限后执行，`--database` 必须与后端实际连接数据库名称一致：

```sh
npm run directory:import --workspace=backend -- \
  --file /absolute/path/华智云服通讯录.xlsx \
  --report ../.runtime/company-directory/result.json \
  --apply --database YOUR_LOCAL_DATABASE \
  --password-file /absolute/private/initial-password
```

预览不写数据库。执行采用事务，冲突整批失败。重复执行不会重置已存在账号密码或覆盖FOP绑定和外部业务员工/部门ID；仍会按最新通讯录更新本地人员资料和本次岗位模板。人员改名、改邮箱导致源身份冲突时应先人工核对，不自动合并。

6. 若使用项目约定的本机 `autoflow_local_demo` 环境，创建共享目录的非员工测试管理员：

```sh
npm run directory:finalize-local --workspace=backend -- \
  --apply --database autoflow_local_demo \
  --import-report ../.runtime/company-directory/result.json \
  --password-file /absolute/private/initial-password \
  --report ../.runtime/company-directory/cleanup-result.json
```

该命令不会凭空删除未知账号。确需移除旧测试账号时，先完整备份，再逐个增加 `--remove-email OLD_EMAIL`。仅允许本机 `autoflow_local_demo` / `autoflow_test`，不允许云端运行。笔记和文件夹转交新管理员；其他受保护的业务外键会使清理回滚，必须单独处理。已创建测试管理员再次执行不会重置其密码。

7. 登录测试管理员核对公司目录，再用各类代表账号验证权限。完成后删除口令明文文件。本工具不发送邀请或验证邮件，不创建邮箱服务器账户，也不创建FOP用户。

公司目录内部仍由Ethan员工账号持有；非员工管理员通过服务端目录链接共享，不伪造员工记录，不再另起演示组织。历史演示账号的启动种子并不代表真实员工，迁移和应用启动均不会重新导入已删除人员。

## 共同连接云端FOP测试环境

双方本地后端可连接同一云端FOP测试API。需交接测试URL、租户、鉴权方式、网络白名单/VPN、接口版本、测试员工和预期权限。本项目已有员工网关入口 `FOP_EMPLOYEE_API_URL` / `FOP_EMPLOYEE_API_TOKEN`，实际云端是否发布同一契约仍待核实；配置地址本身不等于接通。

- 本机 `FOP_DATA_MODE=demo` 会优先使用演示数据；真实联调须关闭该模式，配置真实网关并完成逐账号绑定及业务ID映射。
- 每位开发者最好有独立、可追踪的测试凭证，密钥只放后端；不可放前端或Git。
- 读取可同时进行。审核、采购等会改变状态的操作按人员/单据分组，记录谁操作了什么；不要两边同时审核同一测试单。
- 本地账号密码、组织和权限配置不会自动同步到FOP。FOP的身份、资源权限及审核授权必须单独配置。
- 统一验收时可增加一套共享测试前端、后端和数据库；开发电脑继续独立，避免不同分支迁移同一共享数据库。

未来正式组织同步应以FOP稳定员工/组织ID建立映射。当前通讯录初始化不替代持续同步，也不意味着真实FOP接口联调完成。
