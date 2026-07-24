# AutoFlow Security Baseline

## Implemented Gate

- Runtime DTO allowlists prevent profile role/property escalation.
- Production startup validates JWT, database, SMTP, and synchronization settings.
- Admin bootstrap is disabled by default and requires explicit environment credentials.
- Verification codes use cryptographic randomness, hashed in-memory storage, expiry, and attempt limits.
- Auth, AI, Shopify verification, and PipiAds discovery are throttled; external discovery requires authenticated access.
- Production search does not silently fall back to mock data.
- Frontend `xlsx` was removed; authenticated backend ExcelJS export is used instead.

## Dependency Policy

Run:

```powershell
npm.cmd run audit:prod
```

The gate fails on high or critical production advisories. A current moderate advisory remains in ExcelJS's internal `uuid@8` dependency. AutoFlow only uses ExcelJS workbook generation and does not call the affected UUID buffer APIs. Do not force-downgrade ExcelJS; review the exception whenever ExcelJS publishes a new release.

## Production Rules

- Keep `DB_SYNCHRONIZE=false`.
- Keep `ENABLE_ADMIN_BOOTSTRAP=false` after first-admin creation.
- Never expose mock discovery data as real provider output.
- Keep integration keys in environment/secret storage until encrypted integration-account persistence is implemented.
