import React, { useState, useRef } from 'react';
import { X, UploadCloud } from 'lucide-react';
import Button from '../ui/Button';
import { uploadVideoWithProgress } from '../../services/api.js';

export default function VideoUploadModal({ isOpen, onClose, moduleId, onUploadSuccess }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      
      // Auto-fill title field if it's empty to save the educator time
      if (!title) {
        const cleanName = selectedFile.name.substring(0, selectedFile.name.lastIndexOf('.')) || selectedFile.name;
        setTitle(cleanName);
      }
      setError(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError("Please select a video file first.");
      return;
    }

    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      // Connects directly to our XHR progress tracker utility
      const result = await uploadVideoWithProgress(moduleId, file, title, description, (percentComplete) => {
        setProgress(percentComplete);
      });

      console.log("✅ Server acknowledged upload & initialized transcoding:", result);
      
      if (onUploadSuccess) onUploadSuccess();
      handleClose();
    } catch (err) {
      setError(err.message || "Failed to upload video asset.");
      setUploading(false);
    }
  };

  const handleClose = () => {
    setTitle('');
    setDescription('');
    setFile(null);
    setProgress(0);
    setUploading(false);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-[#F4DFD8] border-[3px] border-black rounded-2xl flex flex-col shadow-[8px_8px_0px_0px_#111]">
        
        {/* Modal Header */}
        <div className="flex justify-between items-center p-4 border-b-[3px] border-black bg-white rounded-t-xl">
          <h3 className="font-bold text-xl">📹 Upload Course Video</h3>
          <button onClick={handleClose} disabled={uploading} className="w-8 h-8 border-[3px] border-black bg-[#F26B4D] rounded-full flex items-center justify-center font-bold hover:scale-110 disabled:opacity-50">
            <X size={16} strokeWidth={3} />
          </button>
        </div>
        
        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 bg-white rounded-b-xl">
          {error && (
            <div className="p-3 bg-red-100 border-2 border-black rounded-xl text-[#F26B4D] font-bold text-sm">
              ❌ {error}
            </div>
          )}

          <div>
            <label className="font-bold text-sm ml-1 mb-1 block">Video Title</label>
            <input 
              required 
              value={title} 
              onChange={e => setTitle(e.target.value)} 
              disabled={uploading}
              className="w-full bg-[#F4F4F4] border-2 border-black rounded-xl px-4 py-2 font-medium focus:outline-none focus:shadow-[4px_4px_0px_0px_#F26B4D]" 
            />
          </div>

          <div>
            <label className="font-bold text-sm ml-1 mb-1 block">Description (Optional)</label>
            <textarea 
              value={description} 
              onChange={e => setDescription(e.target.value)} 
              disabled={uploading}
              rows={2} 
              className="w-full bg-[#F4F4F4] border-2 border-black rounded-xl px-4 py-2 font-medium focus:outline-none focus:shadow-[4px_4px_0px_0px_#F26B4D]" 
            />
          </div>

          {/* Drag & Drop Area / Click Zone */}
          <div>
            <label className="font-bold text-sm ml-1 mb-1 block">Video File</label>
            <div 
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`border-2 border-dashed border-black p-6 rounded-xl text-center cursor-pointer transition-colors ${uploading ? 'bg-gray-100 opacity-60' : 'bg-[#F4F4F4] hover:bg-zinc-100'}`}
            >
              <UploadCloud className="mx-auto mb-2 text-zinc-600" size={32} />
              <span className="block font-bold text-sm max-w-xs mx-auto truncate">
                {file ? file.name : "Click to choose raw video (.mp4, .mov)"}
              </span>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept="video/*" 
                className="hidden" 
                disabled={uploading}
              />
            </div>
          </div>

          {/* Live Progress Infrastructure */}
          {uploading && (
            <div className="space-y-1 mt-2">
              <div className="flex justify-between text-xs font-black tracking-wider">
                <span>{progress < 100 ? "UPLOADING STREAM PARTS..." : "SERVER TRANSCODING STARTED..."}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-[#F4F4F4] border-2 border-black h-5 rounded-xl overflow-hidden p-[2px]">
                <div 
                  className="bg-[#F26B4D] h-full rounded-lg border border-black transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Footer Action Controls */}
          <div className="flex justify-end gap-3 mt-4">
            <button 
              type="button" 
              onClick={handleClose} 
              disabled={uploading}
              className="px-6 py-2 border-[3px] border-black rounded-xl font-bold hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <Button type="submit" variant="primary" className="py-2" disabled={uploading || !file}>
              {uploading ? 'Processing File...' : 'Start Upload'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}