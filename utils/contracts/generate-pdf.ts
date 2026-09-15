import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type Snapshot = Record<string, unknown>;

function text(value: unknown) {
    if (value === null || value === undefined || value === "") {
        return "-";
    }

    return String(value);
}

function money(value: unknown) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return text(value);
    }

    return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        maximumFractionDigits: 2,
    }).format(number);
}

function dateTime(value: unknown) {
    if (!value) return "-";

    const date = new Date(String(value));

    if (Number.isNaN(date.getTime())) {
        return text(value);
    }

    return new Intl.DateTimeFormat("es-AR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Argentina/Mendoza",
    }).format(date);
}

function wrapText(
    value: string,
    font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
    size: number,
    maxWidth: number,
) {
    const paragraphs = value.split(/\n+/);
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
        const words = paragraph.trim().split(/\s+/);

        if (!paragraph.trim()) {
            lines.push("");
            continue;
        }

        let current = "";

        for (const word of words) {
            const candidate = current ? `${current} ${word}` : word;

            if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
                current = candidate;
            } else {
                if (current) lines.push(current);
                current = word;
            }
        }

        if (current) lines.push(current);
    }

    return lines;
}

export async function generarContratoPdf(
    snapshot: Snapshot,
    firmaEmpresa?: Uint8Array | null,
    firmaCliente?: Uint8Array | null,
) {
    const pdf = await PDFDocument.create();

    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 48;
    const contentWidth = pageWidth - margin * 2;

    let page = pdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    function newPage() {
        page = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
    }

    function ensureSpace(height: number) {
        if (y - height < margin) {
            newPage();
        }
    }

    function heading(value: string, size = 14) {
        ensureSpace(size + 18);

        page.drawText(value, {
            x: margin,
            y,
            size,
            font: bold,
            color: rgb(0.03, 0.17, 0.29),
        });

        y -= size + 12;
    }

    function line(label: string, value: unknown) {
        const labelSize = 9;
        const valueSize = 10;
        const labelWidth = 155;

        const wrapped = wrapText(
            text(value),
            regular,
            valueSize,
            contentWidth - labelWidth,
        );

        const height = Math.max(18, wrapped.length * 13 + 4);
        ensureSpace(height);

        page.drawText(label, {
            x: margin,
            y,
            size: labelSize,
            font: bold,
        });

        wrapped.forEach((item, index) => {
            page.drawText(item, {
                x: margin + labelWidth,
                y: y - index * 13,
                size: valueSize,
                font: regular,
            });
        });

        y -= height;
    }

    function paragraph(value: unknown) {
        const size = 9.5;
        const lines = wrapText(text(value), regular, size, contentWidth);

        for (const item of lines) {
            ensureSpace(14);

            page.drawText(item, {
                x: margin,
                y,
                size,
                font: regular,
            });

            y -= 14;
        }

        y -= 8;
    }

    page.drawText("HUGELLA", {
        x: margin,
        y,
        size: 22,
        font: bold,
        color: rgb(0.03, 0.17, 0.29),
    });

    y -= 30;

    page.drawText("CONTRATO DE COMPRAVENTA FINANCIADA", {
        x: margin,
        y,
        size: 15,
        font: bold,
    });

    y -= 24;

    line("Versión", snapshot.version_condiciones);
    line("Fecha del contrato", dateTime(snapshot.fecha_contrato));
    line("Estado", snapshot.estado);

    y -= 8;

    heading("1. Identificación de la empresa");

    line("Nombre comercial", snapshot.vendedor_nombre_comercial);
    line("Titular", snapshot.vendedor_titular_nombre);
    line("CUIT", snapshot.vendedor_titular_cuit);
    line("Domicilio", snapshot.vendedor_domicilio);
    line("Correo electrónico", snapshot.vendedor_email);

    heading("2. Datos del cliente");

    line("Nombre y apellido", snapshot.cliente_nombre);
    line("DNI", snapshot.cliente_dni);
    line("Teléfono", snapshot.cliente_telefono);
    line("Correo electrónico", snapshot.cliente_email);
    line("Rubro", snapshot.cliente_rubro);
    line("Domicilio particular", snapshot.cliente_domicilio_particular);
    line("Domicilio comercial", snapshot.cliente_domicilio_comercial);
    line("Domicilio de entrega", snapshot.domicilio_entrega);
    line("Domicilio de cobro", snapshot.domicilio_cobro);

    heading("3. Detalle de la operación");

    line("Producto", snapshot.producto);
    line("Cantidad", snapshot.cantidad_producto);
    line("Número de serie", snapshot.numero_serie);
    line(
        "Producto exhibido",
        snapshot.producto_exhibido === true ? "Sí" : "No",
    );
    line("Observaciones", snapshot.observaciones_entrega);
    line(
        "Fecha prevista de entrega",
        snapshot.fecha_entrega_prevista,
    );

    heading("4. Resumen financiero");

    line("Precio de contado", money(snapshot.precio_contado));
    line("Anticipo", money(snapshot.anticipo));
    line("Monto financiado", money(snapshot.monto_financiado));
    line("Precio total", money(snapshot.precio_total));
    line("Cantidad de cuotas", snapshot.cantidad_cuotas);
    line("Importe de cuota", money(snapshot.importe_cuota));
    line("Periodicidad", snapshot.periodicidad);
    line(
        "Gastos administrativos",
        money(snapshot.gastos_administrativos),
    );
    line(
        "Tasa efectiva anual",
        snapshot.tasa_efectiva_anual ?? "-",
    );
    line(
        "Costo financiero total",
        snapshot.costo_financiero_total ?? "-",
    );

    heading("5. Condiciones contractuales");

    paragraph(snapshot.condiciones_texto);

    heading("6. Aceptación y firmas");

    line(
        "Texto de aceptación",
        snapshot.texto_aceptacion,
    );

    line(
        "Fecha y hora de firma del cliente",
        dateTime(snapshot.firmado_at),
    );

    line(
        "Nombre declarado",
        snapshot.nombre_declarado,
    );

    line(
        "DNI declarado",
        snapshot.dni_declarado,
    );

    if (firmaEmpresa) {
        try {
            const image = await pdf.embedPng(firmaEmpresa);
            ensureSpace(120);

            page.drawText("Firma de HUGELLA", {
                x: margin,
                y,
                size: 10,
                font: bold,
            });

            const dimensions = image.scaleToFit(180, 80);

            page.drawImage(image, {
                x: margin,
                y: y - dimensions.height - 12,
                width: dimensions.width,
                height: dimensions.height,
            });

            y -= dimensions.height + 32;
        } catch {
            line("Firma de HUGELLA", "Imagen no disponible");
        }
    }

    if (firmaCliente) {
        try {
            const image = await pdf.embedPng(firmaCliente);
            ensureSpace(120);

            page.drawText("Firma del cliente", {
                x: margin,
                y,
                size: 10,
                font: bold,
            });

            const dimensions = image.scaleToFit(220, 90);

            page.drawImage(image, {
                x: margin,
                y: y - dimensions.height - 12,
                width: dimensions.width,
                height: dimensions.height,
            });

            y -= dimensions.height + 32;
        } catch {
            line("Firma del cliente", "Imagen no disponible");
        }
    }

    heading("7. Integridad del documento");

    line(
        "Hash firma HUGELLA",
        snapshot.firma_empresa_sha256,
    );

    line(
        "Hash firma cliente",
        snapshot.firma_cliente_sha256,
    );

    line(
        "Identificador del contrato",
        snapshot.id,
    );

    return pdf.save();
}