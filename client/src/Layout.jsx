import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from './AuthContext';

const NAV = {
  student: [['/student', 'Dashboard', true], ['/student/assessment', 'Assessment'], ['/student/practice', 'Practice'], ['/student/drives', 'Drives'], ['/student/profile', 'Profile'], ['/student/mocks', 'Mock tests'], ['/student/recommendations', 'Recommendations'], ['/student/resume', 'Resume'], ['/student/companies', 'Companies']],
  coordinator: [['/coordinator', 'Dashboard', true], ['/coordinator/drives', 'Manage drives'], ['/coordinator/students', 'Students']],
  admin: [['/admin', 'Dashboard', true], ['/admin/users', 'Users'], ['/admin/audit', 'Audit log']]
};

export function Shell({ title, children }) {
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const links = NAV[user.role] || [];
  return (
    <div className="shell">
      <header>
        <strong>IntelliPlace</strong>
        <nav aria-label={`${user.role} navigation`}>
          {links.map(([to, text, end]) => <NavLink key={to} to={to} end={!!end}>{text}</NavLink>)}
        </nav>
        <span className="who">{user.name}</span>
        <span className="role">{user.role}</span>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); await logout(); }}>Sign out</button>
      </header>
      <main>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}
