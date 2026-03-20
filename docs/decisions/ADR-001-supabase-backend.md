# ADR-001: Supabase as Backend with Static HTML Frontend

**Date:** 2026-03-14
**Status:** Accepted

---

## Decision

Mixler uses Supabase (managed PostgreSQL) as the backend, paired with a static HTML/CSS/JS frontend served from an IONOS VPS via Nginx. There is no server-side rendering and no backend application framework.

---

## Context

Mixler requires:

- Real-time or near-real-time data: event listings, live ticket counts, sold-out detection
- User authentication: account creation, login, session management, order history
- Payment-adjacent data: order records, ticket records, price data
- Email list management: per-event MailerLite group creation on publish
- Low operational overhead: no dedicated engineering team, no on-call rotation

Options considered:

| Option | Trade-offs |
|--------|-----------|
| Full-stack Node.js/Express on VPS | More control, but requires maintaining a server process, deployments are heavier, more failure surface |
| Next.js or similar SSR framework | Better DX, but adds build pipeline complexity and SSR hosting requirements |
| Supabase + static frontend | Managed database, built-in auth, auto-generated REST API, edge functions for custom logic. No server process to maintain. |
| Firebase | Similar to Supabase but proprietary, less SQL-friendly, harder to migrate |

Supabase was selected because it provides a full backend surface (auth, database, REST, edge functions) without managing any server infrastructure. The static frontend keeps deployment simple: rsync files to the VPS, Nginx serves them.

---

## Consequences

### Data access

All data operations go through the Supabase REST API (PostgREST, auto-generated from the schema) or Supabase edge functions for custom business logic.

**Auth key rules:**
- `SUPABASE_ANON_KEY`: safe for client-side reads. Subject to Row Level Security (RLS).
- `SUPABASE_SERVICE_KEY`: bypasses RLS. Required for all inserts, updates, and deletes. Never expose in client-side code.

### Schema management

Migrations are tracked in `supabase/migrations/` and applied in order (001, 002, ...). Never modify an existing migration file after it has been applied to production. Add new migration files for schema changes.

### Edge functions

Custom server-side logic (e.g., creating a MailerLite group on event publish) lives in Supabase edge functions. These are Deno-based TypeScript functions deployed via Supabase CLI.

### Frontend constraints

Because there is no SSR, all page rendering is client-side JavaScript. Pages that require authentication check session state on load and redirect unauthenticated users. SEO-sensitive pages (event listings, event detail) must include static or pre-rendered HTML content for indexability.

### Deployment model

The frontend is deployed independently of Supabase. Pushing frontend changes does not affect the database or functions. Schema and function changes require separate Supabase CLI operations.
