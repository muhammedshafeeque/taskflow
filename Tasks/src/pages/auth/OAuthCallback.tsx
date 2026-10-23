import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authApi } from '../../lib/api';
import { resolvePostAuthRoute } from '../../lib/postAuthRedirect';

const ACCESS_KEY = 'pm_access_token';
const REFRESH_KEY = 'pm_refresh_token';

export default function OAuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { updateUser, setAccessToken, switchWorkspace } = useAuth();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code = params.get('code');
    if (!code) {
      navigate('/auth/error');
      return;
    }

    void (async () => {
      const res = await authApi.oauthExchange(code);
      if (!res.success || !res.data?.tokens?.accessToken) {
        navigate('/auth/error');
        return;
      }
      const { accessToken, refreshToken } = res.data.tokens;
      setAccessToken(accessToken);
      localStorage.setItem(ACCESS_KEY, accessToken);
      if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);

      const me = await authApi.me(accessToken);
      if (!me.success || !me.data?.user) {
        navigate('/auth/error');
        return;
      }
      updateUser(me.data.user);
      const storedReturn = sessionStorage.getItem('atrium_ide_return_url');
      if (storedReturn && storedReturn.startsWith('/') && !storedReturn.startsWith('//')) {
        sessionStorage.removeItem('atrium_ide_return_url');
        navigate(storedReturn);
        return;
      }
      const next = await resolvePostAuthRoute(me.data.user, switchWorkspace);
      navigate(next);
    })();
  }, [params, navigate, updateUser, setAccessToken, switchWorkspace]);

  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-[color:var(--text-muted)]">
      Signing you in…
    </div>
  );
}
