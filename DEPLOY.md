# AutoFlow Deployment Guide

This guide describes the current deployment baseline for AutoFlow.

AutoFlow is still in transformation from a legacy NoteFlow codebase. The current deployment priority is to keep the Vue + NestJS + PostgreSQL application buildable and reproducible while product-facing language and business modules are refactored.

## 1. Build

Run local CI before packaging:

```powershell
npm.cmd run ci:local
```

Or run builds individually:

```powershell
npm.cmd --workspace frontend run build
npm.cmd --workspace backend run build
```

## 2. Environment

Backend environment variables are loaded from `backend/.env`.

Required production variables:

```env
NODE_ENV=production
PORT=3000

DB_HOST=
DB_PORT=5432
DB_USERNAME=
DB_PASSWORD=
DB_DATABASE=
DB_SYNCHRONIZE=false
DB_MIGRATIONS_RUN=false

JWT_SECRET=
JWT_EXPIRES_IN=7d
```

Optional integration variables:

```env
ANTHROPIC_API_KEY=
SERPAPI_KEY=
GOOGLE_API_KEY=
GOOGLE_SEARCH_CX=
HOSTIO_API_KEY=
ENABLE_MOCK_SEARCH=false
```

Production must provide `JWT_SECRET`. Do not rely on a fallback secret.

## 3. Database

The current local Docker PostgreSQL container is `hyperzone`, and the existing development database may still be named `noteflow` until a formal migration is performed.

Recommended production database name:

```text
autoflow
```

Create database example:

```powershell
createdb autoflow
```

Before renaming or migrating an existing database:

1. Create a backup.
2. Confirm the app can connect to the new database.
3. Run schema migration scripts.
4. Verify login, workflow, lead, outreach, and legacy record flows.

Apply versioned migrations before starting the new backend version:

```powershell
npm.cmd run db:migration:show
npm.cmd run db:migrate
```

Production should keep `DB_SYNCHRONIZE=false`. Use `DB_MIGRATIONS_RUN=true` only when startup-time migrations are an intentional deployment policy; otherwise run `db:migrate` as a separate release step.

## 4. Runtime

Build backend:

```powershell
npm.cmd --workspace backend run build
```

Start backend in production mode:

```powershell
npm.cmd --workspace backend run start:prod
```

PM2 example:

```powershell
pm2 start backend/dist/main.js --name autoflow
```

## 5. Static Assets

Do not commit generated frontend bundles into `backend/public`.

Current policy:

- `frontend/dist` is a generated build output.
- `backend/dist` is a generated build output.
- `backend/public` legacy frontend bundles have been removed from source control.
- Deployment packaging should copy fresh build artifacts explicitly if static hosting is needed.

## 6. Smoke Checks

After deployment:

- Backend health / API base responds.
- Login works.
- AutoFlow dashboard loads.
- Workflow list API responds.
- PostgreSQL connection is healthy.
- Search adapters fail clearly if provider keys are missing.
- Production does not silently use mock search results.
