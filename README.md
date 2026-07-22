# AutoFlow

AutoFlow is a Dropshipping outbound sales workflow workspace for sales teams serving overseas Shopify small-business sellers.

The product is being transformed from a legacy note-taking application into a sales automation tool that helps reps discover prospects, identify Shopify stores, score leads, generate outreach messages, prepare quotes, and manage follow-up work.

## Core Workflow

```text
Product keyword or image
-> Ad discovery
-> Shopify store detection
-> Lead cleanup and scoring
-> AI outreach message
-> Human-reviewed WhatsApp / Email outreach
-> Quote preparation
-> CRM follow-up
```

## Current Capabilities

- JWT authentication and admin role.
- AutoFlow workbench pages: Dashboard, Workflows, Leads, Lead detail, Outreach, and CRM.
- Shopify store search adapter.
- Facebook Ads discovery adapter.
- AI text generation adapter.
- Legacy record capability inherited from the original note module.
- Frontend Vitest baseline.
- Backend Jest baseline.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vue 3, Vite, TypeScript, Pinia, Vue Router, Tailwind CSS |
| Backend | NestJS, TypeScript, TypeORM |
| Database | PostgreSQL |
| Testing | Vitest, Vue Test Utils, jsdom, Jest, ts-jest |

## Project Structure

```text
note-app/
  backend/
    src/database/migrations/
    src/modules/
      autoflow/
        entities/
      auth/
      facebook-ads/
      shopify-search/
      notes/
      folders/
      users/
  frontend/
    src/views/autoflow/
    src/api/
    src/stores/
    src/tests/
  docs/
```

## Local Development

Install dependencies:

```powershell
npm.cmd install
```

Run both frontend and backend:

```powershell
npm.cmd run dev
```

Run frontend only:

```powershell
npm.cmd run dev:frontend
```

Run backend only:

```powershell
npm.cmd run dev:backend
```

## Environment

Backend configuration is read from `backend/.env`.

Example:

```env
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=noteflow
DB_SYNCHRONIZE=false
DB_MIGRATIONS_RUN=false

JWT_SECRET=change-me
JWT_EXPIRES_IN=7d

ANTHROPIC_API_KEY=
SERPAPI_KEY=
GOOGLE_API_KEY=
GOOGLE_SEARCH_CX=
HOSTIO_API_KEY=
```

Note: the current local Docker PostgreSQL container is `hyperzone`, and the existing development database is still `noteflow`. Product-facing naming should be AutoFlow. Rename the physical database only after a backup and migration plan exists.

## Database Migrations

AutoFlow uses versioned TypeORM migrations. Schema synchronization is disabled by default.

Check and apply migrations before starting a backend against a new or updated database:

```powershell
npm.cmd run db:migration:show
npm.cmd run db:migrate
```

Revert only the latest migration when a rollback is explicitly required:

```powershell
npm.cmd run db:migration:revert
```

Set `DB_MIGRATIONS_RUN=true` only when the deployment environment should apply pending migrations during application startup. Keep `DB_SYNCHRONIZE=false` for normal development and production use.

## Verification

Run the local CI baseline:

```powershell
npm.cmd run ci:local
```

This runs frontend tests, backend tests, frontend build, and backend build.

Individual commands:

```powershell
npm.cmd --workspace frontend run test
npm.cmd --workspace backend run test
npm.cmd --workspace frontend run build
npm.cmd --workspace backend run build
```

Database check:

```powershell
docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
Test-NetConnection -ComputerName localhost -Port 5432
docker exec hyperzone psql -U postgres -d noteflow -c "select current_database() as database, current_user as user_name;"
```

Verified local development state:

```text
Docker container: hyperzone
Host port: localhost:5432
Database: noteflow
Connection: OK
```

## Documentation

Formal transformation documents:

- `docs/AUTOFLOW_PRODUCT_SPEC.md`
- `docs/AUTOFLOW_BDD_SCENARIOS.md`
- `docs/AUTOFLOW_PDD_DESIGN.md`
- `docs/AUTOFLOW_TEST_PLAN.md`
- `docs/AUTOFLOW_DEVELOPMENT_BACKLOG.md`
- `docs/AUTOFLOW_FOUNDATION_READINESS.md`
- `docs/AUTOFLOW_TRANSFORMATION_PROPOSAL.md`

## Default Admin For Fresh Seeds

Fresh seeded environments use:

```text
Email: admin@autoflow.local
Username: admin
Password: Admin@123456
```

Change the default password immediately after first login.

Existing local databases created before the AutoFlow migration may still contain `admin@noteflow.com`.
