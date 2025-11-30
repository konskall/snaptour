import React, { useRef } from 'react';
import { Camera, Upload, Image as ImageIcon } from 'lucide-react';
import { Translation } from '../types';

interface PhotoInputProps {
  onImageSelect: (file: File) => void;
  t: Translation;
  onLocationFound?: (coords: { lat: number, lng: number }) => void;
}

export const PhotoInput: React.FC<PhotoInputProps> = ({ onImageSelect, t, onLocationFound }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      // Try to get location context when photo is selected
      if (onLocationFound && navigator.geolocation) {
         navigator.geolocation.getCurrentPosition(
           (position) => {
             onLocationFound({
                lat: position.coords.latitude,
                lng: position.coords.longitude
             });
           },
           (err) => {
             console.log("Location access not available or denied:", err);
           },
           { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
         );
      }
      onImageSelect(e.target.files[0]);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full h-full p-6 pt-24 animate-fade-in">
      
      {/* Background Image Layer - Fixed to ensure full coverage on all devices */}
      <div className="fixed inset-0 z-0 w-full h-full">
        <img 
          src="https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?q=80&w=2021&auto=format&fit=crop" 
          alt="Travel Background" 
          className="w-full h-full object-cover object-center" 
        />
        {/* Dark Gradient Overlay to ensure text readability - Reduced opacity */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/70 via-slate-900/40 to-slate-900/80" />
      </div>

      {/* Main Content Card */}
      <div className="relative z-10 max-w-md w-full bg-slate-800/60 backdrop-blur-xl border border-slate-700/50 rounded-3xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="bg-indigo-500/20 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-indigo-400 border border-indigo-500/30">
            <Camera size={32} />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{t.startTitle}</h2>
          <p className="text-slate-300 font-medium">{t.startSubtitle}</p>
        </div>

        <div className="space-y-4">
          
          {/* Mobile camera trigger (FIRST - GRADIENT) */}
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
              className="w-full cursor-pointer flex items-center justify-center gap-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] shadow-lg shadow-indigo-500/25 border border-indigo-400"
            >
              <Camera size={20} />
              <span>{t.cameraBtn}</span>
            </label>
          </div>

          {/* Upload Button (SECOND - SLATE) */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full group/btn relative flex items-center justify-center gap-3 bg-slate-700/80 hover:bg-slate-600/80 text-slate-200 font-semibold py-4 px-6 rounded-xl transition-all duration-300 border border-indigo-500/30 hover:border-indigo-500/50"
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

        </div>
        
        <div className="mt-8 pt-6 border-t border-slate-700/50 flex items-center justify-center gap-2 text-xs text-slate-400">
          <ImageIcon size={14} />
          <span>{t.supports}</span>
        </div>
      </div>

      {/* Footer / Credits / Disclaimer */}
      <div className="relative z-20 text-center space-y-1 p-4 pointer-events-auto mt-4 sm:mt-8">
        <p className="text-[10px] sm:text-xs text-slate-400/60 mx-auto">
           {t.disclaimer}
        </p>
        <p className="text-[10px] sm:text-xs text-slate-500 font-medium">
           {t.createdBy}{" "}
           <a 
             href="https://www.linkedin.com/in/konstantinos-kalliakoudis-902b90103" 
             target="_blank" 
             rel="noopener noreferrer"
             className="text-slate-400 hover:text-indigo-400 transition-colors underline decoration-slate-600 hover:decoration-indigo-500"
           >
             KonsKall
           </a>
        </p>
      </div>
    </div>
  );
};
