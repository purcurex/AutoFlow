# 1688 Workflow Seed Sourcing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让创建搜客工作流时保存的产品关键词或公开图片 URL 成为 1688 寻源的唯一输入，并修复未配置状态下的错误轮询展示。

**Architecture:** 保留现有 `seedType`/`seedValue`、异步 sourcing sidecar、分页 Worker 和 1688 Param2 适配器。后端只新增图片种子 URL 的入口校验；前端只修正 `not_configured` 对运行状态和轮询的优先级，关键词与图片的真实调用继续使用现有执行器。

**Tech Stack:** Vue 3、TypeScript 5.9、Vitest、NestJS 11、class-validator、Jest、TypeORM、PostgreSQL。

## Global Constraints

- 只使用创建或修订工作流时保存的 `seedType` 和 `seedValue`，不增加一次性寻源输入。
- `seedType=keyword` 时 `seedValue` 是关键词；`seedType=image` 时 `seedValue` 必须是 HTTP/HTTPS 图片 URL。
- 不新增 1688 结果页上传入口，不删除或扩展创建页已有上传能力。
- 不新增 OAuth 页面、Token 存储表或自动刷新服务。
- 不改变客户发现阶段顺序、分页表结构、采购评分、`contactScore` 或客户综合评分。
- 真实 AppKey、AppSecret、AccessToken、RefreshToken 和签名不得写入代码、测试、文档、日志或 Git。
- 所有生产代码改动必须先有能够正确失败的自动化测试。

---

## File Structure

- `backend/src/modules/autoflow/dto/autoflow.dto.ts`：校验创建/修订工作流的图片种子必须是合法 HTTP/HTTPS URL。
- `backend/src/modules/autoflow/dto/autoflow.dto.spec.ts`：覆盖关键词不受 URL 校验影响、合法图片 URL 通过、非法协议和畸形 URL 被拒绝。
- `frontend/src/utils/sourcing.ts`：定义 `not_configured` 对“是否正在寻源”的最高优先级。
- `frontend/src/views/autoflow/SourcingView.vue`：未配置时不安排下一次分页状态轮询。
- `frontend/src/tests/sourcing-view.test.ts`：复现并锁定“未配置 + pagination pending”不得显示寻源中或持续轮询。
- `backend/src/modules/sourcing/sourcing.service.ts`：不修改；已有实现把 `seedType`/`seedValue` 映射到 `keyword` 或 `imageUrl`。
- `backend/src/modules/sourcing/sourcing-page-executor.service.ts`：不修改；已有实现负责关键词调用，以及图片下载、上传和 `imageId` 查询。

---

### Task 1: Validate Public Image URLs at the Workflow Boundary

**Files:**
- Modify: `backend/src/modules/autoflow/dto/autoflow.dto.ts`
- Test: `backend/src/modules/autoflow/dto/autoflow.dto.spec.ts`
- Verify existing: `backend/src/modules/sourcing/sourcing-page-executor.service.spec.ts`

**Interfaces:**
- Consumes: `CreateWorkflowDto.seedType: 'keyword' | 'image'` and `CreateWorkflowDto.seedValue: string`.
- Produces: `IsWorkflowSeedValue(): PropertyDecorator`; keywords remain valid strings, while image seeds require a syntactically valid `http:` or `https:` URL.

- [ ] **Step 1: Write the failing DTO test**

Add this test to `backend/src/modules/autoflow/dto/autoflow.dto.spec.ts`:

```typescript
it('requires image workflow seeds to be public HTTP or HTTPS URLs', async () => {
  const validImage = Object.assign(new CreateWorkflowDto(), {
    seedType: 'image',
    seedValue: 'https://cdn.example.test/products/pet-brush.jpg',
  })
  const invalidImageValues = [
    'pet grooming brush',
    'file:///tmp/pet-brush.jpg',
    'data:image/png;base64,AAAA',
    'ftp://cdn.example.test/pet-brush.jpg',
  ]
  const keyword = Object.assign(new CreateWorkflowDto(), {
    seedType: 'keyword',
    seedValue: 'pet grooming brush',
  })

  await expect(validate(validImage)).resolves.toHaveLength(0)
  await expect(validate(keyword)).resolves.toHaveLength(0)
  for (const seedValue of invalidImageValues) {
    const dto = Object.assign(new CreateWorkflowDto(), {
      seedType: 'image',
      seedValue,
    })
    expect((await validate(dto)).map((error) => error.property)).toContain('seedValue')
  }
})
```

- [ ] **Step 2: Run the DTO test and verify RED**

Run:

```powershell
npm.cmd test --workspace=backend -- --runInBand src/modules/autoflow/dto/autoflow.dto.spec.ts
```

Expected: FAIL because the current DTO accepts non-URL strings for `seedType=image`.

- [ ] **Step 3: Add the minimal conditional seed validator**

Add this private decorator next to `IsWorkflowAssetField` in `backend/src/modules/autoflow/dto/autoflow.dto.ts`:

```typescript
/**
 * 工作流种子由显式 seedType 决定含义；图片种子必须是可由后端处理的 HTTP/HTTPS URL。
 * 这里只校验 URL 结构，图片可达性、类型、大小和 SSRF 防护仍由寻源图片解析服务执行。
 */
function IsWorkflowSeedValue(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isWorkflowSeedValue',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      validator: {
        validate(value: unknown, arguments_: ValidationArguments): boolean {
          if (typeof value !== 'string') return false
          const workflow = arguments_.object as CreateWorkflowDto
          if (workflow.seedType !== 'image') return true
          try {
            const imageUrl = new URL(value.trim())
            return imageUrl.protocol === 'http:' || imageUrl.protocol === 'https:'
          } catch {
            return false
          }
        },
        defaultMessage(): string {
          return 'seedValue must be a public HTTP or HTTPS image URL for an image workflow'
        },
      },
    })
  }
}
```

Apply it to `CreateWorkflowDto.seedValue` without removing the existing string and length validators:

```typescript
@IsString()
@MinLength(1)
@MaxLength(500)
@IsWorkflowSeedValue()
seedValue: string
```

- [ ] **Step 4: Run focused backend tests and verify GREEN**

Run:

```powershell
npm.cmd test --workspace=backend -- --runInBand src/modules/autoflow/dto/autoflow.dto.spec.ts src/modules/sourcing/sourcing-page-executor.service.spec.ts
```

Expected: PASS. The executor regression test must continue proving that keyword seeds call `searchByKeyword`, while image seeds upload once and call `searchByImage` with the returned `imageId`.

- [ ] **Step 5: Commit Task 1**

```powershell
git add backend/src/modules/autoflow/dto/autoflow.dto.ts backend/src/modules/autoflow/dto/autoflow.dto.spec.ts
git commit -m "fix: validate workflow image seed URLs"
```

---

### Task 2: Stop the Unconfigured Sourcing Spinner and Poll Loop

**Files:**
- Modify: `frontend/src/utils/sourcing.ts`
- Modify: `frontend/src/views/autoflow/SourcingView.vue`
- Test: `frontend/src/tests/sourcing-view.test.ts`

**Interfaces:**
- Consumes: `SourcingSummary.providerConfigured`, `SourcingSummary.status`, and optional `pagination.status`.
- Produces: `isSourcingRunning(summary): boolean` returns `false` whenever derived sourcing status is `not_configured`; `schedulePollingIfNeeded()` does not schedule a timer for that state.

- [ ] **Step 1: Strengthen the failing provider-not-configured view test**

Replace the existing `shows the provider-not-configured state without starting a search` test body in `frontend/src/tests/sourcing-view.test.ts` with a reproduction that includes the backend's pending pagination shape:

```typescript
it('shows not configured without a running label or pagination polling', async () => {
  vi.useFakeTimers()
  apiMock.getWorkflowSourcing.mockResolvedValue({
    workflowId: 'workflow-1688',
    providerConfigured: false,
    status: 'not_configured',
    pagination: {
      page: 1,
      pageSize: 20,
      totalRecords: null,
      totalPages: null,
      resultCount: 0,
      loaded: false,
      status: 'pending',
    },
    offers: [],
  } satisfies SourcingSummary)

  const wrapper = mountView()
  await flushPromises()

  expect(wrapper.get('[data-test="provider-not-configured"]').exists()).toBe(true)
  expect(wrapper.get('[data-test="sourcing-status"]').text())
    .toContain('sourcing.status_not_configured')
  expect(wrapper.get('[data-test="restart-sourcing"]').text())
    .toContain('sourcing.restartAction')
  expect(wrapper.get('[data-test="restart-sourcing"]').text())
    .not.toContain('sourcing.runningAction')

  await vi.advanceTimersByTimeAsync(3_000)
  await flushPromises()
  expect(apiMock.getWorkflowSourcing).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})
```

- [ ] **Step 2: Run the view test and verify RED**

Run:

```powershell
npm.cmd test --workspace=frontend -- src/tests/sourcing-view.test.ts
```

Expected: FAIL because pending pagination currently makes the disabled button display `sourcing.runningAction` and schedules repeated requests every 1.5 seconds.

- [ ] **Step 3: Give not-configured status priority in the running helper**

Change `isSourcingRunning` in `frontend/src/utils/sourcing.ts` to:

```typescript
export function isSourcingRunning(summary: SourcingSummary | null): boolean {
  const status = sourcingStatus(summary)
  if (status === 'not_configured') return false
  return status === 'running'
    || summary?.pagination?.status === 'pending'
    || summary?.pagination?.status === 'running'
}
```

- [ ] **Step 4: Prevent polling while the provider is not configured**

Add the early return at the start of `schedulePollingIfNeeded` in `frontend/src/views/autoflow/SourcingView.vue`:

```typescript
function schedulePollingIfNeeded() {
  stopPolling()
  if (status.value === 'not_configured') return
  if (!pagination.value || !['pending', 'running'].includes(pagination.value.status)) return
  pollTimer = setTimeout(async () => {
    pollTimer = null
    await loadSourcing(false)
  }, 1_500)
}
```

- [ ] **Step 5: Run the focused frontend test and verify GREEN**

Run:

```powershell
npm.cmd test --workspace=frontend -- src/tests/sourcing-view.test.ts
```

Expected: PASS, including the existing pending/running pagination polling tests.

- [ ] **Step 6: Commit Task 2**

```powershell
git add frontend/src/utils/sourcing.ts frontend/src/views/autoflow/SourcingView.vue frontend/src/tests/sourcing-view.test.ts
git commit -m "fix: stop unconfigured sourcing polling"
```

---

### Task 3: Verify the Existing Workflow-to-1688 Contract and Full Regression

**Files:**
- Verify: `backend/src/modules/sourcing/sourcing.service.spec.ts`
- Verify: `backend/src/modules/sourcing/sourcing-page-executor.service.spec.ts`
- Verify: `backend/src/modules/alibaba1688/alibaba1688.service.spec.ts`
- Verify: `frontend/src/tests/sourcing-view.test.ts`
- Verify configuration template: `backend/.env.alibaba1688.local.example`
- Never stage: `backend/.env.alibaba1688.local`

**Interfaces:**
- Consumes: the production code and tests completed by Tasks 1 and 2.
- Produces: a verified build where workflow keyword/image seeds reach the correct existing adapter branch, pagination remains functional, and no credentials are tracked.

- [ ] **Step 1: Run the complete backend unit suite**

```powershell
npm.cmd test --workspace=backend -- --runInBand
```

Expected: all backend unit tests PASS.

- [ ] **Step 2: Run backend lint and build**

```powershell
npm.cmd run lint --workspace=backend
npm.cmd run build --workspace=backend
```

Expected: both commands exit with code 0.

- [ ] **Step 3: Run the complete frontend unit suite**

```powershell
npm.cmd test --workspace=frontend
```

Expected: all frontend unit tests PASS.

- [ ] **Step 4: Run frontend lint and build**

```powershell
npm.cmd run lint --workspace=frontend
npm.cmd run build --workspace=frontend
```

Expected: both commands exit with code 0.

- [ ] **Step 5: Run sourcing E2E regression**

```powershell
npm.cmd run test:e2e --workspace=backend -- --runInBand
```

Expected: all authenticated sourcing, pagination, tenant-isolation, and workflow regression scenarios PASS. This suite uses controlled provider doubles and must not require or expose the real AccessToken.

- [ ] **Step 6: Confirm the real local credential file remains ignored and untracked**

```powershell
git check-ignore -v backend/.env.alibaba1688.local
git status --short
```

Expected: `backend/.env.alibaba1688.local` is ignored by `.gitignore`; Git shows only intentional source/test/plan commits and no secret file.

- [ ] **Step 7: Verify the runtime configuration flags without printing secret values**

```powershell
$configPath = 'D:\AutoFlowProject\AutoFlow\note-app\backend\.env.alibaba1688.local'
Get-Content -LiteralPath $configPath | ForEach-Object {
  if ($_ -match '^\s*(ALIBABA_1688_[A-Z0-9_]+)=(.*)$') {
    $name = $Matches[1]
    $value = $Matches[2].Trim('"')
    if ($name -match 'APP_KEY|APP_SECRET|ACCESS_TOKEN|REFRESH_TOKEN') {
      "$name=" + $(if ([string]::IsNullOrWhiteSpace($value)) { 'EMPTY' } else { 'SET' })
    } elseif ($name -eq 'ALIBABA_1688_ENABLED') {
      "$name=$value"
    }
  }
}
```

Expected for a live integration: `ENABLED=true`, AppKey/AppSecret/AccessToken are `SET`. If AccessToken is still `EMPTY`, do not enable the provider or claim a real 1688 call was verified.

- [ ] **Step 8: Record the verification boundary in the handoff**

Report separately:

- automated unit/lint/build/E2E results;
- whether local runtime readiness is configured;
- whether a real 1688 call was performed with the user's authorized account;
- any provider permission or token error, using only redacted request/trace IDs.

Do not create another commit unless verification requires a code correction; any correction must start a new RED/GREEN test cycle.
