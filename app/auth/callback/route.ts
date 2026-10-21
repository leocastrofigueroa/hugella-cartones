import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/admin";

  const safeNext =
  next.startsWith("/") && !next.startsWith("//")
    ? next
    : "/admin";

  if (!code) {
    return NextResponse.redirect(
      new URL("/admin/login", url.origin),
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(
        "/reset-password?error=recovery",
        url.origin,
      ),
    );
  }

  return NextResponse.redirect(
    new URL(safeNext, url.origin),
  );
}
