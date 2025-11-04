// services/whatsappService.ts
import { config } from '../../utils/config';

export interface WhatsAppMessage {
  to: string;
  text: string;
}

export class WhatsAppService {
  private phoneNumberId = config.whatsapp.phoneNumberId;
  private accessToken = config.whatsapp.accessToken;

  /**
   * Enviar mensaje de WhatsApp
   */
  async sendMessage(message: WhatsAppMessage): Promise<boolean> {
    try {
      console.log('📤 Enviando mensaje WhatsApp a:', message.to);
      
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${this.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: message.to,
            text: { body: message.text },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Error enviando WhatsApp:', response.status, errorText);
        return false;
      }

      console.log('✅ Mensaje WhatsApp enviado exitosamente');
      return true;
    } catch (error) {
      console.error('❌ Error en sendMessage:', error);
      return false;
    }
  }

  /**
   * Mensaje específico para cita aceptada
   */
  async sendAppointmentAcceptedMessage(phoneNumber: string, patientName: string, appointmentDetails: any): Promise<boolean> {
    const message = this.buildAppointmentAcceptedMessage(patientName, appointmentDetails);
    
    return await this.sendMessage({
      to: phoneNumber,
      text: message
    });
  }

  /**
   * Construir mensaje de cita aceptada
   */
  private buildAppointmentAcceptedMessage(patientName: string, appointmentDetails: any): string {
    const { specialty, specialist, selectedSlots, consultationsNumber, previewDates } = appointmentDetails;
    
    const specialistName = `${specialist.Names} ${specialist.LastNamePaternal}`;
    const specialtyName = specialty.TypeOfSpecialty;
    
    // Formatear fechas
    const formattedDates = previewDates.map((date: any, index: number) => {
      const startDate = new Date(date.start);
      return `• ${startDate.toLocaleDateString('es-ES')} a las ${startDate.toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })}`;
    }).join('\n');

    return `🎉 *¡BUENAS NOTICIAS, ${patientName.toUpperCase()}!* 🎉

✅ *Tu cita ha sido ACEPTADA y confirmada oficialmente*

📋 *Detalles de tu terapia:*
🏥 *Especialidad:* ${specialtyName}
👨‍⚕️ *Especialista:* ${specialistName}
📊 *Número de sesiones:* ${consultationsNumber}

📅 *Fechas y horarios programados:*
${formattedDates}

💡 *Recordatorio importante:*
Te enviaremos un recordatorio 24 horas antes de cada sesión para que no se te pase.

🚨 *Política de cancelación:*
• Puedes cancelar o reprogramar hasta 24 horas antes de tu sesión
• Después de este plazo, se aplicarán cargos por cancelación

Si necesitas hacer algún cambio o tienes preguntas, no dudes en contactarnos.

¡Estamos aquí para apoyarte en tu proceso de recuperación! 💪❤️`;
  }

  /**
   * Mensaje de recordatorio 24 horas antes
   */
  async sendReminderMessage(phoneNumber: string, patientName: string, appointmentDate: Date, specialistName: string): Promise<boolean> {
    const formattedDate = appointmentDate.toLocaleDateString('es-ES');
    const formattedTime = appointmentDate.toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    const message = `⏰ *RECORDATORIO DE TERAPIA*

Hola ${patientName},

Te recordamos que *mañana ${formattedDate} a las ${formattedTime}* tienes programada tu sesión de terapia con el especialista ${specialistName}.

📍 *Por favor:*
• Llega 10 minutos antes
• Trae tu documento de identidad
• Usa ropa cómoda

Si no puedes asistir, por favor cancela o reprograma con al menos 24 horas de anticipación.

¡Te esperamos! 👨‍⚕️✨`;

    return await this.sendMessage({
      to: phoneNumber,
      text: message
    });
  }
}

export const whatsappService = new WhatsAppService();