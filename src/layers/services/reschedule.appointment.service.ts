// services/reschedule-appointment.service.ts

import { RealPatientService } from "./real-patient.service";
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

export interface AvailableDay {
  dayOfWeek: string;
  displayName: string;
  availableSlots: AvailableSlot[];
}

export interface AvailableSlot {
  timeSlotId: string;
  startDateTime: string;
  endDateTime: string;
  formattedTime: string;
  formattedDate: string;
}

export interface RescheduleSelectionResult {
  success: boolean;
  selectedAppointment?: AppointmentData;
  selectedSession?: any;
  availableDays?: AvailableDay[];
  message?: string;
}

export interface DaySelectionResult {
  success: boolean;
  selectedDay?: AvailableDay;
  message?: string;
}

export interface SlotSelectionResult {
  success: boolean;
  selectedSlot?: AvailableSlot;
  message?: string;
}

export class RescheduleAppointmentService {
  private realPatientService: RealPatientService;
  private buttonManager: ButtonManager;
  private baseUrl: string;

  constructor() {
    this.realPatientService = new RealPatientService();
    this.buttonManager = new ButtonManager();
    this.baseUrl =
      "https://e-dukate-backend-production.up.railway.app/api/Appointments";
  }

  /**
   * Inicia el proceso de reprogramación
   */
  public startRescheduleProcess = async (
    from: string,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<void> => {
    await sendMessage(
      from,
      "🔄 *Reprogramación de Cita*\n\n" +
        "Para buscar tus citas disponibles para reprogramar, necesito que me envíes tus datos:\n\n" +
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
   * Procesa los datos del paciente para reprogramación
   */
  public processPatientDataForReschedule = async (
    from: string,
    text: string,
    sendMessage: (to: string, text: string) => Promise<void>,
    extractPatientDataWithGemini: (text: string) => Promise<any>
  ): Promise<{ success: boolean; patient?: PatientData; message?: string }> => {
    try {

      // Buscar paciente por CI o nombre (similar a cancelación)
      const patient = await this.findPatientForReschedule(
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
      console.error("❌ Error procesando datos para reprogramación:", error);
      await sendMessage(
        from,
        "❌ Error al buscar tus datos. Por favor intenta nuevamente."
      );
      return { success: false, message: "Error procesando datos" };
    }
  };

  /**
   * Busca paciente para reprogramación
   */
  private findPatientForReschedule = async (
    text: string,
    extractPatientDataWithGemini: (text: string) => Promise<any>
  ): Promise<PatientData | null> => {
    try {
      // Primero intentar buscar por CI
      const ciMatch = text.match(/\b(\d{5,10})\b/);
      if (ciMatch) {
        const identityCardString = ciMatch[1];
        const identityCardNumber = parseInt(identityCardString, 10);

        const patient =
          await this.realPatientService.searchPatientByIdentityCard(
            identityCardNumber
          );
        if (patient) {
          console.log("✅ Paciente encontrado por CI:");
          return patient;
        }
      }

      // Si no se encuentra por CI, usar Gemini para extraer datos
      const extractionResult = await extractPatientDataWithGemini(text);
      if (extractionResult && extractionResult.success) {
        const patientData = extractionResult.data;

        // Buscar paciente por CI extraído
        if (patientData.IdentityCard) {
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
      console.error("❌ Error buscando paciente para reprogramación:", error);
      return null;
    }
  };

  /**
   * Obtiene y muestra las citas reprogramables del paciente
   */
  public showPatientAppointmentsForReschedule = async (
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

      // Obtener todas las sesiones reprogramables
      const allReschedulableSessions =
        this.getAllReschedulableSessions(appointments);

      if (allReschedulableSessions.length === 0) {
        await sendMessage(
          from,
          "ℹ️ *No tienes sesiones que puedan reprogramarse*\n\n" +
            "Tus sesiones están:\n" +
            "• ✅ Confirmadas (no se pueden reprogramar)\n" +
            "• ❌ Ya canceladas\n" +
            "• 🏁 Completadas\n\n" +
            "Si necesitas una nueva cita, escribe *Hola* para comenzar."
        );
        return { success: false, message: "No hay sesiones reprogramables" };
      }

      // Formatear y mostrar las sesiones
      const { message: appointmentsMessage, sessionMap } =
        this.formatAppointmentsMessageForReschedule(allReschedulableSessions);

      await sendMessage(from, appointmentsMessage);

      await sendMessage(
        from,
        "¿Qué sesión deseas reprogramar? Responde con el *número* de la sesión.\n\n" +
          "Ejemplo: envía *1* para reprogramar la primera sesión."
      );

      return { success: true, sessionMap };
    } catch (error) {
      console.error("❌ Error mostrando sesiones para reprogramación:", error);
      await sendMessage(
        from,
        "❌ Error al cargar tus sesiones. Por favor intenta nuevamente o contacta con soporte."
      );
      return { success: false, message: "Error cargando sesiones" };
    }
  };

  /**
   * Obtiene todas las sesiones reprogramables
   */
  private getAllReschedulableSessions = (
    appointments: AppointmentData[]
  ): any[] => {
    const allSessions: any[] = [];

    appointments.forEach((appointment) => {
      const reschedulableSessions = appointment.scheduledSessions.filter(
        (session) => {
          const sessionDate = new Date(session.startSessionDateTime);
          const isFuture = sessionDate > new Date();
          const isReschedulable =
            session.status === "Scheduled" || session.status === "Rescheduled";
          return isFuture && isReschedulable;
        }
      );

      reschedulableSessions.forEach((session) => {
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
   * Obtiene las citas del paciente
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

        if (data.items && Array.isArray(data.items)) {
          return data.items;
        } else if (Array.isArray(data)) {
          console.log(
            `✅ Encontradas ${data.length} citas (formato array directo)`
          );
          return data;
        } else {
          console.log("❌ Formato de respuesta inesperado:", data);
          return [];
        }
      } else {
        const errorText = await response.text();
        console.error("❌ Error obteniendo citas:", response.status, errorText);
        return [];
      }
    } catch (error) {
      console.error("❌ Error en getPatientAppointments:", error);
      return [];
    }
  };

  /**
   * Formatea el mensaje de citas para reprogramación
   */
  private formatAppointmentsMessageForReschedule = (
    allReschedulableSessions: any[]
  ): { message: string; sessionMap: Map<number, any> } => {
    let message = "📋 *Tus sesiones que pueden reprogramarse:*\n\n";
    let sessionCounter = 1;
    const sessionMap = new Map();

    allReschedulableSessions.forEach((sessionData) => {
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
      message += `   📅 *Fecha actual:* ${formattedDate}\n`;
      message += `   🕐 *Horario actual:* ${startTime} a ${endTime}\n\n`;

      sessionMap.set(sessionCounter, {
        appointment: appointment,
        session: session,
      });

      sessionCounter++;
    });

    return { message, sessionMap };
  };

  /**
   * Maneja la selección de cita para reprogramar - SOLO muestra días primero
   */
  public handleAppointmentSelectionForReschedule = async (
    from: string,
    text: string,
    sessionMap: Map<number, any>,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<RescheduleSelectionResult> => {
    try {
      const sessionNumber = parseInt(text.trim());

      if (isNaN(sessionNumber)) {
        await sendMessage(
          from,
          "❌ Por favor, responde con el *número* de la sesión que deseas reprogramar.\n\n" +
            'Ejemplo: envía "1" para reprogramar la primera sesión.'
        );
        return { success: false, message: "Número inválido" };
      }

      if (!sessionMap.has(sessionNumber)) {
        await sendMessage(
          from,
          `❌ Número inválido. Por favor selecciona un número entre 1 y ${sessionMap.size}.`
        );
        return { success: false, message: "Número fuera de rango" };
      }

      const selectedData = sessionMap.get(sessionNumber);
      const selectedAppointment = selectedData.appointment;
      const selectedSession = selectedData.session;

      // 🔥 CAMBIO IMPORTANTE: Solo obtener los días disponibles, NO los slots todavía
      const availableDays = await this.getAvailableDaysOnly(
        selectedAppointment.specialistId
      );

      if (availableDays.length === 0) {
        console.log("❌ No hay días disponibles, enviando mensaje al usuario");
        await sendMessage(
          from,
          "❌ El especialista no tiene días disponibles para reprogramación en este momento.\n\n" +
            "Por favor intenta más tarde o contacta con soporte."
        );
        return { success: false, message: "No hay días disponibles" };
      }

      // 🔥 MOSTRAR SOLO LOS DÍAS primero
      await this.showAvailableDaysOnly(
        from,
        availableDays,
        selectedAppointment,
        selectedSession,
        sendMessage
      );

      return {
        success: true,
        selectedAppointment,
        selectedSession,
        availableDays,
      };
    } catch (error) {
      console.error("❌ Error manejando selección para reprogramación:", error);
      await sendMessage(
        from,
        "❌ Error al procesar tu selección. Por favor intenta nuevamente."
      );
      return { success: false, message: "Error procesando selección" };
    }
  };

  /**
   * Obtiene SOLO los días disponibles del especialista (sin slots todavía)
   */
  private getAvailableDaysOnly = async (
    specialistId: string
  ): Promise<AvailableDay[]> => {
    try {

      // Obtener el especialista con sus horarios
      const specialistResponse = await fetch(
        `https://e-dukate-backend-production.up.railway.app/api/Specialists/${specialistId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!specialistResponse.ok) {
        console.error(
          "❌ Error obteniendo datos del especialista:",
          specialistResponse.status
        );
        return [];
      }

      const specialist = await specialistResponse.json();

      let schedules = specialist.schedules;

      if (!schedules || schedules.length === 0) {
        console.log("❌ No se encontraron horarios para el especialista");
        return [];
      }

      // Mapear días de la semana disponibles
      const availableDays: AvailableDay[] = [];
      const dayMap: { [key: string]: string } = {
        Monday: "Lunes",
        Tuesday: "Martes",
        Wednesday: "Miércoles",
        Thursday: "Jueves",
        Friday: "Viernes",
        Saturday: "Sábado",
        Sunday: "Domingo",
      };

      // Filtrar solo los schedules que tienen attends = true y timeSlots
      const activeSchedules = schedules.filter(
        (schedule: any) =>
          schedule.attends === true &&
          schedule.timeSlots &&
          schedule.timeSlots.length > 0
      );

      // Para cada schedule activo, crear objeto de día SIN slots todavía
      for (const schedule of activeSchedules) {
        const dayOfWeek = schedule.dayOfWeek;
        const displayName = dayMap[dayOfWeek] || dayOfWeek;

        availableDays.push({
          dayOfWeek: dayOfWeek,
          displayName: displayName,
          availableSlots: [], // 🔥 Inicialmente vacío, se llenará después
        });
      }

      return availableDays;
    } catch (error) {
      console.error("❌ Error obteniendo días disponibles:", error);
      return [];
    }
  };

  /**
   * Muestra SOLO los días disponibles al usuario (sin horarios todavía)
   */
  private showAvailableDaysOnly = async (
    from: string,
    availableDays: AvailableDay[],
    appointment: AppointmentData,
    session: any,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<void> => {
    let message = "📅 *Selecciona un día de la semana para reprogramar:*\n\n";

    availableDays.forEach((day, index) => {
      message += `*${index + 1}.* ${day.displayName}\n`;
    });

    message += `\nResponde con el *número* del día que prefieres.\n`;
    message += `Ejemplo: envía *1* para seleccionar ${availableDays[0]?.displayName}`;

    await sendMessage(from, message);
  };

  /**
   * Obtiene slots disponibles para un día específico usando el endpoint correcto
   */
  private getAvailableSlotsForDay = async (
    appointmentId: string,
    sessionId: string,
    dayOfWeek: string
  ): Promise<AvailableSlot[]> => {
    try {

      const request = {
        sessionId: sessionId,
        targetDayOfWeek: dayOfWeek,
        lookAheadWeeks: 2,
      };

      const response = await fetch(
        `${this.baseUrl}/${appointmentId}/reschedule-preview`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        }
      );

      if (response.ok) {
        const data = await response.json();

        // El endpoint devuelve { availableSlots: [...] } o directamente el array
        const slots = data.availableSlots || data || [];

        return slots.map((slot: any) => ({
          timeSlotId: slot.timeSlotId,
          startDateTime: slot.startDateTime,
          endDateTime: slot.endDateTime,
          formattedTime:
            slot.formattedTime ||
            this.formatTimeSlot(slot.startDateTime, slot.endDateTime),
          formattedDate:
            slot.formattedDate || this.formatDate(slot.startDateTime),
        }));
      } else {
        const errorText = await response.text();
        console.error(
          `❌ Error en reschedule-preview: ${response.status}`,
          errorText
        );
        return [];
      }
    } catch (error) {
      console.error("❌ Error obteniendo slots disponibles:", error);
      return [];
    }
  };

  /**
   * Formatea el tiempo del slot
   */
  private formatTimeSlot = (
    startDateTime: string,
    endDateTime: string
  ): string => {
    try {
      const start = new Date(startDateTime);
      const end = new Date(endDateTime);

      const startTime = start.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      const endTime = end.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      return `${startTime} - ${endTime}`;
    } catch (error) {
      console.error("Error formateando tiempo:", error);
      return "Horario no disponible";
    }
  };

  /**
   * Genera slots disponibles basados en los timeSlots del schedule
   * cuando el endpoint de reschedule-preview no funciona
   */
  private generateAlternativeSlots = async (
    dayOfWeek: string
  ): Promise<AvailableSlot[]> => {
    try {

      // Obtener la fecha del próximo día de la semana
      const nextDate = this.getNextDateForDay(dayOfWeek);
      const nextWeekDate = this.getNextDateForDay(dayOfWeek, 1); // Semana siguiente

      const slots: AvailableSlot[] = [];

      // Horarios predefinidos basados en los timeSlots que viste en el log
      const timeSlots = [
        { start: "08:00", end: "08:45" },
        { start: "09:30", end: "10:15" },
        { start: "11:00", end: "11:45" },
        { start: "12:30", end: "13:15" },
        { start: "14:00", end: "14:45" },
        { start: "15:30", end: "16:15" },
        { start: "17:00", end: "17:45" },
      ];

      // Generar slots para esta semana
      timeSlots.forEach((slot, index) => {
        const startDateTime = new Date(`${nextDate}T${slot.start}:00`);
        const endDateTime = new Date(`${nextDate}T${slot.end}:00`);

        // Solo agregar slots futuros
        if (startDateTime > new Date()) {
          slots.push({
            timeSlotId: `alt-${dayOfWeek}-${index}`,
            startDateTime: startDateTime.toISOString(),
            endDateTime: endDateTime.toISOString(),
            formattedTime: `${slot.start} - ${slot.end}`,
            formattedDate: this.formatDate(nextDate),
          });
        }
      });

      // Generar slots para la semana siguiente
      timeSlots.forEach((slot, index) => {
        const startDateTime = new Date(`${nextWeekDate}T${slot.start}:00`);
        const endDateTime = new Date(`${nextWeekDate}T${slot.end}:00`);

        slots.push({
          timeSlotId: `alt-${dayOfWeek}-next-${index}`,
          startDateTime: startDateTime.toISOString(),
          endDateTime: endDateTime.toISOString(),
          formattedTime: `${slot.start} - ${slot.end}`,
          formattedDate: this.formatDate(nextWeekDate),
        });
      });

      return slots;
    } catch (error) {
      console.error("❌ Error generando slots alternativos:", error);
      return [];
    }
  };

  /**
   * Obtiene la fecha del próximo día de la semana específico
   */
  private getNextDateForDay = (
    dayOfWeek: string,
    weeksAhead: number = 0
  ): string => {
    const dayMap: { [key: string]: number } = {
      Monday: 1,
      Tuesday: 2,
      Wednesday: 3,
      Thursday: 4,
      Friday: 5,
      Saturday: 6,
      Sunday: 0,
    };

    const targetDay = dayMap[dayOfWeek];
    const today = new Date();
    const currentDay = today.getDay();

    let daysToAdd = targetDay - currentDay;
    if (daysToAdd < 0) {
      daysToAdd += 7;
    }

    daysToAdd += weeksAhead * 7;

    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysToAdd);

    return targetDate.toISOString().split("T")[0];
  };

  /**
   * Formatea la fecha del slot
   */
  private formatDate = (dateTime: string): string => {
    try {
      const date = new Date(dateTime);
      return date.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch (error) {
      console.error("Error formateando fecha:", error);
      return "Fecha no disponible";
    }
  };

  /**
   * Muestra los días disponibles al usuario
   */
  private showAvailableDays = async (
    from: string,
    availableDays: AvailableDay[],
    appointment: AppointmentData,
    session: any,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<void> => {
    let message = "📅 *Días disponibles para reprogramación:*\n\n";

    availableDays.forEach((day, index) => {
      const slotCount = day.availableSlots.length;
      const slotInfo =
        slotCount > 0
          ? ` (${slotCount} horario${slotCount !== 1 ? "s" : ""} disponible${
              slotCount !== 1 ? "s" : ""
            })`
          : " (Consultar horarios)";
      message += `*${index + 1}.* ${day.displayName}${slotInfo}\n`;
    });

    message += `\nResponde con el *número* del día que prefieres.\n`;
    message += `Ejemplo: envía *1* para seleccionar ${availableDays[0]?.displayName}`;

    await sendMessage(from, message);
  };

  /**
   * Maneja la selección del día y LUEGO obtiene los slots para ese día
   */
  public handleDaySelection = async (
    from: string,
    text: string,
    availableDays: AvailableDay[],
    selectedAppointment: AppointmentData,
    selectedSession: any,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<DaySelectionResult> => {
    try {
      const dayNumber = parseInt(text.trim());

      if (isNaN(dayNumber)) {
        await sendMessage(
          from,
          "❌ Por favor, responde con el *número* del día.\n\n" +
            'Ejemplo: envía "1" para seleccionar el primer día.'
        );
        return { success: false, message: "Número inválido" };
      }

      if (dayNumber < 1 || dayNumber > availableDays.length) {
        await sendMessage(
          from,
          `❌ Número inválido. Por favor selecciona un número entre 1 y ${availableDays.length}.`
        );
        return { success: false, message: "Número fuera de rango" };
      }

      const selectedDay = availableDays[dayNumber - 1];

      // 🔥 AHORA obtener los slots disponibles para este día específico
      const availableSlots = await this.getAvailableSlotsForDay(
        selectedAppointment.id,
        selectedSession.id,
        selectedDay.dayOfWeek
      );

      if (availableSlots.length === 0) {
        await sendMessage(
          from,
          `❌ No hay horarios disponibles para ${selectedDay.displayName} en este momento.\n\n` +
            "Por favor selecciona otro día."
        );
        return { success: false, message: "No hay slots disponibles" };
      }

      // Actualizar el día seleccionado con los slots obtenidos
      selectedDay.availableSlots = availableSlots;

      // Mostrar horarios disponibles para el día seleccionado
      await this.showAvailableSlots(
        from,
        selectedDay,
        selectedAppointment,
        selectedSession,
        sendMessage
      );

      return { success: true, selectedDay };
    } catch (error) {
      console.error("❌ Error manejando selección de día:", error);
      await sendMessage(
        from,
        "❌ Error al procesar tu selección. Por favor intenta nuevamente."
      );
      return { success: false, message: "Error procesando selección" };
    }
  };

  /**
   * Muestra los horarios disponibles para el día seleccionado
   */
  private showAvailableSlots = async (
    from: string,
    selectedDay: AvailableDay,
    appointment: AppointmentData,
    session: any,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<void> => {
    let message = `🕐 *Horarios disponibles para ${selectedDay.displayName}:*\n\n`;

    selectedDay.availableSlots.forEach((slot, index) => {
      message += `*${index + 1}.* ${slot.formattedTime} (${
        slot.formattedDate
      })\n`;
    });

    message += `\nResponde con el *número* del horario que prefieres.\n`;
    message += `Ejemplo: envía *1* para seleccionar el primer horario`;

    await sendMessage(from, message);
  };

  /**
   * Maneja la selección del horario y ejecuta la reprogramación
   */
  public handleSlotSelectionAndReschedule = async (
    from: string,
    text: string,
    selectedDay: AvailableDay,
    selectedAppointment: AppointmentData,
    selectedSession: any,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<SlotSelectionResult> => {
    try {
      const slotNumber = parseInt(text.trim());

      if (isNaN(slotNumber)) {
        await sendMessage(
          from,
          "❌ Por favor, responde con el *número* del horario.\n\n" +
            'Ejemplo: envía "1" para seleccionar el primer horario.'
        );
        return { success: false, message: "Número inválido" };
      }

      if (slotNumber < 1 || slotNumber > selectedDay.availableSlots.length) {
        await sendMessage(
          from,
          `❌ Número inválido. Por favor selecciona un número entre 1 y ${selectedDay.availableSlots.length}.`
        );
        return { success: false, message: "Número fuera de rango" };
      }

      const selectedSlot = selectedDay.availableSlots[slotNumber - 1];

      // Mostrar confirmación
      await this.showRescheduleConfirmation(
        from,
        selectedAppointment,
        selectedSession,
        selectedSlot,
        sendMessage
      );

      return { success: true, selectedSlot }; // ✅ Ahora el tipo coincide
    } catch (error) {
      console.error("❌ Error manejando selección de horario:", error);
      await sendMessage(
        from,
        "❌ Error al procesar tu selección. Por favor intenta nuevamente."
      );
      return { success: false, message: "Error procesando selección" };
    }
  };

  /**
   * Muestra confirmación de reprogramación
   */
  private showRescheduleConfirmation = async (
    from: string,
    appointment: AppointmentData,
    session: any,
    selectedSlot: AvailableSlot,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<void> => {
    const startDate = new Date(session.startSessionDateTime);
    const currentFormattedDate = startDate.toLocaleDateString("es-ES", {
      timeZone: "UTC",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const currentStartTime = startDate.toLocaleTimeString("es-ES", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const newDate = new Date(selectedSlot.startDateTime);
    const newFormattedDate = newDate.toLocaleDateString("es-ES", {
      timeZone: "UTC",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const newStartTime = newDate.toLocaleTimeString("es-ES", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const confirmationMessage =
      "🔄 *¿Confirmas la reprogramación?*\n\n" +
      "*Sesión actual:*\n" +
      `🩺 *Especialidad:* ${appointment.specialtyName}\n` +
      `👨‍⚕️ *Especialista:* ${appointment.specialistName}\n` +
      `📅 *Fecha:* ${currentFormattedDate}\n` +
      `🕐 *Horario:* ${currentStartTime}\n\n` +
      "*Nueva sesión:*\n" +
      `📅 *Fecha:* ${newFormattedDate}\n` +
      `🕐 *Horario:* ${newStartTime}\n\n` +
      "*¿Deseas proceder con la reprogramación?*";

    await sendMessage(from, confirmationMessage);
    await this.buttonManager.sendYesNoButtons(from, "Confirmar reprogramación");
  };

  /**
   * Ejecuta la reprogramación en el backend
   */
  public executeReschedule = async (
    from: string,
    selectedAppointment: AppointmentData,
    selectedSession: any,
    selectedSlot: AvailableSlot,
    sendMessage: (to: string, text: string) => Promise<void>
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const payload = {
        sessionId: selectedSession.id,
        newTimeSlotId: selectedSlot.timeSlotId,
        newStartDateTime: selectedSlot.startDateTime,
        newEndDateTime: selectedSlot.endDateTime,
      };

      const success = await this.rescheduleAppointmentSession(
        selectedAppointment.id,
        payload
      );

      if (success) {
        const newDate = new Date(selectedSlot.startDateTime);
        const newFormattedDate = newDate.toLocaleDateString("es-ES", {
          timeZone: "UTC",
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        const newStartTime = newDate.toLocaleTimeString("es-ES", {
          timeZone: "UTC",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });

        await sendMessage(
          from,
          "✅ *¡Sesión reprogramada exitosamente!*\n\n" +
            `Tu sesión ha sido reprogramada para:\n` +
            `📅 *Fecha:* ${newFormattedDate}\n` +
            `🕐 *Horario:* ${newStartTime}\n\n` +
            "Recibirás un recordatorio antes de tu nueva sesión."
        );
        return { success: true, message: "Sesión reprogramada exitosamente" };
      } else {
        await sendMessage(
          from,
          "❌ *Error al reprogramar la sesión*\n\n" +
            "No se pudo procesar la reprogramación. Por favor contacta con nuestro call center.\n\n" +
            "Error: No se pudo conectar con el sistema."
        );
        return { success: false, message: "Error reprogramando sesión" };
      }
    } catch (error) {
      console.error("❌ Error ejecutando reprogramación:", error);
      await sendMessage(
        from,
        "❌ Error al reprogramar la sesión. Por favor contacta con soporte."
      );
      return { success: false, message: "Error ejecutando reprogramación" };
    }
  };

  /**
   * Reprograma la sesión en el backend
   */
  private rescheduleAppointmentSession = async (
    appointmentId: string,
    payload: any
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${this.baseUrl}/reschedule-session/${appointmentId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (response.ok) {
        console.log(
          `✅ Sesión de cita ${appointmentId} reprogramada exitosamente`
        );
        return true;
      } else {
        console.error(
          `❌ Error reprogramando sesión: ${response.status} ${response.statusText}`
        );
        return false;
      }
    } catch (error) {
      console.error("❌ Error en rescheduleAppointmentSession:", error);
      return false;
    }
  };
}