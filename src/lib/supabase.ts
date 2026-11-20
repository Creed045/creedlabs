import { createClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://bfmappzsrehaprdrgokw.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmbWFwcHpzcmVoYXByZHJnb2t3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4MjE4NjMsImV4cCI6MjExMDM5Nzg2M30.1WVC8UhMJnR9Gkl3XVfD_OA4FvDiZc7wXIxmcRcswmI'

const supabaseUrl = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_SUPABASE_URL).trim()
const supabaseAnonKey = ((import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_SUPABASE_ANON_KEY).trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

// Only the public anon/publishable key belongs here. NEVER the service_role key.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})

let channelSeq = 0

/** Creates a unique Realtime channel instance per hook mount so concurrent mounts never collide. */
export function realtimeChannel(prefix: string) {
  channelSeq += 1
  return supabase.channel(`${prefix}-${channelSeq}`)
}