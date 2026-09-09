import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import AdminDashboard from "./admin-dashboard";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub) {
    redirect("/admin/login");
  }

  return <AdminDashboard email={String(data.claims.email ?? "Administrador")} />;
}
