import { pool } from '../../utils/database';

export interface Specialty {
  Id: string;
  TypeOfSpecialty: string;
}

export class SpecialtyService {
  
  /**
   * Obtiene todas las especialidades de la base de datos
   */
  async getAllSpecialties(): Promise<Specialty[]> {
    try {
      const result = await pool.query(`
        SELECT "Id", "TypeOfSpecialty" 
        FROM "Specialties" 
        ORDER BY "TypeOfSpecialty"
      `);
      
      console.log(`✅ Se encontraron ${result.rows.length} especialidades`);
      
      // 🔥 CONVERTIR Id a string para consistencia
      const specialties = result.rows.map(row => ({
        ...row,
        Id: row.Id.toString() // Convertir a string
      }));
      
      return specialties;
      
    } catch (error) {
      console.error('❌ Error obteniendo especialidades:', error);
      throw error;
    }
  }

  /**
   * Formatea las especialidades para mostrar en mensaje
   */
  formatSpecialtiesMessage(specialties: Specialty[]): string {
    if (specialties.length === 0) {
      return '❌ No hay especialidades disponibles en este momento.';
    }

    let message = '🎯 *Especialidades Disponibles:*\n\n';
    
    specialties.forEach((specialty, index) => {
      message += `${index + 1}. ${specialty.TypeOfSpecialty}\n`;
    });
    
    message += '\nPor favor, responde con el *número* de la especialidad que necesitas.';
    
    return message;
  }

  /**
   * Obtiene una especialidad por su ID
   */
  async getSpecialtyById(id: number): Promise<Specialty | null> {
    try {
      const result = await pool.query(
        'SELECT "Id", "TypeOfSpecialty" FROM "Specialties" WHERE "Id" = $1',
        [id]
      );
      
      return result.rows.length > 0 ? result.rows[0] : null;
      
    } catch (error) {
      console.error(`❌ Error obteniendo especialidad con ID ${id}:`, error);
      throw error;
    }
  }
}