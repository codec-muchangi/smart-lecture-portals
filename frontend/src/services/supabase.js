import { createClient } from '@supabase/supabase-js'

// Anon key only. The service-role key must never appear in frontend code.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'anon-placeholder',
)
