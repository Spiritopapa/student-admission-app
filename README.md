# 🎓 Student Admission Portal

A full-featured student admission web application built with vanilla JavaScript, HTML/CSS, and [Supabase](https://supabase.com) for authentication and database. Designed for easy deployment on **Vercel** and **GitHub Pages**.

---

## 📋 Features

- **Student Application Form** — Collect personal & academic info
- **User Authentication** — Register, Login, Logout (powered by Supabase Auth)
- **Dashboard** — View submitted applications and their status (pending / reviewed / accepted / rejected)
- **Row-Level Security** — Each user sees only their own data
- **Responsive Design** — Works on desktop, tablet, and mobile
- **SPA Navigation** — No page reloads when switching between sections

---

## 🗂 Project Structure

```
student-admission-app/
├── index.html              # Main HTML entry point
├── css/
│   └── styles.css          # All styles (responsive, modern)
├── js/
│   ├── supabase-config.js  # Supabase client initialization
│   ├── cloudinary-config.js# Cloudinary public config (cloud name + upload preset)
│   ├── app.js              # Application logic (auth, forms, dashboard)
│   └── modules/
│       ├── cloudinary.js   # Cloudinary upload / delete helpers
│       └── ...             # all feature modules
├── api/
│   ├── cloudinary-delete.js# Serverless proxy for deleting Cloudinary assets
│   └── send-sms.js         # Nalo SMS payment notifications
├── supabase-schema.sql     # SQL to set up database tables & policies
├── vercel.json             # Vercel deployment configuration
├── package.json            # Metadata (optional, for local dev)
├── .env.example            # Environment variable template
└── README.md               # You're reading it!
```

---

## 🚀 Getting Started

### 1. Clone or download the project

```bash
git clone https://github.com/YOUR_USERNAME/student-admission-app.git
cd student-admission-app
```

### 2. Set up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Once created, navigate to **Project Settings → API**.
3. Copy your **Project URL** and **anon / public key**.

### 3. Configure Supabase credentials

Open **`js/supabase-config.js`** and replace the placeholder values:

```js
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';       // ← Replace
const SUPABASE_ANON_KEY = 'your-anon-key-here';                // ← Replace
```

> ⚠️ Do **not** commit real credentials to a public repo. Use environment variables or a `.env` file if you fork for production.

### 4. Run the database schema

1. In your Supabase Dashboard, go to **SQL Editor**.
2. Open **`supabase-schema.sql`** in this project.
3. Copy the entire content and paste it into the SQL Editor.
4. Click **Run** to create the tables, triggers, and policies.

### 5. Serve the app locally (optional)

```bash
npx serve .
```

Or open `index.html` directly (some features like live reload won't work without a server).

### 6. (Optional) Set up Cloudinary for images & files

Every image / file in the app — student photos, school logos, and teacher certificate / appointment-letter PDFs — is uploaded to **Cloudinary**, and the returned URL is stored in Supabase columns (`student_photo_url`, `logo_url`, `photo_url`, `file_url`). The frontend then pulls every image by URL, exactly as before, so **no display code changes**.

1. Create a free account at [cloudinary.com](https://cloudinary.com).
2. Open **js/cloudinary-config.js** and set:
   - `CLOUDINARY_CLOUD_NAME` — your Cloud Name (on the Dashboard).
   - `CLOUDINARY_UPLOAD_PRESET` — an **Unsigned** upload preset
     (Cloudinary Dashboard → **Settings → Upload → Add upload preset** →
     Signing Mode: **Unsigned**; enable a default folder such as `online_v`).
     > Until these two values are set, the app automatically keeps using
     > Supabase Storage, so you can migrate at your own pace.
3. For **file deletion** (replacing a photo / document), add the Cloudinary
   API credentials as **Vercel environment variables** (never in `js/`):
   `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
   The serverless function `api/cloudinary-delete.js` signs the Admin API
   *destroy* request server-side, mirroring the `/api/send-sms` pattern.

---

## 🌐 Deploy to Vercel

1. Push the project to a **GitHub repository**.
2. Go to [vercel.com](https://vercel.com) and click **Add New → Project**.
3. Import your GitHub repo.
4. In the **"Root Directory"** field, enter `student-admission-app`.
5. (Optional) Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
   > The Supabase app reads these from `js/supabase-config.js` and the Cloudinary public values from `js/cloudinary-config.js`. On Vercel, you can also swap them at build time if you prefer. The two `CLOUDINARY_API_*` secrets are **only** read by `/api/cloudinary-delete`.
6. Click **Deploy**.

Your app will be live at `https://student-admission-app.vercel.app`.

---

## 🔐 Row Level Security (RLS)

The `supabase-schema.sql` enables **Row Level Security** on both the `profiles` and `applications` tables:

- Users can **read** only their own rows (`auth.uid() = user_id`)
- Users can **insert** their own rows
- Users can **update** their own rows

An automatic trigger creates a `profiles` row when a new user signs up via Supabase Auth.

---

## 📱 SMS Payment Notifications (Nalo Solutions)

Every time a fee payment is recorded (by an **admin** in *Fees Management → Record Payment* or by an **accountant** on their dashboard), the app instantly sends an SMS receipt confirmation to the student's **parent/guardian contact**.

Example message:

```
NASCO JHS: Paid GH₵1000.00 for Kofi Mensah (First Term 2025/2026). Receipt: RCP-2026-000123. Thank you.
```

### How it works

1. `js/modules/sms-gateway.js` — after `process_fee_payment` succeeds, it reads the parent's phone number from the `applications` table, normalizes it to `233XXXXXXXXX`, and POSTs `{ phone, message }` to `/api/send-sms`.
2. `api/send-sms.js` — a Vercel serverless function that forwards the message to the Nalo gateway
   (`https://sms.nalosolutions.com/smsbackend/Resl_Nalo/send-message/`). The Nalo credentials are only read server-side from Vercel environment variables, so the secret key is never exposed to the browser.
3. Every attempt is written to the **`sms_logs`** table (`sql/041-sms-gateway.sql`) for auditing. A receipt only ever triggers **one** successful SMS (duplicate guard).

### Configuration

Set these in **Vercel → Project → Settings → Environment Variables**:

| Variable | Required | Description |
|---|---|---|
| `NALO_SMS_AUTH_KEY` | preferred | Nalo API auth key (from your Nalo dashboard) |
| `NALO_SMS_USERNAME` / `NALO_SMS_PASSWORD` | fallback | Account login used only if no `AUTH_KEY` is set |
| `NALO_SMS_SENDER_ID` | optional | Registered sender ID (defaults to `NALO`) |

Then run `sql/041-sms-gateway.sql` in the Supabase SQL Editor (or re-run `sql/000-run-all.sql`).

> The `sms_logs` table and the `/api/send-sms` function are protected by RLS / server-side secrets respectively. Messages are sent fire-and-forget, so an SMS failure never blocks the payment receipt from being generated.

### 📨 SMS Monitoring (Admin)

School admins can monitor every SMS attempt from the **SMS Monitoring** module in the sidebar:

- Summary cards (total / sent / unsent-failed / sent today) plus tabs for **All**, **Sent** and **Unsent / Failed**.
- Search by phone, student ID, receipt number or message text, and filter by date range.
- A **View** modal shows the full message text, sender ID, provider response and the failure reason for unsent messages.
- **Resend** button on any failed message re-sends it through `/api/send-sms` and logs the new attempt as a fresh `sms_logs` row.
- The list refreshes automatically when new SMS rows are written (realtime subscription).

To enable the module, run `sql/043-sms-monitoring-module.sql` (included in `sql/000-run-all.sql`). It only registers the `sms-monitoring` module for Super-Admin lock/unlock control — no new tables are created because the module reads the existing `sms_logs` audit table. The Super Admin can lock it per school via **Schools → Module Locks**.

### 📨 Bulk Fee Reminder SMS (Admin → Fees → Debtors)

School admins can send a single fee-reminder SMS to every debtor's parent/guardian straight from the **Fees Management → Debtors** tab:

- Use the **class filter** (`All Classes` or a specific class) so the bulk SMS targets exactly the class you want.
- Tick the **Select All** checkbox or pick individual debtors manually — a live **"N selected"** counter shows how many are queued.
- Click **📨 Send Fee Reminder SMS**; each parent receives a short message with the school name, the student's name, class and their exact outstanding GH₵ balance.
- Debtors with no valid Ghana phone number are skipped and reported; every attempt is audited as a new `sms_logs` row (visible in SMS Monitoring) so failed sends can be retried.

> Requires the same Nalo gateway as above: set `NALO_SMS_AUTH_KEY` (or username/password) as a **Vercel environment variable** and deploy. Without it `/api/send-sms` returns `500 "Nalo SMS is not configured ..."` and the app now shows that exact reason in the result message.


## 🔑 Forgot Password (SMS OTP)

On the **sign-in page** there is a "Forgot password?" link that lets any user reset their own password by confirming the mobile number on file:

1. **Identify** — enter the email or ID you sign in with.
2. **Confirm** — the app shows only the **last 3 digits** of the registered mobile number as a hint; you type the **full number**. *Students must use the parent/guardian mobile number (the one recorded in the app).*
3. **Reset** — a 6-digit code is sent by SMS (via Nalo, `/api/send-sms`); enter it with your new password.

### Behind the scenes (`sql/042-forgot-password.sql`)
- **`profiles.phone`** is the canonical mobile for every role. It is captured on registration (a **Mobile Number** field was added to all registration forms) and backfilled from existing records (teacher/accountant/school-admin; student → parent contact; parent → ward's parent contact).
- **`password_reset_otps`** stores bcrypt-hashed OTPs, single-use, expiring in 10 minutes, max 5 attempts.
- Three public RPCs (`lookup_forgot_password_account`, `request_forgot_password_otp`, `verify_forgot_password_otp`) are granted to `anon` so logged-out users can use the flow. The identifier → account resolver mirrors the exact logic used at sign-in.

> The OTP SMS uses the same Nalo gateway + `/api/send-sms` as fee-payment notifications, so no extra environment variables are needed beyond the existing `NALO_SMS_*` keys.



1. Open the deployed or local app.
2. Click **Register** and create an account.
3. Log in and click **Apply Now**.
4. Fill out and submit the admission form.
5. Go to **Dashboard** to see the submitted application with its status.
6. To change the status, manually update the row in Supabase Table Editor (e.g. from `pending` to `accepted`).

---

## 📦 Tech Stack

| Layer       | Technology        |
|-------------|-------------------|
| Frontend    | HTML5, CSS3, JavaScript (Vanilla) |
| Backend     | Supabase (PostgreSQL + Auth) |
| Media       | Cloudinary (image / file storage & CDN) |
| Hosting     | Vercel / GitHub Pages |
| CDN         | supabase-js v2 loaded via jsdelivr |

---

## 🤝 Contributing

Pull requests are welcome! For major changes, open an issue first to discuss what you'd like to change.

---

## 📄 License

MIT