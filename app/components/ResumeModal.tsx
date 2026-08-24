"use client";

import { useState } from "react";
import { ArrowRight, FileText, ShieldCheck, UploadCloud, X } from "lucide-react";
import { cx } from "./ui";
import { useDialogFocus } from "../useDialogFocus";

export type ResumeProfile = {
  fileName: string;
  totalPages: number;
  text: string;
  name: string;
  skills: string[];
  suggestedRoles: string[];
  location: string | null;
  headline?: string;
};

export function ResumeModal({ onClose, onComplete }: { onClose: () => void; onComplete: (profile: ResumeProfile) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "reading" | "error">("idle");
  const [error, setError] = useState("");
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);

  const upload = async () => {
    if (!file) return;
    setStatus("reading");
    setError("");
    try {
      const form = new FormData();
      form.set("resume", file);
      const response = await fetch("/api/resume", { method: "POST", body: form });
      const payload = await response.json() as ResumeProfile & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The résumé could not be read.");
      onComplete(payload);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The résumé could not be read.");
      setStatus("error");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} tabIndex={-1} className="resume-modal" role="dialog" aria-modal="true" aria-labelledby="resume-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-wrap"><div className="modal-icon mint"><FileText size={20} /></div><div><span className="eyebrow">One-time setup</span><h2 id="resume-title">Let your résumé drive the search</h2></div></div>
          <button type="button" className="icon-button" aria-label="Close résumé upload" onClick={onClose}><X size={19} /></button>
        </div>
        <p className="modal-intro">Upload a text-based PDF. RoleAtlas extracts your skills and evidence, finds relevant role families, and ranks opportunities. A written self-description is optional.</p>
        <label className={cx("resume-dropzone", file && "has-file")}>
          <input type="file" accept="application/pdf,.pdf,.docx" aria-describedby={error ? "resume-upload-error" : undefined} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <UploadCloud size={28} />
          <strong>{file ? file.name : "Choose your résumé PDF"}</strong>
          <span>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB · ready to read` : "PDF up to 8 MB · text is processed for this session"}</span>
        </label>
        {error && <p id="resume-upload-error" className="resume-error" role="alert">{error}</p>}
        <div className="resume-privacy"><ShieldCheck size={16} /><p><strong>No résumé database.</strong> The file is converted to text for matching and is not written to RoleAtlas&apos;s job database. Only explicit AI actions send extracted text to your chosen model provider.</p></div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Browse without matching</button><button type="button" className="primary-button" disabled={!file || status === "reading"} onClick={upload}>{status === "reading" ? "Reading résumé…" : "Build my job search"}<ArrowRight size={15} /></button></div>
      </section>
    </div>
  );
}
