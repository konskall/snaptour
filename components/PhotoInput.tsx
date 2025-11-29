import React, { useRef } from 'react';
import { Camera, Upload, Image as ImageIcon } from 'lucide-react';
import { Translation } from '../types';

interface PhotoInputProps {
  onImageSelect: (file: File) => void;
  t: Translation;
}

export const PhotoInput: React.FC<PhotoInputProps> = ({ onImageSelect, t }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onImageSelect(e.target.files[0]);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full h-full p-6 pt-20 animate-fade-in">
      <div className="max-w-md w-full bg-slate-800/80 backdrop-blur-lg border border-slate-700 rounded-3xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="bg-indigo-500/20 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-indigo-400">
            <Camera size={32} />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{t.startTitle}</h2>
          <p className="text-slate-400">{t.startSubtitle}</p>
        </div>

        <div className="space-y-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full group relative flex items-center justify-center gap-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] shadow-lg shadow-indigo-500/25"
          >
            <Upload size={20} className="group-hover:-translate-y-0.5 transition-transform" />
            <span>{t.uploadBtn}</span>
          </button>
          
          <div className="relative">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
          </div>

           {/* Mobile camera trigger usually handled by file input with capture="environment" */}
           <div className="relative">
             <input
              type="file"
              accept="image/*"
              capture="environment"
              id="cameraInput"
              className="hidden"
              onChange={handleFileChange}
            />
            <label 
              htmlFor="cameraInput"
              className="w-full cursor-pointer flex items-center justify-center gap-3 bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold py-4 px-6 rounded-xl transition-all duration-300 border border-slate-600"
            >
              <Camera size={20} />
              <span>{t.cameraBtn}</span>
            </label>
           </div>
        </div>
        
        <div className="mt-8 pt-6 border-t border-slate-700/50 flex items-center justify-center gap-2 text-xs text-slate-500">
           <ImageIcon size={14} />
           <span>{t.supports}</span>
        </div>
      </div>
    </div>
  );
};