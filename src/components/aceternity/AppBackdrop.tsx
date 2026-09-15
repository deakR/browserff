import { BackgroundBeams } from './Beams';
import { Spotlight } from './Spotlight';

/** Full-screen cinematic backdrop shared by home and workbench. Fixed, non-interactive. */
export function AppBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#08080c]">
      <BackgroundBeams count={9} />
      <Spotlight fill="#ef4444" className="left-[-12rem] top-[-16rem] h-[46rem] w-[46rem]" />
      <Spotlight fill="#4f8ff7" className="right-[-14rem] top-[-4rem] h-[48rem] w-[48rem]" />
      <Spotlight fill="#481111" className="bottom-[-18rem] left-[30%] h-[36rem] w-[36rem]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.55)_100%)]" />
    </div>
  );
}
