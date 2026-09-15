"use client";

import { useRef, useState, type FormEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";

const acceptanceText = "Declaro que leí el contrato completo, acepto todas sus condiciones y reconozco los precios y el plan de cuotas detallados. Autorizo el registro de la fecha, hora, dirección IP y datos de mi dispositivo como evidencia de mi aceptación y firma.";
const focusStyle = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hugella-navy)]";

export default function ClientSignatureForm({ token, revision }: { token: string; revision: string }) {
    const router = useRouter();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pointer = useRef<number | null>(null);
    const inFlight = useRef(false);
    const [name, setName] = useState("");
    const [dni, setDni] = useState("");
    const [accepted, setAccepted] = useState(false);
    const [hasSignature, setHasSignature] = useState(false);
    const [sending, setSending] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState("");

    function draw(event: PointerEvent<HTMLCanvasElement>, start = false) {
        if (inFlight.current || success || (!start && pointer.current !== event.pointerId)) return;
        const canvas = event.currentTarget;
        const context = canvas.getContext("2d");
        if (!context) return;
        event.preventDefault();
        const bounds = canvas.getBoundingClientRect();
        const x = (event.clientX - bounds.left) * canvas.width / bounds.width;
        const y = (event.clientY - bounds.top) * canvas.height / bounds.height;
        context.strokeStyle = "#082b49";
        context.fillStyle = "#082b49";
        context.lineWidth = 3;
        context.lineCap = "round";
        context.lineJoin = "round";
        if (start) {
            if (pointer.current !== null || event.button !== 0) return;
            pointer.current = event.pointerId;
            canvas.setPointerCapture(event.pointerId);
            context.beginPath();
            context.arc(x, y, 1.5, 0, Math.PI * 2);
            context.fill();
            context.beginPath();
            context.moveTo(x, y);
            setHasSignature(true);
        } else {
            context.lineTo(x, y);
            context.stroke();
        }
    }

    function stopDrawing(event: PointerEvent<HTMLCanvasElement>) {
        if (pointer.current !== event.pointerId) return;
        pointer.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }

    function clearSignature() {
        const canvas = canvasRef.current;
        if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        pointer.current = null;
        setHasSignature(false);
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (inFlight.current || success) return;
        setError("");
        const normalizedName = name.trim().replace(/\s+/g, " ");
        const normalizedDni = dni.replace(/[.\s]/g, "");
        if (normalizedName.length < 2 || normalizedName.length > 150 || !/^\d{7,9}$/.test(normalizedDni) || !accepted || !hasSignature) {
            setError("Completá tu nombre, un DNI de 7 a 9 dígitos, dibujá tu firma y aceptá las condiciones.");
            return;
        }
        inFlight.current = true;
        setSending(true);
        try {
            const canvas = canvasRef.current;
            if (!canvas) throw new Error("No se pudo leer la firma. Intentá nuevamente.");
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
            if (!blob || blob.size === 0 || blob.size > 1024 * 1024) throw new Error("La firma debe ser una imagen PNG de hasta 1 MB. Borrala y volvé a dibujarla.");
            const form = new FormData();
            form.set("nombre", normalizedName);
            form.set("dni", normalizedDni);
            form.set("aceptacion", "true");
            form.set("texto_aceptacion", acceptanceText);
            form.set("revision", revision);
            form.set("signature", blob, "firma.png");
            const response = await fetch(`/api/contratos/${encodeURIComponent(token)}/firmar`, {
                method: "POST", body: form, credentials: "same-origin", cache: "no-store",
            });
            const result = await response.json();
            if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "No se pudo registrar la firma.");
            setSuccess(true);
            router.refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "No se pudo enviar la firma. Revisá tu conexión e intentá nuevamente.");
        } finally {
            inFlight.current = false;
            setSending(false);
        }
    }

    return (
        <section className="rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7" aria-labelledby="signature-title">
            <h2 id="signature-title" className="text-xl font-bold">Aceptación y firma del cliente</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--hugella-navy-secondary)]">Revisá cuidadosamente el contrato completo antes de firmar.</p>
            <form onSubmit={submit} className="mt-6" aria-busy={sending}>
                <fieldset disabled={sending || success} className="min-w-0 space-y-5 disabled:opacity-70">
                    <div>
                        <label htmlFor="signer-name" className="field-label">Nombre completo del firmante</label>
                        <input id="signer-name" autoComplete="name" required minLength={2} maxLength={150} value={name} onChange={(event) => setName(event.target.value)} className="field-control" />
                    </div>
                    <div>
                        <label htmlFor="signer-dni" className="field-label">DNI</label>
                        <input id="signer-dni" inputMode="numeric" autoComplete="off" required maxLength={20} value={dni} onChange={(event) => setDni(event.target.value)} aria-describedby="signer-dni-hint" className="field-control" />
                        <p id="signer-dni-hint" className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">Entre 7 y 9 dígitos. Podés incluir puntos o espacios.</p>
                    </div>
                    <div>
                        <p id="signature-label" className="field-label">Tu firma</p>
                        <p id="signature-hint" className="mb-3 text-sm text-[var(--hugella-navy-secondary)]">Dibujá con el dedo, lápiz digital o mouse dentro del recuadro.</p>
                        <canvas ref={canvasRef} width={1000} height={360} aria-labelledby="signature-label" aria-describedby="signature-hint" onPointerDown={(event) => draw(event, true)} onPointerMove={(event) => draw(event)} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} onLostPointerCapture={() => { pointer.current = null; }} className="block aspect-[25/9] w-full touch-none select-none rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] bg-white" style={{ touchAction: "none" }}>
                            Tu navegador debe permitir dibujar en un lienzo para registrar la firma.
                        </canvas>
                        <button type="button" onClick={clearSignature} className={`mt-3 min-h-12 rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] px-4 py-3 text-sm font-semibold ${focusStyle}`}>Borrar firma</button>
                    </div>
                    <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
                        <input type="checkbox" required checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--hugella-navy)]" />
                        <span>{acceptanceText}</span>
                    </label>
                    <button type="submit" disabled={!hasSignature || !accepted || name.trim().length < 2 || !/^\d{7,9}$/.test(dni.replace(/[.\s]/g, ""))} className={`min-h-12 w-full rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-gold)] px-4 py-3 font-bold text-[var(--hugella-navy-deep)] transition hover:bg-[var(--hugella-gold-light)] disabled:cursor-not-allowed disabled:opacity-60 ${focusStyle}`}>
                        {sending ? "Registrando firma…" : "Aceptar y firmar contrato"}
                    </button>
                </fieldset>
                <div role="status" aria-live="polite" className="mt-4 text-sm">
                    {sending && <p>Estamos registrando tu firma. Esperá la confirmación.</p>}
                    {success && <p className="font-semibold text-green-800">Contrato firmado correctamente. Actualizando el documento…</p>}
                </div>
                {error && <p role="alert" className="mt-3 rounded-[var(--hugella-radius-sm)] border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            </form>
        </section>
    );
}
