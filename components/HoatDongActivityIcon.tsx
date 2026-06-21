import React from 'react';

/** Icon hoạt động / biến động — dùng chung cho nút FAB và header popup */
export const HoatDongActivityIcon: React.FC<{ className?: string; size?: number }> = ({
  className = '',
  size = 24
}) => {
  const gid = React.useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={`g1-${gid}`} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#005992" />
          <stop offset="1" stopColor="#D71049" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill={`url(#g1-${gid})`} opacity={0.14} />
      <rect x="5.5" y="14" width="3.2" height="5" rx="1" fill={`url(#g1-${gid})`} />
      <rect x="10.4" y="9.5" width="3.2" height="9.5" rx="1" fill={`url(#g1-${gid})`} />
      <rect x="15.3" y="5.5" width="3.2" height="13.5" rx="1" fill={`url(#g1-${gid})`} />
    </svg>
  );
};
