import cashIconUrl from "./icons/cash.svg";

// Fallback testuale in stile "pill" del mockup, in attesa di un'eventuale decisione sui
// loghi ufficiali Revolut/Isybank (marchi registrati: non copiarli in repo senza OK esplicito).
export function AccountLogo({ name }: { name: string }) {
  const key = name.trim().toLowerCase();
  if (key === "contanti") return <span className="zine-cash"><img src={cashIconUrl} alt="" width={22} height={22} /><span>{name}</span></span>;
  const brand = key === "revolut" ? "zine-pill-dark" : key === "isybank" ? "zine-pill-light" : "zine-pill-neutral";
  return <span className={`zine-pill ${brand}`}>{name}</span>;
}
