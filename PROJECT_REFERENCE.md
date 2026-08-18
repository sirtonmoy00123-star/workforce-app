# PROJECT_REFERENCE.md — Master Project Reference

> **This is the master project reference file.** Before making significant changes to this application, read this file first instead of relying on the full historical conversation. Inspect the actual code when necessary because the codebase remains the final authority for the current implementation.
>
> **Keep this file updated.** Whenever you make a significant change (new feature, database change, business logic change, new page/API, auth/permission change, payroll/roster/shift/mileage logic change, important bug fix, or dependency change), update this file before finishing the task.

---

## 1. Project Overview

### What It Does
A workforce management web application for employee rostering, shift tracking, odometer/mileage recording, timesheet generation, and payment tracking.

### Core Workflow
```
Admin creates employee → Sets availability → Creates/assigns shift →
Employee accepts/declines → Employee starts shift (uploads odometer photo) →
Employee finishes shift (uploads ending odometer photo) →
App auto-calculates hours + mileage + payment →
Admin reviews/approves timesheet → Admin marks payment as paid →
Employee sees payment status
```

### Target Users
- **Platform Admin (you)**: Manages the entire SaaS — creates businesses, suspends/activates them
- **Business Owner/Admin**: Manages their workforce — employees, roster, timesheets, payments
- **Employees**: View shifts, start/finish shifts, view timesheets and payments

### SaaS/Business Model
Multi-tenant SaaS. One application, one database, many independent businesses with completely isolated data. Each business has its own employees, shifts, timesheets, and payments. A Platform Admin manages all businesses.

---

## 2. Current Architecture

### Stack
| Layer | Technology | Version |
|---|---|---|
| Frontend | Next.js (App Router, Server Components) | 16.3.1 |
| UI | React + TypeScript | React 19, TS 5 |
| Styling | Tailwind CSS | 4 |
| Database | PostgreSQL via Supabase | - |
| Auth | Supabase Auth (email/password) | - |
| Storage | Supabase Storage (odometer photos) | - |
| Hosting | Vercel (connected to GitHub) | - |

### Key Libraries
- `@supabase/supabase-js` — Supabase client
- `@supabase/ssr` — Server-side Supabase for Next.js (cookie-based sessions)

### How Parts Communicate
```
Browser → Next.js API Routes → Supabase (PostgreSQL + Auth + Storage)
                ↕
         Tenant Context Helper (derives business_id from session)
```

- **Client pages** (`"use client"`) call `/api/*` routes via `fetch()`
- **API routes** use `tenantContext.ts` helpers to authenticate + derive `businessId`
- **All DB queries** go through the Supabase admin client (service role), with `business_id` filters applied server-side
- **Auth session** is managed via cookies by `@supabase/ssr` middleware

### Three Supabase Clients
| Client | File | Purpose |
|---|---|---|
| Browser client | `src/lib/supabase/client.ts` | Client-side auth (login/logout only) |
| Server client | `src/lib/supabase/server.ts` | Server components — reads session cookies |
| Admin client | `src/lib/supabase/admin.ts` | Service role — bypasses RLS, used in all API routes |

---

## 3. User Roles

### Platform Admin (`is_platform_admin = true` on users table)
- **NOT** a business role — separate platform-level flag
- Can create, view, suspend, activate businesses
- Can view platform-wide stats
- Cannot access business employee/payroll data directly
- Routes: `/platform/*`

### Business Owner (`OWNER` in business_members)
- Full control over their business
- Can manage employees, availability, roster, timesheets, payments
- One owner per business (created when Platform Admin creates the business)
- Routes: `/admin/*`

### Business Admin (`ADMIN` in business_members)
- Same permissions as Owner except: cannot change business settings or add/remove other admins
- Created by Owner (future feature — not implemented yet)
- Routes: `/admin/*`

### Employee (`EMPLOYEE` in business_members)
- Can only see their own shifts, timesheets, payments
- Can accept/decline shifts, start/finish shifts, upload odometer photos
- Can submit corrections when requested by admin
- Cannot see other employees' data
- Routes: `/employee/*`

### Permission Matrix
| Action | OWNER | ADMIN | EMPLOYEE | PLATFORM_ADMIN |
|---|---|---|---|---|
| Business settings | ✅ | ❌ | ❌ | ❌ |
| Manage employees | ✅ | ✅ | ❌ | ❌ |
| Availability, roster, shifts | ✅ | ✅ | ❌ | ❌ |
| Review/approve timesheets | ✅ | ✅ | ❌ | ❌ |
| Employee payments | ✅ | ✅ | ❌ | ❌ |
| Own shifts/timesheets/pay | ✅ | ✅ | ✅ | ❌ |
| Suspend a business | ❌ | ❌ | ❌ | ✅ |
| Create businesses | ❌ | ❌ | ❌ | ✅ |

---

## 4. Current Features

### Authentication & Access
- **Login**: Email/password via Supabase Auth. Employees use `userId@workforce.app` format.
- **Force password change**: First login forces password change (`must_change_password` flag).
- **Account management**: Admin can reset password, disable/enable employee accounts.
- **No self-registration**: Only admins create employee accounts.
- **Role-based routing**: Root page (`/`) redirects based on `is_platform_admin`, `role` (admin/employee).

### Platform Admin Panel
- **Dashboard** (`/platform/home`): Shows total businesses, users, employees, shifts across all tenants.
- **Business list** (`/platform/businesses`): View all businesses with status badges, suspend/activate controls.
- **Create business** (`/platform/businesses/new`): Creates business + owner auth account + users row + business_members row in one transaction with rollback.
- **Business detail** (`/platform/businesses/[id]`): Shows members, employee/shift counts, business info.

### Employee Management
- **Employee list** (`/admin/employees`): Shows all employees in the business.
- **Create employee** (`/admin/employees/new`): Creates auth user, users row, business_members row, employees row. Generates login credentials.
- **Edit employee** (`/admin/employees/[id]`): Update name, phone, rates. Disable/enable/reset password.

### Availability
- **Weekly availability** (`/admin/employees/[id]` → availability tab): Admin sets 7-day recurring availability per employee with time windows.
- Stored in `employee_availability` table (one row per day_of_week per employee).

### Roster & Shifts
- **Weekly roster** (`/admin/roster`): Grid view of shifts for the week, organized by day.
- **Create shift** (`/admin/shifts/new`): Assign employee to a date/time. Validates availability, checks overlaps. Availability warnings can be overridden.
- **Smart employee suggestions** (`/api/roster/available-employees`): Ranks employees by availability status (available → partial → unavailable → conflict) and weekly hours.
- **Recurring shifts** (`/api/shifts/recurring`): Preview conflicts, then bulk-create shifts across multiple weeks (next week, end of month, custom end date).
- **Copy last week** (`/api/roster/copy-week`): Preview what shifts would look like copied to a target week, then create them.
- **Edit shift** (`/api/shifts/[id]`): Admin can edit date, time, location, instructions. If the shift was accepted, changes that affect date/time/location trigger `updated_pending` status requiring employee reconfirmation.
- **Shift audit log**: Every edit is recorded in `shift_audit_log` with original/new values, change reason, and whether reconfirmation was required.

### Employee Shift Flow
- **View shifts** (`/employee/shifts`): See assigned shifts with status.
- **Accept/Decline** (`/employee/shifts/[id]`): Accept or decline pending/updated_pending shifts.
- **Start shift** (`/employee/start-shift/[id]`): Upload odometer photo, enter odometer reading. Creates `shift_attendance` (status: working) and `odometer_submissions` (type: START).
- **Finish shift** (`/employee/finish-shift/[id]`): Upload ending odometer photo, enter reading. Auto-generates timesheet with calculated hours, mileage, and payment.

### Timesheets
- **Auto-generated** when employee finishes a shift.
- **Admin list** (`/admin/timesheets`): View all timesheets with status filter (submitted/approved/needs_correction/correction_required/correction_submitted).
- **Admin review** (`/admin/timesheets/[id]`): Approve (with optional adjusted total) or request correction.
- **Correction workflow**: Admin selects fields needing correction (start time, finish time, start odometer, finish odometer, photos, other) + writes a note. Employee sees the request, submits corrected values + explanation. App recalculates all amounts. Admin can then approve.
- **Employee view** (`/employee/timesheets`): See own timesheets with status.

### Payments
- **Create payment** (`/admin/payments`): Select employee + date range, system aggregates approved timesheets into a payment record.
- **Mark paid** (`/admin/payments/[id]`): Mark a payment as paid with date.
- **Employee view** (`/employee/payments`): See own payments with status.

### Dashboards
- **Admin dashboard** (`/admin/dashboard`): Active employees, pending shifts, today's shifts, submitted timesheets, unpaid payments with amount.
- **Employee dashboard** (`/employee/home`): Upcoming shifts, active shift (if working), recent timesheets, earnings summary.

---

## 5. Roster and Shift System

### Shift Creation Rules
1. Employee must be active (`employment_status = 'active'`).
2. No overlapping shifts for the same employee on the same date (cancelled/declined excluded from overlap check).
3. Availability check: warns if employee is unavailable or partially available. Admin can override with reason.
4. Shifts created with status `pending`.

### Shift Statuses
`pending` → `accepted` → `completed` (normal flow)
`pending` → `declined`
`accepted` → `updated_pending` (admin edited → needs reconfirmation)
Any → `cancelled`

### Edit Triggers Reconfirmation When
Date, scheduled_start, scheduled_finish, or location changes on an `accepted` shift → status becomes `updated_pending`.

### Recurring Shift Types
- `NEXT_WEEK`: Repeats the shift for the following week only
- `WEEKLY_END_OF_MONTH`: Repeats weekly until end of current month
- `WEEKLY_CUSTOM_END`: Repeats weekly until a specified end date

### No Notifications System
Currently no push/email notifications. Employees must check the app.

---

## 6. Time, Mileage and Payroll

### Start/End Shift Process
1. **Start**: Employee uploads photo of odometer + enters reading → server records `actual_start` timestamp + creates `odometer_submissions` (type: START)
2. **Finish**: Employee uploads ending photo + reading → server records `actual_finish` + creates `odometer_submissions` (type: FINISH) → auto-generates timesheet

### Working Hours Calculation
```typescript
// src/lib/calculations/time.ts
workedMinutes = Math.round((actualFinish - actualStart) / 60000)  // whole minutes
decimalHours = workedMinutes / 60  // for payment only
```
- No rounding of minutes — exact minute count.
- Decimal hours for payment calculation only (not displayed as "hours worked").

### Mileage Calculation
```typescript
// src/lib/calculations/mileage.ts
distanceKm = endingOdometer - startingOdometer
```
- Simple subtraction. Finish must be >= start (validated at input).

### Payment Calculation
```typescript
// src/lib/calculations/payment.ts
wageAmount = round2(decimalHours * hourlyRateSnapshot)
mileageAmount = round2(distanceKm * mileageRateSnapshot)
estimatedTotal = round2(wageAmount + mileageAmount)
```
- `round2()` = `Math.round(value * 100) / 100` — standard 2-decimal rounding.
- **Rate snapshots**: When a timesheet is generated, the employee's current `hourly_rate` and `mileage_rate` are snapshotted into the timesheet. Past timesheets remain correct even if rates change.

### Payment Aggregation
- Admin selects employee + date range → system sums all `approved` timesheets in that range.
- `total_hours`, `wage_amount`, `mileage_amount`, `total_amount` are stored on the payment.
- Payment statuses: `unpaid` → `paid`.

---

## 7. Database Structure

### Core Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `users` | App user accounts (linked to Supabase Auth) | `auth_user_id`, `business_id`, `role`, `is_platform_admin`, `must_change_password` |
| `businesses` | Tenant/business entity | `business_name`, `slug` (unique), `status` (ACTIVE/SUSPENDED/ARCHIVED), `timezone` |
| `business_members` | Links users to businesses with roles | `business_id`, `user_id`, `role` (OWNER/ADMIN/EMPLOYEE), `status` |
| `employees` | Employee profiles | `business_id`, `user_id`, `employee_number`, `full_name`, `hourly_rate`, `mileage_rate` |
| `employee_availability` | Weekly recurring availability | `employee_id`, `day_of_week` (0-6), `is_available`, `start_time`, `end_time` |
| `shifts` | Shift assignments | `business_id`, `employee_id`, `date`, `scheduled_start`, `scheduled_finish`, `status`, `location`, `instructions` |
| `shift_attendance` | Actual work tracking | `shift_id`, `employee_id`, `actual_start`, `actual_finish`, `attendance_status` |
| `odometer_submissions` | Photo evidence + readings | `shift_id`, `employee_id`, `submission_type` (START/FINISH), `photo_path`, `odometer_reading` |
| `timesheets` | Auto-generated pay records | `shift_id`, `employee_id`, `worked_minutes`, `distance_km`, rate snapshots, calculated amounts, `status` |
| `timesheet_corrections` | Correction workflow records | `timesheet_id`, `employee_id`, `requested_fields`, `original_values`, `corrected_values`, `recalculated_values` |
| `payments` | Aggregated pay periods | `employee_id`, `period_start`, `period_end`, totals, `status` (unpaid/paid) |
| `shift_audit_log` | Edit history for shifts | `shift_id`, original/new values, `change_reason`, `required_reconfirmation` |

### Business/Tenant Separation
- **Every major table** has a `business_id` column (NOT NULL with index).
- `business_id` is **never** accepted from client requests — always derived server-side from `tenantContext.ts`.
- Queries always include `.eq("business_id", ctx.businessId)` or verify the fetched record's `business_id` matches.

### RLS
- RLS is enabled on all tables.
- Current RLS policies are basic (from migration 001). Phase 4 will add comprehensive tenant-scoped RLS policies.
- Server-side validation in API routes is the primary security layer currently.

---

## 8. SaaS/Multi-Tenant Structure

### Tenant Context (`src/lib/services/tenantContext.ts`)
The **single source of truth** for "which business is the current user in?"

```typescript
getCurrentBusinessContext() → {
  userId,        // public.users.id
  authUserId,    // auth.users.id
  businessId,    // derived from business_members
  membershipId,  // business_members.id
  role,          // OWNER | ADMIN | EMPLOYEE
  employeeId,    // employees.id (null for OWNER/ADMIN)
}
```

**Flow**: Authenticate → look up users row → look up active business_members → verify business is ACTIVE → return context.

### Guard Helpers
| Helper | What it checks |
|---|---|
| `requireAdmin()` | Authenticated + role is OWNER or ADMIN |
| `requireMember()` | Authenticated + any active membership |
| `requireRole("EMPLOYEE")` | Authenticated + specific role |
| `requirePlatformAdmin()` | Authenticated + `is_platform_admin = true` |
| `handleTenantError(err)` | Converts `TenantError` to proper HTTP response |

### Business Onboarding (Current)
Platform Admin creates a business via `/platform/businesses/new`:
1. Creates `businesses` row
2. Creates Supabase Auth user for the owner
3. Creates `users` row (role: admin, business_id)
4. Creates `business_members` row (role: OWNER)

The business owner then logs in and adds employees via `/admin/employees/new`.

### Subscription/Billing
**Not implemented yet.** Planned for Phase 7-8. The rules mandate that SaaS billing and employee payments use completely separate tables and screens.

---

## 9. Important UI/UX Decisions

### Mobile-First Admin Roster
The admin roster (`/admin/roster`) is designed mobile-first with day cards. Must be tested at **320 / 375 / 390 / 430px** widths. Features: `+ Shift` button, smart employee suggestions, copy last week, recurring shifts, edit shift with reconfirmation.

### Navigation Structure
- **Platform Admin**: Dark nav bar (gray-900) with emerald accent. Links: Dashboard, Businesses.
- **Business Admin**: White nav bar with blue accent. Links: Dashboard, Employees, Roster, Timesheets, Payments.
- **Employee**: Separate nav (EmployeeNav component). Links: Home, Shifts, Timesheets, Payments, Profile.

### Design Patterns
- Cards with `rounded-xl border border-gray-200` styling
- Status badges with color-coded backgrounds (green=active, red=suspended, etc.)
- Form inputs with `rounded-lg border border-gray-300` and focus ring
- Mobile hamburger menu for all navs
- Loading states with centered gray text

---

## 10. Project File Structure

```
src/
├── app/                          # Next.js App Router pages
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Root redirect (→ /platform, /admin, or /employee)
│   ├── login/page.tsx            # Login page
│   ├── change-password/page.tsx  # Force password change
│   ├── platform/                 # Platform Admin pages
│   │   ├── layout.tsx            # Auth guard + PlatformNav
│   │   ├── home/page.tsx         # Platform dashboard
│   │   └── businesses/           # Business CRUD
│   ├── admin/                    # Business Admin pages
│   │   ├── layout.tsx            # Auth guard + AdminNav
│   │   ├── dashboard/page.tsx
│   │   ├── employees/            # Employee CRUD + availability
│   │   ├── roster/page.tsx       # Weekly roster grid
│   │   ├── shifts/new/page.tsx   # Create shift
│   │   ├── timesheets/           # Timesheet review
│   │   └── payments/             # Payment management
│   ├── employee/                 # Employee pages
│   │   ├── layout.tsx            # Auth guard + EmployeeNav
│   │   ├── home/page.tsx         # Employee dashboard
│   │   ├── shifts/               # View + accept/decline
│   │   ├── start-shift/          # Start shift flow
│   │   ├── finish-shift/         # Finish shift flow
│   │   ├── timesheets/           # View timesheets
│   │   ├── payments/             # View payments
│   │   └── profile/              # View profile
│   └── api/                      # API routes
│       ├── auth/                 # setup-admin, password-changed
│       ├── platform/             # Platform admin APIs
│       │   ├── stats/route.ts
│       │   └── businesses/       # CRUD + [id]
│       ├── employees/            # CRUD + [id] + availability
│       ├── shifts/               # CRUD + [id]/start + [id]/finish + recurring
│       ├── roster/               # available-employees, copy-week
│       ├── timesheets/           # list + [id] + corrections + submit
│       ├── payments/             # list + [id]
│       ├── dashboard/            # admin + employee stats
│       └── profile/              # employee profile
├── components/
│   ├── AdminNav.tsx              # Business admin navigation
│   ├── EmployeeNav.tsx           # Employee navigation
│   ├── PlatformNav.tsx           # Platform admin navigation
│   └── StatusBadge.tsx           # Reusable status badge
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Browser Supabase client
│   │   ├── server.ts             # Server Supabase client (cookies)
│   │   └── admin.ts              # Service role client (bypasses RLS)
│   ├── services/
│   │   ├── tenantContext.ts      # 🔑 Tenant auth + business context
│   │   ├── shiftValidation.ts    # Shift assignment validation rules
│   │   └── recurringShift.ts     # Recurring shift generation + conflict detection
│   └── calculations/
│       ├── time.ts               # Working hours calculation
│       ├── mileage.ts            # Distance calculation
│       └── payment.ts            # Payment calculation
├── types/
│   └── database.ts               # TypeScript types matching DB schema
└── middleware.ts                  # Supabase session refresh middleware

supabase/migrations/              # SQL migrations (run in Supabase SQL Editor)
├── 001_initial_schema.sql        # Core tables, indexes, RLS, triggers
├── 002_recurring_shifts.sql      # Recurring shift columns
├── 003_shift_editing.sql         # Edit shift + audit log + updated_pending status
├── 004_timesheet_corrections.sql # Correction workflow table
├── 005_saas_tenant_foundation.sql # businesses + business_members + backfill
├── 005b_add_not_null_and_indexes.sql # NOT NULL constraints on business_id columns
└── 006_platform_admin.sql        # is_platform_admin flag
```

### Where to Add New Features
- **New page**: `src/app/{role}/{feature}/page.tsx` (platform, admin, or employee)
- **New API route**: `src/app/api/{resource}/route.ts`
- **New business logic**: `src/lib/services/`
- **New calculation**: `src/lib/calculations/`
- **New component**: `src/components/`
- **Database change**: `supabase/migrations/NNN_description.sql`
- **Types**: Update `src/types/database.ts` to match schema changes

---

## 11. Environment and Deployment

### GitHub
- Repository: `https://github.com/sirtonmoy00123-star/workforce-app.git`
- Main branch: `main`
- Feature branches: `saas/phase-N-description`

### Required Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...        # Public anon key (safe for browser)
SUPABASE_SERVICE_ROLE_KEY=eyJ...             # Secret service role key (server only!)
```

### Development
```bash
npm run dev    # Start dev server on port 3000
npm run build  # Production build
npm run lint   # ESLint
```

### Supabase
- Project: `sirtonmoy00123-star's Project`
- Region: (check Supabase dashboard)
- Migrations: Run SQL files manually in Supabase SQL Editor (no CLI setup)
- Storage bucket: `odometer-photos` (private)

### Vercel
- Connected to GitHub repo, auto-deploys on push to `main`
- Environment variables must be set in Vercel dashboard (same 3 as above)

---

## 12. Completed Work

### Phase 0: Audit ✅
- Full architecture audit documented in `docs/SAAS-AUDIT.md`
- Identity collision decision: Option B (business code on login — planned for future)

### Phase 1: Tenant Foundation ✅
- `businesses` and `business_members` tables created
- All existing data backfilled into a default business
- `business_id` added to all 12 relevant tables (NOT NULL with indexes)
- `tenantContext.ts` helper created with `getCurrentBusinessContext()`, `requireAdmin()`, `requireMember()`, `requireRole()`, `requirePlatformAdmin()`
- All 21 API routes wired to use tenant context (no manual auth boilerplate remaining)
- Platform Admin panel built (dashboard, business CRUD, suspend/activate)

### All V1 Workforce Features ✅
- Phases 1-12 of the original spec are complete:
  1. Project setup
  2. Database schema
  3. Authentication & roles
  4. Employee management
  5. Availability management
  6. Shift creation & roster
  7. Employee shift acceptance
  8. Start/finish shift with odometer photos
  9. Calculations + timesheet generation
  10. Admin timesheet approval
  11. Payment tracking
  12. Dashboards

---

## 13. Known Problems

### Technical Debt
- **RLS policies are basic**: Current RLS from migration 001 is not tenant-scoped. API-level checks are the primary security layer. Phase 4 will add proper tenant-scoped RLS.
- **No input validation library**: Validation is done inline in route handlers. Consider adding Zod.
- **`as any` casts**: Several routes cast `adminClient` to `any` for `timesheet_corrections` table queries because the table was added after initial types.
- **No error boundary**: No global error boundary component.
- **Timezone handling**: Shift times are stored as ISO timestamps but timezone-aware display is not fully implemented.

### Incomplete Features
- **Business code on login** (Option B): Planned but not built. Currently uses direct email login.
- **Admin invites**: Owner can't yet add other admins to their business.
- **No notifications**: No push/email notifications for shift assignments, corrections, etc.
- **No photo viewing**: Admin can't view odometer photos in the timesheet review (photos are uploaded but not displayed with signed URLs).

### Known Issues
- **`setup-admin` route**: The bootstrap route at `/api/auth/setup-admin` creates users with a random `business_id` that doesn't match any business. It's a one-time bootstrap and should be disabled/removed since Platform Admin now handles business creation.

---

## 14. Future Features (from CLAUDE-SAAS-RULES.md phase plan)

| Phase | Feature | Status |
|---|---|---|
| 2 | Migrate existing data verification | ✅ Done |
| 3 | Tenant-scope existing features | ✅ Done (all routes use tenant context) |
| 4 | RLS policies + storage isolation + cross-tenant tests | **Not started** |
| 5 | Business owner signup + onboarding wizard | **Not started** |
| 6 | Admin invites (Owner adds other admins) | **Not started** |
| 7 | Subscription plans, trials, server-side plan limits | **Not started** |
| 8 | Billing provider integration + webhooks | **Not started** |
| 9 | Platform Admin dashboard (expanded) | **Partially done** (basic version built) |
| 10 | Public marketing pages (pricing, features, signup) | **Not started** |
| 11 | Full security + regression testing under two tenants | **Not started** |

### Other Planned Improvements
- Employee self-service password change
- Odometer photo viewer with signed URLs in timesheet review
- Email notifications for shift assignments
- Business settings page (timezone, currency, week start day)
- Employee app improvements (calendar view, shift history)

---

## 15. Important Development Rules

### MUST Follow (from CLAUDE-SAAS-RULES.md)
1. **Tenant derived server-side only.** `business_id` comes from `tenantContext.ts`, never from request body/query/form.
2. **Two security layers always.** PostgreSQL RLS AND server-side validation.
3. **Do not change existing business logic.** Hours, mileage, payment, correction workflow calculations must produce identical results.
4. **Do not break mobile-first admin roster.** Test at 320/375/390/430px.
5. **No employee self-registration.** Employee accounts created by Owner/Admin only.
6. **Never delete existing data.** Backfill, verify, then constrain.
7. **SaaS billing ≠ employee payments.** Never share tables/screens between them.
8. **Service-role key is server-side only.** Never expose to browser.
9. **One shared database.** No per-customer database.
10. **Storage is tenant-scoped and private.**

### Development Process
- **Show SQL before running.** Print migration SQL, wait for approval.
- **One phase at a time.** Don't start next phase without being asked.
- **One git branch per phase.** Commit at each working checkpoint.
- **Don't rename for aesthetics.** Only change what the tenant model requires.
- **Ask instead of assuming.** If ambiguous, ask — don't pick silently.

### Code Conventions
- All API routes use `requireAdmin()` / `requireMember()` / `requireRole()` / `requirePlatformAdmin()` from `tenantContext.ts`
- All API routes catch errors with `handleTenantError(err)` 
- All DB queries use `adminClient` (service role) with explicit `business_id` filtering
- TypeScript strict mode, types in `src/types/database.ts`
- Tailwind CSS for all styling — no CSS modules or styled-components
- Components are `"use client"` with hooks; layouts are server components with auth guards

### Process for Future Changes
1. Read `PROJECT_REFERENCE.md`
2. Inspect relevant current code and database files
3. Understand how the change fits the existing architecture
4. Make the changes
5. Run `npx tsc --noEmit` to verify no type errors
6. Run `npm run build` to verify full build
7. Check that existing features haven't broken
8. Update `PROJECT_REFERENCE.md` with any important changes
9. Commit with descriptive message
