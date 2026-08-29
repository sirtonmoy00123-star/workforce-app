# Workforce App — Full Architecture

> **Version:** 2.0 (Post Phase 1–5 Core Reliability Upgrade)  
> **Last updated:** 2026-08-28  
> **Production URL:** https://workforce-app-sigma-rouge.vercel.app  
> **Repository:** github.com/sirtonmoy00123-star/workforce-app

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Folder Structure](#3-folder-structure)
4. [Database Schema](#4-database-schema)
5. [Security Model](#5-security-model)
6. [Authentication Flow](#6-authentication-flow)
7. [Multi-Tenant (SaaS) Architecture](#7-multi-tenant-saas-architecture)
8. [API Routes](#8-api-routes)
9. [Pages & UI](#9-pages--ui)
10. [Business Logic Services](#10-business-logic-services)
11. [Calculation Engine](#11-calculation-engine)
12. [Key Workflows](#12-key-workflows)
13. [Attendance System](#13-attendance-system)
14. [Event Staffing System](#14-event-staffing-system)
15. [Task Proof System](#15-task-proof-system)
16. [Notification System](#16-notification-system)
17. [Storage Buckets](#17-storage-buckets)
18. [Database Migrations](#18-database-migrations)
19. [Environment Variables](#19-environment-variables)
20. [Deployment](#20-deployment)

---

## 1. Overview

A **multi-tenant workforce management SaaS** for small businesses. Covers the full employee lifecycle:

```
Admin creates employee → Assigns shifts → Employee accepts →
Check-in (QR + GPS + selfie) → Start shift (odometer) →
Task proof (photos) → Finish shift (odometer) → Check-out →
Auto-generate timesheet → Admin approves → Mark paid
```

Three user roles:
- **Platform Admin** — manages all businesses (super admin)
- **Business Admin** — manages one business (employees, shifts, timesheets, payments)
- **Employee** — accepts shifts, checks in/out, uploads proof, views timesheets/payments

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.3.1 |
| UI | React + TypeScript | 19.2.8 / 5.x |
| Styling | Tailwind CSS | 4.x |
| Database | Supabase (PostgreSQL) | - |
| Auth | Supabase Auth | - |
| Storage | Supabase Storage | - |
| QR Generation | qrcode.react | 4.2.0 |
| QR Scanning | jsQR | 1.4.0 |
| Hosting | Vercel | - |

---

## 3. Folder Structure

```
src/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Root — redirects by role
│   ├── layout.tsx                # Root layout
│   ├── login/page.tsx            # Login page
│   ├── change-password/page.tsx  # First-login password change
│   │
│   ├── admin/                    # Admin pages
│   │   ├── dashboard/page.tsx    # Admin home — stats + quick actions
│   │   ├── employees/            # CRUD: list, new, [id] detail
│   │   ├── roster/page.tsx       # Weekly roster grid + shift creation
│   │   ├── shifts/new/page.tsx   # Standalone shift creation
│   │   ├── timesheets/           # List + [id] review/approve
│   │   ├── payments/             # List + [id] mark paid
│   │   ├── events/               # Event staffing: list, new, [id], edit, find-workers
│   │   ├── locations/page.tsx    # Work locations management
│   │   ├── attendance/           # Attendance reviews: list, [id] detail, reports
│   │   ├── task-proof-templates/ # Reusable proof templates
│   │   └── notifications/        # Admin notifications
│   │
│   ├── employee/                 # Employee pages
│   │   ├── shifts/               # Shift list (today-first) + [id] detail (progressive flow)
│   │   ├── start-shift/[id]/     # Start shift (odometer capture)
│   │   ├── finish-shift/[id]/    # Finish shift (odometer + timesheet generation)
│   │   ├── checkin/[shiftId]/    # Multi-step check-in (QR → GPS → selfie)
│   │   ├── checkout/[shiftId]/   # Multi-step check-out
│   │   ├── attendance/           # Attendance history
│   │   ├── offers/               # Open shift offers
│   │   ├── timesheets/           # View timesheets + [id] detail
│   │   ├── payments/             # Payment history
│   │   ├── profile/              # Employee profile
│   │   ├── home/                 # Dashboard (legacy, redirects to shifts)
│   │   └── notifications/        # Employee notifications
│   │
│   ├── platform/                 # Platform admin pages
│   │   ├── home/                 # Platform dashboard
│   │   └── businesses/           # Manage all businesses: list, new, [id]
│   │
│   └── api/                      # API routes (see Section 8)
│
├── components/                   # Shared UI components
│   ├── AdminNav.tsx              # Admin navigation bar
│   ├── EmployeeNav.tsx           # Employee navigation bar
│   ├── PlatformNav.tsx           # Platform admin navigation
│   └── StatusBadge.tsx           # Colored status badge component
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Browser Supabase client (anon key)
│   │   ├── server.ts             # Server Supabase client (cookie-based auth)
│   │   └── admin.ts              # Admin Supabase client (service role, bypasses RLS)
│   │
│   ├── services/                 # Business logic layer
│   │   ├── tenantContext.ts      # Tenant isolation — derives business_id from session
│   │   ├── workSessionService.ts # Start/finish work (uses atomic RPC)
│   │   ├── payableTime.ts        # Payable time engine (pure function)
│   │   ├── shiftStateMachine.ts  # Lifecycle state machine + guard functions
│   │   ├── timesheetService.ts   # Timesheet calc + correction recalculation
│   │   ├── auditService.ts       # Audit event logging
│   │   ├── shiftValidation.ts    # Shift assignment validation (overlap, availability)
│   │   ├── recurringShift.ts     # Recurring shift generation
│   │   ├── dynamicQr.ts          # Dynamic QR code generation + validation
│   │   └── notificationService.ts# In-app notification creation
│   │
│   ├── calculations/             # Pure calculation functions
│   │   ├── time.ts               # Worked hours, overtime
│   │   ├── mileage.ts            # Distance from odometer readings
│   │   ├── payment.ts            # Wage + mileage payment (rate snapshots)
│   │   ├── timezone.ts           # IANA timezone conversions, DST-safe
│   │   └── geo.ts                # Haversine distance for GPS
│   │
│   └── validation/               # Zod input validation schemas
│       ├── shift.schema.ts       # Shift create/edit/recurring schemas
│       ├── attendance.schema.ts  # Check-in/check-out schemas
│       ├── workSession.schema.ts # File validation (size, MIME, magic bytes)
│       ├── timesheet.schema.ts   # Approval + correction schemas
│       └── errors.ts             # Standardized error codes & responses
│
├── types/
│   ├── index.ts                  # App-level TypeScript types
│   └── database.ts               # Supabase generated types
│
└── middleware.ts                 # Session refresh middleware

supabase/
└── migrations/                   # 17 SQL migration files (see Section 18)
```

---

## 4. Database Schema

### Core Tables

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│   businesses    │────<│ business_members  │>────│      users         │
│                 │     │ (role: OWNER/     │     │ (auth_user_id →    │
│ business_name   │     │  ADMIN/EMPLOYEE)  │     │  auth.users)       │
│ slug, timezone  │     │                  │     │ role, username     │
│ currency        │     └──────────────────┘     │ must_change_password│
└─────────────────┘                              └────────────────────┘
        │                                                │
        │                                    ┌───────────┘
        ▼                                    ▼
┌─────────────────┐     ┌──────────────────────────────────┐
│   employees     │     │           shifts                 │
│                 │     │                                  │
│ full_name       │<────│ employee_id                      │
│ employee_number │     │ date, scheduled_start/finish     │
│ hourly_rate     │     │ location (text), location_id (FK)│
│ mileage_rate    │     │ status: pending → accepted →     │
│ odometer_enabled│     │         working → completed      │
│ task_proof_on   │     │ require_odometer (per-shift)     │
│ employment_type │     │ event_id (FK, nullable)          │
└─────────────────┘     └──────────────────────────────────┘
        │                        │              │
        │                        │              │
        ▼                        ▼              ▼
┌──────────────────┐  ┌──────────────────┐  ┌─────────────────────┐
│employee_availability│ work_sessions    │  │ odometer_submissions│
│                  │  │                  │  │                     │
│ day_of_week (0-6)│  │ actual_start     │  │ submission_type     │
│ start_time       │  │ actual_finish    │  │ (START / FINISH)    │
│ end_time         │  │ payable_start_at │  │ photo_path          │
│ is_available     │  │ payable_finish_at│  │ odometer_reading    │
└──────────────────┘  └──────────────────┘  └─────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐     ┌─────────────────┐
                    │   timesheets     │────>│    payments      │
                    │                  │     │                  │
                    │ worked_minutes   │     │ employee_id      │
                    │ distance_km      │     │ week_start       │
                    │ wage_amount      │     │ total_amount     │
                    │ mileage_amount   │     │ status: unpaid → │
                    │ total_amount     │     │         paid     │
                    │ status: submitted│     └─────────────────┘
                    │  → approved      │
                    │  → needs_correction│
                    └──────────────────┘
```

### Attendance Tables

```
┌─────────────────────┐      ┌──────────────────────────┐
│   work_locations     │─────>│   attendance_settings    │
│                      │      │                          │
│ name, address        │      │ attendance_required      │
│ latitude, longitude  │      │ qr_required, qr_mode     │
│ status (ACTIVE/      │      │ gps_required             │
│         ARCHIVED)    │      │ allowed_radius_metres    │
└─────────────────────┘      │ selfie_required          │
         │                    │ early_checkin_minutes    │
         │                    │ late_grace_minutes       │
         ▼                    │ checkout_method          │
┌──────────────────────────┐  │ early_departure_minutes  │
│   attendance_records     │  │ late_departure_minutes   │
│                          │  └──────────────────────────┘
│ shift_id, employee_id   │
│ actual_checkin/checkout  │
│ checkin_status:          │
│   NOT_CHECKED_IN         │
│   PRESENT / LATE         │
│   NEEDS_REVIEW / ABSENT  │
│ checkout_status:         │
│   NOT_CHECKED_OUT        │
│   CHECKED_OUT            │
│   EARLY/LATE_DEPARTURE   │
│ qr_verified              │
│ checkin_latitude/longitude│
│ checkin_distance_metres  │
│ selfie_path, site_photo  │
│ verification_status:     │
│   PENDING / VERIFIED     │
│   REJECTED               │
│ requires_review          │
└──────────────────────────┘
         │
         ▼
┌──────────────────────────┐
│ attendance_exceptions    │
│                          │
│ exception_type:          │
│   LATE_ARRIVAL           │
│   EARLY_DEPARTURE        │
│   GPS_OUT_OF_RANGE       │
│   QR_NOT_VERIFIED        │
│   OVERTIME               │
│ severity: INFO/WARNING/  │
│           CRITICAL       │
│ admin_action: PENDING/   │
│   APPROVED/REJECTED      │
└──────────────────────────┘
```

### Event Staffing Tables

```
┌────────────────────┐     ┌─────────────────────────────┐
│ staffing_events    │────>│ event_staffing_requirements  │
│                    │     │                              │
│ name, event_date   │     │ role_name, required_count    │
│ location           │     │ filled_count, hourly_rate    │
│ status: DRAFT →    │     └─────────────────────────────┘
│   OPEN → FILLED    │
└────────────────────┘
         │
         ▼
┌──────────────────────────┐     ┌────────────────────────────┐
│  open_shift_offers       │────>│ open_shift_offer_recipients │
│                          │     │                             │
│ requirement_id           │     │ employee_id                 │
│ shift_date, start/end    │     │ status: PENDING → ACCEPTED  │
│ status: OPEN → FILLED    │     │         / DECLINED / EXPIRED│
│ filled_count             │     └────────────────────────────┘
└──────────────────────────┘
```

### Task Proof Tables

```
┌─────────────────────────┐     ┌──────────────────────────────┐
│ task_proof_templates     │────>│ task_proof_template_items    │
│ (reusable configs)       │     │                              │
│ name, description        │     │ proof_type: BEFORE/DURING/   │
└─────────────────────────┘     │             AFTER/OTHER      │
                                 │ minimum_photos, maximum      │
                                 │ is_required                  │
                                 │ allow_finish_without_proof   │
                                 └──────────────────────────────┘

┌──────────────────────────┐     ┌──────────────────────────────┐
│ task_proof_requirements  │────>│ task_proof_submissions       │
│ (per-shift config)       │     │                              │
│                          │     │ photo_path, photo_url        │
│ shift_id, proof_type     │     │ employee_note                │
│ min/max photos           │     │ status: SUBMITTED → APPROVED │
│ is_required              │     │         / CORRECTION_REQUIRED│
│ allow_finish_without     │     │         / REPLACED           │
└──────────────────────────┘     └──────────────────────────────┘
```

### Audit & Support Tables

```
shift_audit_log          — Every shift edit/delete with before/after values
static_qr_credentials   — Per-location QR code tokens
notifications            — In-app notification messages
timesheet_corrections    — Admin correction notes on timesheets
```

### Key Enums

| Enum | Values |
|------|--------|
| `user_role` | `admin`, `employee` |
| `shift_status` | `pending`, `accepted`, `declined`, `completed`, `cancelled`, `updated_pending` |
| `attendance_status` | `pending`, `working`, `completed` |
| `timesheet_status` | `submitted`, `approved`, `needs_correction` |
| `payment_status` | `unpaid`, `paid` |
| `proof_type` | `BEFORE`, `DURING`, `AFTER`, `OTHER` |
| `employment_type` | `PERMANENT`, `PART_TIME`, `CASUAL` |

---

## 5. Security Model

### Two-Layer Security (always both)

```
Layer 1: PostgreSQL RLS    — Database enforces row-level access
Layer 2: Server-side API   — tenantContext.ts validates before any DB call
```

### Tenant Isolation

```typescript
// tenantContext.ts — the ONLY way server code learns which business
const ctx = await requireMember();  // returns { businessId, userId, role, employeeId }

// business_id is NEVER accepted from:
// ✗ request body
// ✗ query string
// ✗ form field
// ✗ URL parameter

// It is ALWAYS derived from:
// ✓ auth session → users table → business_members table
```

### RLS Policies (per table)

Every table has `ENABLE ROW LEVEL SECURITY` and policies like:
```sql
-- Employees can only see their own business's data
CREATE POLICY "employees_select" ON shifts
  FOR SELECT USING (
    business_id = (SELECT business_id FROM business_members
                   WHERE user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
                   LIMIT 1)
  );
```

### Two ID Systems

```
auth.users.id  (auth_user_id)  ← Supabase Auth UUID
public.users.id (userId)       ← App-level UUID
                                  THESE ARE DIFFERENT!
```

### Admin Client vs Regular Client

| Client | Used For | RLS |
|--------|---------|-----|
| `createClient()` | Browser-side, cookie auth | ✅ Enforced |
| `await createClient()` (server) | Server components, session refresh | ✅ Enforced |
| `createAdminClient()` | API routes (service role) | ❌ Bypassed — server validates manually |

---

## 6. Authentication Flow

```
User visits / ──→ middleware.ts refreshes session
                  │
                  ▼
              page.tsx checks auth
                  │
          ┌───────┼───────┐
          ▼       ▼       ▼
      No user  Admin    Employee
          │       │       │
          ▼       ▼       ▼
       /login  /admin/  /employee/
               dashboard  shifts

First login ──→ must_change_password = true ──→ /change-password
                After changing ──→ normal redirect
```

### Password Management
- Admin creates employee with temporary password
- Employee **must** change password on first login
- Supabase Auth stores passwords (app never sees them after creation)
- No self-registration — admin-only account creation

---

## 7. Multi-Tenant (SaaS) Architecture

```
Platform Admin
    │
    ├── Business A (tenant)
    │   ├── Admin users
    │   └── Employee users
    │
    ├── Business B (tenant)
    │   ├── Admin users
    │   └── Employee users
    │
    └── Business C (tenant)
        └── ...
```

### Tenant Boundaries

- Every data table has `business_id` column
- RLS policies enforce tenant boundaries at the database level
- Server-side `tenantContext.ts` adds a second validation layer
- Cross-tenant data access is impossible at both layers

### Platform Admin

- `is_platform_admin = true` on users table
- Can view/manage all businesses
- Separate `/platform/*` routes and API endpoints

---

## 8. API Routes

### Auth & Profile

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/setup-admin` | Initial admin account creation |
| POST | `/api/auth/password-changed` | Mark password as changed |
| GET/PUT | `/api/profile` | Employee profile (get/update) |

### Employees

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/employees` | List employees (admin) |
| POST | `/api/employees` | Create employee (admin) |
| GET/PUT | `/api/employees/[id]` | Get/update employee |
| GET/PUT | `/api/employees/[id]/availability` | Weekly availability |

### Shifts

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/shifts` | List shifts (filtered by role) |
| POST | `/api/shifts` | Create shift (admin) |
| GET/PUT/DELETE | `/api/shifts/[id]` | Shift CRUD, accept/decline |
| POST | `/api/shifts/[id]/start` | Start shift (+ odometer) |
| POST | `/api/shifts/[id]/finish` | Finish shift (+ timesheet gen) |
| POST | `/api/shifts/recurring` | Create recurring shifts |

### Roster

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/roster/available-employees` | Employees available for a day |
| POST | `/api/roster/copy-week` | Copy roster week |

### Timesheets & Payments

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/timesheets` | List timesheets |
| GET/PUT | `/api/timesheets/[id]` | Review/approve timesheet |
| GET/POST | `/api/timesheets/[id]/corrections` | Correction notes |
| POST | `/api/timesheets/[id]/corrections/submit` | Submit corrections |
| GET | `/api/payments` | List payment groups |
| GET/PUT | `/api/payments/[id]` | Mark payment as paid |

### Attendance

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/attendance/status` | Get shift attendance status |
| POST | `/api/attendance/checkin` | Employee check-in (QR + GPS + selfie) |
| POST | `/api/attendance/checkout` | Employee check-out |
| GET | `/api/attendance/reviews` | Admin: list attendance for review |
| GET/PUT | `/api/attendance/reviews/[id]` | Admin: review/approve attendance |
| GET | `/api/attendance/roster` | Attendance roster view |
| GET | `/api/attendance/reports` | Attendance reports |
| GET/PUT | `/api/attendance-settings` | Per-location attendance config |

### Work Locations & QR

| Method | Route | Description |
|--------|-------|-------------|
| GET/POST | `/api/work-locations` | CRUD work locations |
| GET/PUT | `/api/work-locations/[id]` | Single location |
| GET/POST | `/api/static-qr` | Static QR codes per location |
| DELETE | `/api/static-qr/[id]` | Delete static QR |
| POST | `/api/dynamic-qr` | Generate rotating dynamic QR |
| POST | `/api/dynamic-qr/validate` | Validate a dynamic QR token |

### Task Proof

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/task-proof/requirements` | Get proof requirements for shift |
| GET | `/api/task-proof/submissions` | Get proof submissions for shift |
| POST | `/api/task-proof/submit` | Upload proof photo |
| PUT | `/api/task-proof/[id]/correct` | Upload replacement photo |
| GET/POST | `/api/task-proof/templates` | Reusable proof templates |

### Events & Offers

| Method | Route | Description |
|--------|-------|-------------|
| GET/POST | `/api/events` | List/create staffing events |
| GET/PUT | `/api/events/[id]` | Event detail/update |
| GET | `/api/events/[id]/find-workers` | Find available workers |
| POST | `/api/events/[id]/assign` | Direct-assign worker |
| POST | `/api/events/[id]/send-offer` | Send open shift offer |
| GET | `/api/offers/my` | Employee: my open offers |
| POST | `/api/offers/[id]/respond` | Accept/decline offer |

### Dashboard & Notifications

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/dashboard/admin` | Admin dashboard stats |
| GET | `/api/dashboard/employee` | Employee dashboard stats |
| GET/PUT | `/api/notifications` | List/mark-read notifications |

### Platform Admin

| Method | Route | Description |
|--------|-------|-------------|
| GET/POST | `/api/platform/businesses` | List/create businesses |
| GET/PUT | `/api/platform/businesses/[id]` | Manage single business |
| GET | `/api/platform/stats` | Platform-wide statistics |

---

## 9. Pages & UI

### Navigation Components

| Component | Used By | Links |
|-----------|---------|-------|
| `AdminNav` | `/admin/*` | Dashboard, Employees, Roster, Timesheets, Payments, Events, Locations, Attendance |
| `EmployeeNav` | `/employee/*` | My Shifts, Offers, Attendance, Timesheets, Payments, Profile |
| `PlatformNav` | `/platform/*` | Home, Businesses |

### Mobile-First Design
- All pages use Tailwind CSS responsive utilities
- Employee pages optimized for phone screens
- Admin roster uses a weekly grid view
- Touch-friendly buttons (py-3.5+ padding)

### Key UI Patterns
- **StatusBadge** — colored pill for shift/timesheet/payment status
- **Progressive shift detail** — phase-based rendering (check-in → start → working → done)
- **Today highlight** — blue border + "TODAY" badge on shifts list
- **Step indicators** — numbered progress bar on check-in and shift detail

---

## 10. Business Logic Services

### `tenantContext.ts`
The **single source of truth** for tenant isolation:

```typescript
requireMember()    // Any authenticated user — returns BusinessContext
requireAdmin()     // Must be OWNER or ADMIN role
requireRole("EMPLOYEE")  // Must be specific role
handleTenantError(err)   // Standardized error responses
```

### `shiftValidation.ts`
Validates shift assignments before creation/update:
- Employee availability check (day of week + time window)
- Overlap detection (excludes self for edits)
- Employment status check (active only)
- Shift worked check (can't edit completed/started shifts)
- Returns `{ valid, errors[], warnings[] }`

### `recurringShift.ts`
Generates recurring shifts from a template:
- Weekly repetition across a date range
- Respects employee availability
- Skips existing shifts on the same date

### `dynamicQr.ts`
Dynamic QR code system for attendance:
- Generates time-limited tokens
- Validates token freshness and location binding
- Format: `WFA:DYN:<locationId>:<timestamp>:<hash>`

### `notificationService.ts`
Creates in-app notifications:
- Triggered by shift assignment, approval, correction requests
- Unread count badge on navigation

---

## 11. Calculation Engine

### `time.ts` — Worked Hours
```typescript
calculateWorkedMinutes(actualStart, actualFinish) → number
// Returns total minutes worked (server timestamps)
```

### `mileage.ts` — Distance
```typescript
calculateMileage(startReading, endReading) → number
// Returns km driven (end minus start odometer)
```

### `payment.ts` — Pay Calculation
```typescript
calculatePayment(workedMinutes, distanceKm, hourlyRateSnapshot, mileageRateSnapshot) → {
  wageAmount,      // (workedMinutes / 60) × hourlyRateSnapshot
  mileageAmount,   // distanceKm × mileageRateSnapshot
  totalAmount      // wage + mileage (round to 2 decimal places)
}
// Uses RATE SNAPSHOTS — never the employee's current rate
```

### `timezone.ts` — IANA Timezone Conversions
```typescript
localToUtc(date, time, timezone) → ISO string
utcToLocal(isoString, timezone) → { date, time }
buildShiftTimestamps(date, startTime, endTime, timezone) → { scheduledStart, scheduledFinish }
// Handles DST transitions and overnight shifts correctly
```

### `payableTime.ts` — Payable Time Engine
```typescript
calculatePayableTime(input, policy) → {
  payableStartAt, payableFinishAt,
  actualWorkedMinutes, payableWorkedMinutes,
  paidBreakMinutes, unpaidBreakMinutes,
  adjustments[]
}
// Pure function. Supports: EXACT_TIME, NEAREST_5/10/15/30 rounding,
// early-start capping, break deduction. Never queries the database.
```

### `geo.ts` — GPS Distance
```typescript
haversineDistance(lat1, lng1, lat2, lng2) → metres
// Used for attendance geofencing
```

### Single Calculation Path (Phase 5J)
```
Work Session → Payable Time Engine → Mileage Engine → Payment Engine → Timesheet Snapshot
```
No competing wage calculations exist. UI components display calculated results only.

---

## 12. Key Workflows

### Shift Lifecycle (State Machine)

```
Admin creates shift (pending)
    │
    ▼
Employee sees on shift list
    │
    ├── Accept → status: accepted
    │   │
    │   ├── [Admin edits material details] → updated_pending
    │   │   └── Employee must re-accept before any work action
    │   │
    │   ├── [If attendance required] Check In (QR → GPS → Selfie)
    │   │   └── Creates attendance_record (presence evidence only)
    │   │
    │   ├── Start Shift (+ odometer photo if enabled)
    │   │   └── Creates work_session: status = working
    │   │       (Check-in ≠ Start Work — separate by design)
    │   │
    │   ├── [During] Upload task proof photos (if configured)
    │   │
    │   ├── Finish Shift (+ odometer photo if enabled)
    │   │   └── Atomic RPC: complete_work_session()
    │   │       ├── Updates work_session: status = completed
    │   │       ├── Calculates payable time (via engine)
    │   │       ├── Creates timesheet: status = submitted
    │   │       ├── Updates shift: status = completed
    │   │       └── Inserts audit event
    │   │       (Single transaction — all or nothing)
    │   │
    │   └── [If attendance required] Check Out
    │
    ├── Decline → status: declined
    └── Admin Cancel → status: cancelled
```

**Guard functions** (`shiftStateMachine.ts`):
- `canAcceptShift`, `canDeclineShift`, `canCheckIn`, `canStartWork`
- `canFinishWork`, `canCheckout`, `canGenerateTimesheet`
- `canPublishShift`, `canCancelShift`, `assertShiftTransition`

**Key invariants:**
- `updated_pending` blocks check-in, start work, and finish work
- One work session per shift (UNIQUE constraint)
- One timesheet per shift (UNIQUE constraint, migration 024)
- One attendance record per shift (UNIQUE constraint, migration 024)
- Rate snapshots copied at shift publish, immutable thereafter

### Admin Edit Workflow

```
Admin edits shift
    │
    ├── Preview validation (availability, overlap)
    │
    ├── If shift was accepted + date/time/location changed
    │   └── Status → updated_pending (employee must reconfirm)
    │
    ├── Audit log entry created (before/after values)
    │
    └── Location auto-linked: text matches work_locations.name → sets location_id
```

### Timesheet → Payment Flow

```
Shift completed → timesheet auto-generated (submitted)
    │
    ▼
Admin reviews timesheet
    ├── Approve → status: approved
    └── Needs correction → employee notified
        └── Employee resubmits → back to submitted
    │
    ▼
Admin: Payments page
    Groups approved timesheets by employee + week
    └── Mark as paid → payment record created
```

---

## 13. Attendance System

### Architecture

```
work_locations (GPS coords) → attendance_settings (rules) →
shifts (location_id FK) → attendance_records (check-in/out data) →
attendance_exceptions (flags for admin review)
```

### Check-In Flow (multi-step)

```
Step 1: QR Scan
    ├── Static QR: WFA:CHECKIN:<locationId>:<token>
    └── Dynamic QR: WFA:DYN:<locationId>:<timestamp>:<hash>
    (Uses jsQR library — works on all browsers including iOS Safari)

Step 2: GPS Verification
    ├── Browser geolocation → haversine distance to location
    ├── Within allowed_radius_metres → auto-advance
    └── Outside range → warning, can continue (flagged for review)

Step 3: Selfie (if required)
    └── Front camera photo upload

Step 4: Auto-submit
    └── POST /api/attendance/checkin with all collected data
```

### Auto-Verification

```
On-time + in-range check-in → verification_status = VERIFIED (no admin review)
Late / out-of-range / QR fail → verification_status = PENDING (admin reviews)
```

### Check-Out Methods

| Method | Behavior |
|--------|----------|
| `BUTTON_ONLY` | Simple button tap (auto-checkout on finish-shift) |
| `QR_AND_GPS` | Full QR + GPS verification |
| `GPS_ONLY` | GPS verification only |

### Threshold Logic

```
Early departure: actual_checkout < scheduled_finish - early_departure_minutes
Late departure:  actual_checkout > scheduled_finish + late_departure_minutes
Clean checkout:  within thresholds → status = CHECKED_OUT
```

---

## 14. Event Staffing System

### Flow

```
Admin creates event (DRAFT)
    │
    ├── Add staffing requirements (roles + counts)
    │
    ├── Open event (OPEN)
    │   │
    │   ├── Find workers → filter by availability, employment type
    │   │   ├── Direct assign → shift created immediately
    │   │   └── Send offer → employee gets notification
    │   │
    │   └── Employee responds to offer
    │       ├── Accept → shift created, offer filled
    │       └── Decline → offer status updated
    │
    └── All requirements filled → FULLY_STAFFED
```

### Atomic Offer Acceptance

```sql
-- accept_open_shift_offer() — PostgreSQL function
-- Uses row-level locking to prevent race conditions
-- when multiple employees accept the same offer
```

---

## 15. Task Proof System

### Configuration Levels

```
Level 1: Templates (reusable across shifts)
    └── Template items (proof_type, min/max photos, required)

Level 2: Per-shift requirements (copied from template or custom)
    └── Applied when admin creates/edits a shift
```

### Proof Enforcement

| Config | Behavior at Finish Shift |
|--------|-------------------------|
| `is_required = true` + `allow_finish_without_proof = false` | **Hard block** (400) — must upload first |
| `is_required = true` + `allow_finish_without_proof = true` | **Soft warning** (409) — can finish anyway |
| `is_required = false` | Optional, no enforcement |

### Per-Shift Toggles

```
shifts.require_odometer:
    NULL   → use employee's default (odometer_tracking_enabled)
    true   → force odometer on this shift
    false  → skip odometer on this shift
```

---

## 16. Notification System

### In-App Notifications

```
notifications table:
    user_id, title, message, link, is_read, created_at
```

Triggered by:
- New shift assigned
- Shift updated (reconfirmation needed)
- Timesheet approved/needs correction
- Open shift offer received
- Attendance flagged

Displayed as:
- Bell icon with unread count badge in navigation
- Notification list page with mark-as-read

---

## 17. Storage Buckets

| Bucket | Contents |
|--------|----------|
| `odometer-photos` | Start/finish odometer images |
| `task-proof-photos` | Before/during/after work evidence |
| `attendance-photos` | Check-in selfies, site photos, checkout selfies |

### Upload Pattern

```typescript
// All uploads go through the admin client (service role)
const fileName = `${employeeId}/${shiftId}/${type}_${Date.now()}.${ext}`;
await adminClient.storage.from("bucket").upload(fileName, fileBuffer);
```

---

## 18. Database Migrations

| # | File | Description |
|---|------|-------------|
| 001 | `001_initial_schema.sql` | Core tables: users, employees, shifts, timesheets, payments, RLS |
| 002 | `002_recurring_shifts.sql` | Recurring shift groups |
| 003 | `003_shift_editing.sql` | Shift audit log, edit tracking |
| 004 | `004_timesheet_corrections.sql` | Correction notes on timesheets |
| 005 | `005_saas_tenant_foundation.sql` | businesses + business_members tables |
| 005b | `005b_add_not_null_and_indexes.sql` | NOT NULL constraints + indexes |
| 006 | `006_platform_admin.sql` | Platform admin role + pages |
| 007 | `007_event_staffing.sql` | Events, offers, staffing requirements |
| 008 | `008_task_proof.sql` | Task proof templates, requirements, submissions |
| 009 | `009_shift_evidence_toggles.sql` | Per-employee odometer/proof toggles |
| 010 | `010_shift_deletion.sql` | Shift delete with audit trail |
| 011 | `011_shift_odometer_toggle.sql` | Per-shift odometer override |
| 012 | `012_attendance_phase1.sql` | Work locations + attendance settings |
| 013 | `013_static_qr_credentials.sql` | Static QR tokens per location |
| 014 | `014_attendance_records.sql` | Attendance records + exceptions |
| 015 | `015_notifications.sql` | In-app notifications |
| 015b | `015b_fix_notification_rls.sql` | Fix notification RLS policies |
| 016 | `016_security_audit_fixes.sql` | Security audit patches |
| 017 | `017_checkout_columns.sql` | Checkout selfie + QR columns |
| 018 | `018_timesheet_payment_link.sql` | Timesheet ↔ payment linking |
| 019 | `019_work_sessions.sql` | `shift_attendance` → `work_sessions` rename + new columns |
| 020 | `020_rate_snapshots.sql` | `hourly_rate_snapshot`, `mileage_rate_snapshot` on shifts |
| 021 | `021_timesheet_extensions.sql` | `work_session_id` FK, payable/break columns, `calculation_version` |
| 022 | `022_audit_events.sql` | `audit_events` table for structured audit trail |
| 023 | `023_backfill_work_sessions.sql` | Backfill work_sessions + enforce NOT NULL rate snapshots |
| 024 | `024_atomic_finish.sql` | `complete_work_session()` RPC + UNIQUE constraints for idempotency |

---

## 19. Environment Variables

```env
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...         # Public anon key (safe for browser)
SUPABASE_SERVICE_ROLE_KEY=eyJ...              # Server-only! Never expose to client

# Dynamic QR signing (required for attendance)
QR_SIGNING_SECRET=<random-32-char-string>    # Signs dynamic QR tokens
```

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` and `QR_SIGNING_SECRET` must **never** be in client-side code or exposed in the browser. They are used only in API routes via `createAdminClient()`.

---

## 20. Deployment

### Vercel

```bash
# Deploy to production
npx vercel --prod

# Environment variables configured in Vercel dashboard
# Build command: next build
# Output directory: Next.js default (.next)
```

### Build & Development

```bash
npm run dev      # Local development server (port 3000)
npm run build    # Production build
npm run start    # Start production server locally
npm run lint     # ESLint
```

### Git Workflow

- Single `main` branch
- Direct commits to main (small team)
- Vercel auto-deploys on push

---

## Appendix: Request Flow Diagram

```
Browser Request
    │
    ▼
middleware.ts (session refresh)
    │
    ▼
Page Component (server or client)
    │
    ├── Server Component: reads data directly
    │   └── Uses createClient() (server) — RLS enforced
    │
    └── Client Component: calls API route
        │
        ▼
    API Route Handler
        │
        ├── tenantContext.ts → derives businessId from session
        │   (NEVER from request body/query/params)
        │
        ├── createAdminClient() → bypasses RLS
        │   (server validates permissions manually)
        │
        ├── Business logic + validation
        │
        └── Response (JSON)
```

---

*Generated for Workforce App V1 — a Next.js + Supabase multi-tenant workforce management platform.*
