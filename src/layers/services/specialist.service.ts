import { pool } from '../../utils/database';

export interface Specialist {
  Id: string;
  SpecialtyId: string;
  YearsOfExperience: number;
  SpecialistCode: string;
  ConsultationDuration: number;
  Names: string;
  LastNamePaternal: string;
  LastNameMaternal: string | null;
  MobileNumber: string;
  IdentityCard: string;
  PhoneNumber: string | null;
  Age: number;
  Gender: string;
  DateOfBirth: string;
  Address: string;
}

export class SpecialistService {
  /**
   * Obtiene todos los especialistas por especialidad
   */
  async getSpecialistsBySpecialty(specialtyId: string): Promise<Specialist[]> {
    try {
      const result = await pool.query(`
        SELECT 
          "Id", "SpecialtyId", "YearsOfExperience", "SpecialistCode",
          "ConsultationDuration", "Names", "LastNamePaternal", "LastNameMaternal",
          "MobileNumber", "IdentityCard", "PhoneNumber", "Age", "Gender", 
          "DateOfBirth", "Address"
        FROM "Specialists" 
        WHERE "SpecialtyId" = $1
        ORDER BY "YearsOfExperience" DESC, "LastNamePaternal", "Names"
      `, [specialtyId]);
      
      console.log(`✅ Se encontraron ${result.rows.length} especialistas para especialidad ${specialtyId}`);
      
      // 🔥 CONVERTIR todos los IDs a string para consistencia
      const specialists = result.rows.map(row => ({
        ...row,
        Id: row.Id.toString(),
        SpecialtyId: row.SpecialtyId.toString()
      }));
      
      return specialists;
      
    } catch (error) {
      console.error('❌ Error obteniendo especialistas:', error);
      throw error;
    }
  }

  /**
   * Formatea los especialistas para mostrar en mensaje
   */
  formatSpecialistsMessage(
    specialists: Specialist[],
    specialtyName: string
  ): string {
    if (specialists.length === 0) {
      return `❌ No hay especialistas disponibles para *${specialtyName}* en este momento.`;
    }

    let message = `👨‍⚕️ *Especialistas en ${specialtyName}:*\n\n`;

    specialists.forEach((specialist, index) => {
      // Construir nombre completo
      let fullName = `${specialist.Names} ${specialist.LastNamePaternal}`;
      if (specialist.LastNameMaternal) {
        fullName += ` ${specialist.LastNameMaternal}`;
      }

      message += `${index + 1}. ${fullName}\n\n`;
    });

    message +=
      "Por favor, responde con el *número* del especialista que prefieres.";

    return message;
  }

  /**
   * Obtiene un especialista por su ID
   */
  async getSpecialistById(id: string): Promise<Specialist | null> { // 🔥 Cambiado a string
    try {
      const result = await pool.query(
        `SELECT 
          "Id", "SpecialtyId", "YearsOfExperience", "SpecialistCode",
          "ConsultationDuration", "Names", "LastNamePaternal", "LastNameMaternal",
          "MobileNumber", "IdentityCard", "PhoneNumber", "Age", "Gender", 
          "DateOfBirth", "Address"
        FROM "Specialists" WHERE "Id" = $1`,
        [id]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      // 🔥 CONVERTIR IDs a string
      const specialist = result.rows[0];
      return {
        ...specialist,
        Id: specialist.Id.toString(),
        SpecialtyId: specialist.SpecialtyId.toString()
      };
      
    } catch (error) {
      console.error(`❌ Error obteniendo especialista con ID ${id}:`, error);
      throw error;
    }
  }
}