import { cn } from '../../lib/cn';

/** Button with a slowly rotating conic-gradient border. */
export function MovingBorderButton(props: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={cn('moving-border relative rounded-lg p-[1.5px] disabled:opacity-50', props.className)}
    >
      <span className="block rounded-[7px] bg-[#141318] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#1d1c24]">
        {props.children}
      </span>
    </button>
  );
}
