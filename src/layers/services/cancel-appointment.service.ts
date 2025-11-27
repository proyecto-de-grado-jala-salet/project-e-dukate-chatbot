import { RealPatientService } from "../services/real-patient.service";
import { ButtonManager } from "../messaging-middleware/interactive-elements/button.manager";

export interface AppointmentData {
  id: string;
  patientId: string;
  patientName: string;
  specialistId: string;
  specialistName: string;
  specialtyId: string;
  specialtyName: string;
  sessionCount: number;
  scheduledSessions: Array<{
    id: string;
    timeSlotId: string;
    startSessionDateTime: string;
    endSessionDateTime: string;
    status: string;
    dayOfWeek: string;
    formattedDate: string;
    formattedTime: string;
    isFuture: boolean;
    isActive: boolean;
  }>;
  paymentStatus: string;
  totalAmount: number;
  amountPaid: number;
  hasActiveSessions: boolean;
}

export interface PatientData {
  Id: string;
  Names: string;
  LastNamePaternal: string;
  LastNameMaternal?: string;
  IdentityCard: string;
}

export class CancelAppointmentService {
  private realPatientService: RealPatientService;
  private buttonManager: ButtonManager;
  private baseUrl: string;

  constructor() {
    this.realPatientService = new RealPatientService();
    this.buttonManager = new ButtonManager();
    this.baseUrl =
      "https://project-e-dukate-backend-production.up.railway.app/api/Appointments";
  }

  /**
   * Inicia el proceso de cancelación
   */
  public startCancellationProcess = async (
    from: string,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<void> => {
    await sendMessage(
      from,
      "❌ *Cancelación de Cita*\n\n" +
        "Para buscar tus citas, necesito que me envíes tus datos exactos:\n\n" +
        "• 👤 *Nombre completo*\n" +
        "• 👨‍👩‍👧‍👦 *Apellido paterno*\n" +
        "• 👨‍👩‍👧‍👦 *Apellido materno* (si lo tienes registrado)\n" +
        "• 🆔 *Número de carnet*\n\n" +
        "*Formato de ejemplo:*\n" +
        "Maria Gonzalez Lopez 1234567\n\n" +
        "O si prefieres, puedes enviarme solo tu número de carnet."
    );
  };

  /**
   * Procesa los datos del paciente para cancelación
   */
  public processPatientDataForCancellation = async (
    from: string,
    text: string,
    sendMessage: (to: string, text: string) => Promise<void>,
    extractPatientDataWithGemini: (text: string) => Promise<any>
  ): Promise<{ success: boolean; patient?: PatientData; message?: string }> => {
    try {

      // Buscar paciente por CI o nombre
      const patient = await this.findPatientForCancellation(
        text,
        extractPatientDataWithGemini
      );

      if (!patient) {
        await sendMessage(
          from,
          "❌ No se encontró ningún paciente con los datos proporcionados.\n\n" +
            "Por favor verifica:\n" +
            "• Que los nombres y apellidos estén escritos correctamente\n" +
            "• Que el número de carnet sea el correcto\n\n" +
            "Ejemplo: *Maria Gonzalez Lopez 1234567*"
        );
        return { success: false, message: "Paciente no encontrado" };
      }

      return { success: true, patient };
    } catch (error) {
      console.error("❌ Error procesando datos para cancelación:", error);
      await sendMessage(
        from,
        "❌ Error al buscar tus datos. Por favor intenta nuevamente."
      );
      return { success: false, message: "Error procesando datos" };
    }
  };

  /**
   * Busca paciente para cancelación
   */
  private findPatientForCancellation = async (
    text: string,
    extractPatientDataWithGemini: (text: string) => Promise<any>
  ): Promise<PatientData | null> => {
    try {
      // Primero intentar buscar por CI
      const ciMatch = text.match(/\b(\d{5,10})\b/);
      if (ciMatch) {
        const identityCardString = ciMatch[1];
        const identityCardNumber = parseInt(identityCardString, 10);

        console.log(`🔍 Buscando paciente por CI`);

        const patient =
          await this.realPatientService.searchPatientByIdentityCard(
            identityCardNumber
          );
        if (patient) {
          console.log("✅ Paciente encontrado por CI:");
          return patient;
        }
      }

      // Si no se encuentra por CI, usar Gemini para extraer datos y buscar por nombre
      const extractionResult = await extractPatientDataWithGemini(text);
      if (extractionResult && extractionResult.success) {
        const patientData = extractionResult.data;

        // Buscar paciente por CI extraído
        if (patientData.IdentityCard) {
          // Convertir a número si es string
          const identityCardNumber =
            typeof patientData.IdentityCard === "string"
              ? parseInt(patientData.IdentityCard, 10)
              : patientData.IdentityCard;

          const patient =
            await this.realPatientService.searchPatientByIdentityCard(
              identityCardNumber
            );
          if (patient) {
            return patient;
          }
        }
      }

      return null;
    } catch (error) {
      console.error("❌ Error buscando paciente para cancelación:", error);
      return null;
    }
  };

  /**
   * Obtiene y muestra las citas del paciente
   */
  public showPatientAppointments = async (
    from: string,
    patientId: string,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<{
    success: boolean;
    sessionMap?: Map<number, any>;
    message?: string;
  }> => {
    try {

      // Obtener TODAS las citas del paciente
      const appointments = await this.getPatientAppointments(patientId);

      if (!appointments || appointments.length === 0) {
        await sendMessage(
          from,
          "ℹ️ *No tienes citas programadas*\n\n" +
            "No se encontraron citas en el sistema.\n\n" +
            "Si deseas programar una nueva cita, escribe *Hola* para comenzar."
        );
        return { success: false, message: "No hay citas programadas" };
      }

      // Obtener todas las sesiones cancelables de todas las citas
      const allCancelableSessions = this.getAllCancelableSessions(appointments);

      if (allCancelableSessions.length === 0) {
        await sendMessage(
          from,
          "ℹ️ *No tienes sesiones que puedan cancelarse*\n\n" +
            "Tus sesiones están:\n" +
            "• ✅ Confirmadas (no se pueden cancelar)\n" +
            "• ❌ Ya canceladas\n" +
            "• 🏁 Completadas\n\n" +
            "Si necesitas una nueva cita, escribe *Hola* para comenzar."
        );
        return { success: false, message: "No hay sesiones cancelables" };
      }

      // Formatear y mostrar las sesiones
      const { message: appointmentsMessage, sessionMap } =
        this.formatAppointmentsMessage(allCancelableSessions);

      await sendMessage(from, appointmentsMessage);

      await sendMessage(
        from,
        "¿Qué sesión deseas cancelar? Responde con el *número* de la sesión.\n\n" +
          "Ejemplo: envía *1* para cancelar la primera sesión."
      );

      return { success: true, sessionMap };
    } catch (error) {
      console.error("❌ Error mostrando sesiones del paciente:", error);
      await sendMessage(
        from,
        "❌ Error al cargar tus sesiones. Por favor intenta nuevamente o contacta con soporte."
      );
      return { success: false, message: "Error cargando sesiones" };
    }
  };

  /**
   * Obtiene todas las sesiones cancelables de todas las citas
   */
  private getAllCancelableSessions = (
    appointments: AppointmentData[]
  ): any[] => {
    const allSessions: any[] = [];

    appointments.forEach((appointment) => {
      const cancelableSessions = appointment.scheduledSessions.filter(
        (session) => {
          const sessionDate = new Date(session.startSessionDateTime);
          const isFuture = sessionDate > new Date();
          const isCancelable =
            session.status === "Scheduled" || session.status === "Rescheduled";
          return isFuture && isCancelable;
        }
      );

      cancelableSessions.forEach((session) => {
        allSessions.push({
          appointment: appointment,
          session: session,
          sessionDate: new Date(session.startSessionDateTime),
        });
      });
    });

    return allSessions.sort((a, b) => {
      return a.sessionDate.getTime() - b.sessionDate.getTime();
    });
  };

  /**
   * Filtra las citas que pueden cancelarse (Scheduled y Rescheduled)
   */
  private filterActiveAppointments = (
    appointments: AppointmentData[]
  ): AppointmentData[] => {
    const now = new Date();

    const cancelableAppointments = appointments.filter((appointment) => {
      
      // Si no tiene sesiones, no la mostramos
      if (
        !appointment.scheduledSessions ||
        appointment.scheduledSessions.length === 0
      ) {
        console.log(`❌ Cita ${appointment.id} no tiene sesiones`);
        return false;
      }

      // Buscar al menos una sesión que sea futura Y cancelable (Scheduled o Rescheduled)
      const hasCancelableSession = appointment.scheduledSessions.some(
        (session) => {
          const sessionDate = new Date(session.startSessionDateTime);
          const isFuture = sessionDate > now;
          const isCancelable =
            session.status === "Scheduled" || session.status === "Rescheduled";

          return isFuture && isCancelable;
        }
      );
      
      return hasCancelableSession;
    });

    console.log(
      `✅ Citas cancelables después del filtro`
    );
    return cancelableAppointments;
  };

  /**
   * Obtiene las citas del paciente desde el backend
   */
  private getPatientAppointments = async (
    patientId: string
  ): Promise<AppointmentData[]> => {
    try {

      const response = await fetch(`${this.baseUrl}/patient/${patientId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log(
          "📊 Datos recibidos del backend:"
        );

        // Verificar la estructura de la respuesta
        if (data.items && Array.isArray(data.items)) {
          console.log(`✅ Encontradas data item citas`);
          return data.items;
        } else if (Array.isArray(data)) {
          console.log(
            `✅ Encontradas citas`
          );
          return data;
        } else {
          console.log("❌ Formato de respuesta inesperado:", data);
          return [];
        }
      } else {
        const errorText = await response.text();
        console.error(
          "❌ Error obteniendo citas del paciente:",
          response.status,
          errorText
        );

        // 🔥 OPCIONAL: Si el nuevo endpoint falla, intentar con el antiguo
        console.log("🔄 Intentando con endpoint antiguo...");
        return await this.tryOldEndpoint(patientId);
      }
    } catch (error) {
      console.error("❌ Error en getPatientAppointments:", error);
      return [];
    }
  };

  /**
   * Método de respaldo usando el endpoint antiguo
   */
  private tryOldEndpoint = async (
    patientId: string
  ): Promise<AppointmentData[]> => {
    try {
      const response = await fetch(`${this.baseUrl}?patientId=${patientId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.items && Array.isArray(data.items)) {
          console.log(
            `✅ Encontradas citas en endpoint antiguo`
          );
          return data.items;
        }
      }
      return [];
    } catch (error) {
      console.error("❌ Error en tryOldEndpoint:", error);
      return [];
    }
  };

  /**
   * Formatea el mensaje de citas mostrando cada sesión individualmente
   */
  private formatAppointmentsMessage = (
    allCancelableSessions: any[]
  ): { message: string; sessionMap: Map<number, any> } => {
    let message = "📋 *Tus sesiones que pueden cancelarse:*\n\n";
    let sessionCounter = 1;
    const sessionMap = new Map();

    allCancelableSessions.forEach((sessionData) => {
      const appointment = sessionData.appointment;
      const session = sessionData.session;

      const startDate = new Date(session.startSessionDateTime);
      const endDate = new Date(session.endSessionDateTime);

      const formattedDate = startDate.toLocaleDateString("es-ES", {
        timeZone: "UTC",
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      const startTime = startDate.toLocaleTimeString("es-ES", {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      const endTime = endDate.toLocaleTimeString("es-ES", {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      message += `*${sessionCounter}.* 🩺 *Especialidad:* ${appointment.specialtyName}\n`;
      message += `   👨‍⚕️ *Especialista:* ${appointment.specialistName}\n`;
      message += `   📅 *Fecha:* ${formattedDate}\n`;
      message += `   🕐 *Horario:* ${startTime} a ${endTime}\n\n`;

      sessionMap.set(sessionCounter, {
        appointment: appointment,
        session: session,
      });

      sessionCounter++;
    });

    return { message, sessionMap };
  };

  /**
   * Maneja la selección de cita para cancelar
   */
  public handleAppointmentSelection = async (
    from: string,
    text: string,
    sessionMap: Map<number, any>,
    sendMessage: (to: string, text: string) => Promise<void>,
    sendButtons: (to: string, text: string) => Promise<void>
  ): Promise<{
    success: boolean;
    selectedAppointment?: AppointmentData;
    selectedSession?: any;
    message?: string;
  }> => {
    try {
      const sessionNumber = parseInt(text.trim());

      if (isNaN(sessionNumber)) {
        await sendMessage(
          from,
          "❌ Por favor, responde con el *número* de la sesión que deseas cancelar.\n\n" +
            'Ejemplo: envía "1" para cancelar la primera sesión.'
        );
        return { success: false, message: "Número inválido" };
      }

      // Verificar si el número existe en el mapa
      if (!sessionMap.has(sessionNumber)) {
        await sendMessage(
          from,
          `❌ Número inválido. Por favor selecciona un número entre 1 y ${sessionMap.size}.`
        );
        return { success: false, message: "Número fuera de rango" };
      }

      // Obtener la sesión seleccionada
      const selectedData = sessionMap.get(sessionNumber);
      const selectedAppointment = selectedData.appointment;
      const selectedSession = selectedData.session;

      // Enviar confirmación
      await this.sendCancelConfirmation(
        from,
        selectedAppointment,
        selectedSession,
        sendMessage,
        sendButtons
      );

      return { success: true, selectedAppointment, selectedSession };
    } catch (error) {
      console.error("❌ Error manejando selección de sesión:", error);
      await sendMessage(
        from,
        "❌ Error al procesar tu selección. Por favor intenta nuevamente."
      );
      return { success: false, message: "Error procesando selección" };
    }
  };

  /**
   * Envía la confirmación de cancelación
   */
  private sendCancelConfirmation = async (
    from: string,
    appointment: AppointmentData,
    session: any,
    sendMessage: (to: string, text: string) => Promise<void>,
    sendButtons: (to: string, text: string) => Promise<void>
  ): Promise<void> => {
    try {
      const startDate = new Date(session.startSessionDateTime);
      const endDate = new Date(session.endSessionDateTime);

      const formattedDate = startDate.toLocaleDateString("es-ES", {
        timeZone: "UTC",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      const startTime = startDate.toLocaleTimeString("es-ES", {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      const endTime = endDate.toLocaleTimeString("es-ES", {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      const confirmationMessage =
        "⚠️ *¿Estás seguro que deseas cancelar esta sesión?*\n\n" +
        `🩺 *Especialidad:* ${appointment.specialtyName}\n` +
        `👨‍⚕️ *Especialista:* ${appointment.specialistName}\n` +
        `📅 *Fecha:* ${formattedDate}\n` +
        `🕐 *Horario:* ${startTime} a ${endTime}\n\n` +
        "*Esta acción no se puede deshacer.*";

      await sendMessage(from, confirmationMessage);
      await sendButtons(from, "Confirmar cancelación");
    } catch (error) {
      console.error("❌ Error enviando confirmación de cancelación:", error);
      throw error;
    }
  };

  /**
   * Procesa la confirmación de cancelación
   */
  public processCancellationConfirmation = async (
    from: string,
    text: string,
    selectedAppointment: AppointmentData,
    selectedSession: any,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const lowerText = text.toLowerCase();

      if (
        lowerText.includes("sí") ||
        lowerText.includes("si") ||
        text.includes("✅")
      ) {
        // Proceder con la cancelación
        return await this.executeCancellation(
          from,
          selectedAppointment,
          selectedSession,
          sendMessage
        );
      } else if (lowerText.includes("no") || lowerText.includes("❌")) {
        await sendMessage(
          from,
          "✅ *Cancelación abortada*\n\n" +
            "Tu cita sigue activa. No se realizaron cambios.\n\n" +
            "Si necesitas ayuda adicional, no dudes en escribirnos."
        );
        return {
          success: true,
          message: "Cancelación abortada por el usuario",
        };
      }

      return { success: false, message: "Respuesta no reconocida" };
    } catch (error) {
      console.error("❌ Error procesando confirmación de cancelación:", error);
      await sendMessage(
        from,
        "❌ Error al procesar tu confirmación. Por favor intenta nuevamente."
      );
      return { success: false, message: "Error procesando confirmación" };
    }
  };

  /**
   * Ejecuta la cancelación en el backend
   */
  private executeCancellation = async (
    from: string,
    appointment: AppointmentData,
    session: any,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      // 🔥 CORREGIR: Usar session.id (camelCase) en lugar de session.Id (PascalCase)
      const cancellationSuccess = await this.cancelAppointmentSession(
        appointment.id,
        session.id // Cambiado de session.Id a session.id
      );

      if (cancellationSuccess) {
        await sendMessage(
          from,
          "✅ *¡Sesión cancelada exitosamente!*\n\n" +
            "Tu sesión ha sido cancelada. Recibirás un correo de confirmación.\n\n" +
            "Si fue un error, puedes programar una nueva cita escribiendo *Hola*."
        );
        return { success: true, message: "Sesión cancelada exitosamente" };
      } else {
        await sendMessage(
          from,
          "❌ *Error al cancelar la sesión*\n\n" +
            "No se pudo procesar la cancelación. Por favor contacta con nuestro call center.\n\n" +
            "Error: No se pudo conectar con el sistema."
        );
        return { success: false, message: "Error cancelando sesión" };
      }
    } catch (error) {
      console.error("❌ Error ejecutando cancelación:", error);
      await sendMessage(
        from,
        "❌ Error al cancelar la sesión. Por favor contacta con soporte."
      );
      return { success: false, message: "Error ejecutando cancelación" };
    }
  };

  /**
   * Cancela la sesión de la cita en el backend
   */
  private cancelAppointmentSession = async (
    appointmentId: string,
    sessionId: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${this.baseUrl}/appointment/${appointmentId}/cancel-session/${sessionId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        console.log(
          `✅ Sesión cancelada exitosamente`
        );
        return true;
      } else {
        console.error(
          `❌ Error cancelando sesión: ${response.status} ${response.statusText}`
        );
        return false;
      }
    } catch (error) {
      console.error("❌ Error en cancelAppointmentSession:", error);
      return false;
    }
  };
}