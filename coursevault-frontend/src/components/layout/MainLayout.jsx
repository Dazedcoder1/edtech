import React, { useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Compass, BookOpen, LayoutDashboard, BarChart3 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import PageTransition from '../ui/PageTransition.jsx';

const transitionColors = [
  "#E63946", // Red
  "#A7E2D1", // Mint
  "#F9E076", // Yellow
  "#932973", // Purple
  "#87CEFA", // Sky Blue
  "#F26B4D", // Orange
  "#A084E8"  // Lavender
];

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const currentColor = useMemo(() => {
    const pathHash = location.pathname.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return transitionColors[pathHash % transitionColors.length];
  }, [location.pathname]);

  const navItems = user?.role === 'educator' 
    ? [
        { path: '/dashboard', label: 'Dashboard' },
        { path: '/analytics', label: 'Analytics' },
      ]
    : [
        { path: '/explore', label: 'Explore' },
        { path: '/my-learning', label: 'My Learning' },
      ];

  const getIcon = (path) => {
    if (path === '/explore') return Compass;
    if (path === '/my-learning') return BookOpen;
    if (path === '/dashboard') return LayoutDashboard;
    if (path === '/analytics') return BarChart3;
    return Compass;
  };

  return (
    <div className="min-h-screen bg-[#FDF1E9] pb-20 font-sans overflow-x-hidden">
     <nav className="relative z-50 flex flex-wrap justify-between items-center px-6 md:px-12 py-2 md:py-3 sticky top-0 bg-[#FDF1E9] shadow-[0px_4px_10px_rgba(0,0,0,0.12)]">
        {/* Logo */}
        <div 
          className="relative cursor-pointer group inline-block" 
          onClick={() => navigate(user?.role === 'educator' ? '/dashboard' : '/explore')}
        >
          <img src="/sv-logo.png" alt="Sharda Vidyapeeth" className="h-10 md:h-12 w-auto" />
        </div>

        {/* Center Nav - desktop only */}
        <div className="hidden md:flex items-center gap-4">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <div key={item.path} className="relative group cursor-pointer" onClick={() => navigate(item.path)}>
                <div className="absolute inset-0 bg-[#F26B4D] rounded-[40px] border-2 border-black transition-all duration-300 translate-x-0 translate-y-0 group-hover:-translate-x-2 group-hover:translate-y-2"></div>
                <div className="absolute inset-0 bg-[#932973] rounded-[40px] border-2 border-black transition-all duration-300 translate-x-0 translate-y-0 group-hover:-translate-x-1 group-hover:translate-y-1"></div>
                <button className={`relative z-10 px-5 py-1.5 rounded-[40px] border-2 border-black font-bold text-sm transition-all duration-300 flex items-center gap-2 ${isActive ? 'bg-[#A7E2D1] text-black' : 'bg-white text-black group-hover:bg-[#A7E2D1]'}`}>
                  {item.label}
                  <svg width="11" height="8" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg" className="ml-1 mt-0.5">
                    <path d="M7 10L0.0717964 -1.30318e-06L13.9282 -9.10263e-08L7 10Z" fill="currentColor" stroke="black" strokeWidth="2" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {/* User Info */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex px-4 py-1.5 rounded-[30px] border-2 border-black bg-white font-bold text-xs items-center gap-2 cursor-default">
            {user?.name || 'student'}
          </div>
          <button onClick={logout} className="px-4 py-1.5 rounded-[30px] border-2 border-black bg-white font-bold text-xs hover:bg-[#F26B4D] hover:text-white transition-colors">
            Exit
          </button>
        </div>
      </nav>

     <main className="max-w-[1400px] mx-auto px-6 pt-3 md:pt-10 relative">
        <AnimatePresence mode="wait">
          <PageTransition 
            key={location.pathname} 
            color={currentColor}
          >
            <Outlet />
          </PageTransition>
        </AnimatePresence>
      </main>

      {/* MOBILE BOTTOM TAB BAR */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex justify-around items-center bg-white border-t-2 border-black px-2 pt-2"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = getIcon(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 rounded-2xl font-bold text-[11px] transition-colors ${
                isActive ? 'bg-[#A7E2D1] border-2 border-black' : 'text-black/60'
              }`}
            >
              <Icon size={20} strokeWidth={2.5} />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}