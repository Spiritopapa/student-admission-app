import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rfsfkxplafwlmwncwduz.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_9iTTz6D1zvaEZIsauboxKQ__wyPfK5A'

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
)