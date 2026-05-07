import { config } from '../../utils/config';

export interface ScheduledSessionDto {
  TimeSlotId: string;
  DayOfWeek: string;
  StartTime: string;
  EndTime: string;
  Status: string;
}

export interface AppointmentDto {
  PatientId: string;
  SpecialtyId: string;
  SpecialistId: string;
  SessionCount: number;
  SessionCost: number;
  ScheduledSessions: ScheduledSessionDto[];
}

export interface PreviewSlot {
  start: string;
  end: string;
}

export class AppointmentService {
  private baseUrl =
    "https://e-dukate-backend-production.up.railway.app/api/Appointments";

  /**
   * Obtiene el preview de las citas con las fechas calculadas
   */
  async getAppointmentPreview(
    appointmentData: AppointmentDto
  ): Promise<PreviewSlot[] | null> {
    try {
      
      const response = await fetch(`${this.baseUrl}/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(appointmentData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "❌ Error en preview de citas:",
          response.status,
          errorText
        );

        // 🔥 LOG DETALLADO del error
        if (response.status === 400) {
          console.error(
            "❌ Error 400: Bad Request - Revisar el formato de los datos enviados"
          );
          console.error(
            "Datos enviados:",
            JSON.stringify(appointmentData, null, 2)
          );
        }

        return null;
      }

      const previewData = await response.json();

      return previewData;
    } catch (error) {
      console.error("❌ Error obteniendo preview de citas:", error);
      return null;
    }
  }

  /**
   * Formatea la fecha para mostrar manteniendo la hora UTC
   */
  formatDateForDisplay(startIsoString: string, endIsoString?: string): string {
    try {
      const startDate = new Date(startIsoString);
      const endDate = endIsoString
        ? new Date(endIsoString)
        : new Date(startIsoString);

      // Usar métodos UTC para evitar conversión de zona horaria
      const day = startDate.getUTCDate().toString().padStart(2, "0");
      const month = (startDate.getUTCMonth() + 1).toString().padStart(2, "0");
      const year = startDate.getUTCFullYear();

      const startHours = startDate.getUTCHours().toString().padStart(2, "0");
      const startMinutes = startDate
        .getUTCMinutes()
        .toString()
        .padStart(2, "0");

      const endHours = endDate.getUTCHours().toString().padStart(2, "0");
      const endMinutes = endDate.getUTCMinutes().toString().padStart(2, "0");

      return `${day}/${month}/${year} a las ${startHours}:${startMinutes} - ${endHours}:${endMinutes}`;
    } catch (error) {
      console.error("Error formateando fecha:", error);
      return startIsoString;
    }
  }

  /**
   * Formatea las fechas del preview para el mensaje
   */
  formatPreviewMessage(previewSlots: PreviewSlot[]): string {
    if (!previewSlots || previewSlots.length === 0) {
      return "❌ No se pudieron calcular las fechas para las sesiones.";
    }

    let message = "📅 *Horarios seleccionados:*\n\n";

    previewSlots.forEach((slot, index) => {
      const formattedDate = this.formatDateForDisplay(slot.start, slot.end);
      message += `*Sesión ${index + 1}:* ${formattedDate}\n`;
    });

    return message;
  }
}