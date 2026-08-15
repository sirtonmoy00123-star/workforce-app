// Core app types (domain models, API contracts).
// Database row types auto-generated from Supabase are in ./database.ts.

export enum Role {
  Admin = "admin",
  Employee = "employee",
}

export enum ShiftStatus {
  Pending = "pending",
  Accepted = "accepted",
  Declined = "declined",
  Completed = "completed",
  Cancelled = "cancelled",
}

export enum AttendanceStatus {
  Pending = "pending",
  Working = "working",
  Completed = "completed",
}

export enum OdometerSubmissionType {
  Start = "START",
  Finish = "FINISH",
}

export enum TimesheetStatus {
  Submitted = "submitted",
  Approved = "approved",
  NeedsCorrection = "needs_correction",
}

export enum PaymentStatus {
  Unpaid = "unpaid",
  Paid = "paid",
}

export enum EmploymentStatus {
  Active = "active",
  Inactive = "inactive",
}

export enum AccountStatus {
  Active = "active",
  Disabled = "disabled",
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}
