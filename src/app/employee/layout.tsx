import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployeeNav from "@/components/EmployeeNav";

export default async function EmployeeLayout({
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

  if (!appUser || appUser.role !== "employee" || appUser.account_status === "disabled") {
    redirect("/login");
  }

  if (appUser.must_change_password) {
    redirect("/change-password");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <EmployeeNav />
      <main className="flex-1 p-4 md:p-6 max-w-4xl mx-auto w-full">{children}</main>
    </div>
  );
}
