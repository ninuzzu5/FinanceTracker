import { useEffect, useState } from "react";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Access } from "./features/access/Access";

// I due percorsi sono indipendenti: non esiste uno stato di autenticazione.
export function App() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const access = path === "/accesso";
  useEffect(() => {
    document.title = `FinanceTracker · ${access ? "Accesso" : "Panoramica"}`;
  }, [access]);
  return access ? <Access /> : <Dashboard />;
}
