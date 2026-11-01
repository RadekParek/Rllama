import React from 'react';

/**
 * Inline stroke icons.
 * A hand-written set keeps the bundle small and the line weight consistent
 * with the rest of the UI (1.6px, round caps, 16px box).
 */

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
} as const;

export type IconProps = React.SVGProps<SVGSVGElement>;

export const IconPlus = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconChat = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z" />
  </svg>
);

export const IconSliders = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
    <circle cx="16" cy="8" r="2" />
    <circle cx="10" cy="16" r="2" />
  </svg>
);

export const IconBolt = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M13 3 5 14h6l-1 7 8-11h-6z" />
  </svg>
);

export const IconStack = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="m12 3 8 4.5-8 4.5-8-4.5z" />
    <path d="m4 12 8 4.5 8-4.5" />
    <path d="m4 16.5 8 4.5 8-4.5" />
  </svg>
);

export const IconChart = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

export const IconX = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconArrowUp = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 20V5M5 12l7-7 7 7" />
  </svg>
);

export const IconMenu = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);

export const IconRefresh = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 5v6h-6" />
  </svg>
);

export const IconCheck = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="m5 12 5 5L20 7" />
  </svg>
);

export const IconTrash = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
);

export const IconKey = (props: IconProps) => (
  <svg {...base} {...props}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8-8M17 4l3 3M15 6l2 2" />
  </svg>
);

export const IconDownload = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 4v11M7 11l5 5 5-5M4 20h16" />
  </svg>
);

export const IconSearch = (props: IconProps) => (
  <svg {...base} {...props}>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-3.6-3.6" />
  </svg>
);

export const IconChevron = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
