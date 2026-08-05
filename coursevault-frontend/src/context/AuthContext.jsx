import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAPI } from '../services/api.js';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const data = await fetchAPI('/auth/me');
          setUser(data.user);
        } catch (err) {
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
    role === 'educator' || role === 'admin' ? '/dashboard' : '/explore';

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
    localStorage.setItem('token', data.token);
    setUser(data.user);
    navigate(homeFor(data.user?.role), { replace: true });
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
    localStorage.setItem('token', data.token);
    setUser(data.user);
    navigate(homeFor(data.user?.role), { replace: true });
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
    <AuthContext.Provider value={{ user, login, register, logout, loading, applyProfileUpdate }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);