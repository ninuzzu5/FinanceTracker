import { Banknote, Landmark } from "lucide-react";

// Fallback icona + nome, in attesa di un'eventuale decisione sui loghi ufficiali
// Revolut/Isybank (marchi registrati: non copiarli in repo senza autorizzazione esplicita).
export function AccountLogo({ name }: { name: string }) {
  const Icon = name.trim().toLowerCase() === "contanti" ? Banknote : Landmark;
  return <span className="account-logo" aria-hidden="true"><Icon size={23} /></span>;
}
