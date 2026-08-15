# Workforce App — Version 1

A simple, working employee rostering + timesheet + payment tracking web app built in Next.js + Supabase.

**Full spec:** [docs-spec.md](docs-spec.md)

## Architecture

**Folder structure** (keeping business logic separate from UI):

- `src/lib/supabase/` — Supabase JS client (browser + server).
- `src/lib/services/` — Business logic & API layer (employee CRUD, shift management, etc.).
- `src/lib/calculations/` — Pure calculation functions (worked hours, mileage, payment).
- `src/lib/validation/` — Input validation helpers.
- `src/types/` — TypeScript types and enums.
- `src/app/` — Next.js App Router pages & layouts by role (admin, employee, login).
- `src/components/` — Reusable React UI components.

**Stack:**

- Next.js 16 (App Router, server components, server actions)
- React 19 + TypeScript 5
- Tailwind CSS 4
- Supabase (PostgreSQL + Auth + Storage)

**Security model:**

- Supabase Auth handles user logins (email/password, backed by Supabase Auth's secure password storage).
- Row Level Security (RLS) policies in PostgreSQL enforce that admins can only see employees in their business, employees can only see their own data.
- No admin account can see an employee's password after it's set (Supabase Auth is the source of truth, app never stores/exposes it).
- Server-side API layer validates permissions before returning data, even though RLS already prevents DB access.

## Development phases

Build phase-by-phase per the spec's own process:

1. ✅ **Project setup** — Next.js scaffold, Supabase clients, layered folder structure, calculation helpers.
2. ✅ **Supabase project & database schema** — SQL migration for all tables, indexes, enums, RLS policies.
3. ✅ **Authentication & roles** — Login page, session middleware, role-based routing, force password change on first login.
4. ✅ **Admin employee creation** — `/admin/employees`, `/admin/employees/new`, `/admin/employees/[id]` CRUD pages.
5. ✅ **Admin availability** — Admin sets recurring weekly availability per employee.
6. ✅ **Shift creation & roster** — Admin creates shifts, weekly roster grid view.
7. ✅ **Employee shift acceptance** — Employee sees shifts, accepts/declines.
8. ✅ **Start/finish shift + odometer photos** — Upload photos, manual odometer entry, server timestamps.
9. ✅ **Calculations + timesheet generation** — Auto-calc hours, mileage, payment on finish-shift.
10. ✅ **Admin timesheet approval** — Review submitted timesheets, approve/needs-correction.
11. ✅ **Payment tracking** — Group approved timesheets by employee+week, mark paid.
12. ✅ **Dashboards** — Admin and employee home screens with stats and quick actions.
13. **Security review & end-to-end test** — Run the John Smith test scenario from the spec, verify RLS, permission checks.

## Next step

→ **Phase 13: Security review & end-to-end test.** Verify full workflow, RLS policies, and permission checks.
