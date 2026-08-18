# SaaS Conversion Audit Report

> **Phase 0 — Audit only. No code changes. No migrations.**
> Generated: 2026-08-17
> Database: test data only, no backup.
> Migrations run via: Supabase SQL Editor.

---

## 1. Architecture Summary

### Framework & routing
- **Next.js 16.3.1** with App Router (`src/app/`).
- All interactive pages are `"use client"` components.
- Server components are only used for layout-level auth guards (`admin/layout.tsx`, `employee/layout.tsx`).
- No server actions — all mutations go through REST-style API route handlers in `src/app/api/`.

### Server-side code locations
- **API Route Handlers**: `src/app/api/` — 20 route files across auth, employees, shifts, roster, timesheets, payments, dashboard, profile.
- **Business logic services**: `src/lib/services/shiftValidation.ts`, `src/lib/services/recurringShift.ts`.
- **Pure calculation functions**: `src/lib/calculations/time.ts`, `mileage.ts`, `payment.ts`.
- **Middleware**: `src/middleware.ts` — refreshes Supabase auth session on every request.

### Supabase client setup

| Client | File | Key | RLS | Purpose |
|---|---|---|---|---|
| Browser | `src/lib/supabase/client.ts` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Client-side auth (signOut only) |
| Server | `src/lib/supabase/server.ts` | Anon key + cookies | Yes | Auth verification in API routes |
| Admin | `src/lib/supabase/admin.ts` | `SUPABASE_SERVICE_ROLE_KEY` | **No** | All data mutations |

### How the service-role key is currently used
The admin client is created inside every API route handler after the server client has verified authentication and role. It is used for:
- All employee CRUD operations
- All shift operations (create, edit, copy-week, recurring)
- All timesheet/correction operations
- All payment operations
- Attendance and odometer submission writes
- Photo uploads to Supabase Storage
- Auth admin operations (createUser, deleteUser, updateUserById)
- Dashboard stats queries

The admin client **bypasses all RLS**. Tenant isolation is enforced at the application level (checking `appUser.business_id` in code).

### Folder structure
```
src/
├── app/           # Pages + API routes
├── components/    # AdminNav, EmployeeNav, StatusBadge
├── lib/
│   ├── supabase/  # 3 clients
│   ├── services/  # shiftValidation, recurringShift
│   ├── calculations/  # time, mileage, payment
│   └── validation/    # Empty directory
├── types/         # database.ts, index.ts (enums)
└── middleware.ts
```

### State management
- No state management library. All state is local `useState` + `useEffect` in client components.
- No React Context providers.

### Styling
- Tailwind CSS 4 via `@tailwindcss/postcss`. No component library.

### Test setup
- **No tests exist.** Zero test files. No test framework configured.

---

## 2. Database Inventory

### Tables

| # | Table | Classification | Has `business_id`? | Row count | Notes |
|---|---|---|---|---|---|
| 1 | `users` | **TENANT-OWNED** | ✅ Yes | Low (test data) | Links Supabase Auth → app role |
| 2 | `employees` | **TENANT-OWNED** | ✅ Yes | Low | Extended profile, rates |
| 3 | `employee_availability` | **USER-SCOPED** | ❌ No | Low | Tenancy via `employee_id → employees.business_id` |
| 4 | `shifts` | **TENANT-OWNED** | ✅ Yes | Low | Shift assignments |
| 5 | `shift_attendance` | **USER-SCOPED** | ❌ No | Low | Tenancy via `shift_id → shifts.business_id` |
| 6 | `odometer_submissions` | **USER-SCOPED** | ❌ No | Low | Tenancy via `shift_id → shifts.business_id` |
| 7 | `timesheets` | **USER-SCOPED** | ❌ No | Low | Tenancy via `shift_id → shifts.business_id` OR `employee_id → employees.business_id` |
| 8 | `payments` | **USER-SCOPED** | ❌ No | Low | Tenancy via `employee_id → employees.business_id` |
| 9 | `shift_audit_log` | **USER-SCOPED** | ❌ No | Low | Tenancy via `shift_id → shifts.business_id` |
| 10 | `timesheet_corrections` | **TENANT-OWNED** | ✅ Yes | Low | Has `business_id` (plain UUID, no FK) |

No **GLOBAL** or **PLATFORM** tables exist yet. No `businesses` table exists.

### Column details per table

**`users`**: `id` (PK), `auth_user_id` (UNIQUE FK→auth.users), `business_id` (UUID, no FK), `role` (user_role enum), `username` (TEXT), `must_change_password` (BOOL), `account_status` (account_status enum), `created_at`, `updated_at`.

**`employees`**: `id` (PK), `business_id` (UUID, no FK), `user_id` (FK→users), `employee_number` (TEXT), `full_name`, `phone`, `hourly_rate` (NUMERIC(10,2)), `mileage_rate` (NUMERIC(10,4)), `employment_status` (employment_status enum), `created_at`, `updated_at`. UNIQUE(business_id, employee_number).

**`employee_availability`**: `id` (PK), `employee_id` (FK→employees CASCADE), `day_of_week` (SMALLINT 0-6), `start_time` (TIME), `end_time` (TIME), `is_available` (BOOL), `created_by` (FK→users), `created_at`, `updated_at`. UNIQUE(employee_id, day_of_week).

**`shifts`**: `id` (PK), `business_id` (UUID, no FK), `employee_id` (FK→employees CASCADE), `date` (DATE), `scheduled_start` (TIMESTAMPTZ), `scheduled_finish` (TIMESTAMPTZ), `location`, `instructions`, `status` (shift_status enum), `created_by` (FK→users), `recurring_group_id` (UUID), `is_recurring` (BOOL), `recurrence_type` (recurrence_type enum), `recurrence_end_date` (DATE), `updated_by` (FK→users), `last_change_reason` (TEXT), `created_at`, `updated_at`.

**`shift_attendance`**: `id` (PK), `shift_id` (UNIQUE FK→shifts CASCADE), `employee_id` (FK→employees CASCADE), `actual_start`, `actual_finish` (TIMESTAMPTZ), `attendance_status` (attendance_status enum), `created_at`, `updated_at`.

**`odometer_submissions`**: `id` (PK), `shift_id` (FK→shifts CASCADE), `employee_id` (FK→employees CASCADE), `submission_type` (submission_type enum), `photo_path` (TEXT), `odometer_reading` (NUMERIC(10,1)), `server_timestamp` (TIMESTAMPTZ), `created_at`. UNIQUE(shift_id, submission_type).

**`timesheets`**: `id` (PK), `shift_id` (UNIQUE FK→shifts CASCADE), `employee_id` (FK→employees CASCADE), `scheduled_start`, `scheduled_finish`, `actual_start`, `actual_finish` (TIMESTAMPTZ), `worked_minutes` (INT), `start_odometer`, `finish_odometer`, `distance_km` (NUMERIC(10,1)), `hourly_rate_snapshot` (NUMERIC(10,2)), `mileage_rate_snapshot` (NUMERIC(10,4)), `wage_amount`, `mileage_amount`, `estimated_total` (NUMERIC(10,2)), `approved_total` (NUMERIC(10,2) nullable), `status` (timesheet_status enum), `approved_by` (FK→users), `approved_at` (TIMESTAMPTZ), `created_at`.

**`payments`**: `id` (PK), `employee_id` (FK→employees CASCADE), `period_start`, `period_end` (DATE), `total_hours` (NUMERIC(10,2)), `total_mileage` (NUMERIC(10,1)), `wage_amount`, `mileage_amount`, `total_amount` (NUMERIC(10,2)), `status` (payment_status enum), `payment_date` (TIMESTAMPTZ), `marked_paid_by` (FK→users), `created_at`.

**`shift_audit_log`** (Migration 003): `id` (PK), `shift_id` (FK→shifts), `employee_id` (FK→employees), `changed_by` (FK→users), `changed_at`, original/new columns for date, start, finish, location, instructions, employee_id, status, `change_reason` (TEXT NOT NULL), `change_notes`, `override_reason`, `required_reconfirmation` (BOOL), `created_at`.

**`timesheet_corrections`** (Migration 004): `id` (PK), `business_id` (UUID, no FK), `timesheet_id` (FK→timesheets), `employee_id` (FK→employees), `correction_round` (INT), `requested_fields` (TEXT[]), `admin_note` (TEXT), `original_values` (JSONB), `corrected_values` (JSONB), `recalculated_values` (JSONB), `employee_note`, `replacement_start_photo`, `replacement_finish_photo`, `requested_by` (FK→users), `requested_at`, `submitted_at`, `status` (TEXT CHECK in pending/submitted/approved/rejected), `created_at`, `updated_at`.

---

## 3. Authentication and Role Model

### How users authenticate
- **Supabase Auth** with email/password. No OAuth, no social login.
- Employee "User ID" is mapped to a synthetic email: `{userId}@workforce.app`. This happens in `src/app/login/page.tsx` (line 23): `const email = userId.includes("@") ? userId : \`${userId}@workforce.app\`;`
- Admin accounts use real email addresses (e.g. `tonmoy0024@gmail.com`) passed directly to Supabase Auth.

### Uniqueness enforcement
- Supabase Auth enforces email uniqueness globally across all businesses. Since employee emails are `{userId}@workforce.app`, User IDs like `john001` are globally unique across the entire Supabase project.
- Employee numbers are unique per `business_id` (DB constraint: `UNIQUE(business_id, employee_number)`).
- **Critical SaaS problem:** If Business A creates `john001@workforce.app`, Business B cannot create a `john001` employee. This is enforced at the Supabase Auth level and cannot be fixed with RLS alone.

### Where roles are stored
- **`users.role`** column — an `admin` or `employee` enum value. This is the source of truth for the application.
- Roles are NOT stored in Supabase Auth metadata (`app_metadata` or `user_metadata`).
- The app does not use Supabase Auth's custom claims.

### How the app decides someone is an admin
1. API route calls `supabase.auth.getUser()` to get the Supabase Auth user.
2. Looks up `users` table: `SELECT * FROM users WHERE auth_user_id = <auth.uid>`.
3. Checks `appUser.role === "admin"`.
4. Some routes also verify `appUser.business_id` matches the resource being accessed.

### Role model gaps for SaaS
- Only two roles exist: `admin` and `employee`. No `owner` role.
- No `platform_admin` role.
- The `user_role` enum is `('admin', 'employee')` — needs extension.
- There is no `business_members` table — membership is implicit via `users.business_id`.

---

## 4. Existing RLS

RLS is **enabled** on all 10 tables. Here are all policies:

### `users`
| Policy | Operation | Expression |
|---|---|---|
| "Users: admin sees same-business users" | SELECT | `current_user_role() = 'admin' AND business_id = current_user_business_id()` |
| "Users: employee sees own row" | SELECT | `auth_user_id = auth.uid()` |
| "Users: admin can update same-business users" | UPDATE | `current_user_role() = 'admin' AND business_id = current_user_business_id()` |
| "Users: employee can update own row" | UPDATE | USING `auth_user_id = auth.uid()` WITH CHECK `auth_user_id = auth.uid()` |

### `employees`
| Policy | Operation | Expression |
|---|---|---|
| "Employees: admin sees same-business" | SELECT | `business_id = current_user_business_id()` |
| "Employees: employee sees own row" | SELECT | `id = current_employee_id()` |
| "Employees: admin can insert" | INSERT | `current_user_role() = 'admin' AND business_id = current_user_business_id()` |
| "Employees: admin can update same-business" | UPDATE | `current_user_role() = 'admin' AND business_id = current_user_business_id()` |

### `employee_availability`
| Policy | Operation | Expression |
|---|---|---|
| "Availability: admin sees same-business employees" | SELECT | `employee_id IN (SELECT id FROM employees WHERE business_id = current_user_business_id())` |
| "Availability: employee sees own" | SELECT | `employee_id = current_employee_id()` |
| "Availability: admin can insert" | INSERT | `current_user_role() = 'admin' AND employee_id IN (SELECT id FROM employees WHERE business_id = current_user_business_id())` |
| "Availability: admin can update" | UPDATE | Same subquery |
| "Availability: admin can delete" | DELETE | Same subquery |

### `shifts`
| Policy | Operation | Expression |
|---|---|---|
| "Shifts: admin sees same-business" | SELECT | `business_id = current_user_business_id()` |
| "Shifts: employee sees own" | SELECT | `employee_id = current_employee_id()` |
| "Shifts: admin can insert" | INSERT | `current_user_role() = 'admin' AND business_id = current_user_business_id()` |
| "Shifts: admin can update" | UPDATE | Same |
| "Shifts: employee can update own (accept/decline)" | UPDATE | USING `employee_id = current_employee_id()` WITH CHECK same |

### `shift_attendance`
| Policy | Operation | Expression |
|---|---|---|
| "Attendance: admin sees same-business" | SELECT | `shift_id IN (SELECT id FROM shifts WHERE business_id = current_user_business_id())` |
| "Attendance: employee sees own" | SELECT | `employee_id = current_employee_id()` |
| "Attendance: employee can insert own" | INSERT | `employee_id = current_employee_id()` |
| "Attendance: employee can update own" | UPDATE | `employee_id = current_employee_id()` |

### `odometer_submissions`
| Policy | Operation | Expression |
|---|---|---|
| "Odometer: admin sees same-business" | SELECT | `shift_id IN (SELECT id FROM shifts WHERE business_id = current_user_business_id())` |
| "Odometer: employee sees own" | SELECT | `employee_id = current_employee_id()` |
| "Odometer: employee can insert own" | INSERT | `employee_id = current_employee_id()` |

### `timesheets`
| Policy | Operation | Expression |
|---|---|---|
| "Timesheets: admin sees same-business" | SELECT | `shift_id IN (SELECT id FROM shifts WHERE business_id = current_user_business_id())` |
| "Timesheets: employee sees own" | SELECT | `employee_id = current_employee_id()` |
| "Timesheets: admin can update (approve/reject)" | UPDATE | `current_user_role() = 'admin' AND shift_id IN (SELECT id FROM shifts WHERE business_id = current_user_business_id())` |

**Note:** No INSERT policy for timesheets — inserts happen via admin client (service role key).

### `payments`
| Policy | Operation | Expression |
|---|---|---|
| "Payments: admin sees same-business" | SELECT | `employee_id IN (SELECT id FROM employees WHERE business_id = current_user_business_id())` |
| "Payments: employee sees own" | SELECT | `employee_id = current_employee_id()` |
| "Payments: admin can insert" | INSERT | `current_user_role() = 'admin' AND employee_id IN (SELECT id FROM employees WHERE business_id = current_user_business_id())` |
| "Payments: admin can update" | UPDATE | Same |

### `shift_audit_log`
| Policy | Operation | Expression |
|---|---|---|
| "Admin can read shift audit logs" | SELECT | `EXISTS (SELECT 1 FROM shifts s JOIN users u ON u.auth_user_id = auth.uid() WHERE s.id = shift_audit_log.shift_id AND s.business_id = u.business_id AND u.role = 'admin')` |
| "Admin can insert shift audit logs" | INSERT | `EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid() AND u.role = 'admin')` |

**⚠️ Flag — Audit log INSERT policy**: The INSERT policy checks `role = 'admin'` but does NOT check `business_id`. An admin from Business A could technically insert an audit log entry referencing a shift from Business B (if they knew the shift_id). In practice this is mitigated because the admin client bypasses RLS anyway — but if we ever switch to RLS-based inserts, this needs fixing.

### `timesheet_corrections`
| Policy | Operation | Expression |
|---|---|---|
| "Admin can read timesheet corrections" | SELECT | `EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid() AND u.business_id = timesheet_corrections.business_id AND u.role = 'admin')` |
| "Admin can insert timesheet corrections" | INSERT | `EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid() AND u.role = 'admin')` |
| "Admin can update timesheet corrections" | UPDATE | Same as SELECT (checks business_id) |
| "Employee can read own corrections" | SELECT | `EXISTS (SELECT 1 FROM employees e JOIN users u ON u.id = e.user_id WHERE u.auth_user_id = auth.uid() AND e.id = timesheet_corrections.employee_id)` |
| "Employee can update own pending corrections" | UPDATE | Same + `AND status = 'pending'` |

**⚠️ Flag — Correction INSERT policy**: Same issue as audit log INSERT — checks `role = 'admin'` but not `business_id`.

### Recursion risk
The RLS helper functions (`current_user_role()`, `current_user_business_id()`, `current_employee_id()`) query `public.users` and `public.employees`. These tables have RLS enabled. The functions are `SECURITY DEFINER` which means they run as the function owner (typically the postgres superuser), bypassing RLS on the tables they read. **No recursion risk with current setup.** However, if a future `business_members` table has RLS policies that call these same functions, we need to verify no circular dependency arises.

---

## 5. Storage

### Buckets

| Bucket | Public? | Created by |
|---|---|---|
| `odometer-photos` | **Private** (correct) | Migration 001 |

No other buckets exist.

### Storage policies

| Policy | Operation | Expression |
|---|---|---|
| "Odometer photos: employee upload" | INSERT | `bucket_id = 'odometer-photos' AND (storage.foldername(name))[1] IS NOT NULL` |
| "Odometer photos: authenticated read" | SELECT | `bucket_id = 'odometer-photos'` |

**⚠️ Problems:**
1. **READ is wide open to all authenticated users.** Any authenticated user (from any business) can read any photo in the bucket if they know/guess the path. There is no business_id or employee_id check.
2. **INSERT has no employee_id check.** Any authenticated user can upload to any folder path. The only check is that the folder name is not null.
3. **No tenant scoping.** The path convention is `{employee_id}/{shift_id}/{start|finish}_{timestamp}.{ext}` — no `business_id` in the path.

### Current path convention
```
{employee_id}/{shift_id}/start_{timestamp}.{ext}
{employee_id}/{shift_id}/finish_{timestamp}.{ext}
```

Target convention from CLAUDE-SAAS-RULES.md:
```
businesses/{business_id}/employees/{employee_id}/shifts/{shift_id}/start.jpg
```

### Object count
Test data only — likely very few objects (0-10).

---

## 6. Tenant-Ownership Gaps

Tables that need `business_id` added:

| Table | Currently has `business_id`? | Join path to derive business | Action needed |
|---|---|---|---|
| `employee_availability` | ❌ | `employee_availability.employee_id → employees.business_id` | ADD `business_id` column, backfill via employees join |
| `shift_attendance` | ❌ | `shift_attendance.shift_id → shifts.business_id` | ADD `business_id` column, backfill via shifts join |
| `odometer_submissions` | ❌ | `odometer_submissions.shift_id → shifts.business_id` | ADD `business_id` column, backfill via shifts join |
| `timesheets` | ❌ | `timesheets.shift_id → shifts.business_id` OR `timesheets.employee_id → employees.business_id` | ADD `business_id` column, backfill via either join |
| `payments` | ❌ | `payments.employee_id → employees.business_id` | ADD `business_id` column, backfill via employees join |
| `shift_audit_log` | ❌ | `shift_audit_log.shift_id → shifts.business_id` | ADD `business_id` column, backfill via shifts join |

Tables that already have `business_id`:
- `users` ✅ (plain UUID, no FK)
- `employees` ✅ (plain UUID, no FK)
- `shifts` ✅ (plain UUID, no FK)
- `timesheet_corrections` ✅ (plain UUID, no FK)

**All existing `business_id` columns are plain UUIDs with no FK to a `businesses` table.** Phase 1 must create the `businesses` table first, then add FK constraints.

---

## 7. Code That Must Change

Every query that currently relies on the admin client (which bypasses RLS) needs tenant filtering via `business_id`. Here is a file-by-file inventory, grouped by domain:

### Employees

| File | Issue |
|---|---|
| `src/app/api/employees/route.ts` GET | ✅ Already filters by `business_id` on the server client query. OK. |
| `src/app/api/employees/route.ts` POST | ✅ Uses `appUser.business_id` for insert. OK. |
| `src/app/api/employees/[id]/route.ts` GET | ✅ Checks `.eq("business_id", appUser.business_id)`. OK. |
| `src/app/api/employees/[id]/route.ts` PUT | ✅ Checks `.eq("business_id", appUser.business_id)`. OK. |
| `src/app/api/employees/[id]/route.ts` POST (actions) | ✅ Checks `.eq("business_id", appUser.business_id)`. OK. |

### Availability

| File | Issue |
|---|---|
| `src/app/api/employees/[id]/availability/route.ts` GET | ✅ Verifies employee business_id first. OK. |
| `src/app/api/employees/[id]/availability/route.ts` PUT | ✅ Verifies employee business_id first. OK. But delete+reinsert via admin client has **no business_id filter on delete** — the `.eq("employee_id", id)` is sufficient because the employee was already verified, but after SaaS conversion, the delete should also filter by `business_id` for defense in depth. |

### Roster / Shifts

| File | Issue |
|---|---|
| `src/app/api/shifts/route.ts` GET | ✅ Admin path filters by `business_id`. Employee path filters by `employee_id`. OK. |
| `src/app/api/shifts/route.ts` POST | ✅ Checks employee `.eq("business_id", appUser.business_id)` and inserts with `business_id`. OK. |
| `src/app/api/shifts/[id]/route.ts` GET | ⚠️ **Fetches shift with admin client without business_id filter** (line 34-37). Then checks `shift.business_id !== appUser.business_id` after the fetch. This is functionally correct but the admin client could theoretically fetch any shift from any business before the check. After SaaS, the initial query should include a `business_id` filter. |
| `src/app/api/shifts/[id]/route.ts` PUT | ⚠️ **Same issue** — fetches shift via admin client without tenant filter (line 104-107), then checks after. Also, `handlePreviewEdit` and `handleUpdateShift` fetch employee, availability, and existing shifts via admin client without business_id filters on those queries (they filter by `employee_id` which is sufficient for correctness but not defense-in-depth). |
| `src/app/api/shifts/[id]/start/route.ts` | ✅ Employee ownership is verified via `shift.employee_id !== employee.id`. However, shift is fetched via admin client without business_id filter (line 39-42). Should add business_id filter. |
| `src/app/api/shifts/[id]/finish/route.ts` | ✅ Same pattern — fetches shift via admin client without business_id, verifies employee_id ownership. Should add business_id. |
| `src/app/api/shifts/recurring/route.ts` | ✅ `handlePreview` checks `.eq("business_id", appUser.business_id)` on employees. `handleCreate` inserts with `business_id`. OK. |
| `src/app/api/roster/available-employees/route.ts` | ✅ Filters employees by `business_id`. OK. |
| `src/app/api/roster/copy-week/route.ts` | ✅ Filters source shifts by `business_id`. OK. |

### Attendance

| File | Issue |
|---|---|
| `src/app/api/shifts/[id]/start/route.ts` | ⚠️ Inserts `shift_attendance` via admin client without `business_id` (table doesn't have the column yet). After adding `business_id`, this insert must include it. |
| `src/app/api/shifts/[id]/finish/route.ts` | ⚠️ Same — updates attendance without business_id. |

### Odometer

| File | Issue |
|---|---|
| `src/app/api/shifts/[id]/start/route.ts` | ⚠️ Inserts `odometer_submissions` without `business_id`. |
| `src/app/api/shifts/[id]/finish/route.ts` | ⚠️ Same. |

### Timesheets

| File | Issue |
|---|---|
| `src/app/api/timesheets/route.ts` GET | ⚠️ Admin path fetches employees by business_id, then fetches timesheets by `employee_id IN (...)`. This is correct but indirect. After adding `business_id` to timesheets, should filter directly by `business_id`. |
| `src/app/api/timesheets/[id]/route.ts` GET | ⚠️ Fetches timesheet via admin client without business_id filter, then verifies via employee join. Should filter by business_id. |
| `src/app/api/timesheets/[id]/route.ts` PUT | ⚠️ Same fetch-first-verify-after pattern. |
| `src/app/api/shifts/[id]/finish/route.ts` | ⚠️ Auto-inserts timesheet via admin client without `business_id` (table doesn't have column yet). |

### Corrections

| File | Issue |
|---|---|
| `src/app/api/timesheets/[id]/corrections/route.ts` GET | ⚠️ Fetches corrections via admin client with `.eq("timesheet_id", id)` only — no business_id filter. Anyone who guesses a correction's timesheet_id could potentially see it (mitigated by auth check, but no tenant filter). |
| `src/app/api/timesheets/[id]/corrections/route.ts` POST | ✅ Verifies employee's business_id before creating. Inserts with `business_id: appUser.business_id`. OK. |
| `src/app/api/timesheets/[id]/corrections/submit/route.ts` | ⚠️ Fetches timesheet and correction via admin client without business_id. Employee ownership is checked via `employee_id`. |

### Payments

| File | Issue |
|---|---|
| `src/app/api/payments/route.ts` GET | ⚠️ Admin path fetches employees by business_id, then payments by `employee_id IN (...)`. Indirect but correct. After adding `business_id` to payments, filter directly. |
| `src/app/api/payments/route.ts` POST | ✅ Verifies employee business_id. But inserts payment without `business_id` (table doesn't have column). |
| `src/app/api/payments/[id]/route.ts` GET | ⚠️ Fetches payment via admin client without business_id, then verifies via employee join. |
| `src/app/api/payments/[id]/route.ts` PUT | ⚠️ Same fetch-first-verify-after pattern. |

### Dashboard

| File | Issue |
|---|---|
| `src/app/api/dashboard/admin/route.ts` | ✅ All queries scoped by `business_id` or derived from scoped employee list. OK. |
| `src/app/api/dashboard/employee/route.ts` | ✅ All queries scoped by `employee.id`. OK. But uses admin client for queries that could use tenant-scoped queries. |

### Profile

| File | Issue |
|---|---|
| `src/app/api/profile/route.ts` | ✅ Uses server client (RLS enforced), queries own data. OK. |

### Auth

| File | Issue |
|---|---|
| `src/app/api/auth/setup-admin/route.ts` | ⚠️ Checks `any admin exists globally` with `.eq("role", "admin").limit(1)`. In multi-tenant, multiple admins should exist. This endpoint should be replaced with a proper onboarding flow. |
| `src/app/api/auth/password-changed/route.ts` | ✅ Updates own user row by `auth_user_id`. OK. |

### Summary pattern
Almost every route that fetches a record by ID (shift, timesheet, payment) uses the admin client without a `business_id` filter, then verifies ownership after the fetch. This "fetch-then-verify" pattern is functionally correct today, but in SaaS it should be "filter-and-fetch" (include `business_id` in the query).

---

## 8. Business Logic That Must NOT Change

These files contain the calculation formulas and business rules that must produce identical results:

| File | Functions | Purpose |
|---|---|---|
| `src/lib/calculations/time.ts` | `calculateWorkedMinutes()`, `formatWorkedDuration()`, `minutesToDecimalHours()` | Working hours from timestamps |
| `src/lib/calculations/mileage.ts` | `calculateMileage()` | Distance from odometer readings |
| `src/lib/calculations/payment.ts` | `calculatePayment()` | Wage + mileage amounts from rates and time/distance |
| `src/lib/services/shiftValidation.ts` | `validateShiftAssignment()`, `requiresEmployeeReconfirmation()` | Shift assignment validation, reconfirmation rules |
| `src/lib/services/recurringShift.ts` | `generateRecurringDates()`, `buildConflictReport()` | Recurring shift date generation, conflict checking |
| `src/app/api/timesheets/[id]/corrections/submit/route.ts` lines 133-140 | Recalculation logic using the three calculation functions | Correction recalculation |
| `src/app/api/shifts/[id]/finish/route.ts` lines 161-170 | Auto-timesheet generation orchestration | Combining time, mileage, payment calculations |

**None of these files reference `business_id` or make tenant-related decisions.** They are purely functional. They should not be touched during the SaaS conversion.

---

## 9. Risks

Ordered most to least dangerous:

### 1. **Employee login collision — CRITICAL**
The `{userId}@workforce.app` pattern creates globally unique synthetic emails in Supabase Auth. When two businesses exist, `john001` from Business A and `john001` from Business B would collide at the auth layer. **This must be resolved before multi-tenant goes live.** See decision question below.

### 2. **Admin client bypasses RLS — HIGH**
Every API route uses the admin client (service role key) for data operations. This means RLS policies are a backup, not the primary defense. If a code path forgets to check `business_id`, data leaks across tenants. The current code is careful but not perfect (see §7 — many routes fetch-then-verify instead of filter-and-fetch).

### 3. **`business_id` has no FK constraint — HIGH**
All existing `business_id` columns are plain UUIDs with no FK to any table. There's no database-level guarantee that a `business_id` actually refers to a real business. Phase 1 must create the `businesses` table and add FK constraints.

### 4. **Storage has no tenant isolation — HIGH**
The `odometer-photos` bucket allows any authenticated user to read any photo. The path doesn't include `business_id`. Both the path convention and the storage policies must change.

### 5. **`setup-admin` endpoint is wide open — MEDIUM**
The one-time bootstrap endpoint only checks "is there any admin globally?" Once called, it refuses to run again. In SaaS, new businesses need their own admin creation flow — this endpoint must be replaced or heavily guarded.

### 6. **RLS INSERT policies don't check `business_id` — MEDIUM**
The INSERT policies on `shift_audit_log` and `timesheet_corrections` only check `role = 'admin'`, not `business_id`. In practice the admin client bypasses these anyway, but if we ever move inserts to the server client, an admin from Business A could insert records into Business B's data.

### 7. **Availability delete-then-reinsert — LOW**
`PUT /api/employees/[id]/availability` deletes all rows for an employee, then reinserts. If the insert fails partway, data is lost. This is a data integrity risk but not a tenant isolation risk.

### 8. **No `updated_at` triggers on newer tables — LOW**
`shift_audit_log` and `timesheet_corrections` have no `update_updated_at()` trigger. `timesheet_corrections` manually sets `updated_at` in the application code, but `shift_audit_log` doesn't.

### 9. **TypeScript types not regenerated — LOW**
`shift_audit_log` and `timesheet_corrections` aren't in `src/types/database.ts`. Code uses `(adminClient as any)` to bypass type checking. Adding `business_id` to more tables will make this worse. Types should be regenerated.

### What surprised me
- The `user_role` enum is only `('admin', 'employee')` — stored in the database, not in application code. Adding `'owner'` and `'platform_admin'` requires `ALTER TYPE ... ADD VALUE`, which cannot be done inside a transaction. This means the enum extension must be a separate migration step.
- The `mileage_rate` column is `NUMERIC(10,4)` (4 decimal places) — more precise than `hourly_rate` at `NUMERIC(10,2)`. This is intentional and must be preserved.

---

## Phase 1 Plan — Tenant Foundation

### Step 1: Create `businesses` table

```sql
-- Migration 005: SaaS tenant foundation
-- Step 1: Create businesses table

CREATE TABLE IF NOT EXISTS public.businesses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  timezone    TEXT NOT NULL DEFAULT 'Australia/Sydney',
  currency    TEXT NOT NULL DEFAULT 'AUD',
  week_starts_on SMALLINT NOT NULL DEFAULT 1,  -- 1 = Monday
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger for updated_at
CREATE TRIGGER trg_businesses_updated_at
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

-- Members of a business can read it (policy will reference business_members)
-- Placeholder — will refine after business_members table exists
```

### Step 2: Create `business_members` table

```sql
CREATE TABLE IF NOT EXISTS public.business_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id),
  user_id     UUID NOT NULL REFERENCES public.users(id),
  role        TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'EMPLOYEE')),
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE', 'INVITED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id)
);

CREATE INDEX idx_bm_business_id ON public.business_members(business_id);
CREATE INDEX idx_bm_user_id ON public.business_members(user_id);

CREATE TRIGGER trg_business_members_updated_at
  BEFORE UPDATE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
```

### Step 3: Create default business and backfill

```sql
-- Create a default business from the existing admin's business_id
-- (Run this AFTER verifying what the current business_id is)

INSERT INTO public.businesses (id, business_name, slug, email)
SELECT DISTINCT
  u.business_id,
  'Default Business',
  'default',
  (SELECT username FROM public.users WHERE role = 'admin' LIMIT 1)
FROM public.users u
WHERE u.role = 'admin'
LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- Create business_members rows for all existing users
INSERT INTO public.business_members (business_id, user_id, role, status)
SELECT
  u.business_id,
  u.id,
  CASE u.role
    WHEN 'admin' THEN 'OWNER'
    WHEN 'employee' THEN 'EMPLOYEE'
  END,
  CASE u.account_status
    WHEN 'active' THEN 'ACTIVE'
    WHEN 'disabled' THEN 'INACTIVE'
  END
FROM public.users u
ON CONFLICT (business_id, user_id) DO NOTHING;
```

### Step 4: Add FK constraints on existing `business_id` columns

```sql
-- Now that the businesses table exists, add FK constraints
ALTER TABLE public.users
  ADD CONSTRAINT fk_users_business
  FOREIGN KEY (business_id) REFERENCES public.businesses(id);

ALTER TABLE public.employees
  ADD CONSTRAINT fk_employees_business
  FOREIGN KEY (business_id) REFERENCES public.businesses(id);

ALTER TABLE public.shifts
  ADD CONSTRAINT fk_shifts_business
  FOREIGN KEY (business_id) REFERENCES public.businesses(id);

ALTER TABLE public.timesheet_corrections
  ADD CONSTRAINT fk_corrections_business
  FOREIGN KEY (business_id) REFERENCES public.businesses(id);
```

### Step 5: Add `business_id` to tables that lack it

```sql
-- Add business_id to 6 tables, backfill, then add NOT NULL + FK

-- employee_availability
ALTER TABLE public.employee_availability ADD COLUMN IF NOT EXISTS business_id UUID;
UPDATE public.employee_availability ea
  SET business_id = e.business_id
  FROM public.employees e
  WHERE ea.employee_id = e.id AND ea.business_id IS NULL;
ALTER TABLE public.employee_availability ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE public.employee_availability
  ADD CONSTRAINT fk_availability_business FOREIGN KEY (business_id) REFERENCES public.businesses(id);

-- shift_attendance
ALTER TABLE public.shift_attendance ADD COLUMN IF NOT EXISTS business_id UUID;
UPDATE public.shift_attendance sa
  SET business_id = s.business_id
  FROM public.shifts s
  WHERE sa.shift_id = s.id AND sa.business_id IS NULL;
ALTER TABLE public.shift_attendance ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE public.shift_attendance
  ADD CONSTRAINT fk_attendance_business FOREIGN KEY (business_id) REFERENCES public.businesses(id);

-- odometer_submissions
ALTER TABLE public.odometer_submissions ADD COLUMN IF NOT EXISTS business_id UUID;
UPDATE public.odometer_submissions os
  SET business_id = s.business_id
  FROM public.shifts s
  WHERE os.shift_id = s.id AND os.business_id IS NULL;
ALTER TABLE public.odometer_submissions ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE public.odometer_submissions
  ADD CONSTRAINT fk_odometer_business FOREIGN KEY (business_id) REFERENCES public.businesses(id);

-- timesheets
ALTER TABLE public.timesheets ADD COLUMN IF NOT EXISTS business_id UUID;
UPDATE public.timesheets t
  SET business_id = s.business_id
  FROM public.shifts s
  WHERE t.shift_id = s.id AND t.business_id IS NULL;
ALTER TABLE public.timesheets ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE public.timesheets
  ADD CONSTRAINT fk_timesheets_business FOREIGN KEY (business_id) REFERENCES public.businesses(id);

-- payments
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS business_id UUID;
UPDATE public.payments p
  SET business_id = e.business_id
  FROM public.employees e
  WHERE p.employee_id = e.id AND p.business_id IS NULL;
ALTER TABLE public.payments ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE public.payments
  ADD CONSTRAINT fk_payments_business FOREIGN KEY (business_id) REFERENCES public.businesses(id);

-- shift_audit_log
ALTER TABLE public.shift_audit_log ADD COLUMN IF NOT EXISTS business_id UUID;
UPDATE public.shift_audit_log sal
  SET business_id = s.business_id
  FROM public.shifts s
  WHERE sal.shift_id = s.id AND sal.business_id IS NULL;
ALTER TABLE public.shift_audit_log ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE public.shift_audit_log
  ADD CONSTRAINT fk_audit_business FOREIGN KEY (business_id) REFERENCES public.businesses(id);
```

### Step 6: Create indexes on new `business_id` columns

```sql
CREATE INDEX IF NOT EXISTS idx_availability_business ON public.employee_availability(business_id);
CREATE INDEX IF NOT EXISTS idx_attendance_business ON public.shift_attendance(business_id);
CREATE INDEX IF NOT EXISTS idx_odometer_business ON public.odometer_submissions(business_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_business ON public.timesheets(business_id);
CREATE INDEX IF NOT EXISTS idx_payments_business ON public.payments(business_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_business ON public.shift_audit_log(business_id);
CREATE INDEX IF NOT EXISTS idx_corrections_business ON public.timesheet_corrections(business_id);
```

### Order of operations
1. Create `businesses` table (Step 1)
2. Create `business_members` table (Step 2)
3. Backfill default business + members (Step 3) — **verify row counts before and after**
4. Add FK constraints to existing business_id columns (Step 4)
5. Add business_id to remaining 6 tables + backfill (Step 5)
6. Create indexes (Step 6)
7. Verify: every row in every table has a valid `business_id` that references `businesses.id`

**Do not run any of this yet.** This is the plan for your review.

---

## Decision Required

> **Employee logins are `User ID + password` with no business selector. Once two businesses exist, two employees could both want `john001`. Do we make employee User IDs globally unique (e.g. prefixed per business, or generated), or add a business code to the login screen?**

### My recommendation: **Add a business code to the login screen.**

Here's why it fits the current implementation better:

**Option A — Globally unique User IDs** (e.g. `acme_john001@workforce.app`):
- Breaks existing employee logins — every employee would need to learn a new longer User ID.
- The prefix scheme is ugly and error-prone (employees will forget their prefix).
- Auto-generated IDs (e.g. UUIDs) are not human-memorable.
- Supabase Auth would still require unique emails, so we'd need to encode business identity into the email anyway.

**Option B — Business code on login screen** (e.g. "Business Code: ACME", "User ID: john001"):
- Login form gets one new field: a short business code (the `businesses.slug`).
- The synthetic email becomes `{slug}_{userId}@workforce.app` (e.g. `acme_john001@workforce.app`), making it globally unique at the auth level.
- Employees only need to remember their short User ID — the business code is the same for everyone at their company and can be printed on their welcome sheet.
- Existing employees can be migrated: the default business gets a slug, and existing auth emails are updated to `{slug}_{existingUserId}@workforce.app`.
- The login page change is minimal: add one text field above the existing User ID field.
- Admins could continue to log in with their real email (the `@` detection already skips the synthetic email path).

**Option B preserves the simplicity of the current User ID login while making it multi-tenant safe.**

### Decision

**Option B selected.** Business code on login screen. Synthetic email format: `{slug}_{userId}@workforce.app`.
