// GET /api/admin/photos — list all employee photos across the business
// DELETE /api/admin/photos — delete employee photos (by IDs, employee, or age)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

const BUCKETS = ["odometer-photos", "task-proof-photos", "attendance-photos"] as const;

interface PhotoRecord {
  id: string;
  bucket: (typeof BUCKETS)[number];
  path: string;
  shiftId: string;
  shiftDate: string | null;
  employeeId: string;
  employeeName: string;
  type: "odometer_start" | "odometer_finish" | "task_proof" | "selfie" | "site_photo";
  createdAt: string;
  signedUrl: string | null;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();
    const url = new URL(request.url);
    const filterEmployeeId = url.searchParams.get("employeeId");
    const olderThanDays = parseInt(url.searchParams.get("olderThan") || "0");
    const summaryOnly = url.searchParams.get("summaryOnly") === "true";

    const cutoffDate = olderThanDays > 0
      ? new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // 1. Get employees in this business
    const { data: employees } = await adminClient
      .from("employees")
      .select("id, full_name")
      .eq("business_id", ctx.businessId);

    const empMap = new Map<string, string>();
    const empIds: string[] = [];
    for (const e of employees || []) {
      empMap.set(e.id, e.full_name);
      empIds.push(e.id);
    }

    // Filter to a single employee if requested
    const targetEmpIds = filterEmployeeId
      ? empIds.filter((id) => id === filterEmployeeId)
      : empIds;

    if (targetEmpIds.length === 0) {
      return NextResponse.json({
        photos: [],
        totalPhotos: 0,
        estimatedStorageMB: 0,
        byEmployee: [],
        byAge: { last30Days: 0, thirtyTo60Days: 0, sixtyTo90Days: 0, older90Days: 0 },
        byType: { odometer: 0, taskProof: 0, selfie: 0, sitePhoto: 0 },
        employees: (employees || []).map((e) => ({ id: e.id, name: e.full_name })),
      });
    }

    // 2. Get all shifts for target employees
    const { data: shifts } = await adminClient
      .from("shifts")
      .select("id, date, status, employee_id")
      .eq("business_id", ctx.businessId)
      .in("employee_id", targetEmpIds)
      .order("date", { ascending: false });

    const shiftMap = new Map<string, { date: string; status: string; employeeId: string }>();
    for (const s of shifts || []) {
      shiftMap.set(s.id, { date: s.date, status: s.status, employeeId: s.employee_id });
    }

    // 3. Fetch photo records from all 3 sources in parallel
    const [odometerResult, proofResult, attendanceResult] = await Promise.all([
      adminClient
        .from("odometer_submissions")
        .select("id, shift_id, employee_id, submission_type, photo_path, server_timestamp")
        .eq("business_id", ctx.businessId)
        .in("employee_id", targetEmpIds)
        .order("server_timestamp", { ascending: false }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (adminClient as any)
        .from("task_proof_submissions")
        .select("id, shift_id, employee_id, proof_type, photo_path, server_timestamp, status")
        .eq("business_id", ctx.businessId)
        .in("employee_id", targetEmpIds)
        .order("server_timestamp", { ascending: false }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (adminClient as any)
        .from("attendance_records")
        .select("id, shift_id, employee_id, selfie_photo_path, site_photo_path, created_at")
        .eq("business_id", ctx.businessId)
        .in("employee_id", targetEmpIds)
        .order("created_at", { ascending: false }),
    ]);

    const odometerSubs = odometerResult.data || [];
    const proofSubs = proofResult.data || [];
    const attendanceRecords = attendanceResult.data || [];

    // 4. Build photo list
    const photos: PhotoRecord[] = [];

    for (const sub of odometerSubs) {
      if (!sub.photo_path) continue;
      const shift = shiftMap.get(sub.shift_id);
      const createdAt = sub.server_timestamp;
      if (cutoffDate && createdAt > cutoffDate) continue;

      photos.push({
        id: `odo-${sub.id}`,
        bucket: "odometer-photos",
        path: sub.photo_path,
        shiftId: sub.shift_id,
        shiftDate: shift?.date || null,
        employeeId: sub.employee_id,
        employeeName: empMap.get(sub.employee_id) || "Unknown",
        type: sub.submission_type === "START" ? "odometer_start" : "odometer_finish",
        createdAt,
        signedUrl: null,
      });
    }

    for (const sub of proofSubs) {
      if (!sub.photo_path) continue;
      const shift = shiftMap.get(sub.shift_id);
      const createdAt = sub.server_timestamp;
      if (cutoffDate && createdAt > cutoffDate) continue;

      photos.push({
        id: `proof-${sub.id}`,
        bucket: "task-proof-photos",
        path: sub.photo_path,
        shiftId: sub.shift_id,
        shiftDate: shift?.date || null,
        employeeId: sub.employee_id,
        employeeName: empMap.get(sub.employee_id) || "Unknown",
        type: "task_proof",
        createdAt,
        signedUrl: null,
      });
    }

    for (const rec of attendanceRecords) {
      const shift = shiftMap.get(rec.shift_id);
      const createdAt = rec.created_at;

      if (rec.selfie_photo_path) {
        if (!cutoffDate || createdAt <= cutoffDate) {
          photos.push({
            id: `selfie-${rec.id}`,
            bucket: "attendance-photos",
            path: rec.selfie_photo_path,
            shiftId: rec.shift_id,
            shiftDate: shift?.date || null,
            employeeId: rec.employee_id,
            employeeName: empMap.get(rec.employee_id) || "Unknown",
            type: "selfie",
            createdAt,
            signedUrl: null,
          });
        }
      }
      if (rec.site_photo_path) {
        if (!cutoffDate || createdAt <= cutoffDate) {
          photos.push({
            id: `site-${rec.id}`,
            bucket: "attendance-photos",
            path: rec.site_photo_path,
            shiftId: rec.shift_id,
            shiftDate: shift?.date || null,
            employeeId: rec.employee_id,
            employeeName: empMap.get(rec.employee_id) || "Unknown",
            type: "site_photo",
            createdAt,
            signedUrl: null,
          });
        }
      }
    }

    // 5. Stats
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000;
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

    const byAge = {
      last30Days: photos.filter((p) => new Date(p.createdAt).getTime() > thirtyDaysAgo).length,
      thirtyTo60Days: photos.filter((p) => {
        const t = new Date(p.createdAt).getTime();
        return t <= thirtyDaysAgo && t > sixtyDaysAgo;
      }).length,
      sixtyTo90Days: photos.filter((p) => {
        const t = new Date(p.createdAt).getTime();
        return t <= sixtyDaysAgo && t > ninetyDaysAgo;
      }).length,
      older90Days: photos.filter((p) => new Date(p.createdAt).getTime() <= ninetyDaysAgo).length,
    };

    const byType = {
      odometer: photos.filter((p) => p.type === "odometer_start" || p.type === "odometer_finish").length,
      taskProof: photos.filter((p) => p.type === "task_proof").length,
      selfie: photos.filter((p) => p.type === "selfie").length,
      sitePhoto: photos.filter((p) => p.type === "site_photo").length,
    };

    // By employee breakdown
    const empCounts = new Map<string, number>();
    for (const p of photos) {
      empCounts.set(p.employeeId, (empCounts.get(p.employeeId) || 0) + 1);
    }
    const byEmployee = Array.from(empCounts.entries())
      .map(([empId, count]) => ({
        employeeId: empId,
        employeeName: empMap.get(empId) || "Unknown",
        count,
      }))
      .sort((a, b) => b.count - a.count);

    const totalPhotos = photos.length;
    const estimatedStorageMB = Math.round(totalPhotos * 0.5 * 10) / 10;

    if (summaryOnly) {
      return NextResponse.json({
        totalPhotos,
        estimatedStorageMB,
        byEmployee,
        byAge,
        byType,
        employees: (employees || []).map((e) => ({ id: e.id, name: e.full_name })),
      });
    }

    // 6. Generate signed URLs for preview (limit to first 60)
    const previewPhotos = photos.slice(0, 60);
    for (const photo of previewPhotos) {
      const { data: signedData } = await adminClient.storage
        .from(photo.bucket)
        .createSignedUrl(photo.path, 3600);
      photo.signedUrl = signedData?.signedUrl || null;
    }

    return NextResponse.json({
      photos: previewPhotos,
      totalPhotos,
      estimatedStorageMB,
      byEmployee,
      byAge,
      byType,
      employees: (employees || []).map((e) => ({ id: e.id, name: e.full_name })),
    });
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();
    const body = await request.json();
    const { photoIds, deleteOlderThanDays, employeeId } = body as {
      photoIds?: string[];
      deleteOlderThanDays?: number;
      employeeId?: string;
    };

    if (!photoIds?.length && !deleteOlderThanDays) {
      return NextResponse.json(
        { error: "Provide photoIds or deleteOlderThanDays." },
        { status: 400 }
      );
    }

    // Verify the employee belongs to this business (if specified)
    if (employeeId) {
      const { data: emp } = await adminClient
        .from("employees")
        .select("id")
        .eq("id", employeeId)
        .eq("business_id", ctx.businessId)
        .single();
      if (!emp) {
        return NextResponse.json({ error: "Employee not found." }, { status: 404 });
      }
    }

    let deletedCount = 0;
    const errors: string[] = [];

    // Bulk delete by age (optionally filtered to one employee)
    if (deleteOlderThanDays && deleteOlderThanDays > 0) {
      const cutoff = new Date(Date.now() - deleteOlderThanDays * 24 * 60 * 60 * 1000).toISOString();

      // Only delete from completed shifts
      let shiftsQuery = adminClient
        .from("shifts")
        .select("id")
        .eq("business_id", ctx.businessId)
        .in("status", ["completed"]);

      if (employeeId) {
        shiftsQuery = shiftsQuery.eq("employee_id", employeeId);
      }

      const { data: completedShifts } = await shiftsQuery;
      const completedShiftIds = (completedShifts || []).map((s) => s.id);

      if (completedShiftIds.length === 0) {
        return NextResponse.json({ deleted: 0, message: "No completed shifts found." });
      }

      // Delete odometer photos
      let odoQuery = adminClient
        .from("odometer_submissions")
        .select("id, photo_path, shift_id")
        .eq("business_id", ctx.businessId)
        .in("shift_id", completedShiftIds)
        .lt("server_timestamp", cutoff);

      if (employeeId) {
        odoQuery = odoQuery.eq("employee_id", employeeId);
      }

      const { data: oldOdometer } = await odoQuery;

      for (const sub of oldOdometer || []) {
        if (!sub.photo_path) continue;
        const { error: delErr } = await adminClient.storage
          .from("odometer-photos")
          .remove([sub.photo_path]);
        if (delErr) {
          errors.push(`odometer ${sub.id}: ${delErr.message}`);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (adminClient as any)
            .from("odometer_submissions")
            .update({ photo_path: null })
            .eq("id", sub.id);
          deletedCount++;
        }
      }

      // Delete task proof photos
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let proofQuery = (adminClient as any)
        .from("task_proof_submissions")
        .select("id, photo_path, shift_id")
        .eq("business_id", ctx.businessId)
        .in("shift_id", completedShiftIds)
        .lt("server_timestamp", cutoff)
        .in("status", ["SUBMITTED", "APPROVED"]);

      if (employeeId) {
        proofQuery = proofQuery.eq("employee_id", employeeId);
      }

      const { data: oldProofs } = await proofQuery;

      for (const sub of oldProofs || []) {
        if (!sub.photo_path) continue;
        const { error: delErr } = await adminClient.storage
          .from("task-proof-photos")
          .remove([sub.photo_path]);
        if (delErr) {
          errors.push(`proof ${sub.id}: ${delErr.message}`);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (adminClient as any)
            .from("task_proof_submissions")
            .update({ photo_path: null })
            .eq("id", sub.id);
          deletedCount++;
        }
      }

      // Delete attendance photos
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let attQuery = (adminClient as any)
        .from("attendance_records")
        .select("id, selfie_photo_path, site_photo_path, shift_id")
        .eq("business_id", ctx.businessId)
        .in("shift_id", completedShiftIds)
        .lt("created_at", cutoff);

      if (employeeId) {
        attQuery = attQuery.eq("employee_id", employeeId);
      }

      const { data: oldAttendance } = await attQuery;

      for (const rec of oldAttendance || []) {
        const toRemove: { bucket: string; path: string; field: string }[] = [];
        if (rec.selfie_photo_path) {
          toRemove.push({ bucket: "attendance-photos", path: rec.selfie_photo_path, field: "selfie_photo_path" });
        }
        if (rec.site_photo_path) {
          toRemove.push({ bucket: "attendance-photos", path: rec.site_photo_path, field: "site_photo_path" });
        }
        for (const item of toRemove) {
          const { error: delErr } = await adminClient.storage
            .from(item.bucket)
            .remove([item.path]);
          if (delErr) {
            errors.push(`attendance ${rec.id} ${item.field}: ${delErr.message}`);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (adminClient as any)
              .from("attendance_records")
              .update({ [item.field]: null })
              .eq("id", rec.id);
            deletedCount++;
          }
        }
      }
    }

    // Individual photo deletion by IDs
    if (photoIds?.length) {
      for (const photoId of photoIds) {
        const [type, id] = photoId.split("-", 2);

        if (type === "odo") {
          const { data: sub } = await adminClient
            .from("odometer_submissions")
            .select("id, photo_path, shift_id, business_id")
            .eq("id", id)
            .eq("business_id", ctx.businessId)
            .single();

          if (sub?.photo_path) {
            await adminClient.storage.from("odometer-photos").remove([sub.photo_path]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (adminClient as any)
              .from("odometer_submissions")
              .update({ photo_path: null })
              .eq("id", id);
            deletedCount++;
          }
        } else if (type === "proof") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: sub } = await (adminClient as any)
            .from("task_proof_submissions")
            .select("id, photo_path, business_id")
            .eq("id", id)
            .eq("business_id", ctx.businessId)
            .single();

          if (sub?.photo_path) {
            await adminClient.storage.from("task-proof-photos").remove([sub.photo_path]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (adminClient as any)
              .from("task_proof_submissions")
              .update({ photo_path: null })
              .eq("id", id);
            deletedCount++;
          }
        } else if (type === "selfie") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: rec } = await (adminClient as any)
            .from("attendance_records")
            .select("id, selfie_photo_path, business_id")
            .eq("id", id)
            .eq("business_id", ctx.businessId)
            .single();

          if (rec?.selfie_photo_path) {
            await adminClient.storage.from("attendance-photos").remove([rec.selfie_photo_path]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (adminClient as any)
              .from("attendance_records")
              .update({ selfie_photo_path: null })
              .eq("id", id);
            deletedCount++;
          }
        } else if (type === "site") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: rec } = await (adminClient as any)
            .from("attendance_records")
            .select("id, site_photo_path, business_id")
            .eq("id", id)
            .eq("business_id", ctx.businessId)
            .single();

          if (rec?.site_photo_path) {
            await adminClient.storage.from("attendance-photos").remove([rec.site_photo_path]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (adminClient as any)
              .from("attendance_records")
              .update({ site_photo_path: null })
              .eq("id", id);
            deletedCount++;
          }
        }
      }
    }

    return NextResponse.json({
      deleted: deletedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `${deletedCount} photo${deletedCount !== 1 ? "s" : ""} deleted.`,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
