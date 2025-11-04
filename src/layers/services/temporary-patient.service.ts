// services/temporary-patient.service.ts
import { config } from "../../utils/config";

export interface TemporaryPatientData {
  Names: string;
  LastNamePaternal: string;
  LastNameMaternal?: string;
  MobileNumber: string;
  IdentityCard: number;
  PhoneNumber?: string;
  Age: number;
  Gender: string;
  DateOfBirth: string;
  Address: string;
}

export interface CreateTemporaryPatientRequest {
  whatsAppNumber: string;
  patientData: TemporaryPatientData;
}

export class TemporaryPatientService {
  private baseUrl = config.api.baseUrl;

  async createTemporaryPatient(
    request: CreateTemporaryPatientRequest
  ): Promise<string> {
    try {
      // Calcular la edad si no viene en los datos
      if (!request.patientData.Age && request.patientData.DateOfBirth) {
        request.patientData.Age = this.calculateAge(
          request.patientData.DateOfBirth
        );
      }

      const response = await fetch(
        `https://${this.baseUrl}/TemporaryPatients`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error creating temporary patient: ${errorText}`);
      }

      const result = await response.json();
      return result.temporaryPatientId;
    } catch (error) {
      console.error("❌ Error in createTemporaryPatient:", error);
      throw error;
    }
  }

  private calculateAge(dateOfBirth: string): number {
    try {
      const birthDate = new Date(dateOfBirth);
      const today = new Date();

      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      // Ajustar si el cumpleaños aún no ha llegado este año
      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < birthDate.getDate())
      ) {
        age--;
      }

      return age;
    } catch (error) {
      console.error("Error calculando edad:", error);
      return 0; // Valor por defecto en caso de error
    }
  }

  async confirmTemporaryPatient(temporaryPatientId: string): Promise<any> {
    try {
      const response = await fetch(
        `${this.baseUrl}/TemporaryPatients/confirm`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ temporaryPatientId }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error confirming temporary patient: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("❌ Error in confirmTemporaryPatient:", error);
      throw error;
    }
  }

  async getTemporaryPatientByWhatsApp(whatsAppNumber: string): Promise<any> {
    try {
      const response = await fetch(
        `${this.baseUrl}/TemporaryPatients/whatsapp/${whatsAppNumber}`
      );

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error("❌ Error getting temporary patient:", error);
      return null;
    }
  }
}
