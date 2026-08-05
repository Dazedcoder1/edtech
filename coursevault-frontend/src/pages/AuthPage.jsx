import React, { useState } from 'react';
import { Bot, BookOpen } from 'lucide-react';
import LoginForm from '../components/auth/LoginForm';
import RegisterForm from '../components/auth/RegisterForm';
import ForgotPasswordForm from '../components/auth/ForgotPasswordForm';
import VerifyEmailStep from '../components/auth/VerifyEmailStep';
import { useAuth } from '../context/AuthContext';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [forgot, setForgot] = useState(false);
  const { pendingVerification } = useAuth();

  /*
   * Verification outranks everything else on this card.
   *
   * Once the server has answered with a challenge, the token in hand is only
   * good for submitting a code — so offering Log In or Sign Up here would lead
   * to screens that cannot succeed.
   */
  const verifying = Boolean(pendingVerification);

  return (
    <div className="min-h-screen bg-[#F4DFD8] flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-20 left-20 text-[#F26B4D] animate-float-icon opacity-50"><Bot size={64} /></div>
      <div className="absolute bottom-20 right-20 text-[#87CEFA] animate-float-icon opacity-50" style={{ animationDelay: '1s' }}><BookOpen size={64} /></div>

      <div className="relative w-full max-w-md z-10">
        <div className="absolute inset-0 bg-[#932973] rounded-3xl brutal-border translate-x-4 translate-y-4"></div>
        <div className="absolute inset-0 bg-[#F26B4D] rounded-3xl brutal-border translate-x-2 translate-y-2"></div>
        
        <div className="relative bg-white brutal-border rounded-3xl p-8 text-center">
          <h1 className="text-4xl font-bold mb-2 tracking-tight">CourseVault</h1>
          <p className="text-gray-600 font-medium mb-6">Master new skills today.</p>

          {/* The Log In / Sign Up switch is hidden during a reset: those tabs
              would abandon the flow mid-way with no warning, and the form has
              its own "Back to sign in" control. */}
          {!forgot && !verifying && (
            <div className="flex gap-4 mb-8">
              <button
                onClick={() => setIsLogin(true)}
                className={`flex-1 font-bold pb-2 border-b-[3px] transition-colors ${isLogin ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-black'}`}
              >
                Log In
              </button>
              <button
                onClick={() => setIsLogin(false)}
                className={`flex-1 font-bold pb-2 border-b-[3px] transition-colors ${!isLogin ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-black'}`}
              >
                Sign Up
              </button>
            </div>
          )}

          {verifying ? (
            <VerifyEmailStep />
          ) : forgot ? (
            <ForgotPasswordForm
              onDone={() => {
                setForgot(false);
                setIsLogin(true);
              }}
            />
          ) : isLogin ? (
            <LoginForm onForgotPassword={() => setForgot(true)} />
          ) : (
            <RegisterForm />
          )}
        </div>
      </div>
    </div>
  );
}
