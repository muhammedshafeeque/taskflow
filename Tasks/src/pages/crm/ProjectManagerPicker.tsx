import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usersApi, type User } from '../../lib/api';
import { PersonSelect, toPeople } from '../../components/people';

/**
 * Picks the project manager of a project created from CRM (AUT-30). The salesperson is not made
 * project lead by default: someone has to be chosen.
 */
export default function ProjectManagerPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { token } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    if (!token) return;
    void usersApi.list(1, 100, token).then((res) => res.success && res.data && setUsers(res.data.data));
  }, [token]);
  return <PersonSelect value={value} onChange={onChange} people={toPeople(users)} placeholder="Choose the project manager…" aria-label="Project manager" required />;
}
