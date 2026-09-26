import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { ProtectedRoute, RoleRoute, PublicOnlyRoute } from './components/guards';
import { PublicLayout } from './layout/PublicLayout';
import { DashboardLayout } from './layout/DashboardLayout';
import { roleBasePath } from './lib/nav';

import Landing from './pages/public/Landing';
import Login from './pages/public/Login';
import Register from './pages/public/Register';
import ForgotPassword from './pages/public/ForgotPassword';
import Apply from './pages/public/Apply';
import VerifyReceipt from './pages/public/VerifyReceipt';
import SchoolOnboarding from './pages/public/SchoolOnboarding';

import StudentHome from './pages/student/StudentHome';
import StudentFees from './pages/student/StudentFees';
import StudentResults from './pages/student/StudentResults';
import StudentAttendance from './pages/student/StudentAttendance';
import StudentAssessments from './pages/student/StudentAssessments';
import StudentAnnouncements from './pages/student/StudentAnnouncements';
import StudentProfile from './pages/student/StudentProfile';

import ParentHome from './pages/parent/ParentHome';
import ParentWards from './pages/parent/ParentWards';
import ParentFees from './pages/parent/ParentFees';
import ParentAnnouncements from './pages/parent/ParentAnnouncements';
import ParentProfile from './pages/parent/ParentProfile';

import AdminHome from './pages/admin/AdminHome';
import AdminStudents from './pages/admin/AdminStudents';
import AdminClasses from './pages/admin/AdminClasses';
import AdminSubjects from './pages/admin/AdminSubjects';
import AdminTeachers from './pages/admin/AdminTeachers';
import AdminAnnouncements from './pages/admin/AdminAnnouncements';
import AdminFees from './pages/admin/AdminFees';
import AdminSettings from './pages/admin/AdminSettings';

import TeacherHome from './pages/teacher/TeacherHome';
import TeacherStudents from './pages/teacher/TeacherStudents';
import TeacherAttendance from './pages/teacher/TeacherAttendance';

import AccountantHome from './pages/accountant/AccountantHome';
import AccountantCollect from './pages/accountant/AccountantCollect';
import AccountantReceipts from './pages/accountant/AccountantReceipts';

import SuperAdminHome from './pages/superadmin/SuperAdminHome';
import SuperAdminSchools from './pages/superadmin/SuperAdminSchools';
import SuperAdminApplications from './pages/superadmin/SuperAdminApplications';

import ProfilePage from './pages/shared/ProfilePage';
import NotFound from './pages/NotFound';

function HomeRedirect() {
  const { user, profile } = useAuth();
  if (!user) return <Navigate to="/" replace />;
  return <Navigate to={roleBasePath(profile?.role)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Landing />} />
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <Login />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnlyRoute>
              <Register />
            </PublicOnlyRoute>
          }
        />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/apply" element={<Apply />} />
        <Route path="/verify-receipt" element={<VerifyReceipt />} />
        <Route path="/school-onboarding" element={<SchoolOnboarding />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<RoleRoute roles={['student']}><StudentHome /></RoleRoute>} />
          <Route path="/dashboard/fees" element={<RoleRoute roles={['student']}><StudentFees /></RoleRoute>} />
          <Route path="/dashboard/results" element={<RoleRoute roles={['student']}><StudentResults /></RoleRoute>} />
          <Route path="/dashboard/attendance" element={<RoleRoute roles={['student']}><StudentAttendance /></RoleRoute>} />
          <Route path="/dashboard/assessments" element={<RoleRoute roles={['student']}><StudentAssessments /></RoleRoute>} />
          <Route path="/dashboard/announcements" element={<RoleRoute roles={['student']}><StudentAnnouncements /></RoleRoute>} />
          <Route path="/dashboard/profile" element={<RoleRoute roles={['student']}><StudentProfile /></RoleRoute>} />

          <Route path="/parent" element={<RoleRoute roles={['parent']}><ParentHome /></RoleRoute>} />
          <Route path="/parent/wards" element={<RoleRoute roles={['parent']}><ParentWards /></RoleRoute>} />
          <Route path="/parent/fees" element={<RoleRoute roles={['parent']}><ParentFees /></RoleRoute>} />
          <Route path="/parent/announcements" element={<RoleRoute roles={['parent']}><ParentAnnouncements /></RoleRoute>} />
          <Route path="/parent/profile" element={<RoleRoute roles={['parent']}><ParentProfile /></RoleRoute>} />

          <Route path="/admin" element={<RoleRoute roles={['admin', 'sub_admin']}><AdminHome /></RoleRoute>} />
          <Route path="/admin/students" element={<RoleRoute roles={['admin', 'sub_admin']}><AdminStudents /></RoleRoute>} />
          <Route path="/admin/classes" element={<RoleRoute roles={['admin', 'sub_admin']}><AdminClasses /></RoleRoute>} />
          <Route path="/admin/subjects" element={<RoleRoute roles={['admin', 'sub_admin']}><AdminSubjects /></RoleRoute>} />
          <Route path="/admin/teachers" element={<RoleRoute roles={['admin', 'sub_admin']}><AdminTeachers /></RoleRoute>} />
          <Route path="/admin/announcements" element={<RoleRoute roles={['admin', 'sub_admin']}><AdminAnnouncements /></RoleRoute>} />
          <Route path="/admin/fees" element={<RoleRoute roles={['admin', 'sub_admin']}><AdminFees /></RoleRoute>} />
          <Route path="/admin/settings" element={<RoleRoute roles={['admin', 'sub_admin']}><AdminSettings /></RoleRoute>} />
          <Route path="/admin/profile" element={<RoleRoute roles={['admin', 'sub_admin']}><ProfilePage /></RoleRoute>} />

          <Route path="/teacher" element={<RoleRoute roles={['teacher']}><TeacherHome /></RoleRoute>} />
          <Route path="/teacher/students" element={<RoleRoute roles={['teacher']}><TeacherStudents /></RoleRoute>} />
          <Route path="/teacher/attendance" element={<RoleRoute roles={['teacher']}><TeacherAttendance /></RoleRoute>} />
          <Route path="/teacher/profile" element={<RoleRoute roles={['teacher']}><ProfilePage /></RoleRoute>} />

          <Route path="/accountant" element={<RoleRoute roles={['accountant']}><AccountantHome /></RoleRoute>} />
          <Route path="/accountant/collect" element={<RoleRoute roles={['accountant']}><AccountantCollect /></RoleRoute>} />
          <Route path="/accountant/receipts" element={<RoleRoute roles={['accountant']}><AccountantReceipts /></RoleRoute>} />
          <Route path="/accountant/profile" element={<RoleRoute roles={['accountant']}><ProfilePage /></RoleRoute>} />

          <Route path="/superadmin" element={<RoleRoute roles={['super_admin']}><SuperAdminHome /></RoleRoute>} />
          <Route path="/superadmin/schools" element={<RoleRoute roles={['super_admin']}><SuperAdminSchools /></RoleRoute>} />
          <Route path="/superadmin/applications" element={<RoleRoute roles={['super_admin']}><SuperAdminApplications /></RoleRoute>} />
          <Route path="/superadmin/profile" element={<RoleRoute roles={['super_admin']}><ProfilePage /></RoleRoute>} />
        </Route>
      </Route>

      <Route path="/home" element={<HomeRedirect />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}