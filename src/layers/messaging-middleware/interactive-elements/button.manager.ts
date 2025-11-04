// src/layers/messaging-middleware/interactive-elements/button.manager.ts
import { config } from '../../../utils/config';
import { Button, ButtonPayload, InteractiveResponse } from '../interactive-elements/interactive.interface';

export class ButtonManager {
  
  /**
   * Crea y envía botones interactivos genéricos
   * @param to Número de WhatsApp destino
   * @param text Texto del mensaje
   * @param buttons Array de botones (máximo 3)
   * @returns Promise con la respuesta
   */
  async sendButtons(to: string, text: string, buttons: Button[]): Promise<void> {
    try {
      // Validar que no exceda el límite de botones
      if (buttons.length < 1 || buttons.length > 3) {
        throw new Error(`Invalid buttons count. Min allowed buttons: 1, Max allowed buttons: 3. Received: ${buttons.length}`);
      }

      const payload: ButtonPayload = {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: text
          },
          action: {
            buttons: buttons.map(button => ({
              type: 'reply',
              reply: {
                id: button.id,
                title: button.title
              }
            }))
          }
        }
      };

      await this.sendToWhatsApp(payload);
      console.log(`✅ Botones enviados a ${to}: ${buttons.map(b => b.title).join(', ')}`);

    } catch (error) {
      console.error('❌ Error enviando botones:', error);
      throw error;
    }
  }

  /**
   * Botones de Sí/No predefinidos
   */
  async sendYesNoButtons(to: string, text: string): Promise<void> {
    const buttons = [
      { id: 'confirm_yes', title: '✅ Sí' },
      { id: 'confirm_no', title: '❌ No' }
    ];
    
    await this.sendButtons(to, text, buttons);
  }

  /**
   * Botones para tipo de paciente (Específico para agendar consulta)
   */
  async sendPatientTypeButtons(to: string, text: string): Promise<void> {
    const buttons = [
      { id: 'patient_yes', title: '✅ Sí' },
      { id: 'patient_no', title: '❌ No' },
      { id: 'patient_dont_know', title: '🤔 No sé' }
    ];
    
    await this.sendButtons(to, text, buttons);
  }

  /**
   * Procesa la respuesta cuando un usuario selecciona un botón
   * @param interactiveData Datos del webhook de WhatsApp
   * @returns InteractiveResponse con la selección
   */
  processButtonResponse(interactiveData: any): InteractiveResponse {
    const buttonResponse = interactiveData?.interactive?.button_reply;
    
    if (!buttonResponse) {
      throw new Error('Invalid button response data');
    }

    return {
      type: 'button',
      selectedId: buttonResponse.id,
      userPhone: interactiveData.from,
      timestamp: new Date()
    };
  }

  private async sendToWhatsApp(payload: ButtonPayload): Promise<void> {
    const phoneNumberId = config.whatsapp.phoneNumberId;
    const accessToken = config.whatsapp.accessToken;

    const response = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`WhatsApp API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
    }
  }
}