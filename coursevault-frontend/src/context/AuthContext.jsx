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

  const login = async (email, password) => {
    const data = await fetchAPI('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    localStorage.setItem('token', data.token);
    setUser(data.user);
    navigate('/explore');
  };

  const register = async (name, email, password, role) => {
    const data = await fetchAPI('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, role }) // Dynamically passing the role
    });
    localStorage.setItem('token', data.token);
    setUser(data.user);
    navigate('/explore');
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    navigate('/login');
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