import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import PlatformNav from "@/components/PlatformNav";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Use admin client to check is_platform_admin
  const adminClient = createAdminClient();
  const { data: appUser } = await adminClient
    .from("users")
    .select("is_platform_admin, account_status")
    .eq("auth_user_id", user.id)
    .single();

  if (!appUser || !appUser.is_platform_admin || appUser.account_status === "disabled") {
    redirect("/login");
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PlatformNav />
      <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full">{children}</main>
    </div>
  );
}
