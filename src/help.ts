import type { Response } from "express";
export function help(res: Response) {
  const role = res.locals.membership.role,
    b = res.locals.base;
  const sections: any[] = [
    {
      title: "Entrar y elegir instituto",
      steps: [
        "Ingresá con tu correo y contraseña. Abrí el menú de tu nombre y elegí Mis institutos para seleccionar dónde trabajar.",
        "Tu rol y la aprobación son independientes en cada instituto. Una solicitud pendiente no habilita el acceso.",
        "Si olvidaste la contraseña, elegí “Recuperar contraseña” en el acceso. Recibirás un enlace válido durante una hora.",
        "Usá “Cerrar sesión” cuando termines, especialmente en dispositivos compartidos.",
      ],
      link: "/institutes",
    },
    {
      title: "Consultar notificaciones",
      steps: [
        "Abrí “Notificaciones” para ver los mensajes dirigidos a tu cuenta.",
        "Elegí “Consultar” para leer el contenido. Después podés marcar el mensaje como leído.",
        "Los recibos y ciertos avisos también pueden llegar al correo que figura en tu ficha.",
      ],
      link: b + "/notifications",
    },
  ];
  if (role === "admin")
    sections.push(
      {
        title: "Usar el dashboard del instituto",
        steps: [
          "Inicio muestra cursos activos, comisiones activas e inscripciones registradas. Un alumno inscripto en dos comisiones cuenta como dos inscripciones.",
          "En Comisiones activas podés consultar cada grupo, ver su cupo e inscribir un alumno. Ver todas abre el listado completo.",
          "Académico reúne cursos, comisiones, alumnos, profesores y asistencias. Pagos, Usuarios y Notificaciones tienen accesos directos.",
          "Más opciones reúne la configuración, los cobros de AulaNexo y el manual. El menú de tu nombre permite cambiar de instituto o cerrar la sesión.",
        ],
        link: b,
      },
      {
        title: "Aprobar solicitudes y administrar roles",
        steps: [
          "Abrí “Usuarios” y elegí “Administrar” en la solicitud.",
          "Seleccioná Administrador, Profesor o Alumno y luego Aprobar, Rechazar o Deshabilitar. Guardá la decisión.",
          "El usuario recibe un correo con el resultado. Al aprobar a un alumno o profesor se vincula o crea su ficha.",
          "Los roles son fijos: el administrador gestiona el instituto; el profesor accede a sus comisiones; el alumno consulta su información.",
          "Siempre debe quedar al menos un administrador habilitado. Compartí el enlace de registro que aparece en esta sección para recibir solicitudes.",
        ],
        link: b + "/users",
      },
      {
        title: "Agregar y actualizar alumnos o profesores",
        steps: [
          "Abrí “Alumnos” o “Profesores” y elegí Agregar. Nombre y apellido son obligatorios; podés completar el resto después.",
          "Usá “Editar” para guardar DNI, contacto, domicilio, fecha de nacimiento y datos del responsable.",
          "Dar de baja requiere confirmación y conserva asistencias, inscripciones y pagos. Podés reactivar la ficha después.",
          "La baja de una ficha impide que participe en nuevos registros y detiene sus futuras cuotas automáticas. Las deudas anteriores se conservan.",
        ],
        link: b + "/people/student",
      },
      {
        title: "Crear cursos y comisiones",
        steps: [
          "En el menú Académico, abrí Cursos y niveles y creá el curso, por ejemplo Inglés con nivel A1.",
          "Volvé a Comisiones y elegí “Crear comisión”. Indicá año, fechas, horario, aula, modalidad, cupo y precios. Antes de inscribir alumnos en una comisión con cuota mensual, configurá su vencimiento desde Configuración.",
          "Desde la comisión, usá “Asignar profesor”. Podés asignar varios profesores.",
          "Una baja conserva el historial. Los cargos ya generados no se modifican al cambiar precios o dar de baja un curso.",
        ],
        link: b + "/commissions",
      },
      {
        title: "Inscribir un alumno",
        steps: [
          "Abrí una comisión y elegí “Inscribir alumno”. Seleccioná un alumno activo y el descuento sobre la cuota mensual. La matrícula conserva su importe.",
          "El sistema rechaza inscripciones duplicadas y comisiones sin cupo. No controla superposición de horarios.",
          "Al confirmar autorizás la asistencia durante el mes actual. Las cuotas comienzan el próximo mes. Si la matrícula está habilitada y tiene importe, elegí su fecha de vencimiento; el cargo se crea al inscribir.",
          "Esta versión no permite quitar una inscripción individual. Consultá el alcance acordado antes de realizar cambios de grupo.",
        ],
        link: b + "/commissions",
      },
      {
        title: "Gestionar cuotas, pagos y deudas",
        steps: [
          "En “Pagos” consultá todos los cargos o filtrá Pendientes. Las cuotas mensuales se generan automáticamente según las inscripciones, precios y vencimiento configurados. Sin un vencimiento definido no se generan cuotas.",
          "“Agregar cargo manual” permite cobrar otros conceptos al alumno seleccionado. Indicá importe y vencimiento.",
          "Elegí “Cobrar” para registrar fecha, método y referencia. Se cobra el importe completo; no hay pagos parciales ni cobro online.",
          "Al confirmar se genera un recibo interno. Podés imprimirlo o guardar como PDF desde el diálogo de impresión del navegador. Si hay correo en la ficha, se envía una copia por correo.",
          "Para perdonar una deuda pendiente elegí “Condonar”, escribí el motivo y confirmá. Se conserva el motivo y quién realizó la acción; no se registra como pago.",
          "Los cargos pagados o condonados no pueden cobrarse nuevamente.",
        ],
        link: b + "/payments",
      },
      {
        title: "Configurar el instituto y sus avisos",
        steps: [
          "En Más opciones, abrí Configuración para elegir vencimiento de cuotas, descuento por defecto, cobro de matrícula, medios de pago y frecuencia de recordatorios. Los recordatorios quedan deshabilitados hasta que los configures.",
          "Escribí un método de pago por línea. Los cambios afectan a futuros cargos e inscripciones.",
          "En “Notificaciones”, elegí Crear y definí título, mensaje y destinatarios: todos, un rol, un usuario o una comisión.",
          "Podés elegir enviar también por correo. Para habilitar recordatorios de deuda configurá su frecuencia: el primer aviso se envía los días después del vencimiento que hayas elegido y los siguientes con el intervalo configurado, mientras la deuda siga pendiente.",
        ],
        link: b + "/settings",
      },
      {
        title: "Consultar los cobros de AulaNexo",
        steps: [
          "En Más opciones, abrí Cobros de AulaNexo para consultar los conceptos, importes, vencimientos y estados de los cargos registrados.",
          "El superadministrador registra manualmente los cargos pactados y sus cobros. El alta del instituto no genera cargos automáticamente.",
          "Estos cargos están separados de las cuotas y pagos de los alumnos.",
        ],
        link: b + "/subscription",
      },
    );
  if (role !== "student")
    sections.push({
      title: "Registrar y corregir asistencias",
      steps: [
        "Abrí “Asistencias” y elegí “Crear clase”. Seleccioná comisión, fecha y hora.",
        "Para dos clases del mismo día usá horarios distintos. La fecha debe estar dentro del período de la comisión.",
        "Abrí la clase y marcá Presente o Ausente para cada alumno. Guardá cuando estén todos completos.",
        "Podés volver a abrir la clase para corregirla. Los cambios quedan auditados.",
        "Los profesores solo pueden consultar alumnos y registrar asistencias en sus comisiones asignadas.",
      ],
      link: b + "/attendance",
    });
  if (role === "student")
    sections.push(
      {
        title: "Consultar tus cursos y asistencias",
        steps: [
          "Abrí “Cursos” para ver tus comisiones, horarios, modalidad, aula y profesores.",
          "En “Asistencias” elegí una clase para consultar tu estado. “Sin registrar” significa que todavía no cargaron tu asistencia.",
          "Si encontrás un error, contactá al profesor o al administrador para que lo corrija.",
        ],
        link: b + "/commissions",
      },
      {
        title: "Consultar tus pagos",
        steps: [
          "Abrí “Pagos” y elegí Pendientes para ver los conceptos, importes y vencimientos.",
          "Coordiná el pago con el instituto. Esta versión no permite pagar online.",
          "Cuando el administrador registra el cobro, podés abrir el recibo e imprimirlo o guardarlo como PDF desde el navegador.",
          "Si una deuda figura condonada, el instituto la perdonó y podés consultar su motivo.",
        ],
        link: b + "/payments",
      },
      {
        title: "Consultar tus datos personales",
        steps: [
          "Abrí “Mis datos” para consultar tu ficha.",
          "Si falta información o necesitás corregirla, contactá al administrador del instituto.",
        ],
        link: b + "/profile",
      },
    );
  res.render("help", { title: "Ayuda y manual de usuario", sections });
}

export function platformHelp(res: Response) {
  res.render("help", {
    title: "Manual del superadministrador",
    sections: [
      {
        title: "Revisar solicitudes de acceso",
        steps: [
          "Los responsables de institutos pueden solicitar el servicio desde Solicitar acceso en la página pública.",
          "Al iniciar sesión como superadministrador entrás al Panel de plataforma. Allí se muestran las solicitudes pendientes con el botón Revisar solicitud. También podés abrir Ver todas las solicitudes para consultar el historial.",
          "Crear instituto y aprobar abre un formulario con los datos recibidos. Completá el identificador público, el contacto y el correo del primer administrador.",
          "Al guardar se crea el instituto, la solicitud queda aprobada y se envía la invitación al primer administrador. El alta no genera cargos ni define una tarifa.",
          "Rechazar solicitud exige un motivo y envía la respuesta por correo. Una solicitud resuelta no puede aprobarse ni rechazarse otra vez.",
        ],
        link: "/platform/requests",
      },
      {
        title: "Crear un instituto",
        steps: [
          "En Plataforma elegí Crear instituto. Completá nombre, identificador público y datos de contacto.",
          "Indicá el correo del primer administrador. Recibirá una invitación que vence a los siete días.",
          "El administrador acepta la invitación creando una cuenta o usando su contraseña existente. Desde entonces administra únicamente su instituto.",
          "Si la invitación vence, abrí el instituto y elegí Invitar administrador para enviar un nuevo enlace.",
        ],
        link: "/platform/new",
      },
      {
        title: "Registrar cargos y cobros a institutos",
        steps: [
          "Abrí un instituto desde el panel para consultar sus cargos, importes, vencimientos y estados.",
          "No se generan cargos automáticamente. El modelo comercial está pendiente: no se asume un precio fijo ni un precio por alumno.",
          "Agregar cargo permite registrar un concepto pactado con el instituto, su importe y vencimiento. Registrar cobro guarda fecha y medio por el importe completo.",
          "Los administradores del instituto pueden consultar los cargos en Cobros de AulaNexo. Estos cobros están separados de las cuotas de alumnos.",
        ],
        link: "/platform",
      },
      {
        title: "Actualizar o deshabilitar institutos",
        steps: [
          "Desde el instituto elegí Editar para cambiar su nombre, identificador público y datos de contacto.",
          "Los cargos manuales conservan el concepto, importe y vencimiento registrados.",
          "Deshabilitar requiere confirmación, conserva toda la información e impide el acceso a sus usuarios.",
          "Para restablecer el servicio elegí Reactivar.",
        ],
        link: "/platform",
      },
      {
        title: "Cuentas y acceso",
        steps: [
          "Una cuenta puede pertenecer a varios institutos con roles independientes.",
          "El rol superadministrador habilita el panel de plataforma. El acceso a la gestión interna de un instituto requiere además pertenecer a él como usuario aprobado.",
          "Para recuperar tu contraseña usá Recuperar contraseña en el acceso. Cerrá la sesión al terminar.",
        ],
        link: "/institutes",
      },
    ],
  });
}
