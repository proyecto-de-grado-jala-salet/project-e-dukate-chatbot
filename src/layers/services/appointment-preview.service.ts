import { AvailabilityService } from './availability.service';

export interface SessionSelection {
  scheduleId: string;
  dayOfWeek: string; // Ej: "Lunes", "Martes"
  startTime: string; // Ej: "08:00"
  endTime: string; // Ej: "09:00"
  displayText: string;
}

export interface AppointmentPreview {
  specialistName: string;
  specialtyName: string;
  totalSessions: number;
  sessions: SessionPreview[];
}

export interface SessionPreview {
  sessionNumber: number;
  date: string; // Formato: "24/10/2025"
  time: string; // Formato: "11:00 - 11:45"
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  actualDate: Date; // 🔥 NUEVO: Para guardar la fecha real
}

export class AppointmentPreviewService {
  private availabilityService: AvailabilityService;

  constructor() {
    this.availabilityService = new AvailabilityService();
  }

  /**
   * Genera el preview de las sesiones verificando disponibilidad (con respaldo)
   */
  async generatePreview(
    specialistName: string,
    specialtyName: string,
    totalSessions: number,
    selectedSlots: SessionSelection[]
  ): Promise<AppointmentPreview> {
    const sessions: SessionPreview[] = [];

    try {
      // Para cada sesión, buscar fecha disponible
      for (let i = 0; i < totalSessions; i++) {
        const slotIndex = i % selectedSlots.length;
        const selectedSlot = selectedSlots[slotIndex];

        const dayOfWeekNumber = this.dayOfWeekToNumber(selectedSlot.dayOfWeek);

        let sessionDate: Date;

        // Intentar usar AvailabilityService
        try {
          sessionDate =
            (await this.availabilityService.findNextAvailableDate(
              selectedSlot.scheduleId,
              dayOfWeekNumber,
              selectedSlot.startTime,
              selectedSlot.endTime
            )) || this.calculateSessionDate(selectedSlot.dayOfWeek, i);
        } catch (error) {
          // Si falla AvailabilityService, usar cálculo local
          console.warn("⚠️ Usando cálculo local de fechas:", error);
          sessionDate = this.calculateSessionDate(selectedSlot.dayOfWeek, i);
        }

        const formattedDate = this.formatDate(sessionDate);
        const formattedTime = this.formatTimeRange(
          selectedSlot.startTime,
          selectedSlot.endTime
        );

        sessions.push({
          sessionNumber: i + 1,
          date: formattedDate,
          time: formattedTime,
          dayOfWeek: selectedSlot.dayOfWeek,
          startTime: selectedSlot.startTime,
          endTime: selectedSlot.endTime,
          actualDate: sessionDate,
        });
      }
    } catch (error) {
      console.error("❌ Error generando preview:", error);
      throw new Error("No se pudieron generar las fechas para las sesiones");
    }

    return {
      specialistName,
      specialtyName,
      totalSessions,
      sessions,
    };
  }

  /**
   * Método de respaldo si AvailabilityService no está disponible
   */
  private calculateSessionDate(dayOfWeek: string, sessionIndex: number): Date {
    const today = new Date();
    const currentDay = today.getDay(); // 0=Domingo, 1=Lunes, ..., 6=Sábado

    const targetDay = this.dayOfWeekToNumber(dayOfWeek);

    // Calcular días hasta el próximo día objetivo
    let daysUntilTarget = (targetDay - currentDay + 7) % 7;
    if (daysUntilTarget === 0) {
      daysUntilTarget = 7; // Si es hoy, programar para la próxima semana
    }

    // Agregar semanas según el índice de la sesión
    const weeksToAdd = Math.floor(sessionIndex);
    const totalDays = daysUntilTarget + weeksToAdd * 7;

    const sessionDate = new Date(today);
    sessionDate.setDate(today.getDate() + totalDays);

    return sessionDate;
  }

  /**
   * Convierte día de la semana en texto a número (0-6)
   */
  private dayOfWeekToNumber(dayOfWeek: string): number {
    const daysMap: { [key: string]: number } = {
      domingo: 0,
      lunes: 1,
      martes: 2,
      miércoles: 3,
      jueves: 4,
      viernes: 5,
      sábado: 6,
    };

    return daysMap[dayOfWeek.toLowerCase()] || 1; // Default a Lunes
  }

  /**
   * Obtiene cuántos slots hay para un día específico (para cálculo de semanas)
   */
  private getSlotsCountForDay(dayOfWeek: string): number {
    // Por simplicidad, asumimos 1 slot por día
    // Puedes ajustar esto si tienes múltiples slots por día
    return 1;
  }

  /**
   * Formatea la fecha a "24/10/2025"
   */
  private formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear();

    return `${day}/${month}/${year}`;
  }

  /**
   * Formatea el rango de tiempo a "11:00 - 11:45"
   */
  private formatTimeRange(startTime: string, endTime: string): string {
    // Asegurar formato consistente
    const formatTime = (time: string): string => {
      if (time.includes(":")) {
        return time.split(":").slice(0, 2).join(":");
      }
      return time;
    };

    return `${formatTime(startTime)} - ${formatTime(endTime)}`;
  }

  /**
   * Genera el mensaje de resumen para mostrar al usuario
   */
  generateSummaryMessage(preview: AppointmentPreview): string {
    let message = `🎉 *¡Perfecto! A continuación te muestro un resumen:*\n\n`;

    message += `*Especialista:* ${preview.specialistName}\n`;
    message += `*Especialidad:* ${preview.specialtyName}\n`;
    message += `*Total de sesiones:* ${preview.totalSessions}\n\n`;

    message += `*Estas son las fechas con el horario que seleccionaste:*\n\n`;
    message += `*Horarios seleccionados:*\n`;

    preview.sessions.forEach((session) => {
      message += `Sesión ${session.sessionNumber}: ${session.date} a las ${session.time}\n`;
    });

    return message;
  }

  /**
   * Genera mensaje de confirmación
   */
  generateConfirmationMessage(): string {
    return `\n¿Estás conforme con las fechas y horario de tus sesiones?`;
  }

  /**
   * Analiza el mensaje del usuario para identificar qué sesiones quiere modificar
   */
  async analyzeSessionModification(
    userMessage: string,
    totalSessions: number,
    currentSessions: SessionPreview[]
  ): Promise<{ sessionsToModify: number[]; message: string }> {
    try {
      const prompt = `
El usuario tiene ${totalSessions} sesiones programadas y no está conforme. 
Analiza su mensaje para identificar EXACTAMENTE qué sesiones específicas quiere modificar.

SESIONES ACTUALES:
${currentSessions
  .map((s) => `Sesión ${s.sessionNumber}: ${s.date} a las ${s.time}`)
  .join("\n")}

MENSAJE DEL USUARIO: "${userMessage}"

Responde SOLO en formato JSON:

{
  "sessionsToModify": [array de números de sesión que quiere modificar, ej: [1, 3] o [2] o [1,2,3]],
  "message": "mensaje claro para confirmar qué sesiones modificar"
}

Reglas:
- Si menciona "todas", "ninguna me convence", etc → modificar todas [1,2,3,...]
- Si menciona números específicos como "la 1 y la 3" → [1, 3]
- Si menciona "la primera" o "sesión 2" → [1] o [2]
- Si menciona "solo la última" → [último número]
- Si no está claro, pregunta por clarificación
- Si es solo 1 sesión total, modificar directamente
`;

      // Usar Gemini para análisis (o lógica de respaldo si no hay API key)
      const sessionsToModify = this.fallbackSessionAnalysis(
        userMessage,
        totalSessions
      );

      let message = "";
      if (sessionsToModify.length === totalSessions) {
        message = "Vamos a modificar *todas* tus sesiones.";
      } else if (sessionsToModify.length === 1) {
        message = `Vamos a modificar la *sesión ${sessionsToModify[0]}*.`;
      } else {
        const sessionsText = sessionsToModify
          .map((s) => s.toString())
          .join(", ");
        message = `Vamos a modificar las *sesiones ${sessionsText}*.`;
      }

      return {
        sessionsToModify,
        message,
      };
    } catch (error) {
      console.error("Error analizando modificación de sesiones:", error);
      // Respuesta por defecto si hay error
      return {
        sessionsToModify: Array.from(
          { length: totalSessions },
          (_, i) => i + 1
        ),
        message: "Vamos a modificar todas tus sesiones.",
      };
    }
  }

  /**
   * Análisis de respaldo sin Gemini
   */
  private fallbackSessionAnalysis(
    userMessage: string,
    totalSessions: number
  ): number[] {
    const lowerMessage = userMessage.toLowerCase();

    // Caso 1: Usuario quiere modificar todas las sesiones
    if (
      lowerMessage.includes("todas") ||
      lowerMessage.includes("ninguna") ||
      lowerMessage.includes("todas las sesiones") ||
      lowerMessage.match(/modificar\s+todo/)
    ) {
      return Array.from({ length: totalSessions }, (_, i) => i + 1);
    }

    // Caso 2: Buscar números específicos mencionados
    const numberMatches = lowerMessage.match(/\d+/g);
    if (numberMatches) {
      const sessionNumbers = numberMatches
        .map(Number)
        .filter((num) => num >= 1 && num <= totalSessions)
        .filter((num, index, array) => array.indexOf(num) === index); // Remover duplicados

      if (sessionNumbers.length > 0) {
        return sessionNumbers;
      }
    }

    // Caso 3: Palabras específicas como "primera", "segunda", etc.
    const sessionKeywords: { [key: string]: number } = {
      primera: 1,
      primero: 1,
      "1ra": 1,
      "1era": 1,
      "1ro": 1,

      segunda: 2,
      segundo: 2,
      "2da": 2,
      "2nda": 2,
      "2do": 2,

      tercera: 3,
      tercero: 3,
      "3ra": 3,
      "3era": 3,
      "3ro": 3,

      cuarta: 4,
      cuarto: 4,
      "4ta": 4,
      "4rta": 4,
      "4to": 4,

      quinta: 5,
      quinto: 5,
      "5ta": 5,
      "5nta": 5,
      "5to": 5,

      sexta: 6,
      sexto: 6,
      "6ta": 6,
      "6to": 6,

      séptima: 7,
      septima: 7,
      séptimo: 7,
      septimo: 7,
      "7ma": 7,
      "7mo": 7,

      octava: 8,
      octavo: 8,
      "8va": 8,
      "8vo": 8,

      novena: 9,
      noveno: 9,
      "9na": 9,
      "9no": 9,

      décima: 10,
      decima: 10,
      décimo: 10,
      decimo: 10,
      "10ma": 10,
      "10mo": 10,

      última: totalSessions,
      ultima: totalSessions,
      último: totalSessions,
      ultimo: totalSessions,
    };

    const mentionedSessions: number[] = [];
    for (const [keyword, sessionNumber] of Object.entries(sessionKeywords)) {
      if (lowerMessage.includes(keyword) && sessionNumber <= totalSessions) {
        mentionedSessions.push(sessionNumber);
      }
    }

    if (mentionedSessions.length > 0) {
      return mentionedSessions;
    }

    // Caso 4: Por defecto, modificar todas
    return Array.from({ length: totalSessions }, (_, i) => i + 1);
  }

  /**
   * Actualiza el preview removiendo las sesiones que se van a modificar
   */
  updatePreviewForModification(
    originalPreview: AppointmentPreview,
    sessionsToModify: number[]
  ): AppointmentPreview {
    // Filtrar las sesiones que NO se van a modificar
    const keptSessions = originalPreview.sessions.filter(
      (session) => !sessionsToModify.includes(session.sessionNumber)
    );

    return {
      ...originalPreview,
      sessions: keptSessions,
    };
  }

  /**
   * Genera mensaje para preguntar qué sesiones modificar
   */
  generateModificationPrompt(totalSessions: number): string {
    if (totalSessions === 1) {
      return "Entendido, vamos a seleccionar un nuevo horario para tu sesión.";
    }

    let message = "🔄 *¿Qué sesiones específicas te gustaría modificar?*\n\n";
    message += `Tienes *${totalSessions} sesiones* programadas.\n\n`;
    message += "Puedes decirme:\n";
    message += '• *"Todas"* - para cambiar todas las sesiones\n';
    message += '• *"La 1 y 3"* - para cambiar solo sesiones específicas\n';
    message += '• *"Solo la última"* - para cambiar solo la sesión final\n';
    message +=
      '• *"La primera y segunda"* - para cambiar múltiples sesiones\n\n';
    message += "Por favor, indícame qué sesiones quieres modificar:";

    return message;
  }
}