/**
 * Supabase Configuration
 *
 * IMPORTANT: Replace the placeholders below with your actual Supabase project values.
 *
 * 1. Go to https://supabase.com and create a project.
 * 2. Go to Project Settings → API.
 * 3. Copy your Project URL (SUPABASE_URL) and Anon Key (SUPABASE_ANON_KEY).
 * 4. Paste them below.
 *
 * --- IMPORTANT: Disable Email Confirmation ---
 * Go to: Supabase Dashboard → Authentication → Settings
 * Under "EMAIL CONFIRMATIONS" → Disable "Confirm email" (set to OFF)
 * This allows users to sign in immediately without email verification.
 */

// ===== CONFIGURE THESE ========================================
const SUPABASE_URL = 'https://rfsfkxplafwlmwncwduz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9iTTz6D1zvaEZIsauboxKQ__wyPfK5A';
// ==============================================================

// Public base URL used to build the secure QR verification link.
// When empty the app falls back to the current site's origin — which works
// once deployed (e.g. Vercel) but NOT from localhost/file://, because a phone
// cannot reach your PC. Set this to your PUBLIC deployment URL so receipts
// printed while working locally still produce scannable QR codes:
//   e.g. 'https://student-admission-app.vercel.app'
const RECEIPT_VERIFY_BASE_URL = '';

if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT')) {
  console.warn(
    ' Supabase not configured! Open js/supabase-config.js and set your SUPABASE_URL and SUPABASE_ANON_KEY.'
  );
}

/**
 * Supabase client instance.
 * Used throughout the app for auth and database operations.
 */
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// Export for ES module usage
export default supabaseClient;
export { SUPABASE_URL, SUPABASE_ANON_KEY, RECEIPT_VERIFY_BASE_URL };
