import { useState } from 'react';
import { useAuth } from './AuthContext';

export function Shell({ title, children }) {
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <div className="shell">
      <header>
        <strong>IntelliPlace</strong>
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
