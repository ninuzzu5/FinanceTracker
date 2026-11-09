import type { ReactNode } from "react";

// Mascotte originale "monetina": un solo corpo condiviso, viso diverso per stato
// (Specifiche.dc.html → Componenti → Monetina; Stati.dc.html per le quattro espressioni).
export type MascotState = "happy" | "sleep" | "dead" | "lock" | "flip";

const eyes = <><ellipse cx="31" cy="37" rx="3.2" ry="4.6" fill="#111" stroke="none" /><ellipse cx="49" cy="37" rx="3.2" ry="4.6" fill="#111" stroke="none" /></>;
const smile = <path d="M31 48q9 9 18 0" fill="none" />;

const faces: Record<MascotState, ReactNode> = {
  happy: <>{eyes}{smile}</>,
  flip: <>{eyes}{smile}</>,
  sleep: <>
    <path d="M26 38q5 5 10 0M44 38q5 5 10 0" fill="none" />
    <path d="M35 51h10" fill="none" />
    <text x="58" y="24" fontFamily="Caveat" fontWeight={700} fontSize={22} stroke="none" fill="#111">z</text>
    <text x="67" y="14" fontFamily="Caveat" fontWeight={700} fontSize={16} stroke="none" fill="#111">z</text>
  </>,
  dead: <>
    <path d="M27 33l8 8M35 33l-8 8M45 33l8 8M53 33l-8 8" fill="none" />
    <path d="M30 53q5-6 10 0t10 0" fill="none" />
    <path d="M64 24q-6 9 0 12t6-4q0-5-6-8z" fill="#9CC4FF" />
  </>,
  lock: <>
    {eyes}{smile}
    <rect x="52" y="58" width="22" height="17" fill="#FF9F43" />
    <path d="M57 58v-6a6 6 0 0 1 12 0v6" fill="none" />
    <circle cx="63" cy="67" r="2" fill="#111" stroke="none" />
  </>,
};

export function Mascot({ state, size = 92 }: { state: MascotState; size?: number }) {
  const animationClass = state === "flip" ? "flip" : state === "dead" ? "shake" : "bob";
  return <svg className={`mascot mascot-${animationClass}`} width={size} height={size * 84 / 80} viewBox="0 0 80 84" aria-hidden="true">
    <g stroke="#111" strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round">
      <path d="M32 70v9M48 70v9M27 79h9M44 79h9M10 42q-7 2-6 10M70 42q7 2 6 10" fill="none" />
      <circle cx="40" cy="40" r="30" fill="#FFE14D" />
      <circle cx="40" cy="40" r="23" fill="none" strokeWidth={2} strokeDasharray="2 5" />
      <circle cx="23" cy="47" r="4" fill="#FF9FB2" stroke="none" />
      <circle cx="57" cy="47" r="4" fill="#FF9FB2" stroke="none" />
      {faces[state]}
    </g>
  </svg>;
}
