import {
  LayoutDashboard,
  Wallet,
  Award,
  CalendarCheck,
  ClipboardList,
  Megaphone,
  User,
  Users,
  BookOpen,
  School,
  Settings,
  Weight,
  ReceiptText,
  Building2,
  FileCheck2,
  FileText,
} from 'lucide-react';

export const NAV_BY_ROLE = {
  student: [
    { path: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { path: '/dashboard/fees', label: 'Fee Details', icon: Wallet },
    { path: '/dashboard/results', label: 'Exam Report Cards', icon: Award },
    { path: '/dashboard/attendance', label: 'My Attendance', icon: CalendarCheck },
    { path: '/dashboard/assessments', label: 'Assessments', icon: ClipboardList },
    { path: '/dashboard/announcements', label: 'Announcements', icon: Megaphone },
    { path: '/dashboard/profile', label: 'My Profile', icon: User },
  ],
  parent: [
    { path: '/parent', label: 'Overview', icon: LayoutDashboard },
    { path: '/parent/wards', label: 'My Wards', icon: Users },
    { path: '/parent/fees', label: 'Ward Fees', icon: Wallet },
    { path: '/parent/announcements', label: 'Announcements', icon: Megaphone },
    { path: '/parent/profile', label: 'My Profile', icon: User },
  ],
  admin: [
    { path: '/admin', label: 'Overview', icon: LayoutDashboard },
    { path: '/admin/students', label: 'Students', icon: Users },
    { path: '/admin/classes', label: 'Classes', icon: BookOpen },
    { path: '/admin/subjects', label: 'Subjects', icon: FileText },
    { path: '/admin/teachers', label: 'Teachers', icon: User },
    { path: '/admin/announcements', label: 'Announcements', icon: Megaphone },
    { path: '/admin/fees', label: 'Fee Structure', icon: Wallet },
    { path: '/admin/settings', label: 'School Settings', icon: Settings },
    { path: '/admin/profile', label: 'My Profile', icon: User },
  ],
  teacher: [
    { path: '/teacher', label: 'Overview', icon: LayoutDashboard },
    { path: '/teacher/students', label: 'My Class', icon: Users },
    { path: '/teacher/attendance', label: 'Attendance', icon: CalendarCheck },
    { path: '/teacher/profile', label: 'My Profile', icon: User },
  ],
  accountant: [
    { path: '/accountant', label: 'Overview', icon: LayoutDashboard },
    { path: '/accountant/collect', label: 'Collect Payment', icon: Wallet },
    { path: '/accountant/receipts', label: 'Receipts', icon: ReceiptText },
    { path: '/accountant/profile', label: 'My Profile', icon: User },
  ],
  super_admin: [
    { path: '/superadmin', label: 'Overview', icon: LayoutDashboard },
    { path: '/superadmin/schools', label: 'Schools', icon: School },
    { path: '/superadmin/applications', label: 'Applications', icon: FileCheck2 },
    { path: '/superadmin/profile', label: 'My Profile', icon: User },
  ],
};

export const DASHBOARD_META = {
  '/dashboard': { title: 'Student Dashboard', icon: LayoutDashboard },
  '/parent': { title: 'Parent Dashboard', icon: LayoutDashboard },
  '/admin': { title: 'Admin Dashboard', icon: LayoutDashboard },
  '/teacher': { title: 'Teacher Dashboard', icon: LayoutDashboard },
  '/accountant': { title: 'Accountant Dashboard', icon: LayoutDashboard },
  '/superadmin': { title: 'Super Admin Dashboard', icon: Building2 },
};

export function roleBasePath(role) {
  if (role === 'admin' || role === 'sub_admin') return '/admin';
  if (role === 'student') return '/dashboard';
  if (role === 'parent') return '/parent';
  if (role === 'teacher') return '/teacher';
  if (role === 'accountant') return '/accountant';
  return '/superadmin';
}

export { Weight as FeesIcon };