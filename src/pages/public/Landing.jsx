import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  FileCheck2,
  Wallet,
  CalendarCheck,
  Award,
  BellRing,
  School,
  Users,
  ShieldCheck,
  Smartphone,
  RefreshCw,
  ReceiptText,
  BookOpen,
  GraduationCap,
  MessageSquareText,
} from 'lucide-react';
import { BrandTagline } from '../../components/Logo';
import { useAuth } from '../../context/AuthContext';
import { roleBasePath } from '../../lib/nav';

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] },
  }),
};

const FEATURES = [
  {
    icon: FileCheck2,
    title: 'Online Admission',
    text: 'Prospective students apply online with photos and documents, and the school receives every application instantly.',
    tone: 'bg-brand-50 text-brand-600',
  },
  {
    icon: Wallet,
    title: 'Fee Management',
    text: 'Per-term fees, balances, receipt printing and mobile-money payments all recorded in one secure ledger.',
    tone: 'bg-teal-50 text-teal-600',
  },
  {
    icon: ReceiptText,
    title: 'Verified Receipts',
    text: 'Every receipt carries a QR code anyone can scan to instantly verify its authenticity.',
    tone: 'bg-accent-500/10 text-accent-600',
  },
  {
    icon: CalendarCheck,
    title: 'Attendance Tracking',
    text: 'Daily present and absent records with per-term summaries visible to teachers, parents and students.',
    tone: 'bg-emerald-50 text-emerald-600',
  },
  {
    icon: Award,
    title: 'Exams & Report Cards',
    text: 'Examination records, letter grades and printable report cards with class performance levels.',
    tone: 'bg-brand-50 text-brand-600',
  },
  {
    icon: BellRing,
    title: 'SMS Notifications',
    text: 'Parents receive instant SMS alerts whenever a fee payment or important announcement is recorded.',
    tone: 'bg-teal-50 text-teal-600',
  },
];

const ROLES_SECTION = [
  {
    icon: GraduationCap,
    title: 'Prospective Students',
    text: 'Apply in minutes, upload your details and track your status until you receive your student ID.',
  },
  {
    icon: School,
    title: 'School Administrators',
    text: 'Admit students, generate IDs, set term fees and manage classes, teachers and announcements.',
  },
  {
    icon: Users,
    title: 'Parents',
    text: 'Follow your child\u2019s fees, results, attendance and announcements through your own portal.',
  },
];

export default function Landing() {
  const { user, profile } = useAuth();

  return (
    <div className="overflow-x-hidden">
      <section className="relative bg-blend-radial pb-20 pt-14 sm:pt-20">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <motion.div initial="hidden" animate="show">
            <motion.div variants={fadeUp} custom={0}>
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-700">
                <span className="h-2 w-2 rounded-full bg-blend" />
                Built for modern schools
              </span>
            </motion.div>
            <motion.h1
              variants={fadeUp}
              custom={1}
              className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl lg:text-6xl"
            >
              Admissions, fees and results in{' '}
              <span className="bg-gradient-to-r from-brand-600 via-teal-600 to-accent-500 bg-clip-text text-transparent">
                one place
              </span>
            </motion.h1>
            <motion.p
              variants={fadeUp}
              custom={2}
              className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600"
            >
              SchoolRunner streamlines the entire school journey. Apply online, manage fees with
              verified receipts, track attendance and deliver report cards to parents through SMS
              and secure portals.
            </motion.p>
            <motion.div variants={fadeUp} custom={3} className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/apply"
                className="btn-primary bg-blend px-6 py-3 text-base shadow-card hover:opacity-95"
              >
                Apply for Admission
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                to={user ? roleBasePath(profile?.role) : '/login'}
                className="btn-secondary px-6 py-3 text-base"
              >
                {user ? 'Open my dashboard' : 'Sign in'}
              </Link>
            </motion.div>
            <motion.div variants={fadeUp} custom={4} className="mt-10 grid max-w-lg grid-cols-3 gap-6">
              <div>
                <p className="text-2xl font-extrabold text-slate-900">5 min</p>
                <p className="text-xs text-slate-500">to apply</p>
              </div>
              <div>
                <p className="text-2xl font-extrabold text-slate-900">1</p>
                <p className="text-xs text-slate-500">verified ledger</p>
              </div>
              <div>
                <p className="text-2xl font-extrabold text-slate-900">24/7</p>
                <p className="text-xs text-slate-500">parent access</p>
              </div>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="relative hidden lg:block"
          >
            <div className="relative mx-auto max-w-md rounded-3xl border border-white/60 bg-white/70 p-6 shadow-card backdrop-blur-md">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blend text-white">
                  <School className="h-6 w-6" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-800">Sunshine International School</p>
                  <p className="text-xs text-slate-400">Academic year 2025/2026 - First Term</p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-brand-50 p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm">
                      <Wallet className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-semibold text-slate-700">Term Fee Paid</p>
                  </div>
                  <p className="text-sm font-extrabold text-brand-700">GHC 1,250.00</p>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-teal-50 p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-teal-600 shadow-sm">
                      <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-semibold text-slate-700">Attendance</p>
                  </div>
                  <p className="text-sm font-extrabold text-teal-700">98%</p>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-accent-500/10 p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-accent-600 shadow-sm">
                      <Award className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-semibold text-slate-700">Performance</p>
                  </div>
                  <p className="text-sm font-extrabold text-accent-600">Excellent</p>
                </div>
              </div>
              <div className="mt-5 rounded-xl border border-dashed border-slate-200 p-3 text-center">
                <p className="flex items-center justify-center gap-2 text-xs font-medium text-slate-400">
                  <RefreshCw className="h-3.5 w-3.5 text-teal-500" aria-hidden="true" />
                  Live updates via SMS notifications
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-teal-600">Everything included</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            One platform for the whole school
          </h2>
          <p className="mt-4 text-slate-500">
            From the first application to the final report card, every step is tracked securely.
          </p>
        </motion.div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.1 }}
              whileHover={{ y: -4 }}
              className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-soft transition-shadow hover:shadow-card"
            >
              <span className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${feature.tone}`}>
                <feature.icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-base font-bold text-slate-800">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{feature.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="roles" className="border-y border-slate-200/60 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            className="mx-auto max-w-2xl text-center"
          >
            <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Who it is for</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              A dedicated space for everyone
            </h2>
          </motion.div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {ROLES_SECTION.map((role, i) => (
              <motion.div
                key={role.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="rounded-2xl border border-slate-200/70 bg-slate-50/50 p-6"
              >
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blend-soft text-white shadow-card">
                  <role.icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-bold text-slate-800">{role.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{role.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-blend py-16">
        <div className="absolute inset-0 bg-blend-radial" />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative mx-auto max-w-3xl px-4 text-center sm:px-6"
        >
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Ready to simplify your school?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/85">
            Join schools already running admissions, fees and results on SchoolRunner. Apply today
            and get started in minutes.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/apply"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold text-brand-700 shadow-card transition-transform hover:scale-[1.02]"
            >
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
              Apply for Admission
            </Link>
            <Link
              to="/school-onboarding"
              className="inline-flex items-center gap-2 rounded-xl border border-white/40 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10"
            >
              <School className="h-4 w-4" aria-hidden="true" />
              Register My School
            </Link>
          </div>
        </motion.div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            { icon: Smartphone, title: 'Works everywhere', text: 'Responsive design tuned for phones, tablets and desktop.' },
            { icon: ShieldCheck, title: 'Private by design', text: 'Every user only sees data for their own school.' },
            { icon: MessageSquareText, title: 'SMS updates', text: 'Parents stay informed with instant text notifications.' },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                <item.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-800">{item.title}</p>
                <p className="mt-1 text-sm text-slate-500">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 py-12 sm:px-6 md:flex-row lg:px-8">
          <div>
            <p className="text-xl font-bold text-white">Take the next step</p>
            <p className="mt-1 text-sm text-slate-400">
              Sign in to your portal or begin a new admission application.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-slate-900 hover:bg-slate-100"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Sign in
            </Link>
            <Link
              to="/school-onboarding"
              className="inline-flex items-center gap-2 rounded-xl bg-blend-soft px-5 py-2.5 text-sm font-bold text-white"
            >
              <BellRing className="h-4 w-4" aria-hidden="true" />
              School onboarding
            </Link>
          </div>
        </div>
      </section>

      <p className="flex items-center justify-center gap-2 bg-slate-900 pb-8 text-center text-xs text-slate-500">
        <BrandTagline />
      </p>
    </div>
  );
}