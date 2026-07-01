import React from 'react';
import { User, Users } from 'lucide-react';

interface AvatarProps {
  url?: string;
  type?: 'direct' | 'group';
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'custom';
  customSizeClass?: string;
  name?: string;
  isOnline?: boolean;
  className?: string;
}

// Helper to extract clean initials from name
const getInitials = (name: string): string => {
  if (!name) return '';
  const clean = name.trim().replace(/[^\w\s\u00C0-\u017F]/g, '');
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name.charAt(0).toUpperCase();
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase().substring(0, 2);
};

// Helper to determine the gradient based on the name hash
const getGradientByName = (name: string): string => {
  const gradients = [
    'from-red-500 to-orange-500',
    'from-pink-500 to-rose-500',
    'from-purple-600 to-indigo-600',
    'from-blue-500 to-cyan-500',
    'from-teal-500 to-emerald-500',
    'from-green-500 to-emerald-600',
    'from-amber-500 to-orange-600',
    'from-violet-500 to-fuchsia-500'
  ];
  if (!name) return gradients[2]; // Default to purple/indigo
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
};

export default function Avatar({
  url,
  type = 'direct',
  size = 'md',
  customSizeClass = '',
  name = '',
  isOnline = false,
  className = ''
}: AvatarProps) {
  // Determine width & height classes based on size preset
  let sizeClass = 'w-12 h-12';
  let iconSize = 22;
  let fontSizeClass = 'text-sm font-semibold';

  switch (size) {
    case 'sm':
      sizeClass = 'w-9 h-9';
      iconSize = 18;
      fontSizeClass = 'text-xs font-bold';
      break;
    case 'md':
      sizeClass = 'w-12 h-12';
      iconSize = 22;
      fontSizeClass = 'text-base font-semibold';
      break;
    case 'lg':
      sizeClass = 'w-16 h-16';
      iconSize = 28;
      fontSizeClass = 'text-xl font-bold';
      break;
    case 'xl':
      sizeClass = 'w-20 h-20';
      iconSize = 34;
      fontSizeClass = 'text-2xl font-black';
      break;
    case 'custom':
      sizeClass = customSizeClass;
      iconSize = 22; // default fallback for icon
      fontSizeClass = 'text-sm font-semibold';
      break;
  }

  const isPlaceholder = !url || 
                        url.includes('149071.png') || 
                        url.includes('166258.png') || 
                        url.includes('166258') || 
                        url.includes('photo-1542751371-adc38448a05e') ||
                        url.trim() === '';

  const initials = getInitials(name);
  const colorGradient = getGradientByName(name || (type === 'group' ? 'GroupChat' : 'UserChat'));

  return (
    <div className={`relative shrink-0 select-none ${sizeClass} ${className}`}>
      {isPlaceholder ? (
        <div 
          className={`w-full h-full rounded-full flex items-center justify-center bg-gradient-to-br ${colorGradient} text-white border border-[var(--border-color)]/20 shadow-sm group-hover:scale-[1.02] transition-transform`}
          style={{ contentVisibility: 'auto' }}
        >
          {initials ? (
            <span className={`${fontSizeClass} tracking-wider font-sans select-none text-white`}>
              {initials}
            </span>
          ) : type === 'group' ? (
            <Users size={iconSize - 2} className="stroke-[2.2] text-white" />
          ) : (
            <User size={iconSize} className="stroke-[1.8] text-white" />
          )}
        </div>
      ) : (
        <div 
          className="w-full h-full rounded-full overflow-hidden border border-[var(--border-color)]/20 shadow-sm transition-transform group-hover:scale-[1.02] flex items-center justify-center bg-[var(--border-color)]/5"
          style={{ contentVisibility: 'auto' }}
        >
          <img 
            src={url} 
            className="w-full h-full object-cover rounded-full"
            referrerPolicy="no-referrer"
            alt={name || 'Avatar'}
          />
        </div>
      )}
      {isOnline && (
        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[var(--bg-card)] rounded-full shadow-sm animate-pulse"></div>
      )}
    </div>
  );
}
