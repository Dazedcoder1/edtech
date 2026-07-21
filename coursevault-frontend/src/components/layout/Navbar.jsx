import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Compass, BookOpen, Database, User, LogOut } from 'lucide-react';
import NavButton from '../ui/NavButton';
import { useAuth } from '../../context/AuthContext';

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const navItems = [
    { path: '/explore', label: 'Explore', icon: Compass },
    { path: '/my-learning', label: 'My Learning', icon: BookOpen },
    { path: '/library', label: 'Library', icon: Database },
  ];

  return (
    <>
      {/* TOP BAR */}
      <nav className="relative z-50 flex justify-between items-center px-6 md:px-10 py-4 md:py-6 gap-6 sticky top-0 bg-[#F4DFD8]/90 backdrop-blur-md border-b-[3px] border-black">
        <div
          className="flex flex-col leading-none font-bold text-xl md:text-2xl tracking-tighter cursor-pointer"
          onClick={() => navigate('/explore')}
        >
          <span>Course</span>
          <span>Vault.</span>
        </div>

        {/* Desktop nav - hidden on mobile */}
        <div className="hidden md:flex items-center gap-4">
          {navItems.map(({ path, label, icon: Icon }) => (
            <NavButton
              key={path}
              isActive={location.pathname === path}
              onClick={() => navigate(path)}
            >
              <Icon size={20} strokeWidth={2.5} /> {label}
            </NavButton>
          ))}
        </div>

        <div className="flex items-center gap-4">
          {user && (
            <div className="hidden lg:flex items-center gap-2 font-bold bg-white brutal-border rounded-full px-4 py-2 shadow-[2px_2px_0px_0px_#111]">
              <User size={18} /> {user.name}
            </div>
          )}
          <NavButton primary onClick={logout}>
            <LogOut size={18} strokeWidth={2.5} /> <span className="hidden sm:inline">Exit</span>
          </NavButton>
        </div>
      </nav>

      {/* MOBILE BOTTOM TAB BAR */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex justify-around items-center bg-white border-t-[3px] border-black px-2 pt-2"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        {navItems.map(({ path, label, icon: Icon }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex flex-col items-center justify-center gap-1 px-3 py-1 rounded-xl transition-colors ${
                isActive ? 'text-black' : 'text-gray-400'
              }`}
            >
              <Icon size={22} strokeWidth={isActive ? 2.75 : 2} />
              <span className="text-[11px] font-bold">{label}</span>
            </button>
          );
        })}
        <button
          onClick={() => navigate('/account')}
          className="flex flex-col items-center justify-center gap-1 px-3 py-1 text-gray-400"
        >
          <User size={22} strokeWidth={2} />
          <span className="text-[11px] font-bold">Account</span>
        </button>
      </div>
    </>
  );
}