// Database types matching the SQL schema.
// Manually written to match 001_initial_schema.sql.

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          auth_user_id: string;
          business_id: string;
          role: "admin" | "employee";
          username: string;
          must_change_password: boolean;
          account_status: "active" | "disabled";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id: string;
          business_id: string;
          role?: "admin" | "employee";
          username: string;
          must_change_password?: boolean;
          account_status?: "active" | "disabled";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string;
          business_id?: string;
          role?: "admin" | "employee";
          username?: string;
          must_change_password?: boolean;
          account_status?: "active" | "disabled";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      employees: {
        Row: {
          id: string;
          business_id: string;
          user_id: string;
          employee_number: string;
          full_name: string;
          phone: string | null;
          hourly_rate: number;
          mileage_rate: number;
          employment_status: "active" | "inactive";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          user_id: string;
          employee_number: string;
          full_name: string;
          phone?: string | null;
          hourly_rate?: number;
          mileage_rate?: number;
          employment_status?: "active" | "inactive";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          user_id?: string;
          employee_number?: string;
          full_name?: string;
          phone?: string | null;
          hourly_rate?: number;
          mileage_rate?: number;
          employment_status?: "active" | "inactive";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      employee_availability: {
        Row: {
          id: string;
          employee_id: string;
          day_of_week: number;
          start_time: string | null;
          end_time: string | null;
          is_available: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          day_of_week: number;
          start_time?: string | null;
          end_time?: string | null;
          is_available?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          day_of_week?: number;
          start_time?: string | null;
          end_time?: string | null;
          is_available?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      shifts: {
        Row: {
          id: string;
          business_id: string;
          employee_id: string;
          date: string;
          scheduled_start: string;
          scheduled_finish: string;
          location: string | null;
          instructions: string | null;
          status: "pending" | "accepted" | "declined" | "completed" | "cancelled";
          recurring_group_id: string | null;
          is_recurring: boolean;
          recurrence_type: "NONE" | "NEXT_WEEK" | "WEEKLY_END_OF_MONTH" | "WEEKLY_CUSTOM_END";
          recurrence_end_date: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          employee_id: string;
          date: string;
          scheduled_start: string;
          scheduled_finish: string;
          location?: string | null;
          instructions?: string | null;
          status?: "pending" | "accepted" | "declined" | "completed" | "cancelled";
          recurring_group_id?: string | null;
          is_recurring?: boolean;
          recurrence_type?: "NONE" | "NEXT_WEEK" | "WEEKLY_END_OF_MONTH" | "WEEKLY_CUSTOM_END";
          recurrence_end_date?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          employee_id?: string;
          date?: string;
          scheduled_start?: string;
          scheduled_finish?: string;
          location?: string | null;
          instructions?: string | null;
          status?: "pending" | "accepted" | "declined" | "completed" | "cancelled";
          recurring_group_id?: string | null;
          is_recurring?: boolean;
          recurrence_type?: "NONE" | "NEXT_WEEK" | "WEEKLY_END_OF_MONTH" | "WEEKLY_CUSTOM_END";
          recurrence_end_date?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      shift_attendance: {
        Row: {
          id: string;
          shift_id: string;
          employee_id: string;
          actual_start: string | null;
          actual_finish: string | null;
          attendance_status: "pending" | "working" | "completed";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          shift_id: string;
          employee_id: string;
          actual_start?: string | null;
          actual_finish?: string | null;
          attendance_status?: "pending" | "working" | "completed";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          shift_id?: string;
          employee_id?: string;
          actual_start?: string | null;
          actual_finish?: string | null;
          attendance_status?: "pending" | "working" | "completed";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      odometer_submissions: {
        Row: {
          id: string;
          shift_id: string;
          employee_id: string;
          submission_type: "START" | "FINISH";
          photo_path: string;
          odometer_reading: number;
          server_timestamp: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          shift_id: string;
          employee_id: string;
          submission_type: "START" | "FINISH";
          photo_path: string;
          odometer_reading: number;
          server_timestamp?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          shift_id?: string;
          employee_id?: string;
          submission_type?: "START" | "FINISH";
          photo_path?: string;
          odometer_reading?: number;
          server_timestamp?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      timesheets: {
        Row: {
          id: string;
          shift_id: string;
          employee_id: string;
          scheduled_start: string;
          scheduled_finish: string;
          actual_start: string;
          actual_finish: string;
          worked_minutes: number;
          start_odometer: number;
          finish_odometer: number;
          distance_km: number;
          hourly_rate_snapshot: number;
          mileage_rate_snapshot: number;
          wage_amount: number;
          mileage_amount: number;
          estimated_total: number;
          approved_total: number | null;
          status: "submitted" | "approved" | "needs_correction";
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          shift_id: string;
          employee_id: string;
          scheduled_start: string;
          scheduled_finish: string;
          actual_start: string;
          actual_finish: string;
          worked_minutes: number;
          start_odometer: number;
          finish_odometer: number;
          distance_km: number;
          hourly_rate_snapshot: number;
          mileage_rate_snapshot: number;
          wage_amount: number;
          mileage_amount: number;
          estimated_total: number;
          approved_total?: number | null;
          status?: "submitted" | "approved" | "needs_correction";
          approved_by?: string | null;
          approved_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          shift_id?: string;
          employee_id?: string;
          scheduled_start?: string;
          scheduled_finish?: string;
          actual_start?: string;
          actual_finish?: string;
          worked_minutes?: number;
          start_odometer?: number;
          finish_odometer?: number;
          distance_km?: number;
          hourly_rate_snapshot?: number;
          mileage_rate_snapshot?: number;
          wage_amount?: number;
          mileage_amount?: number;
          estimated_total?: number;
          approved_total?: number | null;
          status?: "submitted" | "approved" | "needs_correction";
          approved_by?: string | null;
          approved_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          employee_id: string;
          period_start: string;
          period_end: string;
          total_hours: number;
          total_mileage: number;
          wage_amount: number;
          mileage_amount: number;
          total_amount: number;
          status: "unpaid" | "paid";
          payment_date: string | null;
          marked_paid_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          period_start: string;
          period_end: string;
          total_hours?: number;
          total_mileage?: number;
          wage_amount?: number;
          mileage_amount?: number;
          total_amount?: number;
          status?: "unpaid" | "paid";
          payment_date?: string | null;
          marked_paid_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          period_start?: string;
          period_end?: string;
          total_hours?: number;
          total_mileage?: number;
          wage_amount?: number;
          mileage_amount?: number;
          total_amount?: number;
          status?: "unpaid" | "paid";
          payment_date?: string | null;
          marked_paid_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: "admin" | "employee";
      account_status: "active" | "disabled";
      employment_status: "active" | "inactive";
      shift_status: "pending" | "accepted" | "declined" | "completed" | "cancelled";
      attendance_status: "pending" | "working" | "completed";
      submission_type: "START" | "FINISH";
      timesheet_status: "submitted" | "approved" | "needs_correction";
      payment_status: "unpaid" | "paid";
      recurrence_type: "NONE" | "NEXT_WEEK" | "WEEKLY_END_OF_MONTH" | "WEEKLY_CUSTOM_END";
    };
  };
};
