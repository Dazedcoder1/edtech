import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { IndianRupee, Users, BookOpen, Download, TrendingUp } from 'lucide-react';
import { fetchAPI } from '../services/api.js';
import { format } from 'date-fns';
import { downloadCSV } from '../utils/exportCsv.js';

export default function AnalyticsPage() {
  const [data, setData] = useState({ dashboard: null, earnings: null });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadAnalytics = async () => {
      try {
        // Fetch both routes in parallel for speed
        const [dashRes, earnRes] = await Promise.all([
          fetchAPI('/analytics/dashboard'),
          fetchAPI('/analytics/earnings')
        ]);
        
        setData({ 
          dashboard: dashRes.data, 
          earnings: earnRes.data 
        });
      } catch (err) {
        console.error("Failed to load analytics:", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadAnalytics();
  }, []);

  if (isLoading) return <div className="text-center font-bold py-20 text-gray-400">Loading Analytics...</div>;
  if (!data.dashboard) return <div className="text-center font-bold py-20 text-red-500">Failed to load data.</div>;

  const { overview, courses, recent_enrollments, daily_activity } = data.dashboard;
  const { monthly_earnings } = data.earnings;

  // Neo-Brutalist Tooltip for Charts
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border-[3px] border-black p-3 rounded-xl shadow-[4px_4px_0px_0px_#111] max-w-[180px]">
          <p className="font-bold mb-2 uppercase tracking-widest text-xs border-b-[2px] border-black pb-2">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} className="font-black text-base break-words" style={{ color: entry.color }}>
              {entry.name}: {entry.name === 'Revenue' ? `₹${entry.value}` : entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Helper for formatting currency
  const formatCurrency = (val) => `₹${val.toLocaleString('en-IN')}`;

  // Export Course Data
  const handleExport = async (courseId, title) => {
    try {
      const res = await fetchAPI(`/analytics/course/${courseId}/export`);
      downloadCSV(res.data, `${title.replace(/\s+/g, '_')}_students.csv`);
    } catch (err) {
      alert("Failed to export data.");
    }
  };

  return (
    <div className="pb-20">
      <header className="mb-6 md:mb-10">
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-1 md:mb-2">Analytics.</h1>
        <p className="text-base md:text-lg font-bold text-gray-600">Track your courses, students, and revenue.</p>
      </header>

      {/* --- STAT CARDS --- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6 mb-8 md:mb-12">
        <div className="bg-[#A7E2D1] border-[3px] border-black rounded-[20px] md:rounded-[24px] p-4 md:p-6 shadow-[3px_3px_0px_0px_#111] md:shadow-[4px_4px_0px_0px_#111]">
          <div className="flex justify-between items-start gap-2 mb-3 md:mb-4">
            <h3 className="font-bold text-xs md:text-sm uppercase tracking-widest">Total Revenue</h3>
            <div className="bg-white p-1.5 md:p-2 shrink-0 rounded-full border-[2px] border-black"><IndianRupee size={20}/></div>
          </div>
          <p className="text-3xl md:text-4xl font-black break-words">{formatCurrency(overview.total_revenue)}</p>
        </div>

        <div className="bg-[#F9E076] border-[3px] border-black rounded-[20px] md:rounded-[24px] p-4 md:p-6 shadow-[3px_3px_0px_0px_#111] md:shadow-[4px_4px_0px_0px_#111]">
          <div className="flex justify-between items-start gap-2 mb-3 md:mb-4">
            <h3 className="font-bold text-xs md:text-sm uppercase tracking-widest">Total Students</h3>
            <div className="bg-white p-1.5 md:p-2 shrink-0 rounded-full border-[2px] border-black"><Users size={20}/></div>
          </div>
          <p className="text-3xl md:text-4xl font-black break-words">{overview.total_students}</p>
        </div>

        <div className="bg-[#87CEFA] border-[3px] border-black rounded-[20px] md:rounded-[24px] p-4 md:p-6 shadow-[3px_3px_0px_0px_#111] md:shadow-[4px_4px_0px_0px_#111]">
          <div className="flex justify-between items-start gap-2 mb-3 md:mb-4">
            <h3 className="font-bold text-xs md:text-sm uppercase tracking-widest">Active Courses</h3>
            <div className="bg-white p-1.5 md:p-2 shrink-0 rounded-full border-[2px] border-black"><BookOpen size={20}/></div>
          </div>
          <p className="text-3xl md:text-4xl font-black break-words">{overview.total_courses}</p>
        </div>
      </div>

      {/* --- CHARTS ROW --- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 mb-8 md:mb-12">
        
        {/* Daily Enrollments Chart */}
        <div className="bg-white border-[3px] border-black rounded-[20px] md:rounded-[24px] p-3 md:p-6 shadow-[4px_4px_0px_0px_#111] md:shadow-[8px_8px_0px_0px_#111] overflow-hidden">
          <h3 className="font-black text-lg md:text-xl mb-4 md:mb-6 flex items-center gap-2">
            <TrendingUp size={24} className="text-[#F26B4D]" /> 30-Day Enrollments
          </h3>
          <div className="h-[240px] md:h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily_activity.map(d => ({ ...d, dateFormatted: format(new Date(d.date), 'MMM dd') })).reverse()}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ccc" vertical={false} />
                <XAxis dataKey="dateFormatted" axisLine={false} tickLine={false} tick={{fontFamily: 'inherit', fontWeight: 'bold', fontSize: 11}} dy={8} interval="preserveStartEnd" minTickGap={24} />
                <YAxis axisLine={false} tickLine={false} tick={{fontFamily: 'inherit', fontWeight: 'bold', fontSize: 11}} width={34} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="new_enrollments" name="Students" stroke="#E63946" strokeWidth={4} dot={{ r: 6, strokeWidth: 3, fill: '#fff', stroke: '#E63946' }} activeDot={{ r: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Monthly Revenue Chart */}
        <div className="bg-white border-[3px] border-black rounded-[20px] md:rounded-[24px] p-3 md:p-6 shadow-[4px_4px_0px_0px_#111] md:shadow-[8px_8px_0px_0px_#111] overflow-hidden">
          <h3 className="font-black text-lg md:text-xl mb-4 md:mb-6">Monthly Revenue</h3>
          <div className="h-[240px] md:h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly_earnings.map(d => ({ ...d, monthFormatted: format(new Date(d.month), 'MMM yyyy') })).reverse()}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ccc" vertical={false} />
                <XAxis dataKey="monthFormatted" axisLine={false} tickLine={false} tick={{fontFamily: 'inherit', fontWeight: 'bold', fontSize: 11}} dy={8} interval="preserveStartEnd" minTickGap={24} />
                <YAxis axisLine={false} tickLine={false} tick={{fontFamily: 'inherit', fontWeight: 'bold', fontSize: 11}} width={46} tickFormatter={(value) => `₹${value}`} />
                <Tooltip content={<CustomTooltip />} cursor={{fill: 'rgba(0,0,0,0.05)'}} />
                <Bar dataKey="revenue" name="Revenue" fill="#A084E8" stroke="#111" strokeWidth={3} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* --- COURSE PERFORMANCE --- */}
      <h2 className="text-2xl md:text-3xl font-black mb-4 md:mb-6">Course Performance</h2>

      {/*
        Two renderings of the same data. A five-column table on a 360px screen
        either scrolls sideways (the numbers you want to compare end up off
        screen) or crushes every column to one word per line, so phones get
        stacked cards instead and the table starts at md.
      */}
      <div className="md:hidden flex flex-col gap-4 mb-10">
        {courses.length === 0 ? (
          <div className="bg-white border-[3px] border-black rounded-[20px] p-8 text-center font-bold text-gray-500 shadow-[4px_4px_0px_0px_#111]">
            No courses published yet.
          </div>
        ) : (
          courses.map((course) => (
            <div
              key={course.id}
              className="bg-white border-[3px] border-black rounded-[20px] p-4 shadow-[4px_4px_0px_0px_#111]"
            >
              <h3 className="font-black text-base leading-tight mb-3 break-words">{course.title}</h3>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="border-2 border-black rounded-xl px-2 py-2 text-center bg-[#F4F4F4]">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Price</div>
                  <div className="font-black text-sm mt-0.5 break-words">{formatCurrency(course.price)}</div>
                </div>
                <div className="border-2 border-black rounded-xl px-2 py-2 text-center bg-[#F4F4F4]">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Enrolled</div>
                  <div className="font-black text-sm mt-0.5 text-blue-600">{course.enrolled_count}</div>
                </div>
                <div className="border-2 border-black rounded-xl px-2 py-2 text-center bg-[#F4F4F4]">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Paid</div>
                  <div className="font-black text-sm mt-0.5 text-green-600">{course.paid_count}</div>
                </div>
              </div>

              <button
                onClick={() => handleExport(course.id, course.title)}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#F26B4D] border-2 border-black rounded-full text-sm font-bold shadow-[2px_2px_0px_0px_#111] active:translate-y-0.5 active:shadow-none transition-all"
              >
                <Download size={16} /> Export CSV
              </button>
            </div>
          ))
        )}
      </div>

      <div className="hidden md:block bg-white border-[3px] border-black rounded-[24px] shadow-[8px_8px_0px_0px_#111] overflow-hidden mb-12">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F4F4F4] border-b-[3px] border-black text-sm uppercase tracking-widest font-bold">
                <th className="p-5">Course Title</th>
                <th className="p-5 border-l-[3px] border-black text-center">Price</th>
                <th className="p-5 border-l-[3px] border-black text-center">Enrolled</th>
                <th className="p-5 border-l-[3px] border-black text-center">Paid</th>
                <th className="p-5 border-l-[3px] border-black text-center">Export</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course, i) => (
                <tr key={course.id} className={i !== courses.length - 1 ? "border-b-[3px] border-black" : ""}>
                  <td className="p-5 font-black text-lg">{course.title}</td>
                  <td className="p-5 border-l-[3px] border-black text-center font-bold">{formatCurrency(course.price)}</td>
                  <td className="p-5 border-l-[3px] border-black text-center font-bold text-blue-600">{course.enrolled_count}</td>
                  <td className="p-5 border-l-[3px] border-black text-center font-bold text-green-600">{course.paid_count}</td>
                  <td className="p-5 border-l-[3px] border-black text-center">
                    <button 
                      onClick={() => handleExport(course.id, course.title)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-[#F26B4D] border-[2px] border-black rounded-full text-sm font-bold shadow-[2px_2px_0px_0px_#111] hover:translate-y-1 hover:translate-x-1 hover:shadow-none transition-all"
                    >
                      <Download size={16} /> CSV
                    </button>
                  </td>
                </tr>
              ))}
              {courses.length === 0 && (
                <tr><td colSpan="5" className="p-10 text-center font-bold text-gray-500">No courses published yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}