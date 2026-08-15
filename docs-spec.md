# AI Coding Prompt for Version 1 Workforce Web App

Act as a senior full-stack web developer, software architect, UI/UX designer, database designer, and QA engineer.

I am a beginner with no coding background. Build a simple, working Version 1 web application for employee rostering, shift tracking, odometer photo recording, timesheets, mileage calculation, and payment tracking.

The main goal is to build the complete core workflow first. Do not add unnecessary advanced features.

## Core Workflow

The app must support this exact process:

**Admin creates employee → Admin sets employee availability → Admin creates and assigns shift → Employee receives and accepts/declines shift → Employee starts shift and uploads starting odometer photo → Employee finishes shift and uploads ending odometer photo → App calculates working hours and mileage → App calculates estimated payment → Admin reviews and approves timesheet → Admin marks payment as paid → Employee sees payment status.**

## Technology Stack

Use:

- Next.js
- React
- TypeScript
- Tailwind CSS
- Supabase
- PostgreSQL
- Supabase Authentication
- Supabase Storage

Build it as a responsive web application that works properly on desktop and mobile.

Do not build native Android or iOS apps.

## User Roles

There are only two roles in Version 1:

### Admin

Admin has full control over:

- Employee accounts
- Employee availability
- Shifts
- Weekly roster
- Timesheets
- Payments

### Employee

Employee can only access their own:

- Assigned shifts
- Shift details
- Start/finish shift
- Odometer records
- Timesheets
- Payment information

Employees must never see another employee's information.

## Authentication

Employees cannot register themselves.

Only Admin can create employee accounts.

When Admin creates an employee, collect:

- Full name
- Phone number
- Employee ID
- Hourly rate
- Mileage rate per kilometre
- Active/inactive status
- User ID

Admin should generate or enter a temporary password.

Employee logs in using:

- User ID
- Temporary password

On first login, force employee to create a new password.

Do not store passwords in normal database tables.

Use the authentication system securely.

Admin must not be able to see the employee's private password after it is changed.

Admin should be able to:

- Reset employee password
- Disable employee account
- Reactivate employee account

## Admin Dashboard

Create a simple Admin dashboard.

Show:

- Total active employees
- Today's shifts
- Accepted shifts
- Pending shifts
- Declined shifts
- Timesheets waiting approval
- Unpaid payments

Add quick buttons:

- Add Employee
- Create Shift
- View Roster
- Review Timesheets

Keep the dashboard clean and simple.

## Employee Management

Admin page:

**Employees**

Show employee list with:

- Name
- Phone
- Employee ID
- Hourly rate
- Mileage rate
- Status

Admin actions:

- Add employee
- Edit employee
- View employee
- Disable employee
- Reset password

## Employee Availability

Only Admin manages employee availability.

Employee cannot edit availability.

For each employee, Admin can define recurring weekly availability.

Example:

Monday: 2 PM–10 PM

Tuesday: Unavailable

Wednesday: 3 PM–9 PM

Thursday: 12 PM–8 PM

Friday: 3 PM–9 PM

Store availability in the database.

When Admin assigns a shift, automatically check whether the employee is available for the shift time.

If employee is not available, show a warning.

Admin may override the warning if necessary.

## Weekly Roster

Create a simple weekly roster view.

Show:

- Employees vertically
- Days horizontally
- Shift start/finish times

Example:

| Employee | Mon | Tue | Wed | Thu | Fri |
| John | 3–9 | OFF | 3–9 | 4–9 | OFF |
| Sarah | 4–9 | 3–9 | OFF | 3–9 | 3–8 |

The roster does not need drag-and-drop in Version 1.

Admin should be able to click:

**Create Shift**

## Create Shift

Admin enters:

- Employee
- Date
- Start time
- Finish time
- Work location
- Optional instructions

Before saving, validate:

- Employee is active
- Employee does not already have an overlapping shift
- Employee availability covers the shift

If availability does not cover the shift, show:

**Warning: Employee is not available for the full shift.**

Allow Admin to cancel or override.

## Shift Status

Each assigned shift has one of these statuses:

- Pending
- Accepted
- Declined
- Completed
- Cancelled

When Admin creates a shift:

Status = Pending

Employee sees the new shift on their dashboard.

## Employee Dashboard

Create a very simple mobile-friendly dashboard.

Show:

### Next Shift

- Date
- Time
- Location
- Status

### This Week

- Total hours
- Total mileage
- Estimated earnings
- Approved earnings
- Unpaid earnings

### Quick Actions

- My Shifts
- Start Shift
- My Timesheets
- My Payments

## Employee Shift List

Employee sees only their assigned shifts.

Show:

- Date
- Start/finish time
- Location
- Status

For Pending shifts, show:

**Accept**

**Decline**

When Employee accepts:

Status becomes Accepted.

When Employee declines:

Status becomes Declined.

Admin must see this change.

## Start Shift

Only Accepted shifts can be started.

When Employee opens an accepted shift, show:

**START SHIFT**

When selected:

1. Open camera or image upload.
2. Employee uploads a starting odometer photo.
3. Employee manually enters the odometer number.
4. Record trusted server start time.
5. Save the original photo securely.
6. Save the odometer value.
7. Change attendance status to Working.

Example:

Starting Odometer:

125430

Show confirmation:

**Shift Started Successfully**

Start Time: 2:58 PM

Starting Odometer: 125430 km

Do not add AI/OCR in Version 1.

Employee manually enters the number.

## Finish Shift

For an active shift show:

**FINISH SHIFT**

When selected:

1. Upload ending odometer photo.
2. Employee manually enters ending odometer.
3. Record trusted server finish time.
4. Save photo.
5. Calculate working time.
6. Calculate mileage.
7. Calculate estimated payment.
8. Generate timesheet.

Validation:

Ending odometer cannot normally be lower than starting odometer.

If it is lower, show an error and do not complete the shift until corrected.

## Working Hours Calculation

Calculate:

**Actual Finish Time − Actual Start Time = Worked Time**

Store actual timestamps in the database.

Do not store only decimal hours.

For payment calculation, convert total minutes into hours.

Example:

Start:

2:58 PM

Finish:

9:04 PM

Worked:

6 hours 6 minutes

## Mileage Calculation

Calculate:

**Ending Odometer − Starting Odometer = Mileage**

Example:

125487 − 125430 = 57 km

## Payment Calculation

Each employee has:

- Hourly rate
- Mileage rate

Example:

Hourly rate:

$30/hour

Mileage rate:

$0.50/km

Worked:

6 hours

Mileage:

57 km

Calculate:

Wage:

6 × $30 = $180

Mileage:

57 × $0.50 = $28.50

Estimated Total:

$208.50

Store the employee's hourly rate and mileage rate as snapshots on the timesheet so future rate changes do not change old records.

## Timesheet

After shift completion, automatically generate a timesheet.

Timesheet must contain:

- Employee
- Shift date
- Scheduled start
- Scheduled finish
- Actual start
- Actual finish
- Worked minutes
- Starting odometer
- Ending odometer
- Mileage
- Start photo
- Finish photo
- Hourly rate snapshot
- Mileage rate snapshot
- Wage amount
- Mileage amount
- Estimated total
- Status

Timesheet statuses:

- Submitted
- Approved
- Needs Correction

## Admin Timesheet Review

Create an Admin Timesheets page.

Show submitted timesheets.

Admin can open a timesheet and see:

- Employee
- Shift
- Start photo
- Finish photo
- Start time
- Finish time
- Hours
- Start odometer
- Finish odometer
- Mileage
- Wage
- Mileage payment
- Total

Admin buttons:

**Approve**

**Needs Correction**

When approved:

Status = Approved.

Only approved timesheets should appear in the final payment total.

## Payment Tracking

Create a simple Payments page.

Group approved timesheets by employee and week.

Show:

- Employee
- Total approved hours
- Total mileage
- Wage
- Mileage reimbursement
- Total amount
- Payment status

Payment status:

- Unpaid
- Paid

Admin can click:

**Mark as Paid**

Store:

- Payment date
- Admin who marked it paid
- Amount

Employee should then see:

**PAID**

on their payment screen.

## Employee Payment Screen

Employee sees only their payments.

Show:

- Pay period
- Hours
- Mileage
- Wage
- Mileage payment
- Total
- Status

Use clear statuses:

- Estimated
- Approved
- Paid

## Database Tables

Create a clean relational database.

At minimum use these tables:

### users

Fields:

- id
- auth_user_id
- business_id
- role
- username
- must_change_password
- account_status
- created_at
- updated_at

### employees

Fields:

- id
- business_id
- user_id
- employee_number
- full_name
- phone
- hourly_rate
- mileage_rate
- employment_status
- created_at
- updated_at

### employee_availability

Fields:

- id
- employee_id
- day_of_week
- start_time
- end_time
- is_available
- created_by
- created_at
- updated_at

### shifts

Fields:

- id
- business_id
- employee_id
- date
- scheduled_start
- scheduled_finish
- location
- instructions
- status
- created_by
- created_at
- updated_at

### shift_attendance

Fields:

- id
- shift_id
- employee_id
- actual_start
- actual_finish
- attendance_status
- created_at
- updated_at

### odometer_submissions

Fields:

- id
- shift_id
- employee_id
- submission_type
- photo_path
- odometer_reading
- server_timestamp
- created_at

submission_type:

- START
- FINISH

### timesheets

Fields:

- id
- shift_id
- employee_id
- scheduled_start
- scheduled_finish
- actual_start
- actual_finish
- worked_minutes
- start_odometer
- finish_odometer
- distance_km
- hourly_rate_snapshot
- mileage_rate_snapshot
- wage_amount
- mileage_amount
- estimated_total
- approved_total
- status
- approved_by
- approved_at
- created_at

### payments

Fields:

- id
- employee_id
- period_start
- period_end
- total_hours
- total_mileage
- wage_amount
- mileage_amount
- total_amount
- status
- payment_date
- marked_paid_by
- created_at

## Security

This is very important.

Implement role-based permissions.

Admin:

- Can view employees belonging to their business
- Can create/edit employees
- Can manage availability
- Can create shifts
- Can review timesheets
- Can manage payments

Employee:

- Can only view their own profile
- Can only view their own shifts
- Can only access their own odometer submissions
- Can only view their own timesheets
- Can only view their own payments

Never trust the frontend alone for security.

Validate permissions on the backend and database level.

Use Supabase Row Level Security where appropriate.

Do not expose Supabase service-role credentials to the browser.

## Photo Storage

Create a private storage bucket for odometer photos.

Use a structure similar to:

`business-id/employee-id/shift-id/start.jpg`

and

`business-id/employee-id/shift-id/finish.jpg`

Do not make odometer photos publicly accessible.

Only authorised Admin and the relevant Employee should be able to access them.

## UI Design

Make the interface:

- Clean
- Simple
- Modern
- Mobile-friendly
- Easy for non-technical users

Do not overcrowd screens.

Use clear status badges.

For example:

Pending

Accepted

Declined

Working

Completed

Approved

Unpaid

Paid

Use cards on mobile and tables/calendar views on desktop where appropriate.

## Version 1 Pages

### Admin

Create:

- `/admin/dashboard`
- `/admin/employees`
- `/admin/employees/new`
- `/admin/employees/[id]`
- `/admin/roster`
- `/admin/shifts/new`
- `/admin/timesheets`
- `/admin/timesheets/[id]`
- `/admin/payments`

### Employee

Create:

- `/employee/home`
- `/employee/shifts`
- `/employee/shifts/[id]`
- `/employee/start-shift/[id]`
- `/employee/finish-shift/[id]`
- `/employee/timesheets`
- `/employee/payments`
- `/employee/profile`

## Important Version 1 Limitations

Do NOT add these yet:

- AI odometer recognition
- GPS tracking
- Geofencing
- Native mobile app
- Automatic AI roster generation
- Xero
- MYOB
- Automatic bank payments
- In-app chat
- Advanced reports
- Advanced leave management
- Complex payroll tax calculations
- Employee self-managed availability

These belong in later versions.

## Code Quality

Use:

- TypeScript
- Reusable components
- Clear folder structure
- Server-side validation
- Proper error handling
- Loading states
- Empty states
- Clear user-facing error messages

Do not put all business logic inside UI components.

Separate:

- UI
- API
- Database access
- Business logic
- Validation
- Calculations

Create reusable services for:

- Employee management
- Availability
- Shifts
- Attendance
- Timesheets
- Payments

## Testing

Do not consider the app complete until this exact scenario works correctly:

### Test Employee

Name:

John Smith

Hourly rate:

$30/hour

Mileage rate:

$0.50/km

Admin sets availability:

Monday:

2 PM–10 PM

Admin creates:

Monday

3 PM–9 PM

Employee John receives shift.

John accepts.

John starts shift at approximately 2:58 PM.

Starting odometer:

125430

John uploads starting photo.

John finishes around 9:04 PM.

Ending odometer:

125487

John uploads ending photo.

System must calculate:

Mileage:

57 km

Working duration:

6 hours 6 minutes

Payment based on actual worked minutes.

Timesheet is generated.

Admin opens timesheet.

Admin approves it.

Approved amount appears under Payments.

Admin selects:

**Mark as Paid**

John logs in.

John sees:

**PAID**

The system should preserve all photos, timestamps, calculations and payment records.

## Development Process

Build the project feature by feature.

Do not try to generate everything as one giant untested codebase.

Build in this order:

1. Project setup
2. Supabase/database
3. Authentication and roles
4. Admin employee creation
5. Admin availability
6. Shift creation
7. Employee shift acceptance
8. Start shift
9. Finish shift
10. Odometer photo upload
11. Hours and mileage calculation
12. Timesheet generation
13. Admin timesheet approval
14. Payment tracking
15. Admin dashboard
16. Employee dashboard
17. Security testing
18. End-to-end testing

After completing each phase:

- Run the application
- Check for errors
- Fix errors
- Test the feature
- Check database records
- Check permissions
- Check mobile responsiveness

Do not move to the next phase while the current feature is broken.

## Final Requirement

The first version is successful when this complete workflow works reliably:

**Admin creates employee → Admin sets availability → Admin creates shift → Employee accepts → Employee starts shift with odometer photo → Employee finishes shift with odometer photo → App calculates hours + mileage + estimated pay → Admin approves timesheet → Payment becomes approved → Admin marks paid → Employee sees paid status.**

Prioritise making this workflow reliable and easy to use over adding more features.