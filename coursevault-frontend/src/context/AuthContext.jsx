import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAPI } from '../services/api.js';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  /*
   * Set when the server answered with a verification challenge rather than a
   * session. Its presence is what makes the auth page show the code screen —
   * `user` stays null throughout, so nothing can route into the app.
   */
  const [pendingVerification, setPendingVerification] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const data = await fetchAPI('/auth/me');
          setUser(data.user);
        } catch (err) {
          /*
           * A verify-scoped token left in storage — from a reload part-way
           * through verification — makes /auth/me return 403, not 401, so it
           * lands here rather than in fetchAPI's redirect. Clearing it sends
           * them back to sign in, which is the correct place to restart.
           */
          localStorage.removeItem('token');
        }
      }
      setLoading(false);
    };
    initAuth();
  }, []);

  /**
   * Where a freshly signed-in user belongs.
   *
   * Both login and register sent everyone to /explore, which is the student
   * browse page. An educator therefore landed in the student view and only
   * reached their own panel by noticing the Dashboard tab and clicking it —
   * which looked like the app had logged them in as the wrong kind of user,
   * especially right after signing out of a student account.
   *
   * MainLayout already picks the navigation from the same role, so this keeps
   * the landing page and the nav consistent.
   */
  const homeFor = (role) =>
    role === 'educator' || role === 'admin' ? '/dashboard' : '/home';

  /**
   * @param {string} identifier a mobile number or an email address
   * @param {string} password
   */
  const login = async (identifier, password) => {
    const data = await fetchAPI('/auth/login', {
      method: 'POST',
      // `email` is sent alongside `identifier` for one release: a browser tab
      // left open across the deploy will be running the old backend contract.
      body: JSON.stringify({ identifier, email: identifier, password })
    });
    return finishAuth(data);
  };

  /**
   * Complete a login or registration.
   *
   * The server answers in one of two shapes: a session, or a verification
   * challenge. `requiresVerification` means the token that came back is
   * verify-scoped — good only for submitting a code — so it is stored (the
   * verification calls need it) but no user is set and no navigation happens.
   * Setting the user would let ProtectedRoute wave them into the app holding a
   * token every other endpoint refuses.
   *
   * @returns {{requiresVerification: boolean, email?: string}}
   */
  const finishAuth = (data) => {
    localStorage.setItem('token', data.token);

    if (data.requiresVerification) {
      setPendingVerification({
        email: data.user?.email,
        name: data.user?.name,
        // 'two-factor' for a returning user, 'confirm-email' for one who has
        // not confirmed the address yet. Same code, different thing to say.
        reason: data.reason || 'confirm-email',
      });
      return { requiresVerification: true, email: data.user?.email };
    }

    setPendingVerification(null);
    setUser(data.user);
    navigate(homeFor(data.user?.role), { replace: true });
    return { requiresVerification: false };
  };

  /**
   * Called once a code is accepted. The response carries a full session token
   * in place of the scoped one.
   */
  const completeVerification = (data) => {
    if (data?.token) localStorage.setItem('token', data.token);
    setPendingVerification(null);
    setUser(data.user);
    navigate(homeFor(data.user?.role), { replace: true });
  };

  /** Abandon a half-finished verification and return to the sign-in form. */
  const cancelVerification = () => {
    localStorage.removeItem('token');
    setPendingVerification(null);
    setUser(null);
  };

  /**
   * Takes the whole form as one object.
   *
   * Registration now collects nine fields; as positional arguments they would
   * be a line of same-typed strings where transposing two is silent and
   * produces an account with a board in the state column.
   *
   * @param {{name, phone, password, email?, role?, class_level?, board?, state?, school?}} payload
   */
  const register = async (payload) => {
    const data = await fetchAPI('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return finishAuth(data);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    // replace: otherwise Back returns to the previous account's page, which
    // renders from cache for a moment before the redirect kicks in.
    navigate('/login', { replace: true });
  };

  /**
   * Apply a profile change coming back from the server.
   *
   * A new token accompanies name or email changes — the JWT carries both in
   * its payload, so without swapping it the old values would stay in effect
   * for the remaining seven days of its life.
   */
  const applyProfileUpdate = ({ user: updatedUser, token }) => {
    if (token) localStorage.setItem('token', token);
    if (updatedUser) setUser(updatedUser);
  };

  return (
    <AuthContext.Provider value={{
      user, login, register, logout, loading, applyProfileUpdate,
      pendingVerification, completeVerification, cancelVerification,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);