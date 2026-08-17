import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authApi } from '../../lib/api';
import { resolvePostAuthRoute } from '../../lib/postAuthRedirect';

export default function OAuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { updateUser, setAccessToken, switchWorkspace } = useAuth();

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      navigate('/auth/error');
      return;
    }
    setAccessToken(token);
    authApi.me(token).then(async (res) => {
      if (!res.success || !res.data?.user) {
        navigate('/auth/error');
        return;
      }
      updateUser(res.data.user);
      const storedReturn = sessionStorage.getItem('atrium_ide_return_url');
      if (storedReturn && storedReturn.startsWith('/') && !storedReturn.startsWith('//')) {
        sessionStorage.removeItem('atrium_ide_return_url');
        navigate(storedReturn);
        return;
      }
      const next = await resolvePostAuthRoute(res.data.user, switchWorkspace);
      navigate(next);
    });
  }, [params, navigate, updateUser]);

  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-[color:var(--text-muted)]">
      Signing you in…
    </div>
  );
}
