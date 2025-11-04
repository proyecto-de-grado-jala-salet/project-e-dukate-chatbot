import { pool } from '../../utils/database';

export interface Schedule {
  Id: number;
  SpecialistId: number;
  DayOfWeek: string;
  Attends: boolean;
}

export interface TimeSlot {
  Id: number;
  ScheduleId: number;
  StartTime: string;
  EndTime: string;
}

export interface AvailableSlot {
  scheduleId: string;
  timeSlotId: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  displayText: string;
}

export class ScheduleService {
  /**
   * Obtiene los horarios disponibles de un especialista
   */
  async getAvailableSlotsBySpecialist(
    specialistId: string
  ): Promise<AvailableSlot[]> {
    try {
      const result = await pool.query(
        `
      SELECT 
        ts."Id" as timeslot_id,
        s."Id" as schedule_id,
        s."DayOfWeek",
        ts."StartTime", 
        ts."EndTime"
      FROM "Schedules" s
      INNER JOIN "TimeSlots" ts ON s."Id" = ts."ScheduleId"
      WHERE s."SpecialistId" = $1 
      AND s."Attends" = true
      AND ts."StartTime" IS NOT NULL
      AND ts."EndTime" IS NOT NULL
      ORDER BY 
        s."DayOfWeek",
        ts."StartTime"
    `,
        [specialistId]
      );

      console.log(
        `✅ Se encontraron ${result.rows.length} horarios disponibles para especialista ${specialistId}`
      );

      // 🔥 LOG DETALLADO de los datos
      console.log("🔍 Datos de horarios encontrados:");
      result.rows.forEach((row) => {
        console.log(
          `- TimeSlotId: ${row.timeslot_id}, ScheduleId: ${row.schedule_id}, Day: ${row.DayOfWeek}, Time: ${row.StartTime}-${row.EndTime}`
        );
      });

      // Formatear los resultados
      const availableSlots = result.rows.map((row) => {
        const dayOfWeek = this.formatDayOfWeekFromNumber(row.DayOfWeek);
        const startTime = this.formatTime(row.StartTime);
        const endTime = this.formatTime(row.EndTime);

        return {
          scheduleId: row.schedule_id,
          timeSlotId: row.timeslot_id, // 🔥 USAR el ID real del TimeSlot
          dayOfWeek: dayOfWeek,
          startTime: row.StartTime,
          endTime: row.EndTime,
          displayText: `${dayOfWeek} de ${startTime} a ${endTime}`,
        };
      });

      return availableSlots;
    } catch (error) {
      console.error("❌ Error obteniendo horarios disponibles:", error);
      throw error;
    }
  }

  /**
   * Formatea el día de la semana desde número (0-6) a texto
   */
  private formatDayOfWeekFromNumber(dayNumber: number): string {
    const daysMap: { [key: number]: string } = {
      0: "Domingo",
      1: "Lunes",
      2: "Martes",
      3: "Miércoles",
      4: "Jueves",
      5: "Viernes",
      6: "Sábado",
    };

    return daysMap[dayNumber] || `Día ${dayNumber}`;
  }

  /**
   * Formatea el día de la semana para mostrar
   */
  private formatDayOfWeek(dayOfWeek: string): string {
    const daysMap: { [key: string]: string } = {
      Monday: "Lunes",
      Tuesday: "Martes",
      Wednesday: "Miércoles",
      Thursday: "Jueves",
      Friday: "Viernes",
      Saturday: "Sábado",
      Sunday: "Domingo",
      Lunes: "Lunes",
      Martes: "Martes",
      Miércoles: "Miércoles",
      Jueves: "Jueves",
      Viernes: "Viernes",
      Sábado: "Sábado",
      Domingo: "Domingo",
    };

    return daysMap[dayOfWeek] || dayOfWeek;
  }

  /**
   * Formatea la hora para mostrar (maneja TimeOnly de C#)
   */
  private formatTime(timeString: string): string {
    try {
      // Si es un TimeOnly de C#, viene como "HH:MM:SS" o "HH:MM:SS.NNNNNNN"
      if (typeof timeString === "string" && timeString.includes(":")) {
        // Tomar solo la parte de horas y minutos
        const timeParts = timeString.split(":");
        if (timeParts.length >= 2) {
          const hours = timeParts[0].padStart(2, "0");
          const minutes = timeParts[1].padStart(2, "0");
          return `${hours}:${minutes}`;
        }
      }

      return timeString;
    } catch (error) {
      console.error("Error formateando hora:", error);
      return timeString;
    }
  }

  /**
   * Formatea los horarios para mostrar en mensaje
   */
  formatSlotsMessage(
    availableSlots: AvailableSlot[],
    sessionNumber: number
  ): string {
    if (availableSlots.length === 0) {
      return `❌ No hay horarios disponibles para la sesión ${sessionNumber}.`;
    }

    let message = `🕐 *Selecciona el horario para la sesión ${sessionNumber}:*\n\n`;

    availableSlots.forEach((slot, index) => {
      message += `${index + 1}. ${slot.displayText}\n`;
    });

    message += `\nResponde con el *número* del horario que prefieres para esta sesión.`;

    return message;
  }

  /**
   * Obtiene un slot por su ID
   */
  async getSlotById(
    scheduleId: number,
    startTime: string,
    endTime: string
  ): Promise<AvailableSlot | null> {
    try {
      const result = await pool.query(
        `
      SELECT 
        s."Id" as schedule_id,
        ts."Id" as time_slot_id,
        s."DayOfWeek",
        ts."StartTime", 
        ts."EndTime"
      FROM "Schedules" s
      INNER JOIN "TimeSlots" ts ON s."Id" = ts."ScheduleId"
      WHERE s."Id" = $1 AND ts."StartTime" = $2 AND ts."EndTime" = $3
    `,
        [scheduleId, startTime, endTime]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const dayOfWeek = this.formatDayOfWeek(row.DayOfWeek);
      const formattedStartTime = this.formatTime(row.StartTime);
      const formattedEndTime = this.formatTime(row.EndTime);

      return {
        scheduleId: row.schedule_id,
        timeSlotId: row.time_slot_id,
        dayOfWeek: row.DayOfWeek,
        startTime: row.StartTime,
        endTime: row.EndTime,
        displayText: `${dayOfWeek} de ${formattedStartTime} a ${formattedEndTime}`,
      };
    } catch (error) {
      console.error(`❌ Error obteniendo slot:`, error);
      throw error;
    }
  }

  /**
   * Obtiene horarios únicos (sin repetir) de todos los slots disponibles
   */
  getUniqueTimeSlots(availableSlots: AvailableSlot[]): { startTime: string; endTime: string; displayText: string }[] {
    const uniqueSlotsMap = new Map<string, { startTime: string; endTime: string; displayText: string }>();

    availableSlots.forEach(slot => {
      const timeKey = `${slot.startTime}-${slot.endTime}`;
      if (!uniqueSlotsMap.has(timeKey)) {
        uniqueSlotsMap.set(timeKey, {
          startTime: slot.startTime,
          endTime: slot.endTime,
          displayText: `${this.formatTime(slot.startTime)} a ${this.formatTime(slot.endTime)}`
        });
      }
    });

    return Array.from(uniqueSlotsMap.values());
  }

  /**
   * Obtiene los días disponibles para un horario específico
   */
  getDaysForTimeSlot(availableSlots: AvailableSlot[], startTime: string, endTime: string): string[] {
    const days = new Set<string>();
    
    availableSlots.forEach(slot => {
      if (slot.startTime === startTime && slot.endTime === endTime) {
        days.add(slot.dayOfWeek);
      }
    });

    return Array.from(days).sort((a, b) => {
      const dayOrder = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
      return dayOrder.indexOf(a) - dayOrder.indexOf(b);
    });
  }

  /**
   * Formatea el mensaje de horarios únicos
   */
  formatUniqueSlotsMessage(uniqueSlots: { startTime: string; endTime: string; displayText: string }[]): string {
    if (uniqueSlots.length === 0) {
      return "❌ No hay horarios disponibles.";
    }

    let message = "🕐 *Selecciona el horario que deseas para tu(s) terapia(s):*\n\n";

    uniqueSlots.forEach((slot, index) => {
      message += `${index + 1}. ${slot.displayText}\n`;
    });

    message += `\nResponde con el *número* del horario que prefieres.`;

    return message;
  }

  /**
   * Formatea el mensaje de días disponibles
   */
  formatDaysMessage(days: string[], selectedTimeSlot: string, sessionCount: number): string {
    let message = `📅 *Horario seleccionado:* ${selectedTimeSlot}\n\n`;
    message += `*Los días disponibles en ese horario son:*\n`;
    
    days.forEach(day => {
      message += `• ${day}\n`;
    });

    message += `\n*Tienes ${sessionCount} sesión(es) para programar.*\n\n`;
    
    if (sessionCount === 1) {
      message += "Por favor, escribe el *día* que prefieres para tu sesión.\n";
      message += "Ejemplo: *Lunes* o *Viernes*";
    } else {
      message += "Por favor, escribe los *días* que prefieres para tus sesiones.\n";
      message += "Ejemplos:\n";
      message += "• *Lunes y Miércoles*\n";
      message += "• *Lunes, Miércoles y Viernes*\n";
      message += "• *Martes y Jueves*";
    }

    return message;
  }
}