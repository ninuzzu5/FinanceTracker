import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

// Finestra di dettaglio condivisa da tutte le schede cliccabili (Saldo, Entrate, Uscite,
// Conto, Categoria, Giorno/Mese): un solo <dialog> nativo, un solo stile.
// Il nativo dà gratis la trappola del focus e il tasto Esc; qui gestiamo solo apertura/
// chiusura in sincrono con `open`, il blocco dello scroll di pagina e il ritorno del focus
// a chi ha aperto la finestra.
export function DetailDialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreFocus.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      document.body.style.overflow = "hidden";
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      document.body.style.overflow = "";
      onClose();
      restoreFocus.current?.focus();
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  useEffect(() => () => { document.body.style.overflow = ""; }, []);

  return <dialog ref={dialogRef} className="zine-card zine-dialog" aria-labelledby={titleId}
    style={{ "--tape": "#FFE14Dcc" } as React.CSSProperties}
    onClick={event => { if (event.target === dialogRef.current) dialogRef.current?.close(); }}>
    <div className="zine-card-body zine-dialog-body">
      <div className="zine-dialog-head">
        <h2 id={titleId} className="zine-heading zine-heading-md">{title}</h2>
        <button type="button" className="zine-icon-button zine-dialog-close" aria-label="Chiudi" onClick={() => dialogRef.current?.close()}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  </dialog>;
}
