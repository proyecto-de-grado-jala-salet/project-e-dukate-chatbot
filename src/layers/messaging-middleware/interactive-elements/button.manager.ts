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

      await this.sendToWhatsAppWithRetry(payload);
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

  /**
   * Envía mensaje a WhatsApp con sistema de reintentos robusto
   */
  private async sendToWhatsAppWithRetry(payload: ButtonPayload): Promise<any> {
    const maxRetries = 3;
    const baseDelay = 1000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 segundos para botones

      try {
        console.log(`📤 Intento ${attempt} de enviar botones a ${payload.to}...`);

        const response = await fetch(
          `https://graph.facebook.com/v22.0/${config.whatsapp.phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.whatsapp.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal
          }
        );

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          console.log('✅ Botones enviados exitosamente:', {
            messageId: data.messages?.[0]?.id,
            recipient: payload.to
          });
          return data;
        }

        // Manejar errores HTTP
        const errorText = await response.text();
        console.error(`❌ Error HTTP ${response.status} en botones:`, errorText);
        
        // No reintentar en errores 4xx (excepto 429 - Too Many Requests)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        // Si es rate limiting, esperar más tiempo
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after') || '60';
          console.log(`⏳ Rate limit detectado, esperando ${retryAfter} segundos...`);
          await this.delay(parseInt(retryAfter) * 1000);
          continue;
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      } catch (error: any) {
        clearTimeout(timeoutId);
        console.error(`❌ Intento ${attempt} fallido para botones:`, error.message);

        // Métricas de diagnóstico
        console.error('📊 Diagnóstico botones:', {
          destinatario: payload.to,
          intento: attempt,
          timestamp: new Date().toISOString(),
          error: error.message,
          tipoError: error.name
        });

        // No reintentar si fue abortado manualmente o errores de cliente
        if (error.name === 'AbortError' || 
            (error.message.includes('HTTP 4') && !error.message.includes('HTTP 429'))) {
          throw error;
        }

        // Último intento
        if (attempt === maxRetries) {
          throw new Error(`Fallido después de ${maxRetries} intentos: ${error.message}`);
        }

        // Backoff exponencial con jitter
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.log(`⏳ Reintentando botones en ${Math.round(delay)}ms...`);
        await this.delay(delay);
      }
    }

    throw new Error('Todos los reintentos fallaron');
  }

  /**
   * Delay helper con soporte para AbortSignal
   */
  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Delay aborted'));
        });
      }
    });
  }

  /**
   * Método original mantenido por compatibilidad (puede ser removido luego)
   * @deprecated Usar sendToWhatsAppWithRetry en su lugar
   */
  private async sendToWhatsApp(payload: ButtonPayload): Promise<void> {
    console.warn('⚠️  Usando método sendToWhatsApp sin reintentos. Migrar a sendToWhatsAppWithRetry.');
    
    const response = await fetch(`https://graph.facebook.com/v22.0/${config.whatsapp.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.whatsapp.accessToken}`,
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