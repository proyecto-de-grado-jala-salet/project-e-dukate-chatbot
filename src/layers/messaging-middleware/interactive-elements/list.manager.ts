import { ListSection, ListRow, ListPayload } from '../interactive-elements/interactive.interface';
import { config } from '../../../utils/config';

export class ListManager {
  async sendList(
    to: string,
    text: string,
    buttonText: string,
    sections: ListSection[]
  ): Promise<void> {
    try {
      // Validar secciones
      if (!sections || sections.length === 0) {
        throw new Error("List must have at least one section");
      }

      const payload: ListPayload = {
        messaging_product: "whatsapp",
        to: to,
        type: "interactive",
        interactive: {
          type: "list",
          body: {
            text: text,
          },
          action: {
            button: buttonText,
            sections: sections.map((section) => ({
              title: section.title,
              rows: section.rows.map((row) => ({
                id: row.id,
                title: row.title,
                description: row.description,
              })),
            })),
          },
        },
      };

      await this.sendToWhatsApp(payload);
      console.log(`✅ Lista de bienvenida enviada a ${to}`);
    } catch (error) {
      console.error("❌ Error enviando lista:", error);
      throw error;
    }
  }

  getWelcomeListConfig() {
    return {
      buttonText: "🎯 Ver Opciones",
      sections: [
        {
          title: "Servicios Disponibles",
          rows: [
            {
              id: "agendar",
              title: "📅 Agendar Consulta",
              description: "Programar una nueva cita médica",
            },
            {
              id: "cancelar",
              title: "❌ Cancelar Cita",
              description: "Cancelar una cita existente",
            },
            {
              id: "reprogramar",
              title: "🔄 Reprogramar Horario",
              description: "Cambiar fecha/hora de tu cita",
            },
            {
              id: "preguntas",
              title: "❓ Preguntas Frecuentes",
              description: "Información general y dudas comunes",
            },
          ],
        },
      ],
    };
  }

  private async sendToWhatsApp(payload: ListPayload): Promise<void> {
    const phoneNumberId = config.whatsapp.phoneNumberId;
    const accessToken = config.whatsapp.accessToken;

    const response = await fetch(
      `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `WhatsApp API error: ${response.status} ${
          response.statusText
        } - ${JSON.stringify(errorData)}`
      );
    }
  }
}