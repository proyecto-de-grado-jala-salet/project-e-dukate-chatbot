// src/layers/messaging-middleware/interactive-elements/link.manager.ts

import { config } from '../../../utils/config';
import axios from 'axios';

export interface LinkPayload {
  messaging_product: 'whatsapp';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'cta_url';
    body: {
      text: string;
    };
    action: {
      name: 'cta_url';
      parameters: {
        display_text: string;
        url: string;
      };
    };
  };
}

export class LinkManager {
  /**
   * Envía un mensaje con un enlace CTA (Call To Action)
   * @param to Número de WhatsApp destino
   * @param text Texto del mensaje
   * @param displayText Texto que se muestra para el enlace
   * @param url URL a la que redirige
   * @returns Promise con la respuesta
   */
  async sendLinkMessage(
    to: string,
    text: string,
    displayText: string,
    url: string
  ): Promise<void> {
    try {
      const payload: LinkPayload = {
        messaging_product: "whatsapp",
        to: to,
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: {
            text: text,
          },
          action: {
            name: "cta_url",
            parameters: {
              display_text: displayText,
              url: url,
            },
          },
        },
      };

      await this.sendToWhatsApp(payload);
      console.log(`✅ Enlace enviado a ${to}: ${displayText} -> ${url}`);
    } catch (error) {
      console.error("❌ Error enviando enlace:", error);
      throw error;
    }
  }

  /**
   * Envía el mensaje específico para el pago del 50%
   */
  async sendPaymentLink(
    to: string,
    temporaryAppointmentId: string
  ): Promise<void> {
    const paymentUrl = `https://e-dukate.up.railway.app/pago/${temporaryAppointmentId}`;
    const message =
      "Para que podamos agregar tu cita por favor entra a la siguiente pagina web para realizar un 50% del pago para sus citas.";
    const displayText = "Pagar 50%";

    await this.sendLinkMessage(to, message, displayText, paymentUrl);
  }

  private async sendToWhatsApp(payload: LinkPayload): Promise<void> {
    const phoneNumberId = config.whatsapp.phoneNumberId;
    const accessToken = config.whatsapp.accessToken;

    try {
      const response = await axios.post(
        `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: 30000, // 30 segundos
        }
      );

      console.log("✅ Enlace enviado con axios:", response.data);
    } catch (error: any) {
      console.error("❌ Error con axios:", error.message);
      throw error;
    }
  }
}