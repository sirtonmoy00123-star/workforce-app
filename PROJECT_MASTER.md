# PROJECT_MASTER.md — Workforce App V1

> **Single source of truth** for the Workforce App.
> Last updated: 2026-08-15

---

## 1. Project Overview

### What it does
A web-based employee rostering, shift tracking, and payment management application designed for small businesses with mobile workforces (e.g., delivery, cleaning, field services).

### Who uses it
- **Admin/Employer** — Creates employees, builds rosters, reviews timesheets, manages payments.
- **Employee** — Views assigned shifts, accepts/declines, records odometer photos at start/finish, views timesheets and payments.

### Main problem it solves
Replaces paper-based or spreadsheet rostering and manual mileage/timesheet tracking with a digital system that:
- Automates worked-hours and mileage calculations from odometer photo evidence.
- Provides audit trails via server-stamped timestamps and photo uploads.
- Separates admin and employee access with row-level security.

### Current development stage
**Phase 12 of 13 complete.** Core functionality is fully built and deployed. Phase 13 (security review & end-to-end test) is next.

---

## 2. Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router, server components) | 16.3.1 |
| UI Library | React | 19.2.8 |
| Language | TypeScript | ^5 |
| Styling | Tailwind CSS | ^4 |
| Database | PostgreSQL (via Supabase) | — |
| Auth | Supabase Auth (email/password) | — |
| Storage | Supabase Storage (private bucket) | — |
| Supabase Client | @supabase/supabase-js | ^2.112.3 |
| Supabase SSR | @supabase/ssr | ^0.12.4 |
| Hosting | Vercel | — |
| Source Control | GitHub | — |

### No external libraries
The app uses only Next.js, React, Supabase, and Tailwind. No date libraries, no component libraries, no state management libraries.

---

## 3. Complete Application Architecture

```
┌─────────────────────────────────────────────────────┐
│                    BROWSER (Client)                 │
│  React 19 client components (useState/useEffect)    │
│  AdminNav / EmployeeNav navigation                  │
│  Tailwind CSS 4 styling                             │
│  Supabase Browser Client (auth only)                │
└────────────────────┬────────────────────────────────┘
                     │ fetch() to /api/*
                     ▼
┌─────────────────────────────────────────────────────┐
│              NEXT.JS SERVER (API Routes)            │
│  Route handlers in src/app/api/                     │
│  Supabase Server Client (cookie-based auth)         │
│  Supabase Admin Client (service role, bypasses RLS) │
│  Business logic in src/lib/services/                │
│  Pure calculations in src/lib/calculations/         │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│               SUPABASE (Backend)                    │
│  PostgreSQL — 8 tables + RLS policies               │
│  Auth — email/password accounts                     │
│  Storage — "odometer-photos" private bucket         │
└─────────────────────────────────────────────────────┘
```

### Key architectural decisions
- **Server-side API routes** handle all database operations. Client components never query the database directly.
- **Three Supabase clients:**
  - `client.ts` — Browser client, used only for `auth.signOut()` on logout.
  - `server.ts` — Server client with cookies, used to verify the current user's session.
  - `admin.ts` — Admin client with service role key, bypasses RLS, used for all data operations after permission checks.
- **No server actions** — All mutations go through REST-style API routes (`/api/*`).
- **Client-side rendering** — All pages are `"use client"` components that fetch data via `useEffect` + `fetch()`. Server components are only used for layouts (auth guards).
- **Auth guards in layouts** — `admin/layout.tsx` and `employee/layout.tsx` are server components that check authentication, role, and account status before rendering children.
- **Middleware** — `middleware.ts` refreshes Supabase auth session on every request.

### Deployment flow
```
Local code → git push → GitHub → Vercel auto-deploy → Live app
                                                      ↕
                                               Supabase (managed)
```

---

## 4. User Roles

### Admin (Employer)

| Permission | Details |
|---|---|
| Create employees | Sets name, phone, employee ID, hourly/mileage rates, login credentials |
| Edit employees | Update name, phone, rates |
| Disable/enable employees | Prevents login when disabled |
| Reset employee passwords | Sets new temporary password, forces change on next login |
| Set employee availability | Weekly recurring schedule (per day: available/unavailable, time range) |
| Create shifts | Single or recurring, assign to one or multiple employees |
| View all shifts | Weekly roster grid, all employees |
| Review timesheets | Approve or mark as needs correction |
| Override approved total | Can set a different total from the estimated amount |
| Create payments | Group approved timesheets by employee + date range |
| Mark payments as paid | Records payment date and who marked it |
| View dashboard | Stats: active employees, pending shifts, today's shifts, submitted timesheets, unpaid payments |

### Employee

| Permission | Details |
|---|---|
| View assigned shifts | Only their own |
| Accept/decline shifts | Only pending shifts |
| Start shift | Upload odometer photo + reading (only accepted shifts) |
| Finish shift | Upload odometer photo + reading (only working shifts) |
| View timesheets | Only their own, auto-generated on shift completion |
| View payments | Only their own |
| View profile | Read-only: name, employee number, rates, status |
| Change password | Forced on first login, can also change later |

### Cannot do (either role)
- Employees cannot create, edit, or delete shifts.
- Employees cannot approve timesheets or create payments.
- Employees cannot edit their own profile details (admin controls rates, name, etc.).
- Admins cannot see employee passwords (Supabase Auth is the source of truth).
- Neither role can delete records (no delete endpoints exist).

---

## 5. Authentication System

### Account creation
1. **Admin bootstrap** — One-time endpoint `POST /api/auth/setup-admin` creates the first admin account. Checks if any admin exists first and refuses if one does.
2. **Employee accounts** — Admin creates via `POST /api/employees`. The API:
   - Creates a Supabase Auth user with email `{userId}@workforce.app`
   - Creates a row in the `users` table (role, username, business_id, `must_change_password: true`)
   - Creates a row in the `employees` table (name, rates, employee number)
   - If any step fails, rolls back previous steps

### Login process
1. Employee enters their **User ID** (e.g., `john.smith`) on the login page.
2. The login page appends `@workforce.app` to create the email format Supabase Auth expects.
3. Supabase Auth validates credentials.
4. Root page (`/`) redirects based on role:
   - Checks if account is disabled → redirects to `/login` with error
   - Checks if `must_change_password` → redirects to `/change-password`
   - Admin → `/admin/dashboard`
   - Employee → `/employee/home`

### Password handling
- Temporary password set by admin on employee creation (min 6 characters).
- Employee forced to change on first login (min 8 characters).
- `POST /api/auth/password-changed` clears the `must_change_password` flag using admin client.
- Admin can reset employee passwords from the employee detail page.

### Session handling
- Supabase Auth manages sessions via cookies.
- `middleware.ts` calls `supabase.auth.getUser()` on every request to refresh the session.
- Logout calls `supabase.auth.signOut()` on the browser client and redirects to `/login`.

### Auth guards (server-side)
- `admin/layout.tsx`: Verifies user is authenticated, role is `admin`, and `account_status` is `active`.
- `employee/layout.tsx`: Verifies user is authenticated, role is `employee`, `account_status` is `active`, and `must_change_password` is `false`.

---

## 6. Database Architecture

### Database: PostgreSQL (Supabase)
**Supabase Project ID:** `rqnevhgkfvkmspmtnera`

### Enums

| Enum | Values |
|---|---|
| `user_role` | `admin`, `employee` |
| `shift_status` | `pending`, `accepted`, `declined`, `completed`, `cancelled` |
| `attendance_status` | `pending`, `working`, `completed` |
| `odometer_submission_type` | `START`, `FINISH` |
| `timesheet_status` | `submitted`, `approved`, `needs_correction` |
| `payment_status` | `unpaid`, `paid` |
| `employment_status` | `active`, `inactive` |
| `account_status` | `active`, `disabled` |
| `recurrence_type` | `NONE`, `NEXT_WEEK`, `WEEKLY_END_OF_MONTH`, `WEEKLY_CUSTOM_END` |

### Tables

#### `businesses`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `name` | TEXT NOT NULL | |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**RLS:** Authenticated users can read rows where their `users.business_id` matches.

#### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `auth_user_id` | UUID UNIQUE NOT NULL | FK → `auth.users(id)` |
| `role` | `user_role` NOT NULL | |
| `username` | TEXT NOT NULL | Display name / login ID |
| `business_id` | UUID NOT NULL | FK → `businesses(id)` |
| `account_status` | `account_status` | Default `active` |
| `must_change_password` | BOOLEAN | Default `false` |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** `auth_user_id` (unique), `business_id`
**RLS:** Users can read their own row. Admins can read all users in their business.

#### `employees`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `user_id` | UUID UNIQUE NOT NULL | FK → `users(id)` |
| `business_id` | UUID NOT NULL | FK → `businesses(id)` |
| `full_name` | TEXT NOT NULL | |
| `phone` | TEXT | |
| `employee_number` | TEXT NOT NULL | e.g., "EMP001" |
| `hourly_rate` | NUMERIC(10,2) NOT NULL | |
| `mileage_rate` | NUMERIC(10,2) NOT NULL | |
| `employment_status` | `employment_status` | Default `active` |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** `user_id` (unique), `business_id`, `(business_id, employee_number)` (unique)
**RLS:** Admins can CRUD employees in their business. Employees can read their own record.

#### `employee_availability`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `employee_id` | UUID NOT NULL | FK → `employees(id)` CASCADE |
| `day_of_week` | INT NOT NULL | 0=Sunday, 6=Saturday |
| `is_available` | BOOLEAN | Default `false` |
| `start_time` | TIME | |
| `end_time` | TIME | |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Constraints:** UNIQUE on `(employee_id, day_of_week)`, CHECK `day_of_week BETWEEN 0 AND 6`
**RLS:** Admins can CRUD for employees in their business. Employees can read their own.

#### `shifts`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `business_id` | UUID NOT NULL | FK → `businesses(id)` |
| `employee_id` | UUID NOT NULL | FK → `employees(id)` |
| `date` | DATE NOT NULL | |
| `scheduled_start` | TIMESTAMPTZ NOT NULL | |
| `scheduled_finish` | TIMESTAMPTZ NOT NULL | |
| `location` | TEXT | |
| `instructions` | TEXT | |
| `status` | `shift_status` | Default `pending` |
| `created_by` | UUID | FK → `users(id)` |
| `recurring_group_id` | UUID | Links related recurring shifts |
| `is_recurring` | BOOLEAN | Default `false` |
| `recurrence_type` | `recurrence_type` | Default `NONE` |
| `recurrence_end_date` | DATE | |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** `business_id`, `employee_id`, `date`, `status`, `recurring_group_id` (WHERE NOT NULL)
**RLS:** Admins can CRUD shifts in their business. Employees can read/update their own shifts.

#### `shift_attendance`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `shift_id` | UUID NOT NULL | FK → `shifts(id)` |
| `employee_id` | UUID NOT NULL | FK → `employees(id)` |
| `actual_start` | TIMESTAMPTZ | Server timestamp |
| `actual_finish` | TIMESTAMPTZ | Server timestamp |
| `attendance_status` | `attendance_status` | Default `pending` |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Constraints:** UNIQUE on `(shift_id, employee_id)`
**RLS:** Admins can read attendance in their business. Employees can read/insert their own.

#### `odometer_submissions`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `shift_id` | UUID NOT NULL | FK → `shifts(id)` |
| `employee_id` | UUID NOT NULL | FK → `employees(id)` |
| `submission_type` | `odometer_submission_type` NOT NULL | `START` or `FINISH` |
| `photo_path` | TEXT NOT NULL | Path in Supabase Storage |
| `odometer_reading` | NUMERIC(10,1) NOT NULL | |
| `server_timestamp` | TIMESTAMPTZ NOT NULL | |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**RLS:** Admins can read in their business. Employees can read/insert their own.

#### `timesheets`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `shift_id` | UUID NOT NULL | FK → `shifts(id)` |
| `employee_id` | UUID NOT NULL | FK → `employees(id)` |
| `scheduled_start` | TIMESTAMPTZ NOT NULL | |
| `scheduled_finish` | TIMESTAMPTZ NOT NULL | |
| `actual_start` | TIMESTAMPTZ NOT NULL | |
| `actual_finish` | TIMESTAMPTZ NOT NULL | |
| `worked_minutes` | INT NOT NULL | |
| `start_odometer` | NUMERIC(10,1) NOT NULL | |
| `finish_odometer` | NUMERIC(10,1) NOT NULL | |
| `distance_km` | NUMERIC(10,1) NOT NULL | |
| `hourly_rate_snapshot` | NUMERIC(10,2) NOT NULL | Rate at time of shift completion |
| `mileage_rate_snapshot` | NUMERIC(10,2) NOT NULL | Rate at time of shift completion |
| `wage_amount` | NUMERIC(10,2) NOT NULL | |
| `mileage_amount` | NUMERIC(10,2) NOT NULL | |
| `estimated_total` | NUMERIC(10,2) NOT NULL | |
| `approved_total` | NUMERIC(10,2) | Set by admin on approval |
| `approved_by` | UUID | FK → `users(id)` |
| `approved_at` | TIMESTAMPTZ | |
| `status` | `timesheet_status` | Default `submitted` |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**RLS:** Admins can read/update for their business. Employees can read their own.

#### `payments`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `employee_id` | UUID NOT NULL | FK → `employees(id)` |
| `period_start` | DATE NOT NULL | |
| `period_end` | DATE NOT NULL | |
| `total_hours` | NUMERIC(10,2) NOT NULL | |
| `total_mileage` | NUMERIC(10,1) NOT NULL | |
| `wage_amount` | NUMERIC(10,2) NOT NULL | |
| `mileage_amount` | NUMERIC(10,2) NOT NULL | |
| `total_amount` | NUMERIC(10,2) NOT NULL | |
| `status` | `payment_status` | Default `unpaid` |
| `payment_date` | DATE | Set when marked paid |
| `marked_paid_by` | UUID | FK → `users(id)` |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**RLS:** Admins can CRUD for their business. Employees can read their own.

### Table relationships
```
businesses
  ├── users (business_id)
  ├── employees (business_id)
  └── shifts (business_id)

users
  └── employees (user_id)

employees
  ├── employee_availability (employee_id)
  ├── shifts (employee_id)
  ├── shift_attendance (employee_id)
  ├── odometer_submissions (employee_id)
  ├── timesheets (employee_id)
  └── payments (employee_id)

shifts
  ├── shift_attendance (shift_id)
  ├── odometer_submissions (shift_id)
  └── timesheets (shift_id)
```

### Migrations
- `001_initial_schema.sql` — All base tables, enums, indexes, RLS policies, storage bucket.
- `002_recurring_shifts.sql` — Added `recurrence_type` enum and recurring shift columns to `shifts` table.

---

## 7. Complete Feature List

### ✅ COMPLETED

1. **Project scaffolding** — Next.js 16, TypeScript, Tailwind CSS 4, folder structure
2. **Supabase integration** — Three client types (browser, server, admin)
3. **Database schema** — 8 tables, enums, indexes, RLS policies
4. **Authentication** — Login, logout, session management, role-based routing
5. **Force password change** — First login redirects to change-password page
6. **Admin employee CRUD** — List, create, view detail, edit, disable/enable, reset password
7. **Employee availability** — Admin sets weekly recurring availability per employee
8. **Single shift creation** — Date, time, location, instructions, employee assignment with availability/overlap checks
9. **Recurring shift creation** — Multi-step flow: details → employee selection → recurrence type → conflict preview → confirm → publish
10. **Weekly roster grid** — Desktop table view (employee × day) and mobile card view, week navigation
11. **Employee shift acceptance** — View shifts, accept/decline pending shifts
12. **Start shift** — Upload odometer photo, enter reading, creates attendance record with server timestamp
13. **Finish shift** — Upload odometer photo, enter reading, updates attendance, auto-generates timesheet
14. **Automatic timesheet generation** — On shift finish: calculates hours, mileage, payment with rate snapshots
15. **Admin timesheet review** — List with status filters, detail view with approve/needs-correction actions
16. **Payment creation** — Admin selects employee + date range, groups approved timesheets into payment
17. **Mark payment as paid** — Records payment date and who marked it
18. **Admin dashboard** — Stats cards (employees, shifts, timesheets, payments) with quick action links
19. **Employee dashboard** — Active shift alert, earnings summary, upcoming shifts, recent timesheets
20. **Employee profile** — Read-only view of name, employee number, rates, status
21. **Status badges** — Reusable component with color-coded badges for all statuses
22. **Responsive design** — Desktop table + mobile card layouts, responsive navigation with hamburger menu
23. **Vercel deployment** — Live at production URL with GitHub auto-deploy

### ⚠️ PARTIALLY COMPLETED

1. **Recurring shift "Save as Draft"** — The API accepts `saveAsDraft` parameter and returns `isDraft` in response, but all shifts are created with `status: "pending"` regardless. Draft status is not functionally different from published.

### 📋 PLANNED (from spec, not yet implemented)

1. **Phase 13: Security review & end-to-end test** — Run the "John Smith" test scenario, verify RLS policies, verify all permission checks.
2. **Notifications** — No notification system exists yet (no email, push, or in-app notifications).
3. **Shift editing/cancelling** — No endpoint to edit or cancel existing shifts after creation.
4. **EXIF metadata extraction** — Odometer photos are stored but EXIF data (GPS, timestamp) is not extracted or validated.
5. **Timezone handling** — Spec mentions AEST (Australia/Sydney) but timestamps are stored as UTC with no explicit timezone conversion in the app.

### 💡 IDEAS / FUTURE FEATURES

1. Push notifications for new shift assignments
2. Email notifications for shift reminders
3. Employee self-service availability editing
4. Bulk shift operations (cancel, reassign)
5. Export timesheets/payments to CSV
6. Admin multi-business support
7. Photo comparison view on timesheet review (show start/finish odometer photos side by side)
8. Audit log for admin actions
9. Shift swap requests between employees

---

## 8. Admin Workflow

```
Admin Login
  → Dashboard (overview stats)
  → Manage Employees
     → Add new employee (set name, phone, ID, rates, login credentials)
     → View/edit employee details
     → Set weekly availability per employee
     → Disable/enable employee accounts
     → Reset employee passwords
  → Create Shifts
     → Set date, time, location, instructions
     → Select one or multiple employees
     → Choose recurrence (none / next week / weekly to end of month / custom end date)
     → Preview conflicts (availability, overlapping shifts, inactive employees)
     → Skip or override conflicts per employee per date
     → Publish shifts (all created as "pending")
  → View Roster
     → Weekly grid view (employee × day of week)
     → Navigate between weeks
     → See shift times and statuses
  → Review Timesheets
     → Filter by status (all / pending review / approved / needs correction)
     → View timesheet detail: scheduled vs actual times, odometer readings, payment breakdown
     → Approve (optionally override total) or mark as needs correction
  → Manage Payments
     → Create payment: select employee + date range → groups approved timesheets
     → View payment details: period, hours, mileage, wage/mileage breakdown, total
     → Mark payment as paid
```

---

## 9. Employee Workflow

```
Employee Login
  → Force password change (first login only, min 8 characters)
  → Employee Home (dashboard)
     → See active shift alert (if currently working)
     → See earnings summary (total paid / pending)
     → See upcoming shifts (next 5)
     → See recent timesheets (last 3)
  → My Shifts
     → View all assigned shifts with dates, times, locations, statuses
     → Tap shift → Shift Detail:
        → If "pending": Accept or Decline
        → If "accepted": START SHIFT button
           → Start Shift page:
              1. Take/upload odometer photo
              2. Enter odometer reading (km)
              3. Confirm → shift is now "working"
        → If "working": FINISH SHIFT button
           → Finish Shift page:
              1. Take/upload odometer photo
              2. Enter odometer reading (km)
              3. Confirm → shift becomes "completed"
              4. Success screen with auto-generated timesheet summary
                 (hours worked, distance, wages, mileage, estimated total)
  → Timesheets
     → View all timesheets with dates, hours, distance, amounts, statuses
  → Payments
     → View all payments with period, hours, mileage, breakdown, totals
  → Profile
     → Read-only view of name, employee number, phone, rates, status
```

---

## 10. Shift Creation System

### Single shift creation
- Admin selects: date, start time, end time, location (optional), instructions (optional)
- Admin selects one or more employees via checkboxes
- System checks employee availability for the selected day of week
- System checks for overlapping existing shifts
- Shift is created with status `pending`

### Recurring shift creation (multi-step)
**Step 1 — Details:**
- Date, start time, end time, location, instructions
- Multi-employee selection (checkboxes from active employees list)
- Recurrence radio buttons:
  - `NONE` — Single shift
  - `NEXT_WEEK` — Same day next week (2 shifts total)
  - `WEEKLY_END_OF_MONTH` — Every week until end of the month
  - `WEEKLY_CUSTOM_END` — Every week until a chosen end date
- "Keep same employees for all dates" checkbox (always checked currently)

**Step 2 — Review conflicts:**
- Calls `POST /api/shifts/recurring` with `action: "preview"`
- Generates list of dates using `generateRecurringDates()`
- For each date × employee, checks:
  - Employee active status
  - Availability for that day of week (day toggle + time range)
  - Overlapping existing shifts
- Displays per-date conflict cards with:
  - ✅ Available (green)
  - ⚠️ Conflict with existing shift (yellow) — with Override/Skip buttons
  - 🚫 Unavailable that day (orange) — with Override/Skip buttons
  - ❌ Inactive employee (red) — with Override/Skip buttons

**Step 3 — Confirm:**
- Summary of dates, times, employees
- Shows how many total shifts will be created
- "Publish Repeating Shifts" button or "Save as Draft" button
- Creates all shifts atomically via `POST /api/shifts/recurring` with `action: "create"`
- All recurring shifts share a `recurring_group_id` UUID
- Skipped conflicts are excluded; overridden conflicts are included

### Shift statuses
| Status | Meaning |
|---|---|
| `pending` | Created, waiting for employee response |
| `accepted` | Employee accepted, ready to start |
| `declined` | Employee declined |
| `completed` | Shift finished, timesheet generated |
| `cancelled` | Not implemented yet |

### Not yet implemented
- Editing existing shifts after creation
- Cancelling shifts
- Shift notifications to employees
- Draft vs published distinction (both create as `pending`)

---

## 11. Photo and Odometer System

### Start shift flow
1. Employee navigates to `/employee/start-shift/[shiftId]`
2. Takes photo of vehicle odometer (camera or file upload, `accept="image/*" capture="environment"`)
3. Enters odometer reading in km (numeric, step 0.1)
4. Submits form as multipart FormData

### Server processing (start)
1. Validates: shift exists, belongs to employee, status is `accepted`, not already started
2. Uploads photo to Supabase Storage bucket `odometer-photos` at path: `{employeeId}/{shiftId}/start_{timestamp}.{ext}`
3. Records server timestamp (`new Date().toISOString()`)
4. Creates `shift_attendance` record with `attendance_status: "working"`, `actual_start` = server time
5. Creates `odometer_submissions` record with `submission_type: "START"`, photo path, reading, server timestamp

### Finish shift flow
1. Employee navigates to `/employee/finish-shift/[shiftId]`
2. Takes photo of vehicle odometer
3. Enters odometer reading in km
4. Validates: finish reading ≥ start reading
5. Submits form as multipart FormData

### Server processing (finish)
1. Validates: shift exists, belongs to employee, attendance is `working`
2. Uploads photo to `{employeeId}/{shiftId}/finish_{timestamp}.{ext}`
3. Records server timestamp
4. Creates `odometer_submissions` record with `submission_type: "FINISH"`
5. Updates `shift_attendance`: `actual_finish` = server time, `attendance_status: "completed"`
6. Updates shift status to `completed`
7. Auto-generates timesheet (see Section 12-14)

### Storage
- **Bucket:** `odometer-photos` (private, created in migration)
- **Path pattern:** `{employeeId}/{shiftId}/{start|finish}_{timestamp}.{extension}`
- **Content type:** Detected from uploaded file, defaults to `image/jpeg`
- **upsert:** `false` (never overwrites)

### Not yet implemented
- EXIF metadata extraction (GPS location, camera timestamp)
- Photo viewing in the admin timesheet review page (submissions are fetched but photos not displayed)
- Fraud detection / mileage anomaly detection
- Photo compression or size limits

---

## 12. Working Hours Calculation

### Formula
```
workedMinutes = Math.round((actualFinish - actualStart) / 60000)
```

**Location:** `src/lib/calculations/time.ts`

- Uses actual timestamps (server-recorded), not scheduled times
- Rounded to nearest minute
- No special rules for breaks, overtime, or minimum hours

### Helper functions
- `calculateWorkedMinutes(actualStart: Date, actualFinish: Date)` → integer minutes
- `formatWorkedDuration(totalMinutes: number)` → `{ hours: number, minutes: number }`
- `minutesToDecimalHours(totalMinutes: number)` → `totalMinutes / 60` (e.g., 90 min → 1.5)

### Example
| Actual Start | Actual Finish | Worked |
|---|---|---|
| 2:05 PM | 7:35 PM | 5h 30m (330 min) |

---

## 13. Mileage Calculation

### Formula
```
distanceKm = endingOdometer - startingOdometer
```

**Location:** `src/lib/calculations/mileage.ts`

- `calculateMileage(startingOdometer: number, endingOdometer: number)` → number
- Throws an error if `endingOdometer < startingOdometer`
- Also validated on the API side before timesheet generation

### Example
| Start Odometer | End Odometer | Distance |
|---|---|---|
| 45,230 km | 45,280 km | 50 km |

---

## 14. Payroll Calculation

### Formulas

**Location:** `src/lib/calculations/payment.ts`

```
wageAmount     = round2((workedMinutes / 60) × hourlyRateSnapshot)
mileageAmount  = round2(distanceKm × mileageRateSnapshot)
estimatedTotal = round2(wageAmount + mileageAmount)
```

Where `round2(x) = Math.round(x * 100) / 100`

### Rate snapshots
When a timesheet is generated, the employee's **current** `hourly_rate` and `mileage_rate` are captured as `hourly_rate_snapshot` and `mileage_rate_snapshot`. This means if rates change later, historical timesheets keep the rate that was in effect when the shift was completed.

### Payment aggregation
When admin creates a payment for a period:
```
totalWages         = sum of all approved timesheets' wage_amount
totalMileageAmount = sum of all approved timesheets' mileage_amount
totalHours         = round2(totalMinutes / 60)
totalAmount        = round2(totalWages + totalMileageAmount)
```

### Payment statuses
- `unpaid` — Created, not yet paid
- `paid` — Marked by admin; records `payment_date` and `marked_paid_by`

### Who can change payment status
- Only admins can create payments and mark them as paid.
- Employees can only view their payments.

### Example
| Value | Calculation |
|---|---|
| Worked | 5h 30m (330 min) |
| Rate | $30.00/hr |
| Wages | (330/60) × 30 = $165.00 |
| Distance | 50 km |
| Mileage rate | $0.50/km |
| Mileage | 50 × 0.50 = $25.00 |
| **Estimated Total** | **$190.00** |

### Admin override
On timesheet approval, admin can optionally set `approved_total` to a different value from `estimated_total`. If not set, the estimated total is used.

---

## 15. Notifications

### Current status: NOT IMPLEMENTED

No notification system exists in the application. There are no:
- Email notifications
- Push notifications
- In-app notification feed
- SMS notifications

### Planned notification triggers (from spec)
| Trigger | Recipient | Type |
|---|---|---|
| New shift assigned | Employee | Push/email |
| Shift accepted/declined | Admin | In-app |
| Timesheet submitted | Admin | In-app |
| Timesheet approved | Employee | Push/email |
| Timesheet needs correction | Employee | Push/email |
| Payment created | Employee | Push/email |
| Payment marked as paid | Employee | Push/email |

---

## 16. Pages and Screens

### Public pages

| Path | Purpose | Components |
|---|---|---|
| `/login` | Login form (User ID + password) | — |
| `/change-password` | Force password change on first login | — |

### Admin pages

| Path | Purpose | Key Features |
|---|---|---|
| `/admin/dashboard` | Admin home with stats | Stats grid (employees, shifts, timesheets, payments), quick action links |
| `/admin/employees` | Employee list | Desktop table + mobile cards, status badges |
| `/admin/employees/new` | Create employee form | Name, phone, employee ID, rates, login credentials; success shows credentials |
| `/admin/employees/[id]` | Employee detail | Two tabs: Details (view/edit name, phone, rates; actions: disable/enable, reset password) and Availability (7-day weekly schedule with toggle + time range) |
| `/admin/roster` | Weekly roster grid | Employee × day table (desktop), day cards (mobile), week navigation |
| `/admin/shifts/new` | Create shift (single or recurring) | Multi-step flow: details → review conflicts → confirm |
| `/admin/timesheets` | Timesheet list | Status filter tabs (all/pending/approved/needs correction) |
| `/admin/timesheets/[id]` | Timesheet detail & review | Shift details, hours & distance, payment breakdown, approve/needs-correction buttons |
| `/admin/payments` | Payment list + create | Create payment form (employee + date range), payment cards |
| `/admin/payments/[id]` | Payment detail | Period, hours, mileage, wage/mileage breakdown, mark-as-paid button |

### Employee pages

| Path | Purpose | Key Features |
|---|---|---|
| `/employee/home` | Employee dashboard | Active shift alert (animated), earnings summary, upcoming shifts, recent timesheets, quick links |
| `/employee/shifts` | Shift list | All assigned shifts with dates, times, locations, statuses |
| `/employee/shifts/[id]` | Shift detail | Accept/decline (pending), start shift (accepted), finish shift (working), status messages |
| `/employee/start-shift/[id]` | Start shift form | Photo upload/capture, odometer reading input, confirm button |
| `/employee/finish-shift/[id]` | Finish shift form | Photo upload/capture, odometer reading input, confirm button; success shows timesheet summary |
| `/employee/timesheets` | Timesheet list | Date, time range, hours, distance, amounts, statuses |
| `/employee/payments` | Payment list | Period, hours, mileage, wage/mileage breakdown, totals |
| `/employee/profile` | Profile (read-only) | Avatar initial, name, employee number, phone, rates, status |

### Components

| Component | Purpose |
|---|---|
| `AdminNav` | Top navigation bar for admin pages (Dashboard, Employees, Roster, Timesheets, Payments, Sign Out). Responsive with hamburger menu. |
| `EmployeeNav` | Top navigation bar for employee pages (Home, My Shifts, Timesheets, Payments, Profile, Sign Out). Responsive with hamburger menu. |
| `StatusBadge` | Color-coded pill badge for any status string. Supports: active, inactive, disabled, pending, accepted, declined, working, completed, cancelled, submitted, approved, needs_correction, unpaid, paid. |

---

## 17. Important Files and Folders

```
src/
├── app/
│   ├── page.tsx                          # Root redirect (auth check → role-based routing)
│   ├── layout.tsx                        # Root HTML layout, global CSS import
│   ├── login/page.tsx                    # Login form
│   ├── change-password/page.tsx          # Force password change
│   ├── admin/
│   │   ├── layout.tsx                    # Auth guard (admin role + active status)
│   │   ├── dashboard/page.tsx            # Admin stats dashboard
│   │   ├── employees/
│   │   │   ├── page.tsx                  # Employee list
│   │   │   ├── new/page.tsx              # Create employee form
│   │   │   └── [id]/page.tsx             # Employee detail (edit, availability, actions)
│   │   ├── roster/page.tsx               # Weekly roster grid
│   │   ├── shifts/new/page.tsx           # Create shift (single + recurring multi-step)
│   │   ├── timesheets/
│   │   │   ├── page.tsx                  # Timesheet list with filters
│   │   │   └── [id]/page.tsx             # Timesheet review detail
│   │   └── payments/
│   │       ├── page.tsx                  # Payment list + create form
│   │       └── [id]/page.tsx             # Payment detail + mark paid
│   ├── employee/
│   │   ├── layout.tsx                    # Auth guard (employee role + active + password changed)
│   │   ├── home/page.tsx                 # Employee dashboard
│   │   ├── shifts/
│   │   │   ├── page.tsx                  # Shift list
│   │   │   └── [id]/page.tsx             # Shift detail (accept/decline/start/finish)
│   │   ├── start-shift/[id]/page.tsx     # Start shift (photo + odometer)
│   │   ├── finish-shift/[id]/page.tsx    # Finish shift (photo + odometer + summary)
│   │   ├── timesheets/page.tsx           # Employee timesheet list
│   │   ├── payments/page.tsx             # Employee payment list
│   │   └── profile/page.tsx              # Read-only profile
│   └── api/
│       ├── auth/
│       │   ├── setup-admin/route.ts      # One-time admin bootstrap
│       │   └── password-changed/route.ts # Clear must_change_password flag
│       ├── employees/
│       │   ├── route.ts                  # GET list, POST create (auth user + users + employees)
│       │   └── [id]/
│       │       ├── route.ts              # GET detail, PUT update, POST actions (disable/enable/reset-password)
│       │       └── availability/route.ts # GET/PUT weekly availability (delete-and-reinsert)
│       ├── shifts/
│       │   ├── route.ts                  # GET list (role-aware, date range), POST create single
│       │   ├── [id]/
│       │   │   ├── route.ts              # GET detail, PUT accept/decline
│       │   │   ├── start/route.ts        # POST start shift (photo upload, attendance, odometer)
│       │   │   └── finish/route.ts       # POST finish shift (photo, attendance, auto-timesheet)
│       │   └── recurring/route.ts        # POST preview conflicts OR create recurring shifts
│       ├── timesheets/
│       │   ├── route.ts                  # GET list (role-aware, status filter)
│       │   └── [id]/route.ts             # GET detail, PUT approve/needs_correction
│       ├── payments/
│       │   ├── route.ts                  # GET list (role-aware), POST create from approved timesheets
│       │   └── [id]/route.ts             # GET detail, PUT mark_paid
│       ├── dashboard/
│       │   ├── admin/route.ts            # GET admin stats
│       │   └── employee/route.ts         # GET employee stats
│       └── profile/route.ts              # GET employee profile
├── components/
│   ├── AdminNav.tsx                      # Admin navigation bar
│   ├── EmployeeNav.tsx                   # Employee navigation bar
│   └── StatusBadge.tsx                   # Reusable colored status pill
├── lib/
│   ├── supabase/
│   │   ├── client.ts                     # Browser Supabase client (anon key)
│   │   ├── server.ts                     # Server Supabase client (cookies + anon key)
│   │   └── admin.ts                      # Admin Supabase client (service role key, bypasses RLS)
│   ├── services/
│   │   └── recurringShift.ts             # Recurring date generation, conflict detection
│   ├── calculations/
│   │   ├── time.ts                       # Worked minutes, duration formatting
│   │   ├── mileage.ts                    # Mileage calculation
│   │   └── payment.ts                    # Wage, mileage amount, total calculation
│   └── validation/                       # (empty — placeholder for future validators)
├── types/
│   ├── database.ts                       # Supabase-generated TypeScript types for all tables
│   └── index.ts                          # App-level enums (Role, ShiftStatus, etc.) and ApiResponse type
├── middleware.ts                          # Refreshes Supabase auth session on every request
└── globals.css                           # Tailwind CSS imports

supabase/
└── migrations/
    ├── 001_initial_schema.sql            # All tables, enums, indexes, RLS, storage bucket
    └── 002_recurring_shifts.sql          # Recurring shift columns + recurrence_type enum
```

---

## 18. Environment Variables

| Variable | Used By | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + Server clients | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + Server clients | Supabase anon/public key (safe for browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin client (server-only) | Bypasses RLS, never exposed to browser |

**⚠️ NEVER put actual keys, passwords, or secrets in this file.**

### Where configured
- **Local development:** `.env.local` file (git-ignored)
- **Vercel:** Project Settings → Environment Variables

---

## 19. Security

### Authentication security
- Supabase Auth handles password hashing and session tokens.
- Passwords are never stored or exposed by the application.
- Session cookies are httpOnly, managed by Supabase SSR library.
- Middleware refreshes sessions on every request.

### Authorization
- Every API route checks `supabase.auth.getUser()` first.
- After auth, the API looks up the app-level `users` record to determine role and business_id.
- Admin routes verify `role === "admin"`.
- Employee routes verify `role === "employee"`.
- Cross-business access is prevented by checking `business_id` on every query.

### Row Level Security (RLS)
All tables have RLS enabled with policies that ensure:
- Admins can only see data belonging to their `business_id`.
- Employees can only see their own data.
- RLS is the database-level safety net; the API layer also checks permissions.

### Admin-only actions
- Create/edit/disable employees
- Set availability
- Create/edit shifts
- Approve/reject timesheets
- Create payments, mark as paid

### Employee restrictions
- Cannot create, edit, or delete any records except:
  - Accept/decline own pending shifts
  - Start/finish own shifts (creates attendance + odometer records)
- Cannot view other employees' data.
- Cannot edit their own profile.

### Service role key
- Only used in `src/lib/supabase/admin.ts` (server-side only).
- Never imported or referenced in client components.
- `SUPABASE_SERVICE_ROLE_KEY` is not prefixed with `NEXT_PUBLIC_` so Next.js never bundles it into client code.

### Known security concerns
1. **No rate limiting** — API routes have no rate limiting; brute-force login attempts are possible (mitigated somewhat by Supabase Auth's built-in rate limiting).
2. **No CSRF protection** — API routes use simple `fetch()` without CSRF tokens (mitigated by Supabase session cookies being SameSite).
3. **No input sanitization** — Text inputs (location, instructions, employee names) are not sanitized for XSS; React's JSX escaping provides protection for rendered content.
4. **Photo uploads not validated** — File type is based on the `Content-Type` header from the upload; no server-side verification that the file is actually an image.
5. **Availability delete-and-reinsert** — `PUT /api/employees/[id]/availability` deletes all existing rows and re-inserts; a failure partway through could leave incomplete data.
6. **No audit logging** — Admin actions (disable employee, approve timesheet, mark paid) are not logged in an audit trail.

---

## 20. Current Problems / Technical Debt

### Known bugs
- None currently identified (basic flows work end-to-end).

### Temporary implementations
1. **`any` type casts** — `timesheets/[id]/route.ts` uses `as { data: any }` to work around TypeScript join type issues.
2. **eslint-disable comments** — `recurringShift.ts` and `recurring/route.ts` have `@typescript-eslint/no-explicit-any` disables.
3. **Draft shifts** — The "Save as Draft" button on recurring shift creation doesn't actually set a different status; all shifts are created as `pending`.

### Missing validation
1. **Date validation** — Shift creation doesn't prevent creating shifts in the past.
2. **Time validation** — No check that `scheduled_finish > scheduled_start` (or that shifts don't span midnight).
3. **Odometer reading validation** — Only checks non-negative and finish ≥ start; no sanity check for unreasonable values.
4. **Employee number uniqueness** — Enforced at DB level but error message is generic.
5. **Concurrent shift starts** — No pessimistic locking; two requests could theoretically both pass the "not already started" check.

### Missing features
1. **Odometer photo display** — Timesheet detail API fetches odometer submissions but the admin review page doesn't display the actual photos.
2. **Timezone handling** — All dates/times use JavaScript's default Date behavior; AEST conversion is not explicitly handled.
3. **Pagination** — No pagination on any list endpoint; all records are returned.
4. **Search/filter** — Employee list has no search; shift list has no employee filter.
5. **Error recovery** — Employee creation has a rollback pattern, but shift finish does not roll back attendance if timesheet creation fails (intentional — returns partial success message).

### Code quality
1. **Duplicated auth boilerplate** — Every API route has the same 10+ lines to check auth and get appUser. Could be extracted into a middleware or helper.
2. **No testing** — Zero test files. No unit tests, integration tests, or end-to-end tests.
3. **No loading skeletons** — All pages show "Loading…" text instead of skeleton UI.
4. **Validation library** — `src/lib/validation/` directory exists but is empty; validation is inline in API routes.

---

## 21. Deployment

### Current deployment
- **Live URL:** https://workforce-app-sigma-rouge.vercel.app
- **GitHub repo:** https://github.com/sirtonmoy00123-star/workforce-app (public)
- **Vercel account:** sirtonmoy00123-star
- **Supabase project:** rqnevhgkfvkmspmtnera

### How updates reach production
```
1. Edit code locally
2. git add + git commit
3. git push origin main
4. Vercel auto-detects the push and starts a build
5. Vercel runs `npm run build` (Next.js production build)
6. If build succeeds → deployed to production URL
7. If build fails → previous deployment stays live
```

### Supabase configuration
- **Auth URL Configuration:**
  - Site URL: `https://workforce-app-sigma-rouge.vercel.app`
  - Redirect URLs: `https://workforce-app-sigma-rouge.vercel.app/**`
- **Storage:** `odometer-photos` bucket (private, RLS-protected)

### Local development
```bash
# Install dependencies
npm install

# Create .env.local with:
# NEXT_PUBLIC_SUPABASE_URL=https://rqnevhgkfvkmspmtnera.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
# SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

# Start dev server
npm run dev
# → http://localhost:3000
```

---

## 22. Development History

| Decision | Rationale |
|---|---|
| Next.js 16 App Router | Latest framework with server components support, good Supabase integration |
| Three Supabase clients | Browser (auth only), Server (session cookies), Admin (bypass RLS for trusted server operations) |
| Admin client for data operations | Server-side permission checks + admin client ensures consistent access without fighting RLS policy complexity |
| `userId@workforce.app` email format | Allows employees to login with simple user IDs while Supabase Auth requires email format |
| Rate snapshots on timesheets | Prevents retroactive changes when admin updates employee rates |
| Server timestamps for attendance | `new Date().toISOString()` on the server, not client-submitted times, to prevent tampering |
| Recurring shift `recurring_group_id` | UUID links all shifts in a recurrence group for future bulk operations |
| Delete-and-reinsert for availability | Simpler than upsert logic for 7-day availability |
| Client-side rendering for all pages | Simpler state management with `useState`/`useEffect`; server components only for auth guard layouts |
| Photo upload via FormData | Standard multipart approach; Supabase Storage handles the rest |
| Atomic bulk insert for recurring shifts | All shifts in a recurrence group are inserted in one Supabase call |

---

## 23. Next Development Priorities

1. **Phase 13: End-to-end test** — Run the complete "John Smith" scenario from the spec. Verify every step works from employee creation through payment.
2. **Display odometer photos** — Show start/finish photos on the admin timesheet review page.
3. **Shift editing & cancellation** — Allow admins to edit shift details or cancel shifts after creation.
4. **Timezone handling** — Implement proper AEST (Australia/Sydney) conversion for display and storage.
5. **Date/time validation** — Prevent past dates, validate finish > start time, handle edge cases.
6. **Pagination** — Add cursor/offset pagination to all list endpoints.
7. **Notification system** — At minimum, in-app notifications for new shifts and timesheet status changes.
8. **Extract auth boilerplate** — Create a shared middleware/helper for the repeated auth + appUser lookup pattern.
9. **Input validation library** — Populate `src/lib/validation/` with reusable validators.
10. **Automated tests** — Unit tests for calculation helpers, integration tests for API routes.
11. **Audit logging** — Track admin actions (who approved what, when).
12. **Loading skeletons** — Replace "Loading…" text with proper skeleton UI components.

---

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
