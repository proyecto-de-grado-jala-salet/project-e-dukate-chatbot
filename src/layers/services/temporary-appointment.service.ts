// src/layers/services/temporary-appointment.service.ts
import { config } from '../../utils/config';

export interface CreateTemporaryAppointmentRequestDto {
  whatsAppNumber: string;
  appointmentData: any;
}

export class TemporaryAppointmentService {
  private baseUrl = "https://project-e-dukate-backend-production.up.railway.app/api";

  /**
   * Crear una cita temporal en el backend
   */
  async createTemporaryAppointment(request: CreateTemporaryAppointmentRequestDto): Promise<string> {
    try {
      console.log("📝 Creando cita temporal:", JSON.stringify(request, null, 2));

      const response = await fetch(`${this.baseUrl}/TemporaryAppointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Error creando cita temporal:', response.status, errorText);
        throw new Error(`Error al crear cita temporal: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log("✅ Cita temporal creada con ID:", result.id);
      return result.id;

    } catch (error) {
      console.error('❌ Error en createTemporaryAppointment:', error);
      throw error;
    }
  }
}