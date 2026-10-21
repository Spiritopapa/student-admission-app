import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { publicUrl, resolveFileUrl, photoUrl } from '../lib/storage';
import { STORAGE_BUCKETS } from '../lib/constants';

/**
 * Resolves an `accountants.photo_url` value into a displayable URL.
 *
 * The column is written by the registration/profile flows and can hold either
 * a full public URL (Cloudinary or a Supabase public URL) or a storage path.
 * A bare path belongs to the public `staff-photos` bucket, so it is resolved
 * there first; anything else falls back to the generic resolver.
 */
function resolveAccountantPhoto(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  // "staff-photos/<path>" or a bare file name inside that bucket.
  if (raw.startsWith(`${STORAGE_BUCKETS.staffPhotos}/`)) {
    return publicUrl(STORAGE_BUCKETS.staffPhotos, raw.slice(STORAGE_BUCKETS.staffPhotos.length + 1));
  }
  if (!raw.includes('/')) {
    return publicUrl(STORAGE_BUCKETS.staffPhotos, raw);
  }
  return resolveFileUrl(raw);
}

/**
 * Loads the logged-in accountant's own `accountants` record.
 *
 * The `accountants` row is the authoritative source for the accountant's
 * name: `sql/027-accountant-name-lock.sql` locks `accountants.full_name`
 * against self-service edits, so the value stored there is the one the
 * school admin set and it is the one that must be displayed.
 *
 * RLS: the "Accountants view own record" policy (see
 * `sql/022-registration-self-claim.sql`) allows an accountant to SELECT
 * only the row where `user_id = auth.uid()`, which is exactly what this
 * query asks for. Any other accountant row stays invisible to the
 * client, so no extra school filter is required (and adding one could
 * hide the row if the school link is out of sync).
 *
 * Fallback: when no accountant row can be read (not yet linked, or an
 * older deployment without the row), the caller falls back to the
 * authenticated profile name so the UI never shows an empty greeting.
 */
export function useAccountant() {
  const { user, profile } = useAuth();
  const isAccountant = String(profile?.role || '').toLowerCase() === 'accountant';
  const [accountant, setAccountant] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAccountant || !user?.id) {
      setAccountant(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const load = (columns) =>
      supabase
        .from('accountants')
        .select(columns)
        .eq('user_id', user.id)
        .limit(1)
        .then(({ data, error }) => {
          if (cancelled) return;
          // A missing row is not an error: the profile name is used instead.
          if (!error) setAccountant((data && data[0]) || null);
          return error;
        });
    load('id, full_name, registration_id, photo_url, school_id')
      .then((error) => {
        // Older deployments may not have the photo column yet. Retry without it
        // so the authoritative NAME is still loaded.
        if (error && !cancelled) {
          return load('id, full_name, registration_id, school_id');
        }
        return null;
      })
      .catch(() => {
        if (!cancelled) setAccountant(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAccountant, user?.id]);

  // Authoritative name first, authenticated profile name as the fallback.
  const fullName =
    (accountant?.full_name || '').trim() || (profile?.full_name || '').trim() || '';
  const firstName = fullName.split(' ')[0] || '';

  return {
    accountant,
    loading,
    fullName,
    firstName,
    registrationId: accountant?.registration_id || '',
    // The accountant's own staff photo is authoritative; the generic profile
    // picture is only used when the staff record has no photo.
    photo:
      accountant?.photo_url
        ? resolveAccountantPhoto(accountant.photo_url)
        : profile?.photo_url
          ? photoUrl(profile.photo_url)
          : profile?.avatar_url
            ? photoUrl(profile.avatar_url)
            : null,
  };
}
