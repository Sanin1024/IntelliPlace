import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function Shell({ title, children }) {
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <div className="shell">
      <header>
        <strong>IntelliPlace</strong>
        {user.role === 'student' && (
          <nav aria-label="Student">
            <NavLink to="/student" end>Dashboard</NavLink>
            <NavLink to="/student/assessment">Assessment</NavLink>
            <NavLink to="/student/practice">Practice</NavLink>
            <NavLink to="/student/drives">Drives</NavLink>
            <NavLink to="/student/profile">Profile</NavLink>
          </nav>
        )}
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
