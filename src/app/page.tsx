// Root page — redirects to the right place based on auth state and role.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function RootPage() {
  const supabase = await createClient();

  // 1. Check if user is logged in
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 2. Get the user's app profile (use admin client so is_platform_admin is visible)
  const adminClient = createAdminClient();
  const { data: appUser } = await adminClient
    .from("users")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  if (!appUser) {
    await supabase.auth.signOut();
    redirect("/login");
  }

  // 3. Account disabled?
  if (appUser.account_status === "disabled") {
    await supabase.auth.signOut();
    redirect("/login");
  }

  // 4. Must change password on first login?
  if (appUser.must_change_password) {
    redirect("/change-password");
  }

  // 5. Route to role-specific dashboard
  if (appUser.is_platform_admin) {
    redirect("/platform/home");
  } else if (appUser.role === "admin") {
    redirect("/admin/dashboard");
  } else {
    redirect("/employee/shifts");
  }
}
