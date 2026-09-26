import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GraduationCap,
  Users,
  UserRound,
  ShieldCheck,
  Briefcase,
  Calculator,
  School,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Logo } from '../../components/Logo';
import {
  StudentForm,
  ParentForm,
  SchoolWizard,
  SubAdminForm,
  TeacherForm,
  AccountantForm,
  SuperAdminForm,
} from './registerForms';

const ROLE_TABS = [
  { value: 'school', label: 'School', icon: School, hint: 'School administrators' },
  { value: 'student', label: 'Student', icon: GraduationCap, hint: 'Students' },
  { value: 'parent', label: 'Parent', icon: Users, hint: 'Parents / guardians' },
  { value: 'sub_admin', label: 'Sub Admin', icon: Briefcase, hint: 'School staff' },
  { value: 'teacher', label: 'Teacher', icon: UserRound, hint: 'Teaching staff' },
  { value: 'accountant', label: 'Accountant', icon: Calculator, hint: 'Finance staff' },
  { value: 'super_admin', label: 'Super Admin', icon: ShieldCheck, hint: 'Platform owner' },
];

export default function Register() {
  const { superAdminExists } = useAuth();
  const [active, setActive] = useState('student');
  const [canRegisterSuper, setCanRegisterSuper] = useState(false);

  useEffect(() => {
    superAdminExists()
      .then((exists) => setCanRegisterSuper(!exists))
      .catch(() => setCanRegisterSuper(false));
  }, [superAdminExists]);

  const tabs = ROLE_TABS.filter((t) => t.value !== 'super_admin' || canRegisterSuper);

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="mb-8 text-center"
      >
        <div className="flex justify-center">
          <Logo size="md" />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Create your account
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Choose the account type that matches your role at the school.
        </p>
      </motion.div>

      <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tabs.map((tab) => {
          const isActive = active === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActive(tab.value)}
              className={`flex flex-col items-center gap-1.5 rounded-2xl border px-3 py-3.5 text-center transition-all ${
                isActive
                  ? 'border-brand-500 bg-brand-50 shadow-soft'
                  : 'border-slate-200 bg-white hover:border-brand-200 hover:bg-slate-50'
              }`}
            >
              <tab.icon
                className={`h-5 w-5 ${isActive ? 'text-brand-600' : 'text-slate-400'}`}
                aria-hidden="true"
              />
              <span className={`text-xs font-bold ${isActive ? 'text-brand-700' : 'text-slate-600'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          {active === 'student' ? <StudentForm /> : null}
          {active === 'parent' ? <ParentForm /> : null}
          {active === 'schol' || active === 'school' ? <SchoolWizard /> : null}
          {active === 'sub_admin' ? <SubAdminForm /> : null}
          {active === 'teacher' ? <TeacherForm /> : null}
          {active === 'accountant' ? <AccountantForm /> : null}
          {active === 'super_admin' ? <SuperAdminForm /> : null}
        </motion.div>
      </AnimatePresence>

      <p className="mt-6 text-center text-sm text-slate-500">
        Already registered?{' '}
        <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">
          Sign in
        </Link>
      </p>
    </div>
  );
}