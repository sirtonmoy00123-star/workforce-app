// POST /api/shifts/[id]/start — Employee starts a shift
// Creates shift_attendance record, uploads odometer photo, saves odometer submission
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: shiftId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // Verify user is an employee
    const { data: appUser } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser || appUser.role !== "employee") {
      return NextResponse.json({ error: "Only employees can start shifts." }, { status: 403 });
    }

    const { data: employee } = await supabase
      .from("employees")
      .select("*")
      .eq("user_id", appUser.id)
      .single();
    if (!employee) {
      return NextResponse.json({ error: "Employee record not found." }, { status: 404 });
    }

    const adminClient = createAdminClient();

    // Get the shift and verify ownership
    const { data: shift } = await adminClient
      .from("shifts")
      .select("*")
      .eq("id", shiftId)
      .single();

    if (!shift) {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }
    if (shift.employee_id !== employee.id) {
      return NextResponse.json({ error: "This shift is not assigned to you." }, { status: 403 });
    }
    if (shift.status !== "accepted") {
      return NextResponse.json({ error: "Only accepted shifts can be started." }, { status: 400 });
    }

    // Check if already started (attendance record exists)
    const { data: existingAttendance } = await adminClient
      .from("shift_attendance")
      .select("id")
      .eq("shift_id", shiftId)
      .eq("employee_id", employee.id)
      .maybeSingle();

    if (existingAttendance) {
      return NextResponse.json({ error: "This shift has already been started." }, { status: 400 });
    }

    // Parse the form data (multipart for photo upload)
    const formData = await request.formData();
    const photo = formData.get("photo") as File | null;
    const odometerReading = parseFloat(formData.get("odometer_reading") as string);

    if (!photo) {
      return NextResponse.json({ error: "Odometer photo is required." }, { status: 400 });
    }
    if (isNaN(odometerReading) || odometerReading < 0) {
      return NextResponse.json({ error: "Valid odometer reading is required." }, { status: 400 });
    }

    // Upload photo to Supabase Storage (odometer-photos bucket)
    const fileExt = photo.name.split(".").pop() || "jpg";
    const fileName = `${employee.id}/${shiftId}/start_${Date.now()}.${fileExt}`;
    const arrayBuffer = await photo.arrayBuffer();
    const fileBuffer = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await adminClient.storage
      .from("odometer-photos")
      .upload(fileName, fileBuffer, {
        contentType: photo.type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("Photo upload error:", uploadError);
      return NextResponse.json({ error: "Failed to upload photo." }, { status: 500 });
    }

    // Server timestamp for actual_start
    const serverNow = new Date().toISOString();

    // Create shift_attendance record
    const { error: attendanceError } = await adminClient
      .from("shift_attendance")
      .insert({
        shift_id: shiftId,
        employee_id: employee.id,
        actual_start: serverNow,
        attendance_status: "working",
      });

    if (attendanceError) {
      console.error("Attendance insert error:", attendanceError);
      return NextResponse.json({ error: "Failed to record attendance." }, { status: 500 });
    }

    // Create odometer submission record
    const { error: odometerError } = await adminClient
      .from("odometer_submissions")
      .insert({
        shift_id: shiftId,
        employee_id: employee.id,
        submission_type: "START",
        photo_path: fileName,
        odometer_reading: odometerReading,
        server_timestamp: serverNow,
      });

    if (odometerError) {
      console.error("Odometer submission error:", odometerError);
      return NextResponse.json({ error: "Failed to save odometer reading." }, { status: 500 });
    }

    // Update shift status to in_progress (we use "accepted" → keep as accepted for now,
    // but the attendance_status="working" indicates in-progress)
    // The shift stays "accepted" while working — it becomes "completed" when finished.

    return NextResponse.json({
      success: true,
      actual_start: serverNow,
      message: "Shift started successfully.",
    });
  } catch (err) {
    console.error("Start shift error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
