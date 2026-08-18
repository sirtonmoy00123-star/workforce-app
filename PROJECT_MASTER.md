# PROJECT_MASTER.md — Workforce App V1

> **Single source of truth for this entire application.**
> Last updated: 2026-08-17

---

## 1. Project Overview

### What it does
A web application for small-business employee rostering, shift tracking, odometer/mileage recording, timesheet generation, and payment tracking.

### Who uses it
- **Admin / Employer** — creates employees, sets availability, builds rosters, reviews timesheets, tracks payments.
- **Employee** — views assigned shifts, accepts/declines, records odometer photos at shift start/finish, views timesheets and payment status.

### Main problem it solves
Replaces manual paper-based rostering and timesheet/mileage tracking with a single web app that automates hour/mileage calculations and payment tracking.

### Current development stage
**Phase 12 of 13 complete.** All core features are implemented and deployed. Phase 13 (security review & end-to-end test) remains.

### Core workflow
```
Admin creates employee
→ Admin sets employee weekly availability
→ Admin creates and assigns shift (single or recurring)
→ Employee receives and accepts/declines shift
→ Employee starts shift + uploads starting odometer photo
→ Employee finishes shift + uploads ending odometer photo
→ App auto-calculates working hours, mileage, and estimated payment
→ App auto-generates timesheet
→ Admin reviews and approves timesheet (or requests correction)
→ Admin creates payment record from approved timesheets
→ Admin marks payment as paid
→ Employee sees payment status
```

---

## 2. Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router, server components, server actions) | 16.3.1 |
| UI Library | React | 19.2.8 |
| Language | TypeScript | ^5 |
| CSS | Tailwind CSS | ^4 |
| Database | PostgreSQL (via Supabase) | — |
| Auth | Supabase Auth (email/password) | — |
| Storage | Supabase Storage (private bucket) | — |
| Supabase Client | @supabase/supabase-js | ^2.112.3 |
| Supabase SSR | @supabase/ssr | ^0.12.4 |
| Hosting | Vercel (auto-deploy from GitHub) | — |
| Source Control | GitHub | — |

**GitHub remote:** `https://github.com/sirtonmoy00123-star/workforce-app.git`

**No other external libraries, CDNs, or third-party services are used.** The app is entirely self-contained within Next.js + Supabase.

---

## 3. Complete Application Architecture

### High-level structure

```
Browser (React 19)
  ↕  HTTP / fetch
Next.js App Router (server components + API routes)
  ↕  Supabase JS client
Supabase
  ├── PostgreSQL (data + RLS)
  ├── Auth (email/password login)
  └── Storage (odometer photos, private bucket)
```

### Three Supabase clients

| Client | File | Key used | RLS enforced? | Use case |
|---|---|---|---|---|
| **Browser** | `src/lib/supabase/client.ts` | Anon key | Yes | Client-side auth state, signOut |
| **Server** | `src/lib/supabase/server.ts` | Anon key + cookies | Yes | Server components, auth verification |
| **Admin** | `src/lib/supabase/admin.ts` | Service role key | **No** (bypasses RLS) | Server-side writes, bulk inserts |

> **Important:** The admin client throws at startup if `SUPABASE_SERVICE_ROLE_KEY` is missing. It must never be exposed to the browser.

### Request flow
1. Browser makes a `fetch()` call to `/api/...` route.
2. API route creates a **server client** (cookies + anon key) to authenticate the user and check their role.
3. For write operations, the API route creates an **admin client** (service role key) to bypass RLS and perform the mutation.
4. Response is returned as JSON.

### Middleware
`src/middleware.ts` runs on every request (except static assets). It refreshes the Supabase auth session cookie so sessions don't expire during active use.

### Frontend rendering
- **Server components** are the default for layouts (auth guard checks).
- **Client components** (`"use client"`) are used for all interactive pages (forms, modals, bottom sheets).
- Pages fetch data via `useEffect` + `fetch()` to API routes.

### Deployment flow
```
Local development (npm run dev)
  → git push to GitHub (main branch)
  → Vercel auto-deploys from main
  → Supabase is separate (SQL migrations run manually in SQL Editor)
```

---

## 4. User Roles

### Admin / Employer
| Permission | Details |
|---|---|
| Manage employees | Create, view, edit, disable/enable, reset password |
| Set availability | Set recurring weekly availability per employee |
| Create shifts | Single, recurring, or copy-week; assign to employees |
| Edit shifts | Change date/time/location/instructions; triggers reconfirmation if shift was accepted |
| View roster | Weekly roster grid (mobile day-card view + desktop table view) |
| Review timesheets | Approve, request correction, approve corrected timesheets |
| Create payments | Group approved timesheets by employee + period |
| Mark paid | Update payment status to paid |
| View dashboard | Stats: total/active employees, pending shifts, today's shifts, submitted timesheets, unpaid payments |

### Employee
| Permission | Details |
|---|---|
| View own shifts | See assigned shifts, accept or decline |
| Accept updated shifts | Re-accept shifts modified by admin (updated_pending status) |
| Start shift | Upload starting odometer photo + reading |
| Finish shift | Upload ending odometer photo + reading; triggers auto-timesheet |
| View own timesheets | See generated timesheets and their status |
| Submit corrections | When admin requests correction, employee updates the requested fields |
| View own payments | See payment amounts and paid/unpaid status |
| Change password | Required on first login; can change later from profile |

### What employees CANNOT do
- Create, edit, or cancel shifts
- View other employees' data
- Approve timesheets or payments
- Access admin pages
- See other employees' shifts, timesheets, or payments

---

## 5. Authentication System

### Account creation
- **Admin account**: Created once via the `/api/auth/setup-admin` bootstrap endpoint. This creates a Supabase Auth user, a `users` row with `role = 'admin'`, and generates a random `business_id` UUID.
- **Employee accounts**: Created by the admin via `/admin/employees/new`. The API creates a Supabase Auth user (with a temporary password), a `users` row (role = employee, same business_id as admin), and an `employees` row. If any step fails, previous steps are rolled back.

### Login process
1. User enters a **User ID** and password on `/login`.
2. If the User ID doesn't contain `@`, the app appends `@workforce.app` to create the email format Supabase Auth expects.
3. Supabase Auth validates credentials and returns a session.
4. The app looks up the `users` table by `auth_user_id` to determine the role.
5. If `account_status = 'disabled'`, access is denied.
6. If `must_change_password = true`, the user is redirected to `/change-password`.
7. Admins are routed to `/admin/dashboard`, employees to `/employee/home`.

### Password handling
- Passwords are stored exclusively in Supabase Auth (bcrypt-hashed). The app never stores or exposes passwords.
- Admin sets a temporary password when creating an employee. Employee must change it on first login.
- Admin can reset an employee's password (sets a new temporary password + `must_change_password = true`).
- Minimum password length: 8 characters.

### Session handling
- Supabase Auth uses cookie-based sessions.
- `src/middleware.ts` refreshes the session on every request.
- Server-side: `createClient()` reads cookies to restore the session.
- Client-side: `createBrowserClient()` manages the session in the browser.

### Role-based routing
- `/admin/*` routes: `src/app/admin/layout.tsx` checks auth + role = admin + account active. Redirects to login if not.
- `/employee/*` routes: `src/app/employee/layout.tsx` checks auth + role = employee + account active + password changed. Redirects if not.
- Root `/` page: checks auth → profile → disabled → must_change_password → routes to the appropriate dashboard.

---

## 6. Database Architecture

### Tables overview

The database has **10 tables** (8 from the initial migration + 2 added in later migrations):

```
users ──────────┐
                │ 1:1
employees ──────┤
  │             │
  │ 1:7         │
  ├─ employee_  │
  │  availability│
  │             │
  │ 1:N         │
  ├─ shifts ────┤
  │   │         │
  │   ├─ shift_attendance (1:1)
  │   │
  │   ├─ odometer_submissions (1:2, START + FINISH)
  │   │
  │   ├─ timesheets (1:1)
  │   │   └─ timesheet_corrections (1:N)
  │   │
  │   └─ shift_audit_log (1:N)
  │
  └─ payments (1:N)
```

### Enums

| Enum | Values |
|---|---|
| `user_role` | `admin`, `employee` |
| `account_status` | `active`, `disabled` |
| `employment_status` | `active`, `inactive` |
| `shift_status` | `pending`, `accepted`, `declined`, `completed`, `cancelled`, `updated_pending` |
| `attendance_status` | `pending`, `working`, `completed` |
| `submission_type` | `START`, `FINISH` |
| `timesheet_status` | `submitted`, `approved`, `needs_correction`, `correction_required`, `correction_submitted` |
| `payment_status` | `unpaid`, `paid` |
| `recurrence_type` | `NONE`, `NEXT_WEEK`, `WEEKLY_END_OF_MONTH`, `WEEKLY_CUSTOM_END` |

### Table: `users`
**Purpose:** Links a Supabase Auth user to an app role.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto-generated |
| auth_user_id | UUID (UNIQUE) | FK → auth.users(id), CASCADE delete |
| business_id | UUID | **Plain UUID, NOT a FK** (no businesses table exists) |
| role | user_role ENUM | 'admin' or 'employee' |
| username | TEXT | Display name / login identifier |
| must_change_password | BOOLEAN | Default true; set false after first password change |
| account_status | account_status ENUM | 'active' or 'disabled' |
| created_at | TIMESTAMPTZ | Auto |
| updated_at | TIMESTAMPTZ | Auto (trigger) |

**RLS policies:**
- Admin sees all users in same business_id
- Employee sees only their own row
- Admin can update same-business users
- Employee can update only their own row

### Table: `employees`
**Purpose:** Extended profile for employee-role users (rates, phone, status).

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto-generated |
| business_id | UUID | Same as their admin's business_id |
| user_id | UUID | FK → users(id), CASCADE |
| employee_number | TEXT | Unique per business |
| full_name | TEXT | |
| phone | TEXT | Nullable |
| hourly_rate | NUMERIC(10,2) | Default 0 |
| mileage_rate | NUMERIC(10,4) | Default 0 (per km) |
| employment_status | employment_status ENUM | 'active' or 'inactive' |
| created_at | TIMESTAMPTZ | Auto |
| updated_at | TIMESTAMPTZ | Auto (trigger) |

**Constraint:** UNIQUE(business_id, employee_number)

**RLS policies:**
- Admin sees all employees in same business
- Employee sees only their own row
- Admin can insert/update for same business

### Table: `employee_availability`
**Purpose:** Recurring weekly availability per employee (7 rows per employee, one per day).

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto-generated |
| employee_id | UUID | FK → employees(id), CASCADE |
| day_of_week | SMALLINT | 0 = Sunday … 6 = Saturday |
| start_time | TIME | Nullable (null when unavailable) |
| end_time | TIME | Nullable |
| is_available | BOOLEAN | Default false |
| created_by | UUID | FK → users(id), nullable |
| created_at | TIMESTAMPTZ | Auto |
| updated_at | TIMESTAMPTZ | Auto (trigger) |

**Constraint:** UNIQUE(employee_id, day_of_week)

**RLS policies:**
- Admin sees/inserts/updates/deletes availability for same-business employees
- Employee sees only their own

### Table: `shifts`
**Purpose:** A rostered shift assigned to one employee on one date.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto-generated |
| business_id | UUID | |
| employee_id | UUID | FK → employees(id), CASCADE |
| date | DATE | The shift date |
| scheduled_start | TIMESTAMPTZ | |
| scheduled_finish | TIMESTAMPTZ | |
| location | TEXT | Nullable |
| instructions | TEXT | Nullable |
| status | shift_status ENUM | pending, accepted, declined, completed, cancelled, updated_pending |
| created_by | UUID | FK → users(id), nullable |
| recurring_group_id | UUID | Nullable (links recurring shifts) |
| is_recurring | BOOLEAN | Default false |
| recurrence_type | recurrence_type ENUM | NONE, NEXT_WEEK, WEEKLY_END_OF_MONTH, WEEKLY_CUSTOM_END |
| recurrence_end_date | DATE | Nullable |
| updated_by | UUID | FK → users(id), nullable — who last edited |
| last_change_reason | TEXT | Nullable — reason for last edit |
| created_at | TIMESTAMPTZ | Auto |
| updated_at | TIMESTAMPTZ | Auto (trigger) |

**RLS policies:**
- Admin sees/inserts/updates for same business
- Employee sees their own shifts
- Employee can update their own shifts (accept/decline)

### Table: `shift_attendance`
**Purpose:** Tracks the actual start and finish times when an employee works a shift.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto-generated |
| shift_id | UUID (UNIQUE) | FK → shifts(id), CASCADE — one attendance per shift |
| employee_id | UUID | FK → employees(id), CASCADE |
| actual_start | TIMESTAMPTZ | Set when employee starts shift |
| actual_finish | TIMESTAMPTZ | Set when employee finishes shift |
| attendance_status | attendance_status ENUM | pending, working, completed |
| created_at | TIMESTAMPTZ | Auto |
| updated_at | TIMESTAMPTZ | Auto (trigger) |

**RLS policies:**
- Admin sees for same-business shifts
- Employee sees/inserts/updates their own

### Table: `odometer_submissions`
**Purpose:** Stores odometer photos and readings for shift start and finish.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto-generated |
| shift_id | UUID | FK → shifts(id), CASCADE |
| employee_id | UUID | FK → employees(id), CASCADE |
| submission_type | submission_type ENUM | 'START' or 'FINISH' |
| photo_path | TEXT | Path in Supabase Storage bucket |
| odometer_reading | NUMERIC(10,1) | The odometer value entered by employee |
| server_timestamp | TIMESTAMPTZ | Server time when submitted (not client time) |
| created_at | TIMESTAMPTZ | Auto |

**Constraint:** UNIQUE(shift_id, submission_type) — exactly one START and one FINISH per shift.

**RLS policies:**
- Admin sees for same-business shifts
- Employee sees/inserts their own

### Table: `timesheets`
**Purpose:** Auto-generated when a shift is finished. Contains calculated hours, mileage, and payment.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto-generated |
| shift_id | UUID (UNIQUE) | FK → shifts(id), CASCADE — one timesheet per shift |
| employee_id | UUID | FK → employees(id), CASCADE |
| scheduled_start | TIMESTAMPTZ | Copied from shift |
| scheduled_finish | TIMESTAMPTZ | Copied from shift |
| actual_start | TIMESTAMPTZ | From shift_attendance |
| actual_finish | TIMESTAMPTZ | From shift_attendance |
| worked_minutes | INTEGER | Calculated: actual_finish − actual_start |
| start_odometer | NUMERIC(10,1) | From START submission |
| finish_odometer | NUMERIC(10,1) | From FINISH submission |
| distance_km | NUMERIC(10,1) | Calculated: finish − start odometer |
| hourly_rate_snapshot | NUMERIC(10,2) | Employee's hourly_rate at time of finish |
| mileage_rate_snapshot | NUMERIC(10,4) | Employee's mileage_rate at time of finish |
| wage_amount | NUMERIC(10,2) | (worked_minutes / 60) × hourly_rate_snapshot |
| mileage_amount | NUMERIC(10,2) | distance_km × mileage_rate_snapshot |
| estimated_total | NUMERIC(10,2) | wage_amount + mileage_amount |
| approved_total | NUMERIC(10,2) | Nullable — admin can override |
| status | timesheet_status ENUM | submitted, approved, needs_correction, correction_required, correction_submitted |
| approved_by | UUID | FK → users(id), nullable |
| approved_at | TIMESTAMPTZ | Nullable |
| created_at | TIMESTAMPTZ | Auto |

**RLS policies:**
- Admin sees/updates for same-business shifts
- Employee sees their own
- Inserts happen server-side via service role key

### Table: `payments`
**Purpose:** Groups approved timesheets by employee + pay period.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto-generated |
| employee_id | UUID | FK → employees(id), CASCADE |
| period_start | DATE | |
| period_end | DATE | |
| total_hours | NUMERIC(10,2) | Default 0 |
| total_mileage | NUMERIC(10,1) | Default 0 |
| wage_amount | NUMERIC(10,2) | Default 0 |
| mileage_amount | NUMERIC(10,2) | Default 0 |
| total_amount | NUMERIC(10,2) | Default 0 |
| status | payment_status ENUM | 'unpaid' or 'paid' |
| payment_date | TIMESTAMPTZ | Nullable — set when marked paid |
| marked_paid_by | UUID | FK → users(id), nullable |
| created_at | TIMESTAMPTZ | Auto |

**RLS policies:**
- Admin sees/inserts/updates for same-business employees
- Employee sees their own

### Table: `shift_audit_log` (Migration 003)
**Purpose:** Records every admin edit to a shift for audit trail.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto-generated |
| shift_id | UUID | FK → shifts(id) |
| employee_id | UUID | FK → employees(id) |
| changed_by | UUID | FK → users(id) |
| changed_at | TIMESTAMPTZ | Default now() |
| original_date / new_date | DATE | |
| original_start / new_start | TIMESTAMPTZ | |
| original_finish / new_finish | TIMESTAMPTZ | |
| original_location / new_location | TEXT | |
| original_instructions / new_instructions | TEXT | |
| original_employee_id / new_employee_id | UUID | |
| original_status / new_status | TEXT | |
| change_reason | TEXT | Required |
| change_notes | TEXT | Optional |
| override_reason | TEXT | If admin overrode a warning |
| required_reconfirmation | BOOLEAN | Default false |
| created_at | TIMESTAMPTZ | Auto |

**RLS policies:**
- Admin can read/insert for their business (via shift → business_id join)

### Table: `timesheet_corrections` (Migration 004)
**Purpose:** Tracks admin correction requests and employee correction submissions.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto-generated |
| business_id | UUID | Plain UUID (no FK to businesses table) |
| timesheet_id | UUID | FK → timesheets(id) |
| employee_id | UUID | FK → employees(id) |
| correction_round | INTEGER | Default 1 |
| requested_fields | TEXT[] | e.g. {'actual_finish', 'finish_odometer'} |
| admin_note | TEXT | Required |
| original_values | JSONB | Snapshot of original values |
| corrected_values | JSONB | Nullable — filled when employee submits |
| recalculated_values | JSONB | Nullable — filled when employee submits |
| employee_note | TEXT | Nullable |
| replacement_start_photo | TEXT | Nullable |
| replacement_finish_photo | TEXT | Nullable |
| requested_by | UUID | FK → users(id) |
| requested_at | TIMESTAMPTZ | Default now() |
| submitted_at | TIMESTAMPTZ | Nullable |
| status | TEXT | CHECK: 'pending', 'submitted', 'approved', 'rejected' |
| created_at | TIMESTAMPTZ | Auto |
| updated_at | TIMESTAMPTZ | Auto |

**RLS policies:**
- Admin can read/insert/update for their business
- Employee can read their own; can update own pending corrections

### RLS helper functions (defined in Migration 001)
- `current_app_user_id()` — returns the `users.id` for the authenticated user
- `current_user_role()` — returns the `user_role` enum value
- `current_user_business_id()` — returns the `business_id` for the authenticated user
- `current_employee_id()` — returns the `employees.id` (NULL for admins)

All are `SECURITY DEFINER STABLE` functions.

### Database triggers
- `update_updated_at()` — auto-sets `updated_at = now()` on UPDATE for: users, employees, employee_availability, shifts, shift_attendance.

### Important design note: `business_id`
`business_id` is a plain UUID column, **NOT** a foreign key to a `businesses` table. **No `businesses` table exists.** The first admin's `business_id` is auto-generated as a random UUID during account setup. All employees created by that admin inherit the same `business_id`. This is a V1 simplification — one admin = one business.

### Migrations

| File | What it adds |
|---|---|
| `001_initial_schema.sql` | All 8 core tables, enums, indexes, triggers, RLS policies, storage bucket, RLS helper functions |
| `002_recurring_shifts.sql` | `recurrence_type` enum, recurring columns on shifts (recurring_group_id, is_recurring, recurrence_type, recurrence_end_date) |
| `003_shift_editing.sql` | `updated_pending` shift status, `updated_by` and `last_change_reason` columns on shifts, `shift_audit_log` table |
| `004_timesheet_corrections.sql` | `correction_required` and `correction_submitted` timesheet statuses, `timesheet_corrections` table |

---

## 7. Complete Feature List

### ✅ COMPLETED

1. **Project setup** — Next.js scaffold, Supabase clients, layered folder structure, calculation helpers.
2. **Database schema** — All tables, enums, indexes, triggers, RLS policies, storage bucket (4 migration files).
3. **Authentication** — Login page, session middleware, role-based routing, force password change on first login.
4. **Admin employee CRUD** — Create, view, edit, disable/enable, reset password.
5. **Admin availability management** — Set recurring weekly availability per employee (7 days).
6. **Shift creation** — Single shift creation with overlap + availability validation.
7. **Recurring shifts** — Repeat next week, weekly to end of month, weekly to custom end date. Preview conflicts before creating.
8. **Weekly roster view** — Mobile-first day-card view with shift cards, status indicators, weekly summary bar. Desktop table view preserved.
9. **Roster tools** — Copy Last Week (preview + create), Find Employee (smart ranking by availability/hours), Employee View mode, Roster Tools menu.
10. **Shift editing** — Admin can edit date/time/location/instructions. Validation (overlap, availability). Audit logging. Employee reconfirmation when accepted shift is modified (updated_pending status).
11. **Employee shift acceptance** — Employee sees shifts, accepts or declines. Can re-accept updated shifts.
12. **Start shift** — Employee uploads starting odometer photo + enters reading. Server timestamp recorded.
13. **Finish shift** — Employee uploads ending odometer photo + enters reading. Auto-generates timesheet.
14. **Auto-timesheet generation** — On shift finish: calculates worked minutes, mileage, payment using rate snapshots. Creates timesheet with status 'submitted'.
15. **Admin timesheet review** — Approve, or request correction with specific fields + admin note.
16. **Timesheet correction workflow** — Admin requests correction → employee submits corrected values → recalculation → admin reviews corrected timesheet.
17. **Payment tracking** — Group approved timesheets by employee + period. Mark paid.
18. **Admin dashboard** — Stats: total/active employees, pending shifts, today's shifts, submitted timesheets, unpaid payments + amount.
19. **Employee dashboard** — Stats: upcoming shifts, active shift, recent timesheets, total earned, total paid, pending payment.
20. **Mobile-first roster redesign** — Bottom sheets, 3-step shift creation, smart employee ranking, copy-week preview, day cards with indicators.
21. **Status badges** — Reusable component with color-coded badges for all statuses.
22. **Responsive navigation** — Admin and employee nav with mobile hamburger menu.
23. **Vercel deployment** — Live with GitHub auto-deploy.

### ⚠️ PARTIALLY COMPLETED

1. **Employee notifications** — No push notifications or real-time alerts. Employees must log in and check their shifts page to see new/updated shifts. Status changes (pending → updated_pending) are recorded in the database but not actively pushed.

### 📋 PLANNED

1. **Phase 13: Security review & end-to-end test** — Run the John Smith test scenario from the spec. Verify RLS policies and permission checks end-to-end.

### 💡 IDEAS / FUTURE FEATURES

1. Push notifications for new shifts, shift changes, correction requests.
2. Real-time updates using Supabase Realtime.
3. Multi-business support with a `businesses` table and proper FK relationships.
4. Employee self-service availability editing.
5. Shift swap/trade between employees.
6. Reporting & analytics (weekly/monthly reports for hours, mileage, payments).
7. Export to CSV/PDF (timesheets and payment records).
8. Overtime rules (automatic overtime calculation based on configurable thresholds).
9. Break tracking during shifts.
10. GPS location verification at shift start/finish.
11. EXIF metadata extraction from odometer photos.
12. Photo comparison view on admin timesheet review page.

---

## 8. Admin Workflow

```
Admin logs in
  → Redirected to /admin/dashboard
  → Views summary stats (employees, pending shifts, timesheets, unpaid payments)
  │
  ├── MANAGE EMPLOYEES
  │   → /admin/employees — list all employees
  │   → /admin/employees/new — create new employee (name, employee#, phone, rates, temp password)
  │   → /admin/employees/[id] — view/edit employee details
  │     → Edit rates, phone, disable/enable account, reset password
  │     → Set weekly availability (7-day grid with time windows)
  │
  ├── CREATE ROSTER
  │   → /admin/roster — weekly roster view
  │   → Tap "+ Shift" → 3-step bottom sheet:
  │     Step 1: Select date, start time, end time, location, instructions
  │     Step 2: Choose employee(s) — smart-ranked by availability + weekly hours
  │     Step 3: Review & publish (with optional repeat: next week, weekly to month end, weekly to custom date)
  │   → OR: Use "Copy Last Week" — preview ready/conflict/unavailable shifts, then create
  │   → OR: Use /admin/shifts/new — traditional form-based shift creation
  │
  ├── MANAGE SHIFTS
  │   → View shift details from roster
  │   → Edit shift (date/time/location/instructions) — triggers validation
  │   → If accepted shift is modified → status becomes updated_pending → employee must re-accept
  │   → All edits logged to shift_audit_log
  │
  ├── REVIEW TIMESHEETS
  │   → /admin/timesheets — list submitted/approved/correction timesheets
  │   → /admin/timesheets/[id] — review individual timesheet
  │     → Approve (optionally set approved_total different from estimated_total)
  │     → Request correction (select which fields, add note)
  │     → Review and approve corrected timesheets
  │
  └── TRACK PAYMENTS
      → /admin/payments — list all payments
      → Create payment from approved timesheets (select employee + period)
      → /admin/payments/[id] — view payment details
      → Mark as paid
```

---

## 9. Employee Workflow

```
Employee logs in (with temp password from admin)
  → Forced to /change-password (must set new password, min 8 chars)
  → Redirected to /employee/home
  → Views summary stats (upcoming shifts, active shift, recent timesheets, earnings)
  │
  ├── VIEW & RESPOND TO SHIFTS
  │   → /employee/shifts — list assigned shifts
  │   → /employee/shifts/[id] — view shift details
  │     → Accept shift (status: pending → accepted)
  │     → Decline shift (status: pending → declined)
  │     → Re-accept updated shift (status: updated_pending → accepted)
  │
  ├── WORK A SHIFT
  │   → /employee/start-shift/[id]
  │     → Take/upload odometer photo
  │     → Enter starting odometer reading
  │     → Submit → creates shift_attendance (working) + odometer_submission (START)
  │   → /employee/finish-shift/[id]
  │     → Take/upload odometer photo
  │     → Enter ending odometer reading (must be ≥ starting reading)
  │     → Submit → updates attendance (completed), shift (completed)
  │     → AUTO-GENERATES timesheet with calculations
  │     → Shows summary: worked time, distance, estimated payment
  │
  ├── VIEW TIMESHEETS
  │   → /employee/timesheets — list all timesheets
  │   → /employee/timesheets/[id] — view individual timesheet
  │     → If correction_required → submit corrected values for requested fields only
  │     → View approved/paid status
  │
  ├── VIEW PAYMENTS
  │   → /employee/payments — list all payments and their status
  │
  └── MANAGE PROFILE
      → /employee/profile — view profile details
      → Change password
```

---

## 10. Shift Creation System

### Single shift creation
- **Date**: Any date.
- **Start/end time**: Time inputs; end must be after start.
- **Employee assignment**: Admin selects one employee per shift.
- **Availability check**: Warns if employee is unavailable or partially available on that day/time (warning, not blocking).
- **Overlap check**: Warns if employee already has a shift overlapping the time window (warning, not blocking).
- **Location**: Optional text field.
- **Instructions**: Optional text field.
- **Initial status**: `pending` — employee must accept.

### Smart employee ranking (mobile roster)
When creating a shift, the `/api/roster/available-employees` endpoint ranks employees:
1. **Available** — marked available for that day, within their time window
2. **Partial** — available but shift extends outside their availability window
3. **Unavailable** — not available on that day of week
4. **Conflict** — already has an overlapping shift

Within each group, employees are sorted by **lower weekly rostered hours first** (load balancing).

### Recurring shifts (IMPLEMENTED)
- **Repeat next week** — creates the same shift 7 days later.
- **Weekly to end of month** — repeats weekly until the last day of the month.
- **Weekly to custom end date** — repeats weekly until a specified date.
- All recurring shifts get a shared `recurring_group_id`.
- Preview shows conflicts per employee per date before creation.
- Shifts are created with status `pending`.
- Recurrence types: `NONE`, `NEXT_WEEK`, `WEEKLY_END_OF_MONTH`, `WEEKLY_CUSTOM_END`.

### Copy Last Week (IMPLEMENTED)
- `/api/roster/copy-week` endpoint.
- `action: "preview"` — shows each shift with status: ready, conflict, unavailable, or inactive.
- `action: "create"` — bulk-inserts the "ready" shifts as `pending`.
- Skips cancelled/declined shifts from the source week.

### Shift editing (IMPLEMENTED)
- Admin can edit: date, start time, end time, location, instructions.
- Validation runs: overlap check, availability check (warnings, can be overridden with reason).
- If the shift was previously `accepted` and the date/start/finish/location changed → status becomes `updated_pending`.
- Employee must re-accept the updated shift.
- All changes logged to `shift_audit_log` with: original values, new values, change reason, override reason (if any), whether reconfirmation was required.
- Validation logic: `src/lib/services/shiftValidation.ts` — `validateShiftAssignment()` and `requiresEmployeeReconfirmation()`.

### Shift statuses
| Status | Meaning |
|---|---|
| `pending` | Newly created, awaiting employee response |
| `accepted` | Employee accepted |
| `declined` | Employee declined |
| `updated_pending` | Admin edited an accepted shift; employee must re-accept |
| `completed` | Employee finished the shift |
| `cancelled` | Shift was cancelled |

### NOT implemented
- Number of workers per shift (currently 1 shift = 1 employee; for multiple employees, create multiple shifts).
- Cancelling shifts from the UI (only status exists in DB).
- Push notifications when shifts are created/updated.

---

## 11. Photo and Odometer System

### Before-shift (START)
1. Employee navigates to `/employee/start-shift/[id]`.
2. Employee takes or uploads a photo of their odometer.
3. Employee enters the odometer reading manually (numeric, NUMERIC(10,1)).
4. On submit:
   - Photo is uploaded to Supabase Storage bucket `odometer-photos` at path: `{employee_id}/{shift_id}/start_{timestamp}.{ext}`.
   - An `odometer_submissions` row is created with `submission_type = 'START'`.
   - A `shift_attendance` row is created with `attendance_status = 'working'` and `actual_start` set to server time.
   - `server_timestamp` uses the server's `new Date().toISOString()`, NOT client time.

### After-shift (FINISH)
1. Employee navigates to `/employee/finish-shift/[id]`.
2. Employee takes or uploads a photo of their odometer.
3. Employee enters the ending odometer reading.
4. **Validation**: Ending reading must be ≥ starting reading. If not, the API returns an error.
5. On submit:
   - Photo uploaded to `{employee_id}/{shift_id}/finish_{timestamp}.{ext}`.
   - An `odometer_submissions` row is created with `submission_type = 'FINISH'`.
   - `shift_attendance` is updated: `actual_finish = serverNow`, `attendance_status = 'completed'`.
   - Shift status is updated to `completed`.
   - **Timesheet is auto-generated** (see sections 12–14).

### Storage
- **Bucket**: `odometer-photos` (private, not public).
- **RLS on storage.objects**: Any authenticated user can upload to the bucket; any authenticated user can read.
- **Photo format**: Accepts any image file; stored as-is (no compression/resizing).
- **upsert**: `false` (never overwrites existing files).

### NOT implemented
- EXIF metadata extraction or validation.
- GPS location from photos.
- Fraud detection or anomaly detection on readings.
- Photo preview/zoom for admin review.
- File type validation (any file is accepted as a "photo").

---

## 12. Working Hours Calculation

**File:** `src/lib/calculations/time.ts`

### Formula
```
worked_minutes = Math.round((actual_finish - actual_start) / 60000)
```

- Uses actual timestamps from `shift_attendance`, NOT scheduled times.
- Result is in **whole minutes** (rounded to nearest minute).
- Throws an error if `actual_finish` is before `actual_start`.

### Display format
```
formatWorkedDuration(totalMinutes) → { hours: Math.floor(minutes/60), minutes: minutes%60 }
```

### Decimal hours (for payment)
```
minutesToDecimalHours(totalMinutes) = totalMinutes / 60
```

### Example
- actual_start: 2026-08-17T09:00:00Z
- actual_finish: 2026-08-17T14:30:00Z
- worked_minutes = 330
- Display: 5 hours 30 minutes
- Decimal hours: 5.5

### Special rules
- No rounding rules beyond whole-minute rounding.
- No break deductions.
- No overtime multipliers.
- No maximum shift length enforcement.

---

## 13. Mileage Calculation

**File:** `src/lib/calculations/mileage.ts`

### Formula
```
distance_km = ending_odometer - starting_odometer
```

- Result is in **km** (unit is implicit from odometer readings).
- Stored as NUMERIC(10,1) — one decimal place.
- Throws error if ending < starting.

### Validation
- Ending odometer must be ≥ starting odometer (enforced in API route before calling the calculation).
- No upper bound validation (no maximum mileage per shift).
- No cross-shift continuity check (e.g., today's start should equal yesterday's finish).

### Example
- Starting odometer: 45231.5
- Ending odometer: 45289.2
- Distance: 57.7 km

---

## 14. Payroll Calculation

**File:** `src/lib/calculations/payment.ts`

### Formula
```
decimal_hours = worked_minutes / 60
wage_amount = round2(decimal_hours × hourly_rate_snapshot)
mileage_amount = round2(distance_km × mileage_rate_snapshot)
estimated_total = round2(wage_amount + mileage_amount)
```

Where `round2(x) = Math.round(x * 100) / 100` (rounds to 2 decimal places).

### Rate snapshots
- When a timesheet is auto-generated, the employee's **current** `hourly_rate` and `mileage_rate` are copied into the timesheet as `hourly_rate_snapshot` and `mileage_rate_snapshot`.
- This ensures that if the employee's rate changes later, past timesheets remain accurate.
- Calculations always use the snapshot rates, never the live employee rates.

### Payment status
- `unpaid` — default when payment record is created.
- `paid` — admin marks it as paid.
- Only admin can change payment status.

### Admin override
- Admin can set `approved_total` to a different value than `estimated_total` when approving a timesheet.

### Example
```
worked_minutes: 330 (5h 30m)
distance_km: 57.7
hourly_rate_snapshot: $28.50
mileage_rate_snapshot: $0.78/km

wage_amount = (330/60) × 28.50 = 5.5 × 28.50 = $156.75
mileage_amount = 57.7 × 0.78 = $45.01
estimated_total = $156.75 + $45.01 = $201.76
```

---

## 15. Notifications

### Current state: NO ACTIVE NOTIFICATIONS

The application does **not** currently have push notifications, email notifications, in-app notification bells, or real-time alerts.

### How users discover changes
- **Employees** must log in and check `/employee/shifts` to see new or updated shifts.
- **Admins** must check the dashboard for pending responses, submitted timesheets, etc.
- Status changes are recorded in the database (e.g., `updated_pending`) but not actively communicated.

### Planned notifications (not yet implemented)

| Trigger | Recipient | Type | Action |
|---|---|---|---|
| New shift assigned | Employee | Push / email | Open shift detail |
| Shift updated | Employee | Push / email | Review updated shift |
| Shift accepted/declined | Admin | Push / email | View roster |
| Timesheet submitted | Admin | Push / email | Review timesheet |
| Correction requested | Employee | Push / email | Submit correction |
| Payment marked paid | Employee | Push / email | View payment |

---

## 16. Pages and Screens

### Public / Auth pages

| Path | Purpose | Role |
|---|---|---|
| `/login` | Login page — User ID + password | All |
| `/change-password` | Force password change on first login | All (when must_change_password = true) |
| `/` | Root — checks auth, routes to admin dashboard or employee home | All |

### Admin pages

| Path | Purpose | Key actions |
|---|---|---|
| `/admin/dashboard` | Dashboard with summary stats | View totals, quick links |
| `/admin/employees` | Employee list | View all, link to create/edit |
| `/admin/employees/new` | Create new employee | Set name, number, phone, rates, temp password |
| `/admin/employees/[id]` | View/edit employee | Edit details, rates, availability, disable/enable, reset password |
| `/admin/roster` | Weekly roster (mobile day cards + desktop table) | Create shift (3-step), edit shift, copy week, find employee, employee view |
| `/admin/shifts/new` | Traditional shift creation form | Date, time, employee, location, instructions, recurring |
| `/admin/timesheets` | Timesheet list with status filter | View submitted/approved/correction timesheets |
| `/admin/timesheets/[id]` | Review individual timesheet | Approve, request correction, view correction submissions |
| `/admin/payments` | Payment list | View all, create payment from approved timesheets |
| `/admin/payments/[id]` | View individual payment | Mark as paid |

### Employee pages

| Path | Purpose | Key actions |
|---|---|---|
| `/employee/home` | Dashboard with summary stats | View upcoming shifts, active shift, earnings |
| `/employee/shifts` | My shifts list | View assigned shifts |
| `/employee/shifts/[id]` | Shift detail | Accept, decline, re-accept updated |
| `/employee/start-shift/[id]` | Start shift workflow | Upload odometer photo, enter reading |
| `/employee/finish-shift/[id]` | Finish shift workflow | Upload odometer photo, enter reading |
| `/employee/timesheets` | My timesheets list | View all timesheets |
| `/employee/timesheets/[id]` | Timesheet detail | View details, submit corrections if requested |
| `/employee/payments` | My payments list | View payment amounts and status |
| `/employee/profile` | My profile | View details, change password |

### Shared components

| Component | File | Purpose |
|---|---|---|
| AdminNav | `src/components/AdminNav.tsx` | Admin navigation bar with hamburger menu on mobile |
| EmployeeNav | `src/components/EmployeeNav.tsx` | Employee navigation bar with hamburger menu on mobile |
| StatusBadge | `src/components/StatusBadge.tsx` | Colored badges for all status values (shift, timesheet, payment, correction) |

---

## 17. Important Files and Folders

```
src/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Root redirect (auth check → role-based routing)
│   ├── layout.tsx                # Root layout (Tailwind, fonts)
│   ├── login/page.tsx            # Login form
│   ├── change-password/page.tsx  # Force password change
│   │
│   ├── admin/
│   │   ├── layout.tsx            # Auth guard (admin only)
│   │   ├── dashboard/page.tsx    # Admin dashboard
│   │   ├── employees/            # Employee CRUD pages
│   │   ├── roster/page.tsx       # Mobile-first weekly roster (~1400 lines)
│   │   ├── shifts/new/page.tsx   # Traditional shift creation form
│   │   ├── timesheets/           # Timesheet list + detail
│   │   └── payments/             # Payment list + detail
│   │
│   ├── employee/
│   │   ├── layout.tsx            # Auth guard (employee only)
│   │   ├── home/page.tsx         # Employee dashboard
│   │   ├── shifts/               # Shift list + detail + accept/decline
│   │   ├── start-shift/[id]/     # Start shift workflow
│   │   ├── finish-shift/[id]/    # Finish shift workflow
│   │   ├── timesheets/           # Timesheet list + detail + corrections
│   │   ├── payments/             # Payment list
│   │   └── profile/              # Profile + password change
│   │
│   └── api/                      # API routes
│       ├── auth/
│       │   ├── setup-admin/      # One-time admin bootstrap
│       │   └── password-changed/ # Clear must_change_password flag
│       ├── employees/            # CRUD + availability
│       ├── shifts/               # CRUD + start/finish + recurring
│       ├── roster/               # Available employees + copy week
│       ├── timesheets/           # CRUD + corrections
│       ├── payments/             # CRUD + mark paid
│       └── dashboard/            # Admin + employee stats
│
├── components/                   # Shared React components
│   ├── AdminNav.tsx
│   ├── EmployeeNav.tsx
│   └── StatusBadge.tsx
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Browser client (anon key, RLS enforced)
│   │   ├── server.ts             # Server client (cookies + anon key, RLS enforced)
│   │   └── admin.ts              # Admin client (service role key, bypasses RLS)
│   │
│   ├── calculations/
│   │   ├── time.ts               # calculateWorkedMinutes, formatWorkedDuration, minutesToDecimalHours
│   │   ├── mileage.ts            # calculateMileage
│   │   └── payment.ts            # calculatePayment → PaymentBreakdown
│   │
│   ├── services/
│   │   ├── shiftValidation.ts    # validateShiftAssignment, requiresEmployeeReconfirmation
│   │   └── recurringShift.ts     # generateRecurringDates, buildConflictReport
│   │
│   └── validation/               # (directory exists, currently empty or minimal)
│
├── types/
│   ├── index.ts                  # Domain enums (Role, ShiftStatus, etc.) + ApiResponse
│   └── database.ts               # TypeScript types for all DB table rows
│
└── middleware.ts                  # Refreshes Supabase auth session on every request

supabase/
└── migrations/
    ├── 001_initial_schema.sql    # All 8 core tables, enums, indexes, triggers, RLS, storage bucket
    ├── 002_recurring_shifts.sql  # Adds recurrence_type enum + recurring columns to shifts
    ├── 003_shift_editing.sql     # Adds updated_pending status, shift_audit_log table
    └── 004_timesheet_corrections.sql  # Adds correction statuses, timesheet_corrections table
```

### Key patterns for AI agents to know

1. **API routes use two clients**: Server client for auth check → admin client for mutations.
2. **`(adminClient as any)`**: Used for tables not in the TypeScript types (timesheet_corrections, shift_audit_log). These tables were added in later migrations and their types weren't regenerated.
3. **Rate snapshots**: Timesheets store `hourly_rate_snapshot` and `mileage_rate_snapshot` at creation time. Never use live employee rates for past timesheets.
4. **`business_id` is a plain UUID**: No `businesses` table exists. All business-scoping uses this UUID directly.
5. **Server timestamps**: Shift start/finish times use `new Date().toISOString()` on the server, never trusting client time.

---

## 18. Environment Variables

| Variable | Location | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` + Vercel | Supabase project URL. Used by browser + server clients. Public (safe to expose). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` + Vercel | Supabase anon key. Used by browser + server clients. Public (safe to expose, RLS enforced). |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` + Vercel | Supabase service role key. **SERVER-ONLY.** Used by admin client. Bypasses RLS. **NEVER expose to browser.** |

**⚠️ No actual key values are stored in this document.**

The admin client (`src/lib/supabase/admin.ts`) throws an error at startup if `SUPABASE_SERVICE_ROLE_KEY` is missing or empty.

---

## 19. Security

### Authentication security
- Passwords handled exclusively by Supabase Auth (bcrypt-hashed, never stored in app DB).
- Session cookies refreshed by middleware on every request.
- Force password change on first login.
- No OAuth or social login — email/password only.

### Authorization
- **Layout-level guards**: Admin and employee layouts check role before rendering.
- **API-level guards**: Every API route checks authentication and role before proceeding.
- **Double protection**: RLS in database + permission checks in API routes.

### Row Level Security (RLS)
- Enabled on all 10 tables.
- Admins scoped to their `business_id` — cannot see other businesses' data.
- Employees scoped to their own records — cannot see other employees' data.
- Helper functions (`current_user_role()`, `current_user_business_id()`, `current_employee_id()`) used throughout policies.

### Admin-only actions
- Create/edit/disable employees
- Create/edit shifts
- Approve/reject timesheets
- Create payments, mark paid

### Employee restrictions
- Can only see their own shifts, timesheets, payments
- Cannot create shifts or modify other employees' data
- Cannot approve their own timesheets

### Server-side secrets
- `SUPABASE_SERVICE_ROLE_KEY` is only used server-side (API routes). Never imported by client components.
- Not prefixed with `NEXT_PUBLIC_` so Next.js never bundles it into client code.

### Known security concerns
1. **Storage RLS is loose** — any authenticated user can read from the `odometer-photos` bucket. App-level API access control is the real gate, but a motivated user could craft direct Supabase Storage requests.
2. **No rate limiting** — API routes don't rate-limit requests.
3. **No CSRF protection beyond session cookies** — relies on same-origin policy + Supabase session tokens.
4. **`(adminClient as any)` casts** — bypass TypeScript type checking for newer tables. No runtime safety risk, but reduces compile-time catching of column name errors.
5. **Single admin per business** — no concept of admin roles/permissions (all admins in a business have equal access).
6. **No input sanitization** — text inputs not sanitized for XSS; React's JSX escaping provides protection for rendered content.

---

## 20. Current Problems / Technical Debt

### Known bugs
- None confirmed at present. End-to-end testing (Phase 13) has not been performed.

### Temporary implementations
1. **`(adminClient as any)` type casts** for `timesheet_corrections` and `shift_audit_log` tables — should regenerate Supabase types to include these tables.
2. **Login email mapping** — appends `@workforce.app` if no `@` is present. Works but is a V1 workaround rather than a proper username system.

### Missing validation
1. **No maximum shift duration** — shifts of any length can be created.
2. **No odometer continuity check** — today's start reading isn't validated against yesterday's end reading.
3. **No photo validation** — any file type is accepted as an "odometer photo" (no image format verification).
4. **No duplicate payment prevention** — possible to create overlapping payment periods for the same employee.
5. **No past-date shift validation** — shifts can be created for dates in the past.

### Code that needs refactoring
1. **Roster page is ~1400 lines** — `src/app/admin/roster/page.tsx` is a very large single file. Could be split into sub-components.
2. **No shared error handling** — each API route has its own try/catch pattern. Could be centralized.
3. **No API response type consistency** — some routes return `{ success: true }`, others return `{ data: ... }`, others return arrays directly.
4. **Duplicated auth boilerplate** — every API route has the same 10+ lines to check auth and get appUser.

### Features that are incomplete
1. **No notifications** — employees have no way to be alerted about new/changed shifts.
2. **No shift cancellation UI** — the `cancelled` status exists in the DB but there's no UI to cancel a shift.
3. **`src/lib/validation/` directory** — exists but appears empty or minimal. Input validation is spread across API routes rather than centralized.
4. **No pagination** — all list endpoints return all records.
5. **No automated tests** — zero test files exist.

---

## 21. Deployment

### Current deployment
- **Live URL:** Deployed on Vercel (auto-deploy from GitHub main branch)
- **GitHub repo:** `https://github.com/sirtonmoy00123-star/workforce-app.git`
- **Supabase project ID:** `rqnevhgkfvkmspmtnera`

### How updates reach production
```
1. Edit code locally
2. git add + git commit
3. git push origin main
4. Vercel auto-detects the push and runs `next build`
5. If build succeeds → deployed to production URL
6. If build fails → previous deployment stays live
```

### Environment variables on Vercel
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Database migrations
- **NOT auto-deployed.** SQL migration files in `supabase/migrations/` must be run manually in the Supabase SQL Editor.
- Migrations should be run in order: 001 → 002 → 003 → 004.
- Each migration is idempotent (uses `IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`).

### Local development
```bash
npm install
npm run dev
# → http://localhost:3000
# Requires .env.local with all three environment variables
```

---

## 22. Development History

### Key decisions

1. **Layered folder structure** — Business logic separated from UI: `lib/services/` for logic, `lib/calculations/` for pure functions, `app/api/` for routes, `app/` for pages. Chosen for maintainability and testability.

2. **Three Supabase clients** — Browser (public), server (cookies + anon), admin (service role). The admin client bypasses RLS for server-side mutations where the API route has already verified permissions.

3. **Rate snapshots on timesheets** — `hourly_rate_snapshot` and `mileage_rate_snapshot` are captured at timesheet creation. This prevents retroactive pay changes when employee rates are updated.

4. **`business_id` as plain UUID** — No `businesses` table exists. This was a deliberate V1 simplification. Multi-admin or multi-business support would require a proper `businesses` table.

5. **Server timestamps only** — Shift start/finish times use `new Date().toISOString()` on the server. Client-provided timestamps are never used for attendance records.

6. **Auto-timesheet generation** — Timesheets are created automatically when an employee finishes a shift. No manual timesheet entry. If generation fails, the shift is still marked completed and the admin is told to review.

7. **Updated_pending reconfirmation** — When an admin edits an accepted shift's date/time/location, the status changes to `updated_pending` and the employee must re-accept. This was added to prevent silent schedule changes.

8. **Mobile-first roster redesign** — The roster page was completely rewritten with bottom sheets replacing modals, day-card layout for mobile, and a 3-step shift creation flow. Desktop table view was preserved as a responsive breakpoint.

9. **Timesheet correction workflow** — Instead of allowing direct edits to timesheets, corrections go through a formal request/submit/review cycle. This preserves an audit trail of what was originally recorded vs. what was corrected.

10. **`userId@workforce.app` email format** — Allows employees to log in with simple user IDs while Supabase Auth requires email format.

11. **Client-side rendering for pages** — All interactive pages are `"use client"` with `useState`/`useEffect`. Server components are only used for auth guard layouts.

---

## 23. Next Development Priorities

1. **Phase 13: Security review & end-to-end test** — Run the full John Smith test scenario. Verify RLS policies prevent cross-business and cross-employee access.

2. **Regenerate Supabase types** — Update `src/types/database.ts` to include `shift_audit_log` and `timesheet_corrections` tables, eliminating all `(adminClient as any)` casts.

3. **Employee notifications** — Implement push or email notifications for new shifts, shift changes, and correction requests.

4. **Shift cancellation UI** — Add a "Cancel Shift" button for admins with a reason field.

5. **Input validation centralization** — Move validation from individual API routes into `src/lib/validation/` helpers.

6. **Roster page refactoring** — Split the ~1400-line roster page into smaller components.

7. **Photo validation** — Verify uploaded files are actually images (check MIME type / magic bytes).

8. **Rate limiting** — Add rate limiting to API routes to prevent abuse.

9. **Storage RLS tightening** — Restrict `odometer-photos` bucket read access so employees can only read their own photos.

10. **Pagination** — Add cursor/offset pagination to all list endpoints.

11. **Automated tests** — Unit tests for calculation helpers, integration tests for API routes.

12. **Reporting** — Weekly/monthly summaries of hours, mileage, and payments.

---

## 24. AI Coding Agent Rules

## AI CODING AGENT RULES

Whenever an AI coding agent works on this project:

1. Read `PROJECT_MASTER.md` before making significant changes.
2. Inspect the relevant existing code before modifying anything.
3. Do not assume a feature is missing before checking the code.
4. Do not remove existing working functionality unless explicitly requested.
5. Follow the existing architecture unless there is a strong technical reason to change it.
6. Maintain compatibility with the existing database.
7. Protect authentication, authorization, RLS, and secrets.
8. Never expose Supabase service-role keys or other server secrets to the browser.
9. Test changes for regressions.
10. When adding a feature, update the relevant documentation.
11. After completing an important feature or architectural change, update `PROJECT_MASTER.md`.
12. Move features between PLANNED → PARTIALLY COMPLETED → COMPLETED when appropriate.
13. Record new database tables, columns, migrations, environment variables, and APIs.
14. Record important architectural decisions.
15. Keep documentation concise enough that a new Claude Code session can understand the project without reading previous conversations.

### Architecture guidelines

- **API routes**: Always authenticate with the server client first, then use the admin client for mutations. Never skip auth checks.
- **Calculations**: Use `src/lib/calculations/` pure functions. Always use rate snapshots for payment calculations.
- **Validation**: Use `src/lib/services/shiftValidation.ts` for shift assignment validation. Add new validators to `src/lib/validation/`.
- **Types**: Use enums from `src/types/index.ts`. Use database row types from `src/types/database.ts`.
- **Supabase clients**: Never use the admin client on the browser side. Never import `src/lib/supabase/admin.ts` in client components.
- **Database changes**: Create a new numbered migration file in `supabase/migrations/`. Use `IF NOT EXISTS` for idempotency. Add RLS policies for new tables.
- **`business_id`**: Always scope queries by `business_id` for admin access. There is no `businesses` table — `business_id` is a plain UUID column.
