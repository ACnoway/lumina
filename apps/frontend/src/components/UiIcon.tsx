import type { SVGProps } from 'react';

type IconName = 'plus' | 'image' | 'close' | 'send' | 'sessions';

const paths: Record<IconName, string> = {
  plus: 'M12 5v14M5 12h14',
  image: 'M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4 M8 8h.01',
  close: 'M6 6l12 12M6 18L18 6',
  send: 'M12 19V5M5 12l7-7 7 7',
  sessions: 'M4 5h16v12H9l-5 4V5z M8 9h8M8 13h5',
};

export default function UiIcon({
  name,
  className = 'h-5 w-5',
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
