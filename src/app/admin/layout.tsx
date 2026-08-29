import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminNav from "@/components/AdminNav";
import AdminBottomNav from "@/components/AdminBottomNav";

export default async function AdminLayout({
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

  const { data: appUser } = await supabase
    .from("users")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  if (!appUser || appUser.role !== "admin" || appUser.account_status === "disabled") {
    redirect("/login");
  }

  return (
    <div className="min-h-screen flex flex-col pb-16 md:pb-0">
      <AdminNav />
      <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full">{children}</main>
      <AdminBottomNav />
    </div>
  );
}
