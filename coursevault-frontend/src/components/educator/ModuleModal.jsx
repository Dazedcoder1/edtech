
import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { fetchAPI } from '../../services/api.js';

export default function ModuleModal({ isOpen, onClose, courseId, module = null, onSave }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (module) {
      setTitle(module.title);
      setDescription(module.description || '');
    } else {
      setTitle('');
      setDescription('');
    }
  }, [module, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    const data = { course_id: courseId, title, description };

    try {
      if (module) {
        await fetchAPI(`/modules/${module.id}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await fetchAPI('/modules', { method: 'POST', body: JSON.stringify(data) });
      }
      onSave();
      onClose();
    } catch (err) {
      alert(err.message || 'Failed to save module');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-[#F4DFD8] border-2 md:border-[3px] border-black rounded-2xl flex flex-col shadow-[4px_4px_0px_0px_#111] md:shadow-[8px_8px_0px_0px_#111] max-h-[92vh]">
        <div className="flex justify-between items-center p-3 md:p-4 border-b-2 md:border-b-[3px] border-black bg-white rounded-t-xl shrink-0">
          <h3 className="font-bold text-xl">{module ? 'Edit Module' : 'Add Module'}</h3>
          <button onClick={onClose} className="w-8 h-8 border-[3px] border-black bg-[#F26B4D] rounded-full flex items-center justify-center font-bold hover:scale-110">
            <X size={16} strokeWidth={3} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4 bg-white rounded-b-xl">
          <div>
            <label className="font-bold text-sm ml-1 mb-1 block">Module Title</label>
            <input required value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-[#F4F4F4] border-2 border-black rounded-xl px-4 py-2 font-medium focus:outline-none focus:shadow-[4px_4px_0px_0px_#87CEFA]" />
          </div>
          <div>
            <label className="font-bold text-sm ml-1 mb-1 block">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full bg-[#F4F4F4] border-2 border-black rounded-xl px-4 py-2 font-medium focus:outline-none focus:shadow-[4px_4px_0px_0px_#87CEFA]" />
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 border-[3px] border-black rounded-xl font-bold hover:bg-gray-100 transition-colors">Cancel</button>
            <Button type="submit" variant="secondary" className="py-2" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Module'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}