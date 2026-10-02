import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { HOME } from './roles';
import { Login } from './Login';
import { Register } from './Register';
import { StudentDashboard, CoordinatorDashboard, AdminDashboard } from './Dashboards';
import { AssessmentPage } from './AssessmentPage';
import { PracticePage } from './PracticePage';
import { DrivesPage } from './DrivesPage';
import { ProfilePage } from './ProfilePage';
import { StaffDrivesPage } from './StaffDrives';
import { StaffStudentsPage } from './StaffStudents';
import { AdminUsersPage } from './AdminUsers';
import { AdminAuditPage } from './AdminAudit';
import { MocksPage } from './MocksPage';
import { RecommendationsPage } from './RecommendationsPage';

const Loading = () => <p role="status">Loading...</p>;

function Root() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return <Navigate to={user ? HOME[user.role] : '/login'} replace />;
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user) return <Navigate to={HOME[user.role]} replace />;
  return children;
}

function RequireRole({ role, children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={HOME[user.role]} replace />;
  return children;
}

const guard = (role, el) => <RequireRole role={role}>{el}</RequireRole>;

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
      <Route path="/student" element={guard('student', <StudentDashboard />)} />
      <Route path="/student/assessment" element={guard('student', <AssessmentPage />)} />
      <Route path="/student/practice" element={guard('student', <PracticePage />)} />
      <Route path="/student/drives" element={guard('student', <DrivesPage />)} />
      <Route path="/student/profile" element={guard('student', <ProfilePage />)} />
      <Route path="/coordinator" element={guard('coordinator', <CoordinatorDashboard />)} />
      <Route path="/coordinator/drives" element={guard('coordinator', <StaffDrivesPage />)} />
      <Route path="/coordinator/students" element={guard('coordinator', <StaffStudentsPage />)} />
      <Route path="/admin" element={guard('admin', <AdminDashboard />)} />
      <Route path="/admin/users" element={guard('admin', <AdminUsersPage />)} />
      <Route path="/admin/audit" element={guard('admin', <AdminAuditPage />)} />
            <Route path="/student/mocks" element={guard('student', <MocksPage />)} />
      <Route path="/student/recommendations" element={guard('student', <RecommendationsPage />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
