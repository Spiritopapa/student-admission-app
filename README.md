# SchoolRunner — Student Admission Portal

A modern, production-ready school management platform rebuilt with **React**, **Vite** and **Tailwind CSS** on the proven **Supabase** backend. The application covers the whole school journey — public admission applications, per-school administration, fee collection with verified receipts (QR + SMS notifications), examinations, attendance and parent/student portals.

The previous vanilla JavaScript implementation is preserved in [`legacy/`](./legacy) for reference and history.

---

## Tech Stack

| Layer       | Technology                                                        |
|-------------|-------------------------------------------------------------------|
| Frontend    | React 18, Vite, React Router, Tailwind CSS, Framer Motion          |
| Icons       | lucide-react (real icons, no emoji)                                |
| Backend     | Supabase (PostgreSQL, Auth, RLS, Storage)                          |
| Files       | Supabase Storage buckets (replaces Cloudinary)                     |
| SMS         | Nalo Solutions via `/api/send-sms` serverless function             |
| Hosting     | Vercel (SPA + `/api` serverless functions)                         |

### Three colour blending
The interface uses one signature **three-colour blend** (indigo → teal → amber) applied consistently through gradients, brand marks and the sidebar active state, giving the whole product a cohesive, professional identity.

---

## Features

### Public
- Landing page with responsive marketing sections
- **Apply for admission** — public form with photo upload, stored securely in Supabase Storage
- Register an account for every role (Student, Parent, School, Sub Admin, Teacher, Accountant, Super Admin) with the original multi-stage School wizard
- Sign in with **email or registration ID** (e.g. `STU-XXXXX`, `TCH-SIN-0001`, `SCH-SIS-0001`, staff IDs)
- Forgot password via **SMS OTP** (same Nalo gateway)
- **Verify a receipt** by number or QR token (old `verify-receipt.html` links still work)
- School onboarding application form

### Student portal
- Overview with fee balance, attendance rate and performance
- Fee details, payment history and receipts with **QR verification modal**
- Exam report cards with grades, averages, teacher remarks and **print**
- Attendance records by year/term
- Published assessments and scores
- Announcements, profile editing, photo upload and password change

### Parent portal
- Linked wards overview
- Ward profiles, fees, balances and verified receipts
- Announcements and profile management
### School Admin portal (admin + sub-admin)
- Dashboard with students, classes, teachers and fee totals
- Students: search, admit (auto Student ID + photo + term fee), view, delete
- Classes and Subjects management
- Teachers: add (auto Teacher ID), approve portal access, transport-collector flag, delete
- Announcements with priority and show/hide
- Fee structure per class, term and academic year
- School settings: name, logo upload, academic year, term, password

### Teacher portal
- Overview with class assignment
- My class student list
- **Daily attendance marking** (present/absent, saved per date)

### Accountant portal
- Overview with today's collections
- **Collect payment** -> `process_fee_payment`, issues a verified receipt, optional parent SMS
- Receipt history with QR verification

### Super Admin portal
- Platform overview (schools, pending applications, students, teachers)
- Schools: approve/unapprove, reset administrator password
- School applications: approve, reject, delete

---

## Project Structure

```
student-admission-app/
├── index.html            # Vite entry
├── vite.config.js        # Build + chunk splitting
├── tailwind.config.js    # Three-colour design system
├── vercel.json           # SPA rewrites + /api routes
├── api/
│   ├── send-sms.js       # Nalo SMS gateway proxy (unchanged behaviour)
│   ├── storage-delete.js # Supabase Storage delete proxy (service role)
│   └── cloudinary-delete.js # Legacy (kept for backwards compatibility)
├── sql/
│   ├── 000-run-all.sql   # Existing schema (unchanged)
│   ├── 073-supabase-storage-buckets.sql        # NEW storage buckets + policies
│   └── 074-public-admission-application.sql    # NEW public apply RPC
├── src/
│   ├── main.jsx / App.jsx / routes
│   ├── lib/        # supabase client, storage, queries, format helpers
│   ├── context/    # AuthContext (role guards) + ToastContext
│   ├── components/ # UI primitives, guard routes, receipt modal
│   ├── layout/     # Public + dashboard layouts (responsive sidebar)
│   ├── hooks/      # school settings, student application
│   └── pages/      # public / student / parent / admin / teacher / accountant / superadmin
└── legacy/         # Original vanilla app (preserved, not deployed)
```

---

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build to dist/
npm run preview    # serve the production build
```

### Environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_RECEIPT_VERIFY_BASE_URL=
```

Server-side variables live only in Vercel (never shipped to the browser):

```
NALO_SMS_AUTH_KEY         # SMS gateway
NALO_SMS_SENDER_ID
SUPABASE_SERVICE_ROLE_KEY # used by /api/storage-delete
```

### Supabase migrations

Your existing data and tables are untouched. Run the two new migrations in the Supabase SQL editor:

1. `sql/073-supabase-storage-buckets.sql` - creates the public buckets (`student-photos`, `applications`, `school-logos`, `documents`) with RLS policies. Authenticated users upload; anonymous users may only upload to `applications`; deletes happen server-side through `/api/storage-delete`.
2. `sql/074-public-admission-application.sql` - secure public admission application RPC + public school lookup for the apply page.

### Deployment (Vercel)

1. Push the repository to GitHub (your existing auto-deploy hook keeps working).
2. Import the repo into Vercel - it detects Vite automatically (build `npm run build`, output `dist`).
3. Add the environment variables above under Settings > Environment Variables (Production, Preview, Development).
4. Deploy. SPA rewrites and `/api/*` serverless functions are configured in `vercel.json`.

Old QR links still work: `/verify-receipt.html?t=...` is rewritten to the new React verification page.

---

## Migration roadmap

The core product described above is fully functional in React. The remaining back-office modules from the legacy app (exams/grading management, transport, income & expenses, backups, SMS monitoring, assessments authoring) are planned as incremental ports on this React foundation. The original implementations remain available in `legacy/js/modules/` and use the exact same Supabase tables and RPCs.

---

## License

MIT
