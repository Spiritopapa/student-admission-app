/**
 * Vercel Serverless Function — Nalo Solutions SMS Proxy
 * =====================================================
 * Sends an SMS through the Nalo Solutions gateway:
 *
 *   https://sms.nalosolutions.com/smsbackend/Resl_Nalo/send-message/
 *
 * The Nalo credentials live ONLY in Vercel environment variables so the
 * secret key is never shipped to the browser (the static SPA cannot be
 * trusted with it). This mirrors the existing RESEND_API_KEY pattern
 * referenced in .env.example.
 *
 *   NALO_SMS_AUTH_KEY     Nalo API "key" (auth_key)          [preferred]
 *   NALO_SMS_USERNAME     Nalo account username (fallback auth)
 *   NALO_SMS_PASSWORD     Nalo account password (fallback auth)
 *   NALO_SMS_SENDER_ID    Registered sender id (default "NALO")
 *
 * App-facing request (unchanged client contract):
 *   POST /api/send-sms
 *   { "phone": "233240000000", "message": "...", "sender_id": "NALO" }
 *
 * Transport to Nalo — CRITICAL:
 *   Nalo's "send-message" API is an HTTP FORM endpoint. It does NOT speak
 *   JSON: a JSON body (or wrong parameter names) is rejected with error
 *   "1702" and the SMS is never handed to the operator. The upstream call
 *   MUST use application/x-www-form-urlencoded with Nalo's exact parameter
 *   names: key (or username+password), type, source, destination, dlr,
 *   message.
 *
 * Nalo status "1701" = success. The gateway replies either as a pipe
 * string ("1701|233501234567|message_id") or JSON ({"status":"1701",...}).
 * Both formats are handled.
 */

const NALO_ENDPOINT =
  'https://sms.nalosolutions.com/smsbackend/Resl_Nalo/send-message/';

/**
 * Normalize a Ghana phone number to international 233XXXXXXXXX form.
 * Accepts "0244...", "+23324...", "23324...", with spaces/dashes stripped.
 */
function normalizeGhanaPhone(raw) {
  if (raw == null) return null;
  let digits = String(raw).trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('233')) return digits.length === 12 ? digits : null;
  if (digits.startsWith('0') && digits.length === 10) return '233' + digits.slice(1);
  return null;
}

/** Extract the Nalo status code from either response format. */
function parseNaloStatus(raw) {
  if (!raw) return null;
  const text = String(raw).trim().replace(/\r/g, '');
  const pipe = /^(\d{4})\|/.exec(text); // "1701|233501234567|msg_id"
  if (pipe) return pipe[1];
  const bare = /^(\d{4})(?:\s|$)/.exec(text); // bare "1701"
  if (bare) return bare[1];
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.status) return String(parsed.status);
  } catch (e) {
    /* not JSON */
  }
  return null;
}

function naloErrorText(code) {
  const map = {
    '1025': 'Insufficient SMS credit on the Nalo account',
    '1026': 'Insufficient SMS credit on the Nalo reseller account',
    '1702': 'Invalid request to Nalo gateway (missing/invalid parameter)',
    '1703': 'Invalid Nalo username or password',
    '1704': 'Invalid message type',
    '1705': 'Invalid message',
    '1706': 'Invalid destination number',
    '1707': 'Invalid or unapproved sender ID',
    '1708': 'Invalid DLR setting',
    '1709': 'Nalo user validation failed',
    '1710': 'Nalo internal error',
  };
  return map[code] || 'Nalo gateway rejected the message';
}

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

/**
 * Await a promise but fail with a clear error after `ms` milliseconds.
 * The Nalo gateway can hang; the timeout keeps the function from
 * occupying the Vercel invocation slot forever.
 */
async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('gateway timed out after ' + ms / 1000 + 's')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, {
      success: false,
      error: 'Method not allowed. Use POST.',
    });
  }

  // Parse the JSON body (Vercel may pre-parse it, may come as a raw string)
  let payload;
  try {
    payload =
      typeof req.body === 'object' && req.body !== null
        ? req.body
        : JSON.parse(req.body || '{}');
  } catch (e) {
    return json(res, 400, { success: false, error: 'Invalid JSON body.' });
  }

  const phone = normalizeGhanaPhone(payload.phone || payload.destination);
  const message = String(payload.message || '').trim();
  if (!phone) {
    return json(res, 400, {
      success: false,
      error: 'A valid recipient phone (233XXXXXXXXX) is required.',
    });
  }
  if (!message) {
    return json(res, 400, { success: false, error: 'Message text is required.' });
  }

  const senderId = String(payload.sender_id || process.env.NALO_SMS_SENDER_ID || 'NALO').trim();

  const authKey = (process.env.NALO_SMS_AUTH_KEY || '').trim();
  const username = (process.env.NALO_SMS_USERNAME || '').trim();
  const password = (process.env.NALO_SMS_PASSWORD || '').trim();

  if (!authKey && !(username && password)) {
    return json(res, 500, {
      success: false,
      error:
        'Nalo SMS is not configured. Set NALO_SMS_AUTH_KEY (or NALO_SMS_USERNAME + NALO_SMS_PASSWORD) as Vercel environment variables.',
    });
  }

  // Nalo's send-message API is an HTTP FORM endpoint: JSON bodies and wrong
  // parameter names are rejected with "1702" and the SMS never leaves the
  // gateway. Everything goes through urlencoded fields with Nalo's exact
  // parameter names (key | username+password, type, source, destination,
  // dlr, message) — NOT msisdn / sender_id.
  const params = new URLSearchParams();
  if (authKey) {
    params.set('key', authKey);
  } else {
    params.set('username', username);
    params.set('password', password);
  }
  params.set('type', '0'); // 0 = plain text message
  params.set('destination', phone);
  params.set('source', senderId);
  params.set('dlr', '1'); // request a delivery report
  params.set('message', message);

  let upstream;
  try {
    upstream = await withTimeout(
      fetch(NALO_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      }),
      15000
    );
  } catch (err) {
    return json(res, 502, {
      success: false,
      error: 'Failed to reach Nalo gateway: ' + err.message,
    });
  }

  const raw = await upstream.text().catch(() => '');
  const statusCode = parseNaloStatus(raw);

  if (statusCode === '1701') {
    return json(res, 200, {
      success: true,
      status: '1701',
      message: 'SMS accepted by Nalo gateway',
      providerRaw: raw,
    });
  }

  return json(res, 502, {
    success: false,
    status: statusCode || 'unknown',
    message: naloErrorText(statusCode),
    providerRaw: raw,
  });
};
