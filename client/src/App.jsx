import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { HOME } from './roles';
import { Login } from './Login';
import { Register } from './Register';
import { StudentDashboard, CoordinatorDashboard, AdminDashboard } from './Dashboards';
import { AssessmentPage } from './AssessmentPage';
import { PracticePage } from './PracticePage';

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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
      <Route path="/student" element={<RequireRole role="student"><StudentDashboard /></RequireRole>} />
      <Route path="/student/assessment" element={<RequireRole role="student"><AssessmentPage /></RequireRole>} />
      <Route path="/student/practice" element={<RequireRole role="student"><PracticePage /></RequireRole>} />
      <Route path="/coordinator" element={<RequireRole role="coordinator"><CoordinatorDashboard /></RequireRole>} />
      <Route path="/admin" element={<RequireRole role="admin"><AdminDashboard /></RequireRole>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
