import React from 'react';

export const Logo: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg 
      width="40" 
      height="40" 
      viewBox="0 0 100 120" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* 3D Depth (Orange) */}
      <path 
        d="M90 50C90 75 50 115 50 115C50 115 10 75 10 50C10 25 30 10 50 10C70 10 90 25 90 50Z" 
        fill="#F97316" 
        transform="translate(5, 5)"
      />
      
      {/* Main Body (Cyan/Teal) */}
      <path 
        d="M90 50C90 75 50 115 50 115C50 115 10 75 10 50C10 25 30 10 50 10C70 10 90 25 90 50Z" 
        fill="#06B6D4" 
      />
      
      {/* Highlight/Glare */}
      <path 
        d="M25 30C25 30 35 20 50 20C65 20 70 25 70 25" 
        stroke="white" 
        strokeWidth="4" 
        strokeLinecap="round" 
        opacity="0.3"
      />

      {/* Inner Dark Circle (Camera Lens) */}
      <circle cx="50" cy="50" r="25" fill="#0F172A" />
      
      {/* Play/Lens Triangle */}
      <path 
        d="M45 40L60 50L45 60V40Z" 
        fill="#22D3EE" 
        stroke="#06B6D4" 
        strokeWidth="2" 
        strokeLinejoin="round"
      />
      
      {/* Camera shutter hint */}
      <circle cx="50" cy="50" r="20" stroke="#1E293B" strokeWidth="2" />
    </svg>
  );
};