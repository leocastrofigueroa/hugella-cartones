import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

const sections = [
  {
    title: "Cómo usar el sistema",
    content: (
      <>
        <p>
          El panel administrativo de HUGELLA concentra las operaciones de
          clientes, créditos, cobranzas, compras y administración financiera.
        </p>

        <p className="mt-3">
          Antes de realizar una operación, verificá siempre que estés trabajando
          con el cliente, crédito o compra correcta.
        </p>
      </>
    ),
  },
  {
    title: "Nuevo crédito",
    content: (
      <>
        <p>
          Esta sección se utiliza para registrar un nuevo crédito y asociarlo a
          un cliente.
        </p>

        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>Ingresá el DNI del cliente.</li>
          <li>Buscá el cliente antes de continuar.</li>
          <li>
            Si ya existe, verificá que sus datos correspondan a la persona
            correcta.
          </li>
          <li>
            Si es un cliente nuevo, completá los datos solicitados.
          </li>
          <li>Ingresá producto, fecha de inicio, cuotas y valor de cuota.</li>
          <li>Revisá el resumen antes de confirmar.</li>
        </ol>

        <p className="mt-3 font-semibold">
          Importante: no crear dos clientes distintos para la misma persona.
        </p>
      </>
    ),
  },
  {
    title: "Créditos",
    content: (
      <>
        <p>
          Muestra todos los créditos registrados y permite revisar rápidamente
          su situación.
        </p>

        <div className="mt-3 space-y-2">
          <p>
            <strong>Fecha inicio:</strong> día en que comienza el plan de
            cuotas.
          </p>

          <p>
            <strong>Pagadas:</strong> cuotas completas registradas como
            abonadas.
          </p>

          <p>
            <strong>Debería llevar:</strong> cantidad de cuotas que debería
            haber abonado a la fecha.
          </p>

          <p>
            <strong>Situación:</strong> indica si tiene cuotas atrasadas, está
            al día o tiene cuotas adelantadas.
          </p>

          <p>
            <strong>Importe atrasado:</strong> dinero que debería haberse
            abonado hasta la fecha y todavía está pendiente.
          </p>
        </div>
      </>
    ),
  },
  {
    title: "Créditos y pagos",
    content: (
      <>
        <p>
          La pantalla principal de cobranzas permite buscar un crédito,
          consultar su ficha y registrar pagos.
        </p>

        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>Buscá el crédito por cliente o código.</li>
          <li>Seleccioná el crédito correcto.</li>
          <li>Revisá la situación y el historial antes de cobrar.</li>
          <li>Registrá el pago recibido.</li>
          <li>Confirmá que el pago aparezca en el historial.</li>
        </ol>

        <p className="mt-3 font-semibold">
          Nunca registres nuevamente un pago sin comprobar primero si el pago
          anterior fue guardado correctamente.
        </p>
      </>
    ),
  },
  {
    title: "Clientes",
    content: (
      <>
        <p>
          Permite consultar los clientes registrados y acceder a su ficha.
        </p>

        <p className="mt-3">
          Desde la ficha de un cliente se pueden revisar sus datos y sus
          créditos relacionados.
        </p>

        <p className="mt-3 font-semibold">
          Antes de modificar DNI, teléfono, domicilio u otros datos, verificá
          que estés en la ficha de la persona correcta.
        </p>
      </>
    ),
  },
  {
    title: "Control de cobros",
    content: (
      <>
        <p>
          Se utiliza para controlar la situación general de las cobranzas y
          detectar créditos que requieren atención.
        </p>

        <p className="mt-3">
          Los estados y atrasos se calculan utilizando los pagos válidos
          registrados en el sistema.
        </p>
      </>
    ),
  },
  {
    title: "Compras y gastos",
    content: (
      <>
        <p>
          Esta sección registra las compras de mercadería y los gastos de
          HUGELLA.
        </p>

        <p className="mt-3">
          Una compra de mercadería puede quedar sin asociar inicialmente,
          asociarse a un crédito existente o utilizarse para crear un crédito
          nuevo.
        </p>

        <p className="mt-3 font-semibold">
          Revisá proveedor, productos, importes y forma de pago antes de
          confirmar una compra.
        </p>
      </>
    ),
  },
  {
    title: "Tarjetas y resúmenes",
    content: (
      <>
        <p>
          Permite administrar las compras realizadas con tarjetas, períodos de
          cierre, vencimientos y pagos de resúmenes.
        </p>

        <p className="mt-3 font-semibold">
          No marques una obligación como pagada solamente porque llegó su fecha
          de vencimiento. El pago debe corresponder a una operación realmente
          registrada.
        </p>
      </>
    ),
  },
  {
    title: "Contratos",
    content: (
      <>
        <p>
          Los contratos están asociados a créditos y permiten gestionar su
          preparación, aprobación y firma.
        </p>

        <p className="mt-3">
          Antes de enviar un contrato al cliente, comprobá nombres, DNI,
          producto, precios, cuotas y demás condiciones.
        </p>

        <p className="mt-3 font-semibold">
          Un contrato firmado no debe modificarse como si fuera un borrador.
        </p>
      </>
    ),
  },
  {
    title: "Finanzas",
    content: (
      <>
        <p>
          Las secciones financieras permiten analizar la situación económica
          de HUGELLA.
        </p>

        <div className="mt-3 space-y-2">
          <p>
            <strong>Dashboard:</strong> vista general de indicadores.
          </p>

          <p>
            <strong>Resumen financiero:</strong> resumen de los principales
            valores económicos.
          </p>

          <p>
            <strong>Panel financiero:</strong> análisis de créditos,
            obligaciones y resultados.
          </p>

          <p>
            <strong>Calendario financiero:</strong> vencimientos y movimientos
            organizados por fecha.
          </p>

          <p>
            <strong>Proyección mensual:</strong> previsión de cobranzas y
            obligaciones futuras.
          </p>
        </div>
      </>
    ),
  },
  {
    title: "Errores y buenas prácticas",
    content: (
      <>
        <div className="space-y-3">
          <p>
            <strong>Pago cargado incorrectamente:</strong> no cargues otro pago
            para compensarlo. Utilizá las herramientas de corrección o
            anulación correspondientes.
          </p>

          <p>
            <strong>Compra incorrecta:</strong> no elimines registros
            directamente de la base de datos. Utilizá la anulación disponible
            en la aplicación.
          </p>

          <p>
            <strong>Cliente duplicado:</strong> buscá siempre por DNI antes de
            crear una nueva persona.
          </p>

          <p>
            <strong>Dudas:</strong> si una operación puede afectar pagos,
            créditos, contratos o dinero real, consultá antes de realizarla.
          </p>
        </div>
      </>
    ),
  },
];

export default async function AyudaPage() {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect("/admin/login");
  }

  return (
    <main className="min-h-screen bg-[var(--hugella-bg)] text-[var(--hugella-navy)]">
      <header className="border-b border-[var(--hugella-border)] bg-white px-5 py-6 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <Link href="/admin" className="text-sm font-semibold underline">
            ← Volver al Admin
          </Link>

          <p className="section-kicker mt-6">Ayuda</p>

          <h1 className="text-3xl font-bold">
            Guía de usuario HUGELLA
          </h1>

          <p className="mt-2 max-w-3xl text-sm text-[var(--hugella-navy-secondary)]">
            Manual práctico para utilizar correctamente las principales
            herramientas del sistema administrativo.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-5 py-8 sm:px-8">
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="font-bold">Regla principal</h2>

          <p className="mt-2 text-sm">
            Antes de confirmar una operación que afecte dinero, pagos,
            créditos, compras o contratos, revisá siempre los datos.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold">Contenido del manual</h2>

          <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
            Tocá una sección para abrir sus instrucciones.
          </p>
        </section>

        <div className="space-y-3">
          {sections.map((section, index) => (
            <details
              key={section.title}
              className="group rounded-xl border border-[var(--hugella-border)] bg-white"
              open={index === 0}
            >
              <summary className="cursor-pointer select-none px-5 py-4 font-bold">
                {section.title}
              </summary>

              <div className="border-t border-[var(--hugella-border)] px-5 py-5 text-sm leading-6 text-[var(--hugella-navy-secondary)]">
                {section.content}
              </div>
            </details>
          ))}
        </div>

        <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <h2 className="font-bold">¿El manual no responde tu duda?</h2>

          <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
            Consultá con un responsable antes de modificar datos o realizar una
            operación que no estés seguro de cómo resolver.
          </p>
        </section>
      </div>
    </main>
  );
}
