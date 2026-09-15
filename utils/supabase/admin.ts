import "server-only";

import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !secretKey) {
        throw new Error(
            "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY.",
        );
    }

    return createClient(supabaseUrl, secretKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
        },
    });
}