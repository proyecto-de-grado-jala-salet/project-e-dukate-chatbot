import { pool } from '../../utils/database';

export interface AvailabilityCheck {
  timeSlotId: string;
  date: Date;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

export class AvailabilityService {
  
  /**
   * Verifica si un horario está disponible en una fecha específica
   */
  async checkTimeSlotAvailability(
    timeSlotId: string, 
    date: Date, 
    startTime: string, 
    endTime: string
  ): Promise<boolean> {
    try {
      // Convertir fecha a formato compatible con PostgreSQL
      const dateString = date.toISOString().split('T')[0];
      
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM "ScheduledSessions" ss
        INNER JOIN "Appointments" a ON ss."AppointmentId" = a."Id"
        WHERE ss."TimeSlotId" = $1 
        AND DATE(ss."StartSessionDateTime") = $2
        AND ss."Status" != 'Cancelled'
        AND (
          (TIME(ss."StartSessionDateTime") = $3 AND TIME(ss."EndSessionDateTime") = $4)
          OR
          (ss."StartSessionDateTime" < $5::timestamp AND ss."EndSessionDateTime" > $6::timestamp)
        )
      `, [
        timeSlotId, 
        dateString, 
        startTime, 
        endTime,
        `${dateString} ${endTime}`,
        `${dateString} ${startTime}`
      ]);
      
      const isAvailable = parseInt(result.rows[0].count) === 0;
      
      return isAvailable;
      
    } catch (error) {
      console.error('❌ Error verificando disponibilidad:', error);
      return false; // Por seguridad, asumir no disponible si hay error
    }
  }

  /**
   * Encuentra la próxima fecha disponible para un día y horario específicos
   */
  async findNextAvailableDate(
    timeSlotId: string,
    dayOfWeek: number, // 0=Domingo, 1=Lunes, ..., 6=Sábado
    startTime: string,
    endTime: string,
    maxAttempts: number = 10
  ): Promise<Date | null> {
    try {
      let currentDate = new Date();
      let attempts = 0;
      
      while (attempts < maxAttempts) {
        // Calcular próximo día de la semana objetivo
        const currentDay = currentDate.getDay();
        let daysToAdd = (dayOfWeek - currentDay + 7) % 7;
        if (daysToAdd === 0) {
          daysToAdd = 7; // Si es hoy, ir a la próxima semana
        }
        
        const targetDate = new Date(currentDate);
        targetDate.setDate(currentDate.getDate() + daysToAdd);
        
        // Verificar disponibilidad en esta fecha
        const isAvailable = await this.checkTimeSlotAvailability(
          timeSlotId, 
          targetDate, 
          startTime, 
          endTime
        );
        
        if (isAvailable) {
          console.log(`✅ Fecha disponible encontrada`);
          return targetDate;
        }
        
        // Si no está disponible, intentar la siguiente semana
        currentDate.setDate(currentDate.getDate() + 7);
        attempts++;
      }
      
      console.log(`❌ No se encontró fecha disponible después de ${maxAttempts} intentos`);
      return null;
      
    } catch (error) {
      console.error('❌ Error buscando fecha disponible:', error);
      return null;
    }
  }

  /**
   * Convierte día de la semana en texto a número
   */
  dayOfWeekToNumber(dayOfWeek: string): number {
    const daysMap: { [key: string]: number } = {
      'domingo': 0,
      'lunes': 1,
      'martes': 2,
      'miércoles': 3,
      'jueves': 4,
      'viernes': 5,
      'sábado': 6
    };
    
    return daysMap[dayOfWeek.toLowerCase()] || 1; // Default a Lunes
  }
}