import { Request, Response } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../../utils/config";
import { ButtonManager } from "../messaging-middleware/interactive-elements/button.manager";
import { LinkManager } from "../messaging-middleware/interactive-elements/link.manager";
import { PatientService } from "../services/patient.service";
import { SpecialtyService } from "../services/specialty.service";
import { SpecialistService } from "../services/specialist.service";
import { ScheduleService } from "../services/schedule.service";
import { TemporaryAppointmentService } from "../services/temporary-appointment.service";
import {
  AppointmentService,
  AppointmentDto,
  ScheduledSessionDto,
} from "../services/appointment.service";
import { RealPatientService, RealPatientData } from "../services/real-patient.service";
import { CancelAppointmentService, PatientData, AppointmentData } from "../services/cancel-appointment.service";
import { RescheduleAppointmentService } from "../services/reschedule.appointment.service";

export interface AvailableSlot {
  scheduleId: string;
  timeSlotId: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  displayText: string;
}

interface UniqueTimeSlot {
  startTime: string;
  endTime: string;
  displayText: string;
}

interface UserSelection {
  patient?: any;
  specialty?: any;
  specialist?: any;
  consultationsNumber?: number;
  availableSlots?: AvailableSlot[];
  uniqueSlots?: UniqueTimeSlot[];
  selectedTimeSlot?: UniqueTimeSlot;
  availableDays?: string[];
  selectedSlots?: AvailableSlot[];
  currentSession?: number;
  appointments?: AppointmentData[];
  selectedAppointment?: AppointmentData;
  selectedSession?: any;
}

export class WebhookController {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private buttonManager: ButtonManager;
  private linkManager: LinkManager;
  private patientService: PatientService;
  private specialtyService: SpecialtyService;
  private specialistService: SpecialistService;
  private scheduleService: ScheduleService;
  private appointmentService: AppointmentService;
  private temporaryAppointmentService: TemporaryAppointmentService;
  private cancelAppointmentService: CancelAppointmentService;
  private realPatientService: RealPatientService;
  private rescheduleAppointmentService: RescheduleAppointmentService;
  private userStates: Map<string, string> = new Map();
  private userSelections: Map<string, any> = new Map();

  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    this.buttonManager = new ButtonManager();
    this.patientService = new PatientService();
    this.specialtyService = new SpecialtyService();
    this.specialistService = new SpecialistService();
    this.scheduleService = new ScheduleService();
    this.appointmentService = new AppointmentService();
    this.linkManager = new LinkManager();
    this.temporaryAppointmentService = new TemporaryAppointmentService();
    this.realPatientService = new RealPatientService();
    this.cancelAppointmentService = new CancelAppointmentService();
    this.rescheduleAppointmentService = new RescheduleAppointmentService();
  }

  // Verificación del webhook (igual)
  public verifyWebhook = (req: Request, res: Response): void => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("🔐 Verificando webhook...", { mode, token });

    if (mode === "subscribe" && token === config.whatsapp.webhookVerifyToken) {
      console.log("✅ Webhook verificado correctamente");
      res.status(200).send(challenge);
    } else {
      console.log("❌ Error en verificación del webhook");
      res.sendStatus(403);
    }
  };

  // Manejo de mensajes entrantes
  public handleWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      console.log("📨 Mensaje recibido:", JSON.stringify(req.body, null, 2));

      const body = req.body;

      if (body.object === "whatsapp_business_account") {
        res.status(200).send("EVENT_RECEIVED");
        await this.processMessage(body);
      } else {
        res.sendStatus(404);
      }
    } catch (error) {
      console.error("❌ Error en handleWebhook:", error);
      res.sendStatus(500);
    }
  };

  private setUserState(userId: string, state: string): void {
    this.userStates.set(userId, state);
    console.log(`🔵 Estado actualizado para ${userId}: ${state}`);
  }

  private getUserState(userId: string): string {
    return this.userStates.get(userId) || "idle";
  }

  private clearUserState(userId: string): void {
    this.userStates.delete(userId);
    console.log(`🟡 Estado limpiado para ${userId}`);
  }

  // Procesar mensajes de WhatsApp
  private processMessage = async (body: any): Promise<void> => {
    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (value?.statuses) {
        console.log(
          "📊 Mensaje de estado ignorado:",
          value.statuses[0]?.status
        );
        return;
      }

      const message = value?.messages?.[0];

      if (message) {
        const from = message.from;
        const text = this.extractText(message);

        if (text) {
          console.log(`💬 Mensaje de ${from}: ${text}`);

          // Procesar respuesta de botones interactivos
          if (message.type === "interactive") {
            await this.handleInteractiveResponse(from, message);
          } else {
            // Procesar mensaje de texto normal
            await this.handleTextMessage(from, text);
          }
        }
      }
    } catch (error) {
      console.error("❌ Error procesando mensaje:", error);
    }
  };

  // Manejar respuesta de botones interactivos
  private handleInteractiveResponse = async (
    from: string,
    message: any
  ): Promise<void> => {
    try {
      const interactiveData = message.interactive;
      const buttonResponse = interactiveData?.button_reply;

      if (buttonResponse) {
        const selectedId = buttonResponse.id;
        console.log(`🔘 Botón seleccionado por ${from}: ${selectedId}`);

        const userState = this.getUserState(from);

        if (userState === "confirming_reschedule") {
          const userSelection = this.userSelections.get(from);
          if (
            !userSelection ||
            !userSelection.selectedAppointment ||
            !userSelection.selectedSession ||
            !userSelection.selectedSlot
          ) {
            await this.sendWhatsAppMessage(
              from,
              "❌ Error: No se encontró la información completa para reprogramar."
            );
            this.clearUserState(from);
            return;
          }

          if (selectedId === "confirm_yes") {
            const result =
              await this.rescheduleAppointmentService.executeReschedule(
                from,
                userSelection.selectedAppointment,
                userSelection.selectedSession,
                userSelection.selectedSlot,
                this.sendWhatsAppMessage.bind(this)
              );

            if (result.success) {
              this.clearUserState(from);
              this.userSelections.delete(from);
            }
          } else if (selectedId === "confirm_no") {
            await this.sendWhatsAppMessage(
              from,
              "✅ *Reprogramación cancelada*\n\n" +
                "Tu cita mantiene su horario original. No se realizaron cambios.\n\n" +
                "Si necesitas ayuda adicional, no dudes en escribirnos."
            );
            this.clearUserState(from);
            this.userSelections.delete(from);
          }
          return;
        }

        if (userState === "confirming_cancellation") {
          const userSelection = this.userSelections.get(from);
          if (
            !userSelection ||
            !userSelection.selectedAppointment ||
            !userSelection.selectedSession
          ) {
            await this.sendWhatsAppMessage(
              from,
              "❌ Error: No se encontró la información de la cita a cancelar."
            );
            this.clearUserState(from);
            return;
          }

          if (selectedId === "confirm_yes") {
            const result =
              await this.cancelAppointmentService.processCancellationConfirmation(
                from,
                "sí",
                userSelection.selectedAppointment,
                userSelection.selectedSession,
                this.sendWhatsAppMessage.bind(this)
              );

            if (result.success) {
              this.clearUserState(from);
              this.userSelections.delete(from);
            }
          } else if (selectedId === "confirm_no") {
            await this.sendWhatsAppMessage(
              from,
              "✅ *Cancelación abortada*\n\n" +
                "Tu cita sigue activa. No se realizaron cambios.\n\n" +
                "Si necesitas ayuda adicional, no dudes en escribirnos."
            );
            this.clearUserState(from);
            this.userSelections.delete(from);
          }
          return;
        }

        // En handleInteractiveResponse, simplificar la creación del paciente
        if (userState === "confirming_new_patient_data") {
          const userSelection = this.userSelections.get(from);

          if (selectedId === "confirm_yes") {
            // 🔥 Usuario confirmó los datos, crear paciente REAL
            if (userSelection && userSelection.pendingPatientData) {
              try {
                const request = {
                  patientData: userSelection.pendingPatientData,
                };

                console.log(
                  "📤 Creando paciente REAL con datos confirmados:",
                  request
                );

                // 🔥 CREAR paciente y obtener ID
                const realPatientId =
                  await this.realPatientService.createRealPatient(request);

                console.log(`✅ ID del paciente obtenido: ${realPatientId}`);

                if (!realPatientId) {
                  throw new Error("No se pudo obtener el ID del paciente");
                }

                // 🔥 OBTENER datos completos del paciente desde la BD
                const createdPatient =
                  await this.realPatientService.getPatientById(realPatientId);

                if (!createdPatient) {
                  throw new Error(
                    `No se pudo obtener los datos del paciente con ID: ${realPatientId}`
                  );
                }

                console.log("✅ Paciente obtenido de BD:", createdPatient);

                // 🔥 Crear objeto paciente para el flujo
                const newPatient = {
                  Id: createdPatient.Id,
                  Names: createdPatient.Names,
                  LastNamePaternal: createdPatient.LastNamePaternal,
                  LastNameMaternal: createdPatient.LastNameMaternal,
                  IdentityCard: createdPatient.IdentityCard,
                  MobileNumber: createdPatient.MobileNumber,
                  Age: createdPatient.Age,
                  Gender: createdPatient.Gender,
                  DateOfBirth: createdPatient.DateOfBirth,
                  Address: createdPatient.Address,
                };

                // 🔥 GUARDAR el paciente REAL en la selección del usuario
                this.userSelections.set(from, {
                  ...userSelection,
                  patient: newPatient,
                  pendingPatientData: undefined,
                });

                // 🔥 VERIFICAR que se guardó correctamente
                const updatedSelection = this.userSelections.get(from);
                console.log(
                  "🔍 Verificando userSelection después de guardar:",
                  {
                    hasPatient: !!updatedSelection?.patient,
                    patientId: updatedSelection?.patient?.Id,
                    patientData: updatedSelection?.patient,
                  }
                );

                await this.sendWhatsAppMessage(
                  from,
                  "✅ *¡Registro exitoso!*\n\n" +
                    "Tus datos han sido registrados correctamente en el sistema. Ahora continuemos con la selección de especialidad."
                );

                // Mostrar especialidades
                await this.showSpecialties(from);
              } catch (error) {
                console.error("❌ Error creando paciente:", error);
                await this.sendWhatsAppMessage(
                  from,
                  "❌ Error al registrar tus datos. Por favor intenta nuevamente.\n\n" +
                    "Error: " +
                    (error instanceof Error
                      ? error.message
                      : "Error desconocido")
                );
                this.setUserState(from, "waiting_new_patient_data");
              }
            } else {
              await this.sendWhatsAppMessage(
                from,
                "❌ Error: No se encontraron los datos para confirmar. Por favor comienza nuevamente."
              );
              this.clearUserState(from);
            }
          } else if (selectedId === "confirm_no") {
            // 🔥 Usuario rechazó los datos, pedir nuevamente
            await this.sendWhatsAppMessage(
              from,
              "🔄 *Volvamos a intentarlo*\n\n" +
                "Por favor, envía tus datos nuevamente en el formato solicitado:\n\n" +
                "• 👤 *Nombre completo*\n" +
                "• 👨‍👩‍👧‍👦 *Apellido paterno*\n" +
                "• 👨‍👩‍👧‍👦 *Apellido materno* (opcional)\n" +
                "• 🎂 *Fecha de nacimiento* (DD/MM/AAAA)\n" +
                "• 🆔 *Número de carnet*\n" +
                "• 📞 *Número de celular*\n" +
                "• 🏠 *Domicilio*\n" +
                "• ⚤ *Género* (Masculino/Femenino)\n\n" +
                "*Formato de ejemplo:*\n" +
                "Maria Gonzalez Lopez 25/12/1990 1234567 77712345 Calle Principal #123 Femenino"
            );
            this.setUserState(from, "waiting_new_patient_data");
          }
          return;
        }

        if (userState === "confirming_final_appointment") {
          if (selectedId === "confirm_yes") {
            const userSelection = this.userSelections.get(from);
            if (!userSelection) {
              await this.sendWhatsAppMessage(
                from,
                "❌ Error: No se encontró la información de tu reserva."
              );
              this.clearUserState(from);
              return;
            }

            const temporaryAppointmentId =
              await this.createTemporaryAppointment(
                from,
                userSelection,
                userSelection.previewData
              );

            await this.linkManager.sendPaymentLink(
              from,
              temporaryAppointmentId
            );

            // Mensaje adicional de confirmación
            await this.sendWhatsAppMessage(
              from,
              "✅ *¡Solicitud de terapia en proceso de confirmación!*\n\n" +
                "Para completar el proceso:\n\n" +
                "1. Realiza el pago del 50% mediante el enlace proporcionado\n" +
                "2. Sube tu comprobante de pago en el sitio web\n\n" +
                "🔄 *Proceso posterior al pago:*\n" +
                "Nuestro equipo administrativo revisará tu comprobante para verificar su autenticidad. Una vez validado, recibirás una notificación confirmando que tus terapias han sido aceptadas y agregadas oficialmente al sistema.\n\n" +
                "¡Agradecemos tu comprensión! 🙏"
            );

            // 🔥 Aquí podrías llamar al endpoint para crear la cita real
            // await this.createFinalAppointment(from);
          } else if (selectedId === "confirm_no") {
            await this.sendWhatsAppMessage(
              from,
              "❌ *Cita cancelada*\n\n" +
                'No hay problema. Si deseas programar una nueva cita, simplemente escribe "Hola" para comenzar de nuevo.'
            );
          }

          this.clearUserState(from);
          this.userSelections.delete(from);
          return;
        }

        // Manejar confirmación de datos del paciente (código existente)
        if (userState === "confirming_patient_data") {
          if (selectedId === "confirm_yes") {
            // 🔥 OBTENER la selección actual (que ya contiene el paciente)
            const userSelection = this.userSelections.get(from);
            if (userSelection && userSelection.patient) {
              console.log(
                `✅ Paciente confirmado: ${userSelection.patient.Names} ${userSelection.patient.LastNamePaternal} (ID: ${userSelection.patient.Id})`
              );

              // 🔥 NO SOBREESCRIBIR, solo actualizar el estado
              this.setUserState(from, "selecting_specialty");

              // Mostrar especialidades
              await this.showSpecialties(from);
            } else {
              console.error(
                "❌ No se encontró información del paciente para confirmar"
              );
              await this.sendWhatsAppMessage(
                from,
                "❌ Error: No se encontró la información del paciente. Por favor comienza nuevamente."
              );
              this.clearUserState(from);
            }
          } else if (selectedId === "confirm_no") {
            await this.sendWhatsAppMessage(
              from,
              "❌ *Datos incorrectos*\n\n" +
                "Por favor, escribe tus datos nuevamente:\n" +
                "• Nombre completo\n" +
                "• Carnet de identidad\n\n" +
                "Ejemplo: *Maria Gonzalez Lopez 12345678*"
            );
            this.setUserState(from, "waiting_patient_data");
          }
          return;
        }

        // Manejar botones de registro inicial (código existente)
        switch (selectedId) {
          case "confirm_yes":
            this.setUserState(from, "waiting_patient_data");
            await this.sendWhatsAppMessage(
              from,
              "Perfecto! Por favor, envíame tus datos exactos como te registraste:\n\n" +
                "• 📝 *Nombre completo*\n" +
                "• 🆔 *Carnet de identidad*\n\n" +
                "Ejemplo: *Maria Gonzalez Lopez 12345678*"
            );
            break;

          case "confirm_no":
            this.setUserState(from, "waiting_new_patient_data");
            await this.sendWhatsAppMessage(
              from,
              "📋 *Registro de Nuevo Paciente*\n\n" +
                "Para registrarte, necesito los siguientes datos:\n\n" +
                "• 👤 *Nombre completo*\n" +
                "• 👨‍👩‍👧‍👦 *Apellido paterno*\n" +
                "• 👨‍👩‍👧‍👦 *Apellido materno* (opcional)\n" +
                "• 🎂 *Fecha de nacimiento* (DD/MM/AAAA)\n" +
                "• 🆔 *Número de carnet*\n" +
                "• 📞 *Número de celular*\n" +
                "• 🏠 *Domicilio*\n" +
                "• ⚤ *Género* (Masculino/Femenino)\n\n" +
                "*Formato de ejemplo:*\n" +
                "Maria Gonzalez Lopez 25/12/1990 1234567 77712345 Calle Principal #123 Femenino"
            );
            break;
        }
      }
    } catch (error) {
      console.error("❌ Error procesando respuesta interactiva:", error);
      this.clearUserState(from);
    }
  };

  private showSpecialties = async (from: string): Promise<void> => {
    try {
      const specialties = await this.specialtyService.getAllSpecialties();
      const specialtiesMessage =
        this.specialtyService.formatSpecialtiesMessage(specialties);

      await this.sendWhatsAppMessage(from, specialtiesMessage);

      // 🔥 Cambiar estado para esperar selección de especialidad
      this.setUserState(from, "selecting_specialty");
    } catch (error) {
      console.error("❌ Error mostrando especialidades:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al cargar las especialidades. Por favor intenta nuevamente."
      );
    }
  };

  private handleNewPatientData = async (
    from: string,
    text: string
  ): Promise<void> => {
    try {
      console.log(`📝 Procesando datos de nuevo paciente de ${from}: ${text}`);

      // Usar Gemini para extraer y estructurar los datos del paciente
      let extractionResult = await this.extractPatientDataWithGemini(text);

      if (!extractionResult || !extractionResult.success) {
        console.log("🔄 Gemini falló, usando extracción de respaldo...");
        extractionResult = this.fallbackPatientDataExtraction(text);
      }

      if (!extractionResult || !extractionResult.success) {
        await this.sendWhatsAppMessage(
          from,
          "❌ No pude entender todos los datos. Por favor envíalos en el formato solicitado:\n\n" +
            "*Ejemplo:*\n" +
            "Maria Gonzalez Lopez 25/12/1990 1234567 77712345 Calle Principal #123 Femenino\n\n" +
            "Asegúrate de incluir:\n" +
            "• Nombre completo\n" +
            "• Fecha de nacimiento (DD/MM/AAAA)\n" +
            "• Carnet de identidad\n" +
            "• Número de celular\n" +
            "• Domicilio\n" +
            "• Género"
        );
        return;
      }

      const requiredFields = [
        "Names",
        "DateOfBirth",
        "IdentityCard",
        "MobileNumber",
        "Gender",
        "Address",
      ];
      const missingFields = requiredFields.filter(
        (field) => !extractionResult.data[field]
      );

      if (missingFields.length > 0) {
        await this.sendWhatsAppMessage(
          from,
          `❌ Faltan algunos datos: ${missingFields.join(", ")}\n\n` +
            "Por favor incluye todos los datos solicitados."
        );
        return;
      }

      // 🔥 PRIMERO: Verificar si ya existe un paciente con ese CI
      const existingPatient =
        await this.realPatientService.searchPatientByIdentityCard(
          extractionResult.data.IdentityCard
        );

      if (existingPatient) {
        // 🔥 Usar paciente existente
        console.log("✅ Paciente existente encontrado:", existingPatient);

        const currentSelection = this.userSelections.get(from) || {};
        this.userSelections.set(from, {
          ...currentSelection,
          patient: existingPatient,
        });

        await this.sendWhatsAppMessage(
          from,
          "✅ *Paciente encontrado en el sistema!*\n\n" +
            "Ya existe un registro con tu número de carnet. Continuemos con la selección de especialidad."
        );

        // Mostrar especialidades directamente
        await this.showSpecialties(from);
        return;
      }

      // 🔥 GUARDAR los datos extraídos temporalmente para confirmación
      const currentSelection = this.userSelections.get(from) || {};
      this.userSelections.set(from, {
        ...currentSelection,
        pendingPatientData: extractionResult.data, // 🔥 Guardar datos pendientes de confirmación
      });

      // 🔥 MOSTRAR confirmación con botones SÍ/NO
      const confirmationMessage = this.buildPatientConfirmationMessage(
        extractionResult.data
      );

      await this.sendWhatsAppMessage(from, confirmationMessage);
      await this.buttonManager.sendYesNoButtons(
        from,
        "¿Estos datos son correctos?"
      );

      // 🔥 Cambiar estado para esperar confirmación
      this.setUserState(from, "confirming_new_patient_data");
    } catch (error) {
      console.error("❌ Error procesando datos de nuevo paciente:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al procesar tus datos. Por favor intenta nuevamente o contacta con soporte.\n\n" +
          "Error: " +
          (error instanceof Error ? error.message : "Error desconocido")
      );
    }
  };

  private buildPatientConfirmationMessage(patientData: any): string {
    let message = "🔍 *Por favor confirma tus datos:*\n\n";

    message += `👤 *Nombre(s):* ${patientData.Names}\n`;
    message += `👨‍👩‍👧‍👦 *Apellido paterno:* ${patientData.LastNamePaternal}\n`;

    if (patientData.LastNameMaternal) {
      message += `👨‍👩‍👧‍👦 *Apellido materno:* ${patientData.LastNameMaternal}\n`;
    }

    message += `🎂 *Fecha de nacimiento:* ${patientData.DateOfBirth}\n`;
    message += `🆔 *Carnet de identidad:* ${patientData.IdentityCard}\n`;
    message += `📞 *Celular:* ${patientData.MobileNumber}\n`;

    if (patientData.PhoneNumber) {
      message += `📞 *Teléfono fijo:* ${patientData.PhoneNumber}\n`;
    }

    message += `👫 *Género:* ${
      patientData.Gender === "F" ? "Femenino" : "Masculino"
    }\n`;
    message += `🏠 *Domicilio:* ${patientData.Address}\n`;
    message += `🎯 *Edad:* ${patientData.Age} años\n`;

    return message;
  }

  private handleExistingPatientConfirmation = async (
    from: string,
    text: string
  ): Promise<void> => {
    try {
      const result = await this.patientService.processPatientMessage(text);

      if (result.success) {
        // 🔥 GUARDAR el paciente encontrado
        const currentSelection = this.userSelections.get(from) || {};
        this.userSelections.set(from, {
          ...currentSelection,
          patient: result.patient,
        });

        this.setUserState(from, "confirming_patient_data");
        await this.sendWhatsAppMessage(from, result.message);
        await this.buttonManager.sendYesNoButtons(
          from,
          "Por favor confirma si estos son tus datos correctos:"
        );
      } else {
        await this.sendWhatsAppMessage(
          from,
          `❌ ${result.message}\n\n` +
            `Por favor, escribe tus datos nuevamente:\n` +
            `• Nombre completo\n` +
            `• Carnet de identidad\n\n` +
            `Ejemplo: *Maria Gonzalez Lopez 12345678*`
        );
      }
    } catch (error) {
      console.error("❌ Error procesando paciente existente:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al buscar tus datos. Por favor intenta nuevamente."
      );
    }
  };

  // En tu WebhookController, mejora el método extractPatientDataWithGemini:

  private extractPatientDataWithGemini = async (
    userInput: string
  ): Promise<any> => {
    try {
      const prompt = `
Eres un asistente que extrae datos de pacientes de mensajes de texto.

INSTRUCCIONES CRÍTICAS:

1. Para los NOMBRES (campo "Names"):
   - Incluye TODOS los nombres de pila que encuentres
   - Ejemplos:
     * "Juana Carla Azurdui Markez Lozada" → "Juana Carla Azurdui" (nombres) + "Markez" (paterno) + "Lozada" (materno)
     * "Maria Jose del Carmen" → "Maria Jose del Carmen" (todos los nombres)
     * "Juan Carlos" → "Juan Carlos" (ambos nombres)
     * "Ana" → "Ana" (solo un nombre)

2. Para los APELLIDOS:
   - "LastNamePaternal": Siempre el PENÚLTIMO apellido si hay 2+ palabras después de los nombres
   - "LastNameMaternal": Siempre el ÚLTIMO apellido si hay 2+ palabras después de los nombres
   - Si solo hay un apellido después de los nombres, va en "LastNamePaternal"

3. Para el GÉNERO (campo "Gender"):
   - DEBE ser EXACTAMENTE "F" o "M"
   - "Femenino", "Mujer", "F" → "F"
   - "Masculino", "Hombre", "M" → "M"
   - Si no se especifica, usar "F" como valor por defecto

4. CALCULAR EDAD (campo "Age"):
   - Calcula la edad basada en la fecha de nacimiento y la fecha actual
   - Fórmula: año actual - año de nacimiento (ajustar si el cumpleaños no ha pasado)
   - La edad debe ser un número entero

5. Extrae los siguientes campos:
   - Names (todos los nombres de pila)
   - LastNamePaternal (primer apellido) 
   - LastNameMaternal (segundo apellido, opcional)
   - DateOfBirth (fecha en formato YYYY-MM-DD)
   - IdentityCard (solo números)
   - MobileNumber (solo números)
   - Address (domicilio)
   - Gender (SOLO "F" o "M")
   - Age (edad calculada, número entero)

EJEMPLOS DE PARSING:
- "Juana Carla Azurdui Markez Lozada, 12/12/2012, 14893423, 63931913, Aroma, Femenino" 
  → {"Names": "Juana Carla Azurdui", "LastNamePaternal": "Markez", "LastNameMaternal": "Lozada", "DateOfBirth": "2012-12-12", "IdentityCard": 14893423, "MobileNumber": "63931913", "Address": "Aroma", "Gender": "F", "Age": 12}

- "Maria Jose Fernandez Garcia 25/05/1990 1234567 77788899 Calle 123 Masculino"
  → {"Names": "Maria Jose", "LastNamePaternal": "Fernandez", "LastNameMaternal": "Garcia", "DateOfBirth": "1990-05-25", "IdentityCard": 1234567, "MobileNumber": "77788899", "Address": "Calle 123", "Gender": "M", "Age": 33}

- "Carlos Lopez 15/08/1985 7654321 66655544 Av. Principal Hombre"
  → {"Names": "Carlos", "LastNamePaternal": "Lopez", "LastNameMaternal": null, "DateOfBirth": "1985-08-15", "IdentityCard": 7654321, "MobileNumber": "66655544", "Address": "Av. Principal", "Gender": "M", "Age": 38}

FECHA ACTUAL: ${new Date().toISOString().split("T")[0]}

TEXTO DEL USUARIO: "${userInput}"

Devuelve SOLO un objeto JSON válido con esta estructura:
{
  "success": true,
  "data": {
    "Names": "string",
    "LastNamePaternal": "string", 
    "LastNameMaternal": "string" (puede ser null),
    "DateOfBirth": "string",
    "IdentityCard": number,
    "MobileNumber": "string",
    "Address": "string",
    "Gender": "string" (SOLO "F" o "M"),
    "Age": number
  }
}

Si faltan campos obligatorios, devuelve:
{
  "success": false,
  "missingFields": ["campo1", "campo2"]
}

RESPONDE SOLO CON EL JSON, sin explicaciones adicionales.
    `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();

      // Limpiar la respuesta
      let cleanedText = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      console.log(`🔍 Respuesta de Gemini para datos paciente: ${cleanedText}`);

      const parsedResult = JSON.parse(cleanedText);

      // 🔥 VALIDAR que el género sea F o M
      if (parsedResult.success && parsedResult.data.Gender) {
        const gender = parsedResult.data.Gender.toUpperCase();
        if (gender === "F" || gender === "M") {
          parsedResult.data.Gender = gender;
        } else {
          // Si no es F o M, intentar inferir del texto
          parsedResult.data.Gender = this.inferGenderFromText(userInput);
        }
      }

      return parsedResult;
    } catch (error) {
      console.error("❌ Error con Gemini extrayendo datos paciente:", error);
      return { success: false, missingFields: [] };
    }
  };

  // 🔥 NUEVO: Método para inferir género del texto
  private inferGenderFromText(text: string): string {
    const lowerText = text.toLowerCase();

    if (
      lowerText.includes("femenino") ||
      lowerText.includes("mujer") ||
      lowerText.includes("f")
    ) {
      return "F";
    } else if (
      lowerText.includes("masculino") ||
      lowerText.includes("hombre") ||
      lowerText.includes("m")
    ) {
      return "M";
    } else {
      // Valor por defecto
      return "F";
    }
  }

  private fallbackPatientDataExtraction(userInput: string): any {
    try {
      console.log("🔄 Usando extracción de respaldo para:", userInput);

      // Limpiar y normalizar el input
      const cleanInput = userInput
        .replace(/[^\w\s\d\/,]/g, "") // Remover caracteres especiales excepto / y ,
        .replace(/\s+/g, " ")
        .trim();

      // Buscar patrones comunes
      const dateMatch = cleanInput.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      const ciMatch = cleanInput.match(/\b(\d{7,8})\b/);
      const phoneMatch = cleanInput.match(/\b(\d{7,8})\b/g); // Buscar múltiples números

      if (!dateMatch || !ciMatch || !phoneMatch) {
        return {
          success: false,
          missingFields: ["fecha", "carnet", "teléfono"],
        };
      }

      const dateOfBirth = `${dateMatch[3]}-${dateMatch[2].padStart(
        2,
        "0"
      )}-${dateMatch[1].padStart(2, "0")}`;
      const identityCard = parseInt(ciMatch[1]);

      // Calcular edad
      const birthDate = new Date(dateOfBirth);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < birthDate.getDate())
      ) {
        age--;
      }

      // El primer número de teléfono es mobile, el segundo (si existe) es phone
      const mobileNumber = phoneMatch[0];
      const phoneNumber = phoneMatch.length > 1 ? phoneMatch[1] : null;

      // 🔥 ACTUALIZADO: Extraer género como F o M
      let gender = "F"; // Valor por defecto
      const lowerInput = userInput.toLowerCase();
      if (
        lowerInput.includes("masculino") ||
        lowerInput.includes("hombre") ||
        lowerInput.includes(" m ")
      ) {
        gender = "M";
      } else if (
        lowerInput.includes("femenino") ||
        lowerInput.includes("mujer") ||
        lowerInput.includes(" f ")
      ) {
        gender = "F";
      }

      // Extraer dirección (todo lo que no sea nombres, fechas, números)
      let address = cleanInput
        .replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/, "") // quitar fecha
        .replace(/\b\d{7,8}\b/g, "") // quitar números de carnet y teléfono
        .replace(/\b(femenino|masculino|mujer|hombre|f|m)\b/gi, "") // quitar género
        .replace(/,/g, "")
        .trim();

      // Separar nombres y apellidos
      const words = cleanInput
        .split(" ")
        .filter(
          (word) =>
            !word.match(/\d/) &&
            !["femenino", "masculino", "mujer", "hombre", "f", "m"].includes(
              word.toLowerCase()
            ) &&
            word.length > 1
        );

      // Lógica simple: asumir que los primeros 1-4 words son nombres, luego apellidos
      let names = "",
        lastNamePaternal = "",
        lastNameMaternal = "";

      if (words.length >= 3) {
        const nameWords = Math.min(2, words.length - 2);
        names = words.slice(0, nameWords).join(" ");
        lastNamePaternal = words[words.length - 2] || "";
        lastNameMaternal = words[words.length - 1] || "";
      } else if (words.length === 2) {
        names = words[0];
        lastNamePaternal = words[1];
      } else if (words.length === 1) {
        names = words[0];
      }

      return {
        success: true,
        data: {
          Names: names || "Nombre No Especificado",
          LastNamePaternal: lastNamePaternal || null,
          LastNameMaternal: lastNameMaternal || null,
          DateOfBirth: dateOfBirth,
          IdentityCard: identityCard,
          MobileNumber: mobileNumber,
          PhoneNumber: phoneNumber,
          Age: age,
          Gender: gender, // 🔥 Ahora es "F" o "M"
          Address: address || "Dirección No Especificada",
        },
      };
    } catch (error) {
      console.error("❌ Error en extracción de respaldo:", error);
      return { success: false, missingFields: ["error_en_extraccion"] };
    }
  }

  private classifyUserIntent = async (userMessage: string): Promise<string> => {
    try {
      const prompt = `
Eres un clasificador de intenciones para un sistema de citas médicas. 
Analiza el mensaje del usuario y clasifícalo en UNA de estas categorías:

CATEGORÍAS VÁLIDAS:
- "saludo": Cuando el usuario saluda (hola, hi, buenas, buenos días, etc.)
- "programar_cita": Cuando quiere agendar/programar/reservar una cita nueva
- "cancelar_cita": Cuando quiere cancelar/eliminar/anular una cita existente  
- "reprogramar_cita": Cuando quiere cambiar/modificar/reprogramar una cita
- "otro": Para cualquier otra cosa

INSTRUCCIONES:
1. Responde SOLO con una de las categorías mencionadas
2. No agregues explicaciones, solo la categoría

EJEMPLOS:
- "hola buenos días" → "saludo"
- "quiero agendar una cita" → "programar_cita" 
- "necesito reservar hora" → "programar_cita"
- "deseo programar consulta" → "programar_cita"
- "quiero cancelar mi cita" → "cancelar_cita"
- "necesito anular mi reserva" → "cancelar_cita"
- "me gustaría cambiar la fecha" → "reprogramar_cita"
- "puedo modificar mi horario" → "reprogramar_cita"
- "quiero mover mi cita" → "reprogramar_cita"
- "necesito cambiar el día" → "reprogramar_cita"
- cualquier otra cosa → "otro"

MENSAJE DEL USUARIO: "${userMessage}"

RESPONDE SOLO CON: "saludo", "programar_cita", "cancelar_cita", "reprogramar_cita" o "otro"
    `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const classification = response.text().trim().toLowerCase();

      console.log(
        `🔍 Gemini clasificó: "${userMessage}" → "${classification}"`
      );

      // Validar que la respuesta sea una categoría válida
      const validCategories = [
        "saludo",
        "programar_cita",
        "cancelar_cita",
        "reprogramar_cita",
        "otro",
      ];
      return validCategories.includes(classification) ? classification : "otro";
    } catch (error) {
      console.error("❌ Error clasificando intención con Gemini:", error);
      return "otro";
    }
  };

  private handleTextMessage = async (
    from: string,
    text: string
  ): Promise<void> => {
    try {
      const lowerText = text.toLowerCase();
      const userState = this.getUserState(from);

      console.log(`💬 Mensaje de ${from}: "${text}" (Estado: ${userState})`);

      if (userState.startsWith("processing_")) {
        console.log(`⏳ Operación en curso, ignorando mensaje: ${text}`);
        return;
      }

      if (userState === "waiting_cancel_patient_data") {
        await this.handleCancelPatientData(from, text);
        return;
      }

      if (userState === "selecting_appointment_to_cancel") {
        await this.handleAppointmentSelectionForCancel(from, text);
        return;
      }

      if (userState === "confirming_cancellation") {
        await this.handleCancellationConfirmation(from, text);
        return;
      }

      if (userState === "selecting_unique_time_slot") {
        await this.handleUniqueTimeSlotSelection(from, text);
        return;
      }

      if (userState === "selecting_days") {
        await this.handleDaysSelection(from, text);
        return;
      }

      if (userState === "confirming_final_appointment") {
        await this.handleFinalConfirmation(from, text);
        return;
      }

      // Manejar selección de horario (código existente)
      if (userState === "selecting_time_slot") {
        await this.handleTimeSlotSelection(from, text);
        return;
      }

      if (userState === "waiting_consultations_number") {
        await this.handleConsultationsNumber(from, text);
        return;
      }

      // Manejar selección de especialista (código existente)
      if (userState === "selecting_specialist") {
        await this.handleSpecialistSelection(from, text);
        return;
      }

      // Manejar selección de especialidad (código existente)
      if (userState === "selecting_specialty") {
        await this.handleSpecialtySelection(from, text);
        return;
      }

      // Verificar si el usuario está en estado de espera de datos
      if (userState === "waiting_patient_data") {
        const result = await this.patientService.processPatientMessage(text);

        if (result.success) {
          // 🔥 GUARDAR el paciente encontrado SIN SOBREESCRIBIR
          const currentSelection = this.userSelections.get(from) || {};
          this.userSelections.set(from, {
            ...currentSelection, // 🔥 Mantener datos existentes
            patient: result.patient, // 🔥 Agregar paciente
          });

          this.setUserState(from, "confirming_patient_data");
          await this.sendWhatsAppMessage(from, result.message);
          await this.buttonManager.sendYesNoButtons(
            from,
            "Por favor confirma si estos son tus datos correctos:"
          );
        } else {
          await this.sendWhatsAppMessage(
            from,
            `❌ ${result.message}\n\n` +
              `Por favor, escribe tus datos nuevamente:\n` +
              `• Nombre completo\n` +
              `• Carnet de identidad\n\n` +
              `Ejemplo: *Maria Gonzalez Lopez 12345678*`
          );
        }
        return;
      }

      // Manejar confirmación de datos del paciente (código existente)
      if (userState === "confirming_patient_data") {
        if (
          lowerText.includes("sí") ||
          lowerText.includes("si") ||
          lowerText.includes("confirmar") ||
          text.includes("✅")
        ) {
          // 🔥 NUEVO: Mostrar especialidades después de confirmar
          await this.showSpecialties(from);
        } else if (
          lowerText.includes("no") ||
          lowerText.includes("incorrecto") ||
          text.includes("❌")
        ) {
          await this.sendWhatsAppMessage(
            from,
            "❌ *Datos incorrectos*\n\n" +
              "Por favor, escribe tus datos nuevamente:\n" +
              "• Nombre completo\n" +
              "• Carnet de identidad\n\n" +
              "Ejemplo: *Maria Gonzalez Lopez 12345678*"
          );
          this.setUserState(from, "waiting_patient_data");
        }
        return;
      }

      if (userState === "waiting_new_patient_data") {
        await this.handleNewPatientData(from, text);
        return;
      }

      if (userState === "waiting_reschedule_patient_data") {
        await this.handleReschedulePatientData(from, text);
        return;
      }

      if (userState === "selecting_appointment_to_reschedule") {
        await this.handleAppointmentSelectionForReschedule(from, text);
        return;
      }

      if (userState === "selecting_reschedule_day") {
        await this.handleRescheduleDaySelection(from, text);
        return;
      }

      if (userState === "selecting_reschedule_slot") {
        await this.handleRescheduleSlotSelection(from, text);
        return;
      }

      if (userState === "confirming_reschedule") {
        await this.handleRescheduleConfirmation(from, text);
        return;
      }

      // Procesar mensajes normales (código existente)
      const intent = await this.classifyUserIntent(text);

      switch (intent) {
        case "saludo":
          await this.sendWelcomeMessage(from);
          break;

        case "programar_cita":
          await this.sendRegistrationButtons(from);
          break;

        case "cancelar_cita":
          await this.handleCancelAppointment(from);
          break;

        case "reprogramar_cita":
          await this.handleRescheduleAppointment(from);
          break;

        case "otro":
        default:
          const response = await this.generateResponse(text);
          await this.sendWhatsAppMessage(from, response);
          break;
      }
    } catch (error) {
      console.error("❌ Error en handleTextMessage:", error);
    }
  };

  private handleRescheduleAppointment = async (from: string): Promise<void> => {
    await this.rescheduleAppointmentService.startRescheduleProcess(
      from,
      this.sendWhatsAppMessage.bind(this)
    );
    this.setUserState(from, "waiting_reschedule_patient_data");
  };

  private handleReschedulePatientData = async (
    from: string,
    text: string
  ): Promise<void> => {
    const result =
      await this.rescheduleAppointmentService.processPatientDataForReschedule(
        from,
        text,
        this.sendWhatsAppMessage.bind(this),
        this.extractPatientDataWithGemini.bind(this)
      );

    if (result.success && result.patient) {
      const currentSelection = this.userSelections.get(from) || {};
      this.userSelections.set(from, {
        ...currentSelection,
        patient: result.patient,
      });

      const sessionsResult =
        await this.rescheduleAppointmentService.showPatientAppointmentsForReschedule(
          from,
          result.patient.Id,
          this.sendWhatsAppMessage.bind(this)
        );

      if (sessionsResult.success && sessionsResult.sessionMap) {
        this.userSelections.set(from, {
          ...currentSelection,
          patient: result.patient,
          rescheduleSessionMap: sessionsResult.sessionMap,
        });

        this.setUserState(from, "selecting_appointment_to_reschedule");
      } else {
        this.clearUserState(from);
      }
    }
  };

  private handleAppointmentSelectionForReschedule = async (
    from: string,
    text: string
  ): Promise<void> => {
    const userSelection = this.userSelections.get(from);
    if (!userSelection || !userSelection.rescheduleSessionMap) {
      await this.sendWhatsAppMessage(
        from,
        "❌ Error: No se encontraron las sesiones. Por favor comienza nuevamente."
      );
      this.clearUserState(from);
      return;
    }

    const result =
      await this.rescheduleAppointmentService.handleAppointmentSelectionForReschedule(
        from,
        text,
        userSelection.rescheduleSessionMap,
        this.sendWhatsAppMessage.bind(this)
      );

    if (
      result.success &&
      result.selectedAppointment &&
      result.selectedSession &&
      result.availableDays // ✅ Ahora availableDays está en el tipo
    ) {
      this.userSelections.set(from, {
        ...userSelection,
        selectedAppointment: result.selectedAppointment,
        selectedSession: result.selectedSession,
        availableDays: result.availableDays,
      });

      this.setUserState(from, "selecting_reschedule_day");
    }
  };

  private handleRescheduleDaySelection = async (
    from: string,
    text: string
  ): Promise<void> => {
    const userSelection = this.userSelections.get(from);
    if (
      !userSelection ||
      !userSelection.availableDays ||
      !userSelection.selectedAppointment ||
      !userSelection.selectedSession
    ) {
      await this.sendWhatsAppMessage(
        from,
        "❌ Error: No se encontró la información de la sesión. Por favor comienza nuevamente."
      );
      this.clearUserState(from);
      return;
    }

    const result = await this.rescheduleAppointmentService.handleDaySelection(
      from,
      text,
      userSelection.availableDays,
      userSelection.selectedAppointment,
      userSelection.selectedSession,
      this.sendWhatsAppMessage.bind(this)
    );

    if (result.success && result.selectedDay) {
      this.userSelections.set(from, {
        ...userSelection,
        selectedDay: result.selectedDay,
      });

      this.setUserState(from, "selecting_reschedule_slot");
    }
  };

  private handleRescheduleSlotSelection = async (
    from: string,
    text: string
  ): Promise<void> => {
    const userSelection = this.userSelections.get(from);
    if (
      !userSelection ||
      !userSelection.selectedDay ||
      !userSelection.selectedAppointment ||
      !userSelection.selectedSession
    ) {
      await this.sendWhatsAppMessage(
        from,
        "❌ Error: No se encontró la información de la sesión. Por favor comienza nuevamente."
      );
      this.clearUserState(from);
      return;
    }

    const result =
      await this.rescheduleAppointmentService.handleSlotSelectionAndReschedule(
        from,
        text,
        userSelection.selectedDay,
        userSelection.selectedAppointment,
        userSelection.selectedSession,
        this.sendWhatsAppMessage.bind(this)
      );

    if (result.success && result.selectedSlot) {
      this.userSelections.set(from, {
        ...userSelection,
        selectedSlot: result.selectedSlot,
      });

      this.setUserState(from, "confirming_reschedule");
    }
  };

  private handleRescheduleConfirmation = async (
    from: string,
    text: string
  ): Promise<void> => {
    const userSelection = this.userSelections.get(from);

    if (
      !userSelection ||
      !userSelection.selectedAppointment ||
      !userSelection.selectedSession ||
      !userSelection.selectedDay ||
      !userSelection.selectedSlot
    ) {
      console.error("❌ Datos faltantes en userSelection:", {
        hasSelection: !!userSelection,
        hasAppointment: !!userSelection?.selectedAppointment,
        hasSession: !!userSelection?.selectedSession,
        hasDay: !!userSelection?.selectedDay,
        hasSlot: !!userSelection?.selectedSlot,
        selectedSlot: userSelection?.selectedSlot,
      });

      await this.sendWhatsAppMessage(
        from,
        "❌ Error: No se encontró la información completa para reprogramar. Por favor comienza nuevamente."
      );
      this.clearUserState(from);
      return;
    }

    const lowerText = text.toLowerCase();

    if (
      lowerText.includes("sí") ||
      lowerText.includes("si") ||
      text.includes("✅")
    ) {
      const result = await this.rescheduleAppointmentService.executeReschedule(
        from,
        userSelection.selectedAppointment,
        userSelection.selectedSession,
        userSelection.selectedSlot,
        this.sendWhatsAppMessage.bind(this)
      );

      if (result.success) {
        this.clearUserState(from);
        this.userSelections.delete(from);
      }
    } else if (lowerText.includes("no") || lowerText.includes("❌")) {
      await this.sendWhatsAppMessage(
        from,
        "✅ *Reprogramación cancelada*\n\n" +
          "Tu cita mantiene su horario original. No se realizaron cambios.\n\n" +
          "Si necesitas ayuda adicional, no dudes en escribirnos."
      );
      this.clearUserState(from);
      this.userSelections.delete(from);
    }
  };

  private handleCancelAppointment = async (from: string): Promise<void> => {
    await this.cancelAppointmentService.startCancellationProcess(
      from,
      this.sendWhatsAppMessage.bind(this)
    );
    this.setUserState(from, "waiting_cancel_patient_data");
  };

  /**
   * Maneja los datos del paciente para cancelación
   */
  private handleCancelPatientData = async (
    from: string,
    text: string
  ): Promise<void> => {
    const result =
      await this.cancelAppointmentService.processPatientDataForCancellation(
        from,
        text,
        this.sendWhatsAppMessage.bind(this),
        this.extractPatientDataWithGemini.bind(this)
      );

    if (result.success && result.patient) {
      // Guardar paciente en la selección
      const currentSelection = this.userSelections.get(from) || {};
      this.userSelections.set(from, {
        ...currentSelection,
        patient: result.patient,
      });

      // Obtener y mostrar sesiones
      const sessionsResult =
        await this.cancelAppointmentService.showPatientAppointments(
          from,
          result.patient.Id,
          this.sendWhatsAppMessage.bind(this)
        );

      if (sessionsResult.success && sessionsResult.sessionMap) {
        // Guardar sessionMap en la selección
        this.userSelections.set(from, {
          ...currentSelection,
          patient: result.patient,
          sessionMap: sessionsResult.sessionMap,
        });

        this.setUserState(from, "selecting_appointment_to_cancel");
      } else {
        this.clearUserState(from);
      }
    }
  };

  /**
   * Maneja la selección de cita para cancelar
   */
  private handleAppointmentSelectionForCancel = async (
    from: string,
    text: string
  ): Promise<void> => {
    const userSelection = this.userSelections.get(from);
    if (!userSelection || !userSelection.sessionMap) {
      await this.sendWhatsAppMessage(
        from,
        "❌ Error: No se encontraron las sesiones. Por favor comienza nuevamente."
      );
      this.clearUserState(from);
      return;
    }

    const result =
      await this.cancelAppointmentService.handleAppointmentSelection(
        from,
        text,
        userSelection.sessionMap,
        this.sendWhatsAppMessage.bind(this),
        async (to: string, buttonText: string) => {
          await this.buttonManager.sendYesNoButtons(to, buttonText);
        }
      );

    if (
      result.success &&
      result.selectedAppointment &&
      result.selectedSession
    ) {
      // Guardar la selección
      this.userSelections.set(from, {
        ...userSelection,
        selectedAppointment: result.selectedAppointment,
        selectedSession: result.selectedSession,
      });

      this.setUserState(from, "confirming_cancellation");
    }
  };

  /**
   * Maneja la confirmación de cancelación
   */
  private handleCancellationConfirmation = async (
    from: string,
    text: string
  ): Promise<void> => {
    const userSelection = this.userSelections.get(from);
    if (
      !userSelection ||
      !userSelection.selectedAppointment ||
      !userSelection.selectedSession
    ) {
      await this.sendWhatsAppMessage(
        from,
        "❌ Error: No se encontró la información de la cita a cancelar."
      );
      this.clearUserState(from);
      return;
    }

    const result =
      await this.cancelAppointmentService.processCancellationConfirmation(
        from,
        text,
        userSelection.selectedAppointment,
        userSelection.selectedSession,
        this.sendWhatsAppMessage.bind(this)
      );

    if (result.success) {
      this.clearUserState(from);
      this.userSelections.delete(from);
    }
  };

  private handleFinalConfirmation = async (
    from: string,
    text: string
  ): Promise<void> => {
    try {
      const lowerText = text.toLowerCase();

      if (
        lowerText.includes("sí") ||
        lowerText.includes("si") ||
        text.includes("✅")
      ) {
        // 🔥 ENVIAR MENSAJE CON ENLACE DE PAGO
        const userSelection = this.userSelections.get(from);
        if (!userSelection) {
          await this.sendWhatsAppMessage(
            from,
            "❌ Error: No se encontró la información de tu reserva."
          );
          this.clearUserState(from);
          return;
        }

        // 🔥 CREAR cita temporal en el backend
        const temporaryAppointmentId = await this.createTemporaryAppointment(
          from,
          userSelection,
          userSelection.previewData
        );

        // 🔥 ENVIAR enlace de pago con el ID de la cita temporal
        await this.linkManager.sendPaymentLink(from, temporaryAppointmentId);

        // Mensaje adicional de confirmación
        await this.sendWhatsAppMessage(
          from,
          "✅ *¡Cita en proceso de confirmación!*\n\n" +
            "Una vez realizado el pago del 50%, tu cita quedará confirmada oficialmente.\n\n" +
            "Recibirás un comprobante y recordatorio antes de cada sesión.\n\n" +
            "¡Gracias por confiar en nosotros! 🎉"
        );

        // 🔥 Aquí podrías llamar al endpoint para crear la cita real
        // await this.createFinalAppointment(from);
      } else if (lowerText.includes("no") || lowerText.includes("❌")) {
        await this.sendWhatsAppMessage(
          from,
          "❌ *Cita cancelada*\n\n" +
            'No hay problema. Si deseas programar una nueva cita, simplemente escribe "Hola" para comenzar de nuevo.'
        );
      }

      // 🔥 LIMPIAR estados después de finalizar
      this.clearUserState(from);
      this.userSelections.delete(from);
    } catch (error) {
      console.error("❌ Error manejando confirmación final:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al procesar tu confirmación. Por favor contacta con soporte."
      );
    }
  };

  // 🔥 NUEVO: Método para crear cita temporal en el backend
  private createTemporaryAppointment = async (
    from: string,
    userSelection: any,
    previewData: any[]
  ): Promise<string> => {
    try {
      console.log("📝 Iniciando creación de cita temporal para:", from);

      const isTemporaryPatient =
        userSelection.temporaryPatientId && !userSelection.patient?.Id;

      const patientData = isTemporaryPatient
        ? {
            // Paciente temporal
            Id: userSelection.temporaryPatientId,
            Names: userSelection.temporaryPatientData.Names,
            LastNamePaternal:
              userSelection.temporaryPatientData.LastNamePaternal,
            LastNameMaternal:
              userSelection.temporaryPatientData.LastNameMaternal,
            CI: userSelection.temporaryPatientData.IdentityCard.toString(),
            IsTemporary: true,
          }
        : {
            // Paciente real
            Id: userSelection.patient.Id,
            Names: userSelection.patient.Names,
            LastNamePaternal: userSelection.patient.LastNamePaternal,
            LastNameMaternal: userSelection.patient.LastNameMaternal,
            CI:
              userSelection.patient.IdentityCard?.toString() ||
              userSelection.patient.CI,
            IsTemporary: false,
          };

      // Construir datos completos de la cita
      const appointmentData = {
        patient: {
          Id: userSelection.patient.Id,
          Names: userSelection.patient.Names,
          LastNamePaternal: userSelection.patient.LastNamePaternal,
          LastNameMaternal: userSelection.patient.LastNameMaternal,
          CI: userSelection.patient.CI,
        },
        specialty: {
          Id: userSelection.specialty.Id,
          TypeOfSpecialty: userSelection.specialty.TypeOfSpecialty,
        },
        specialist: {
          Id: userSelection.specialist.Id,
          Names: userSelection.specialist.Names,
          LastNamePaternal: userSelection.specialist.LastNamePaternal,
          LastNameMaternal: userSelection.specialist.LastNameMaternal,
        },
        consultationsNumber: userSelection.consultationsNumber,
        selectedSlots: userSelection.selectedSlots.map((slot: any) => ({
          scheduleId: slot.scheduleId,
          timeSlotId: slot.timeSlotId,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          displayText: slot.displayText,
        })),
        previewDates: previewData,
        totalCost: userSelection.consultationsNumber * 65,
        paymentRequired: userSelection.consultationsNumber * 65 * 0.5,
        createdAt: new Date().toISOString(),
        whatsappNumber: from,
      };

      const request = {
        whatsAppNumber: from,
        appointmentData: appointmentData,
      };

      console.log(
        "📤 Enviando datos al backend:",
        JSON.stringify(request, null, 2)
      );

      // Crear cita temporal en el backend
      const temporaryAppointmentId =
        await this.temporaryAppointmentService.createTemporaryAppointment(
          request
        );

      console.log(
        `✅ Cita temporal creada con ID: ${temporaryAppointmentId} para usuario: ${from}`
      );
      if (isTemporaryPatient) {
        // Aquí podrías actualizar la cita temporal con el ID del paciente temporal
        // Esto depende de cómo esté estructurado tu backend de citas temporales
        console.log(
          `🔗 Paciente temporal ${userSelection.temporaryPatientId} vinculado a cita ${temporaryAppointmentId}`
        );
      }

      return temporaryAppointmentId;
    } catch (error) {
      console.error("❌ Error creando cita temporal:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Lo sentimos, hubo un error al procesar tu reserva. Por favor intenta nuevamente o contacta con soporte."
      );
      throw new Error(
        "No se pudo crear la reserva temporal. Por favor intenta nuevamente."
      );
    }
  };

  // Agrega este método en tu WebhookController
  public handleApprovalNotification = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { phone, message, notificationId, type } = req.body;

      // Validar datos requeridos
      if (!phone || !message) {
        console.log("❌ Faltan campos requeridos: phone o message");
        res.status(400).json({
          success: false,
          error: "Faltan campos requeridos: phone, message",
        });
        return;
      }

      // Enviar mensaje WhatsApp
      await this.sendWhatsAppMessage(phone, message);

      res.json({
        success: true,
        message: "Notificación enviada correctamente",
        notificationId,
      });
    } catch (error) {
      console.error("❌ Error en handleApprovalNotification:", error);
      res.status(500).json({
        success: false,
        error: "Error interno del servidor",
      });
    }
  };

  private handleSpecialtySelection = async (
    from: string,
    text: string
  ): Promise<void> => {
    try {
      const specialtyNumber = parseInt(text.trim());

      if (isNaN(specialtyNumber)) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Por favor, responde con el *número* de la especialidad.\n\n" +
            'Ejemplo: envía "1" para seleccionar la primera especialidad.'
        );
        return;
      }

      const specialties = await this.specialtyService.getAllSpecialties();

      if (specialtyNumber < 1 || specialtyNumber > specialties.length) {
        await this.sendWhatsAppMessage(
          from,
          `❌ Número inválido. Por favor selecciona un número entre 1 y ${specialties.length}.`
        );
        return;
      }

      const selectedSpecialty = specialties[specialtyNumber - 1];

      // 🔥 ACTUALIZAR sin sobrescribir
      const currentSelection = this.userSelections.get(from) || {};
      this.userSelections.set(from, {
        ...currentSelection, // 🔥 Mantener paciente y otros datos
        specialty: selectedSpecialty,
      });

      await this.sendWhatsAppMessage(
        from,
        `✅ *Especialidad seleccionada:* ${selectedSpecialty.TypeOfSpecialty}\n\n` +
          `Ahora vamos a mostrarte los especialistas disponibles.`
      );

      // Pasar Id como string
      await this.showSpecialistsBySpecialty(
        from,
        selectedSpecialty.Id,
        selectedSpecialty.TypeOfSpecialty
      );
    } catch (error) {
      console.error("❌ Error manejando selección de especialidad:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al procesar tu selección. Por favor intenta nuevamente."
      );
    }
  };

  private showSpecialistsBySpecialty = async (
    from: string,
    specialtyId: string,
    specialtyName: string
  ): Promise<void> => {
    // 🔥 specialtyId como string
    try {
      const specialists =
        await this.specialistService.getSpecialistsBySpecialty(specialtyId);
      const specialistsMessage =
        this.specialistService.formatSpecialistsMessage(
          specialists,
          specialtyName
        );

      await this.sendWhatsAppMessage(from, specialistsMessage);

      if (specialists.length > 0) {
        this.setUserState(from, "selecting_specialist");
      } else {
        await this.sendWhatsAppMessage(
          from,
          "⚠️ No hay especialistas disponibles para esta especialidad en este momento.\n\n" +
            "Por favor, selecciona otra especialidad."
        );
        await this.showSpecialties(from);
      }
    } catch (error) {
      console.error("❌ Error mostrando especialistas:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al cargar los especialistas. Por favor intenta nuevamente."
      );
    }
  };

  private handleSpecialistSelection = async (
    from: string,
    text: string
  ): Promise<void> => {
    try {
      const specialistNumber = parseInt(text.trim());

      if (isNaN(specialistNumber)) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Por favor, responde con el *número* del especialista.\n\n" +
            'Ejemplo: envía "1" para seleccionar el primer especialista.'
        );
        return;
      }

      // OBTENER la selección actual (que ya contiene paciente y especialidad)
      const userSelection = this.userSelections.get(from);
      if (!userSelection || !userSelection.specialty) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Error: No se encontró tu selección previa. Por favor comienza nuevamente."
        );
        this.clearUserState(from);
        return;
      }

      const specialists =
        await this.specialistService.getSpecialistsBySpecialty(
          userSelection.specialty.Id
        );

      if (specialistNumber < 1 || specialistNumber > specialists.length) {
        await this.sendWhatsAppMessage(
          from,
          `❌ Número inválido. Por favor selecciona un número entre 1 y ${specialists.length}.`
        );
        return;
      }

      const selectedSpecialist = specialists[specialistNumber - 1];

      // 🔥 ACTUALIZAR sin sobrescribir
      this.userSelections.set(from, {
        ...userSelection, // 🔥 Mantener paciente, especialidad, etc.
        specialist: selectedSpecialist,
      });

      // Construir nombre completo del especialista
      let specialistFullName = `${selectedSpecialist.Names} ${selectedSpecialist.LastNamePaternal}`;
      if (selectedSpecialist.LastNameMaternal) {
        specialistFullName += ` ${selectedSpecialist.LastNameMaternal}`;
      }

      // Preguntar por el número de consultas
      await this.askNumberOfConsultations(from);

      console.log(
        `🎯 Usuario ${from} seleccionó especialista: ${specialistFullName}`
      );
    } catch (error) {
      console.error("❌ Error manejando selección de especialista:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al procesar tu selección. Por favor intenta nuevamente."
      );
    }
  };

  private askNumberOfConsultations = async (from: string): Promise<void> => {
    try {
      await this.sendWhatsAppMessage(
        from,
        "📊 *¿Cuántas consultas deseas realizar?*\n\n" +
          "Por favor, escribe solo el *número* de consultas que necesitas.\n\n" +
          "Ejemplos:\n" +
          "• *1* - para una sola consulta\n" +
          "• *2* - para dos consultas\n\n" +
          "Puedes programar hasta 10 consultas simultáneamente."
      );

      // 🔥 Cambiar estado para esperar número de consultas
      this.setUserState(from, "waiting_consultations_number");
    } catch (error) {
      console.error("❌ Error preguntando por número de consultas:", error);
    }
  };

  private handleConsultationsNumber = async (
    from: string,
    text: string
  ): Promise<void> => {
    try {
      const consultationsNumber = parseInt(text.trim());

      if (isNaN(consultationsNumber)) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Por favor, responde solo con un *número*.\n\n" +
            'Ejemplo: envía "1" para una consulta, "2" para dos consultas, etc.'
        );
        return;
      }

      if (consultationsNumber < 1 || consultationsNumber > 10) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Número inválido. Por favor selecciona un número entre *1* y *10* consultas."
        );
        return;
      }

      // 🔥 ACTUALIZAR sin sobrescribir
      const userSelection = this.userSelections.get(from);
      if (userSelection) {
        this.userSelections.set(from, {
          ...userSelection,
          consultationsNumber: consultationsNumber,
        });
      }

      // Mostrar horarios únicos disponibles
      await this.showUniqueTimeSlots(from);
    } catch (error) {
      console.error("❌ Error manejando número de consultas:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al procesar el número de consultas. Por favor intenta nuevamente."
      );
    }
  };

  private showUniqueTimeSlots = async (from: string): Promise<void> => {
    try {
      const userSelection = this.userSelections.get(from);
      if (!userSelection || !userSelection.specialist) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Error: No se encontró la información del especialista. Por favor comienza nuevamente."
        );
        this.clearUserState(from);
        return;
      }

      // Obtener horarios disponibles del especialista
      const availableSlots =
        await this.scheduleService.getAvailableSlotsBySpecialist(
          userSelection.specialist.Id
        );

      if (availableSlots.length === 0) {
        await this.sendWhatsAppMessage(
          from,
          `❌ El especialista *${userSelection.specialist.Names} ${userSelection.specialist.LastNamePaternal}* no tiene horarios disponibles en este momento.\n\n` +
            "Por favor, selecciona otro especialista o intenta más tarde."
        );
        this.clearUserState(from);
        return;
      }

      // Obtener horarios únicos
      const uniqueSlots =
        this.scheduleService.getUniqueTimeSlots(availableSlots);
      const slotsMessage =
        this.scheduleService.formatUniqueSlotsMessage(uniqueSlots);

      // Guardar los datos necesarios
      this.userSelections.set(from, {
        ...userSelection,
        availableSlots: availableSlots,
        uniqueSlots: uniqueSlots,
      });

      await this.sendWhatsAppMessage(from, slotsMessage);

      // 🔥 Cambiar estado para esperar selección de horario único
      this.setUserState(from, "selecting_unique_time_slot");
    } catch (error) {
      console.error("❌ Error mostrando horarios únicos:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al cargar los horarios disponibles. Por favor intenta nuevamente."
      );
    }
  };

  // 🔥 NUEVO: Manejar selección de horario único
  private handleUniqueTimeSlotSelection = async (
    from: string,
    text: string
  ): Promise<void> => {
    try {
      const slotNumber = parseInt(text.trim());

      if (isNaN(slotNumber)) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Por favor, responde con el *número* del horario.\n\n" +
            'Ejemplo: envía "1" para seleccionar el primer horario.'
        );
        return;
      }

      const userSelection = this.userSelections.get(from);
      if (!userSelection || !userSelection.uniqueSlots) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Error: No se encontraron horarios disponibles. Por favor comienza nuevamente."
        );
        this.clearUserState(from);
        return;
      }

      const uniqueSlots = userSelection.uniqueSlots;

      if (slotNumber < 1 || slotNumber > uniqueSlots.length) {
        await this.sendWhatsAppMessage(
          from,
          `❌ Número inválido. Por favor selecciona un número entre 1 y ${uniqueSlots.length}.`
        );
        return;
      }

      const selectedSlot = uniqueSlots[slotNumber - 1];

      // Obtener días disponibles para este horario
      const availableDays = this.scheduleService.getDaysForTimeSlot(
        userSelection.availableSlots,
        selectedSlot.startTime,
        selectedSlot.endTime
      );

      // 🔥 ACTUALIZAR la selección con el horario único
      this.userSelections.set(from, {
        ...userSelection,
        selectedTimeSlot: selectedSlot,
        availableDays: availableDays,
      });

      // Mostrar días disponibles
      const daysMessage = this.scheduleService.formatDaysMessage(
        availableDays,
        selectedSlot.displayText,
        userSelection.consultationsNumber
      );

      await this.sendWhatsAppMessage(from, daysMessage);

      // 🔥 Cambiar estado para esperar selección de días
      this.setUserState(from, "selecting_days");
    } catch (error) {
      console.error("❌ Error manejando selección de horario único:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al procesar tu selección. Por favor intenta nuevamente."
      );
    }
  };

  // 🔥 NUEVO: Manejar selección de días con Gemini
  private handleDaysSelection = async (
    from: string,
    text: string
  ): Promise<void> => {
    try {
      const userSelection = this.userSelections.get(from);
      if (
        !userSelection ||
        !userSelection.availableDays ||
        !userSelection.selectedTimeSlot
      ) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Error: No se encontró la información de tu selección. Por favor comienza nuevamente."
        );
        this.clearUserState(from);
        return;
      }

      const availableDays = userSelection.availableDays;
      const sessionCount = userSelection.consultationsNumber;
      const selectedTimeSlot = userSelection.selectedTimeSlot;
      const availableSlots: AvailableSlot[] =
        userSelection.availableSlots || [];

      // Usar Gemini para interpretar los días seleccionados
      const selectedDays = await this.interpretDaysSelection(
        text,
        availableDays,
        sessionCount
      );

      if (!selectedDays || selectedDays.length === 0) {
        await this.sendWhatsAppMessage(
          from,
          "❌ No pude entender los días que seleccionaste. Por favor intenta nuevamente.\n\n" +
            "Ejemplos válidos:\n" +
            "• *Lunes y Miércoles*\n" +
            "• *Lunes, Miércoles*\n" +
            "• *Viernes* (para 1 sesión)\n" +
            `• *${availableDays.slice(0, sessionCount).join(" y ")}*`
        );
        return;
      }

      // Validar que no se seleccionen más días de los disponibles
      if (selectedDays.length > sessionCount) {
        await this.sendWhatsAppMessage(
          from,
          `❌ Has seleccionado ${selectedDays.length} días, pero solo tienes ${sessionCount} sesión(es).\n\n` +
            `Por favor selecciona máximo ${sessionCount} día(s).`
        );
        return;
      }

      // Validar que los días seleccionados estén disponibles
      const invalidDays = selectedDays.filter(
        (day) => !availableDays.includes(day)
      );
      if (invalidDays.length > 0) {
        await this.sendWhatsAppMessage(
          from,
          `❌ Los siguientes días no están disponibles en este horario: ${invalidDays.join(
            ", "
          )}\n\n` + `Días disponibles: ${availableDays.join(", ")}`
        );
        return;
      }

      // 🔥 CREAR los slots seleccionados con tipado correcto
      const selectedSlots: AvailableSlot[] = selectedDays.map((day) => {
        // Encontrar el slot completo para este día y horario
        const fullSlot = availableSlots.find(
          (slot: AvailableSlot) =>
            slot.dayOfWeek === day &&
            slot.startTime === selectedTimeSlot.startTime &&
            slot.endTime === selectedTimeSlot.endTime
        );

        if (!fullSlot) {
          throw new Error(
            `No se encontró slot para ${day} ${selectedTimeSlot.displayText}`
          );
        }

        return fullSlot;
      });

      // 🔥 ACTUALIZAR la selección con los slots finales
      this.userSelections.set(from, {
        ...userSelection,
        selectedSlots: selectedSlots,
      });

      await this.sendWhatsAppMessage(
        from,
        `✅ *Días seleccionados:* ${selectedDays.join(", ")}\n` +
          `🕐 *Horario:* ${selectedTimeSlot.displayText}\n` +
          `📊 *Total de sesiones:* ${sessionCount}`
      );

      // Proceder con la finalización
      await this.finalizeAppointmentBooking(from);
    } catch (error) {
      console.error("❌ Error manejando selección de días:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al procesar los días seleccionados. Por favor intenta nuevamente."
      );
    }
  };

  // 🔥 NUEVO: Usar Gemini para interpretar selección de días
  private interpretDaysSelection = async (
    userInput: string,
    availableDays: string[],
    sessionCount: number
  ): Promise<string[]> => {
    try {
      const prompt = `
Eres un asistente que ayuda a interpretar la selección de días para citas médicas.

DÍAS DISPONIBLES: ${availableDays.join(", ")}
NÚMERO DE SESIONES REQUERIDAS: ${sessionCount}

INSTRUCCIONES:
1. Analiza el mensaje del usuario y extrae los días que menciona
2. Solo considera días que estén en la lista de DÍAS DISPONIBLES
3. Si el usuario selecciona más días de los necesarios, toma solo los primeros ${sessionCount} días
4. Si el usuario selecciona menos días de los necesarios, repite los días para completar ${sessionCount} sesiones
5. Devuelve SOLO un array JSON con los nombres de los días en español, usando exactamente estos formatos: "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"

MENSAJE DEL USUARIO: "${userInput}"

RESPONDE SOLO CON EL ARRAY JSON, sin explicaciones adicionales, sin markdown, sin backticks.
Ejemplo: ["Lunes", "Miércoles"]
    `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();

      console.log(`🔍 Respuesta cruda de Gemini: "${text}"`);

      // 🔥 LIMPIAR la respuesta - eliminar markdown y backticks
      let cleanedText = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      // Si todavía empieza con [ y termina con ], es JSON válido
      if (cleanedText.startsWith("[") && cleanedText.endsWith("]")) {
        try {
          const daysArray = JSON.parse(cleanedText);
          if (
            Array.isArray(daysArray) &&
            daysArray.every((day) => typeof day === "string")
          ) {
            console.log(
              `✅ Días interpretados por Gemini: ${daysArray.join(", ")}`
            );
            return daysArray;
          }
        } catch (parseError) {
          console.error(
            "❌ Error parseando JSON limpio:",
            parseError,
            "Texto:",
            cleanedText
          );
        }
      }

      // 🔥 FALLBACK: método robusto de interpretación manual
      console.log("🔄 Usando fallback para interpretar días...");
      return this.fallbackInterpretDays(userInput, availableDays, sessionCount);
    } catch (error) {
      console.error("❌ Error con Gemini interpretando días:", error);

      // 🔥 FALLBACK en caso de error
      return this.fallbackInterpretDays(userInput, availableDays, sessionCount);
    }
  };

  // 🔥 NUEVO: Método fallback robusto para interpretar días
  private fallbackInterpretDays(
    userInput: string,
    availableDays: string[],
    sessionCount: number
  ): string[] {
    console.log(`🔍 Fallback interpretando: "${userInput}"`);

    // Normalizar el input del usuario
    const normalizedInput = userInput
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // quitar acentos
      .replace(/[.,]/g, " ") // reemplazar comas y puntos por espacios
      .replace(/\s+/g, " ") // normalizar espacios múltiples
      .trim();

    console.log(`🔍 Input normalizado: "${normalizedInput}"`);

    // Mapeo de variaciones de días
    const dayVariations: { [key: string]: string } = {
      // Lunes
      lunes: "Lunes",
      lune: "Lunes",
      lun: "Lunes",

      // Martes
      martes: "Martes",
      marte: "Martes",
      mart: "Martes",

      // Miércoles
      miercoles: "Miércoles",
      miercole: "Miércoles",
      miercol: "Miércoles",
      mierco: "Miércoles",
      mierc: "Miércoles",
      mier: "Miércoles",
      mie: "Miércoles",
      miércoles: "Miércoles",
      miércole: "Miércoles",
      miércol: "Miércoles",
      miérco: "Miércoles",
      miérc: "Miércoles",

      // Jueves
      jueves: "Jueves",
      jueve: "Jueves",
      juev: "Jueves",
      jue: "Jueves",

      // Viernes
      viernes: "Viernes",
      vierne: "Viernes",
      viern: "Viernes",
      vier: "Viernes",
      vie: "Viernes",

      // Sábado
      sabado: "Sábado",
      sabad: "Sábado",
      saba: "Sábado",
      sab: "Sábado",
      sábado: "Sábado",
      sábad: "Sábado",
      sába: "Sábado",
      sáb: "Sábado",

      // Domingo
      domingo: "Domingo",
      doming: "Domingo",
      domin: "Domingo",
      domi: "Domingo",
      dom: "Domingo",
    };

    // Buscar días mencionados en el input
    const foundDays: string[] = [];
    const words = normalizedInput.split(" ");

    // Primera pasada: buscar coincidencias exactas en variaciones
    for (const word of words) {
      const cleanWord = word.trim();
      if (cleanWord && dayVariations[cleanWord]) {
        const correctDay = dayVariations[cleanWord];
        if (
          availableDays.includes(correctDay) &&
          !foundDays.includes(correctDay)
        ) {
          foundDays.push(correctDay);
        }
      }
    }

    // Segunda pasada: buscar por substrings si no encontramos suficientes
    if (foundDays.length < sessionCount) {
      for (const availableDay of availableDays) {
        const normalizedAvailableDay = availableDay
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

        if (
          normalizedInput.includes(normalizedAvailableDay) &&
          !foundDays.includes(availableDay)
        ) {
          foundDays.push(availableDay);
        }
      }
    }

    console.log(`🔍 Días encontrados en fallback: ${foundDays.join(", ")}`);

    // Si encontramos días, devolver hasta el número de sesiones necesarias
    if (foundDays.length > 0) {
      // Si el usuario pidió más sesiones que días encontrados, repetir los días
      if (foundDays.length < sessionCount) {
        const repeatedDays = [];
        for (let i = 0; i < sessionCount; i++) {
          repeatedDays.push(foundDays[i % foundDays.length]);
        }
        console.log(
          `🔄 Repitiendo días para completar sesiones: ${repeatedDays.join(
            ", "
          )}`
        );
        return repeatedDays;
      }

      // Si encontramos suficientes días, tomar los primeros que necesitemos
      return foundDays.slice(0, sessionCount);
    }

    // 🔥 TERCERA OPCIÓN: intentar detectar patrones comunes
    if (
      normalizedInput.includes("lunes") &&
      normalizedInput.includes("miercoles") &&
      normalizedInput.includes("viernes")
    ) {
      const commonPattern = ["Lunes", "Miércoles", "Viernes"].filter((day) =>
        availableDays.includes(day)
      );
      if (commonPattern.length >= Math.min(3, sessionCount)) {
        console.log(
          `🎯 Patrón Lunes-Miércoles-Viernes detectado: ${commonPattern.join(
            ", "
          )}`
        );
        return commonPattern.slice(0, sessionCount);
      }
    }

    if (
      normalizedInput.includes("martes") &&
      normalizedInput.includes("jueves")
    ) {
      const commonPattern = ["Martes", "Jueves"].filter((day) =>
        availableDays.includes(day)
      );
      if (commonPattern.length >= Math.min(2, sessionCount)) {
        console.log(
          `🎯 Patrón Martes-Jueves detectado: ${commonPattern.join(", ")}`
        );
        return commonPattern.slice(0, sessionCount);
      }
    }

    console.log(`❌ No se pudieron interpretar días del input: "${userInput}"`);
    return [];
  }

  // 🔥 NUEVO: Método para mostrar horarios disponibles por sesión
  private showAvailableSlotsForSession = async (
    from: string
  ): Promise<void> => {
    try {
      const userSelection = this.userSelections.get(from);
      if (!userSelection || !userSelection.specialist) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Error: No se encontró la información del especialista. Por favor comienza nuevamente."
        );
        this.clearUserState(from);
        return;
      }

      // Obtener horarios disponibles del especialista
      const availableSlots =
        await this.scheduleService.getAvailableSlotsBySpecialist(
          userSelection.specialist.Id
        );

      if (availableSlots.length === 0) {
        await this.sendWhatsAppMessage(
          from,
          `❌ El especialista *${userSelection.specialist.Names} ${userSelection.specialist.LastNamePaternal}* no tiene horarios disponibles en este momento.\n\n` +
            "Por favor, selecciona otro especialista o intenta más tarde."
        );
        this.clearUserState(from);
        return;
      }

      const currentSession = userSelection.currentSession || 1;
      const slotsMessage = this.scheduleService.formatSlotsMessage(
        availableSlots,
        currentSession
      );

      // Guardar los slots disponibles para esta sesión
      this.userSelections.set(from, {
        ...userSelection,
        availableSlots: availableSlots,
        currentSession: currentSession,
      });

      await this.sendWhatsAppMessage(
        from,
        "🕐 *Ahora selecciona un horario para tus sesiones.*"
      );
      await this.sendWhatsAppMessage(from, slotsMessage);

      // 🔥 Cambiar estado para esperar selección de horario
      this.setUserState(from, "selecting_time_slot");
    } catch (error) {
      console.error("❌ Error mostrando horarios disponibles:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al cargar los horarios disponibles. Por favor intenta nuevamente."
      );
    }
  };

  // 🔥 NUEVO: Método para manejar selección de horario
  private handleTimeSlotSelection = async (
    from: string,
    text: string
  ): Promise<void> => {
    try {
      const slotNumber = parseInt(text.trim());

      if (isNaN(slotNumber)) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Por favor, responde con el *número* del horario.\n\n" +
            'Ejemplo: envía "1" para seleccionar el primer horario.'
        );
        return;
      }

      const userSelection = this.userSelections.get(from);
      if (!userSelection || !userSelection.availableSlots) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Error: No se encontraron horarios disponibles. Por favor comienza nuevamente."
        );
        this.clearUserState(from);
        return;
      }

      const availableSlots = userSelection.availableSlots;
      const currentSession = userSelection.currentSession || 1;

      if (slotNumber < 1 || slotNumber > availableSlots.length) {
        await this.sendWhatsAppMessage(
          from,
          `❌ Número inválido. Por favor selecciona un número entre 1 y ${availableSlots.length}.`
        );
        return;
      }

      const selectedSlot = availableSlots[slotNumber - 1];

      // 🔥 ACTUALIZAR la selección con el horario de esta sesión
      const updatedSelectedSlots = [
        ...(userSelection.selectedSlots || []),
        selectedSlot,
      ];

      this.userSelections.set(from, {
        ...userSelection,
        selectedSlots: updatedSelectedSlots,
      });

      await this.sendWhatsAppMessage(
        from,
        `✅ *Sesión ${currentSession} programada:*\n${selectedSlot.displayText}`
      );

      // 🔥 VERIFICAR si hay más sesiones por programar
      const totalSessions = userSelection.consultationsNumber;

      if (currentSession < totalSessions) {
        // Mostrar horarios para la siguiente sesión
        const nextSession = currentSession + 1;

        this.userSelections.set(from, {
          ...userSelection,
          selectedSlots: updatedSelectedSlots,
          currentSession: nextSession,
        });

        await this.sendWhatsAppMessage(
          from,
          `🕐 *Continuemos con la sesión ${nextSession}...*`
        );

        // Mostrar horarios para la siguiente sesión
        await this.showAvailableSlotsForSession(from);
      } else {
        // 🔥 TODAS las sesiones han sido programadas
        await this.finalizeAppointmentBooking(from);
      }
    } catch (error) {
      console.error("❌ Error manejando selección de horario:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al procesar tu selección. Por favor intenta nuevamente."
      );
    }
  };

  // 🔥 ACTUALIZADO: Método para mostrar preview y confirmación
  private finalizeAppointmentBooking = async (from: string): Promise<void> => {
    try {
      const userSelection = this.userSelections.get(from);
      if (!userSelection) {
        await this.sendWhatsAppMessage(
          from,
          "❌ Error: No se encontró la información de tu reserva."
        );
        this.clearUserState(from);
        return;
      }

      // 🔥 Obtener el preview de las citas
      const previewData = await this.getAppointmentPreview(from, userSelection);

      // 🔥 MANEJAR caso cuando el preview falla
      if (!previewData || previewData.length === 0) {
        await this.sendWhatsAppMessage(
          from,
          "❌ No se pudieron calcular las fechas para tus sesiones. " +
            "Esto puede deberse a que los horarios seleccionados ya están ocupados.\n\n" +
            "Por favor, intenta seleccionar otros horarios o contacta con soporte."
        );
        this.clearUserState(from);
        return;
      }

      // Construir mensaje de resumen
      const specialistFullName = this.getSpecialistFullName(
        userSelection.specialist
      );

      let summaryMessage = `🎉 *¡Perfecto! A continuación te muestro un resumen:*\n\n`;
      summaryMessage += `*Especialista:* ${specialistFullName}\n`;
      summaryMessage += `*Especialidad:* ${userSelection.specialty.TypeOfSpecialty}\n`;
      summaryMessage += `*Total de sesiones:* ${userSelection.consultationsNumber}\n\n`;
      summaryMessage += `*Estas son las fechas con el horario que seleccionaste:*\n\n`;
      summaryMessage +=
        this.appointmentService.formatPreviewMessage(previewData);

      this.userSelections.set(from, {
        ...userSelection,
        previewData: previewData,
      });

      await this.sendWhatsAppMessage(from, summaryMessage);

      await this.buttonManager.sendYesNoButtons(
        from,
        "¿Estás conforme con las fechas y horarios de tus sesiones?"
      );

      // 🔥 Cambiar estado para esperar confirmación final
      this.setUserState(from, "confirming_final_appointment");
    } catch (error) {
      console.error("❌ Error finalizando programación de citas:", error);
      await this.sendWhatsAppMessage(
        from,
        "❌ Error al finalizar tu reserva. Por favor contacta con soporte."
      );
    }
  };

  private getSpecialistFullName(specialist: any): string {
    let fullName = `${specialist.Names} ${specialist.LastNamePaternal}`;
    if (specialist.LastNameMaternal) {
      fullName += ` ${specialist.LastNameMaternal}`;
    }
    return fullName;
  }

  // 🔥 NUEVO: Método para obtener el preview de las citas
  // En getAppointmentPreview, agregar más logs
  private getAppointmentPreview = async (
    from: string,
    userSelection: any
  ): Promise<any[] | null> => {
    try {
      // 🔥 LOG DETALLADO de userSelection
      console.log("🔍 DEBUG - userSelection completo:", {
        hasPatient: !!userSelection.patient,
        patient: userSelection.patient,
        patientId: userSelection.patient?.Id,
        patientType: typeof userSelection.patient?.Id,
        hasSpecialty: !!userSelection.specialty,
        hasSpecialist: !!userSelection.specialist,
        hasSelectedSlots: !!userSelection.selectedSlots,
        selectedSlotsCount: userSelection.selectedSlots?.length,
      });

      // 🔥 VERIFICAR que tenemos el ID del paciente
      if (!userSelection.patient || !userSelection.patient.Id) {
        console.error("❌ No se encontró el ID del paciente en userSelection");
        console.error("❌ userSelection.patient:", userSelection.patient);
        return null;
      }

      // 🔥 VERIFICAR que el ID del paciente es válido
      const patientId = userSelection.patient.Id;
      if (typeof patientId !== "string" || patientId.trim() === "") {
        console.error("❌ ID del paciente inválido:", patientId);
        return null;
      }

      // 🔥 VERIFICAR que tenemos timeSlotIds
      if (
        !userSelection.selectedSlots ||
        userSelection.selectedSlots.length === 0
      ) {
        console.error("❌ No se encontraron horarios seleccionados");
        return null;
      }

      // 🔥 LOG DETALLADO de los slots seleccionados
      console.log("🔍 Slots seleccionados para preview:");
      userSelection.selectedSlots.forEach((slot: any, index: number) => {
        console.log(`- Slot ${index + 1}:`, {
          scheduleId: slot.scheduleId,
          timeSlotId: slot.timeSlotId,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
        });
      });

      // Construir el DTO para el preview con el ID REAL del paciente
      const appointmentDto: AppointmentDto = {
        PatientId: patientId, // 🔥 Usar el ID verificado
        SpecialtyId: userSelection.specialty.Id,
        SpecialistId: userSelection.specialist.Id,
        SessionCount: userSelection.consultationsNumber,
        SessionCost: 65.0,
        ScheduledSessions: userSelection.selectedSlots.map(
          (slot: any, index: number) => {
            // 🔥 USAR timeSlotId (el ID real del TimeSlot)
            const timeSlotId = slot.timeSlotId;

            const sessionDto: ScheduledSessionDto = {
              TimeSlotId: timeSlotId,
              DayOfWeek: this.convertToEnglishDay(slot.dayOfWeek),
              StartTime: this.formatTimeForBackend(slot.startTime),
              EndTime: this.formatTimeForBackend(slot.endTime),
              Status: "Scheduled",
            };
            return sessionDto;
          }
        ),
      };

      const previewSlots = await this.appointmentService.getAppointmentPreview(
        appointmentDto
      );

      if (!previewSlots) {
        console.error("❌ El preview retornó null o undefined");
      } else {
        console.log(`✅ Preview obtenido con ${previewSlots.length} slots`);
      }

      return previewSlots;
    } catch (error) {
      console.error("❌ Error obteniendo preview:", error);
      return null;
    }
  };

  private formatTimeForBackend(timeString: string): string {
    try {

      // Si ya está en formato HH:MM:SS, dejarlo igual
      if (timeString.match(/^\d{1,2}:\d{2}:\d{2}$/)) {
        return timeString;
      }

      // Si está en formato HH:MM, agregar :00
      if (timeString.match(/^\d{1,2}:\d{2}$/)) {
        const [hours, minutes] = timeString.split(":");
        const formattedHours = hours.padStart(2, "0");
        const formattedMinutes = minutes.padStart(2, "0");
        return `${formattedHours}:${formattedMinutes}:00`;
      }

      // Si es un timestamp o TimeOnly de C#, extraer la parte de tiempo
      const time = new Date(timeString);
      if (!isNaN(time.getTime())) {
        return time.toLocaleTimeString("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
      }

      return timeString;
    } catch (error) {
      console.error("Error formateando hora para backend:", error);
      return timeString;
    }
  }

  // 🔥 NUEVO: Método para convertir días al inglés (para el enum de C#)
  private convertToEnglishDay(spanishDay: string): string {
    const dayMap: { [key: string]: string } = {
      Lunes: "Monday",
      Martes: "Tuesday",
      Miércoles: "Wednesday",
      Jueves: "Thursday",
      Viernes: "Friday",
      Sábado: "Saturday",
      Domingo: "Sunday",
    };

    return dayMap[spanishDay] || spanishDay;
  }

  // Mensaje de bienvenida con servicios
  private sendWelcomeMessage = async (to: string): Promise<void> => {
    const welcomeText =
      "¡Hola! 👋 Bienvenido/a a nuestro sistema de salud. \n\n" +
      "Estos son nuestros servicios:\n\n" +
      "1. 📅 Programar cita - Para agendar una nueva cita\n" +
      "2. 🔄 Reprogramar cita - Para cambiar fecha/hora de una cita existente\n" +
      "3. ❌ Cancelar cita - Para eliminar una cita programada\n\n" +
      "¿En qué puedo ayudarte hoy?";

    await this.sendWhatsAppMessage(to, welcomeText);
  };

  // Enviar botones de registro
  private sendRegistrationButtons = async (to: string): Promise<void> => {
    const questionText =
      "Para programar una cita, necesito verificar si ya estás registrado en nuestra plataforma. \n\n" +
      "¿Ya te encuentras registrado en nuestra página web?";

    await this.buttonManager.sendYesNoButtons(to, questionText);
  };

  // Extraer texto del mensaje
  private extractText = (message: any): string => {
    if (message.type === "text") {
      return message.text?.body;
    } else if (message.type === "interactive") {
      return message.interactive?.button_reply?.title;
    }
    return "";
  };

  // Generar respuesta con Gemini (para otras consultas)
  private generateResponse = async (userMessage: string): Promise<string> => {
    try {
      const sistemaMenu = `
Eres un asistente virtual para un sistema de gestión de citas médicas. Responde de manera amigable y profesional.

Servicios disponibles:
1. PROGRAMAR CITA - Para agendar una nueva cita
2. REPROGRAMAR CITA - Para cambiar fecha/hora de una cita existente  
3. CANCELAR CITA - Para eliminar una cita programada
4. INFORMACIÓN - Para hacer preguntas sobre el sistema

Responde de manera concisa y directa, como si fuera un mensaje de WhatsApp.
Si el usuario quiere programar una cita, ya tenemos un flujo específico para eso.
`;

      const prompt = `${sistemaMenu}\n\nMensaje del usuario: "${userMessage}"`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error("❌ Error con Gemini:", error);
      return "¡Hola! ¿En qué puedo ayudarte con nuestros servicios de citas médicas?";
    }
  };

  private wait = (delay: number, signal?: AbortSignal): Promise<void> => {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener("abort", () => clearTimeout(timer));
    });
  };

  private fetchWithRetry = async (
    url: string,
    options: any = {},
    maxRetries: number = 10,
    baseDelay: number = 1000
  ): Promise<globalThis.Response> => {
    // 🔥 Especificar globalThis.Response
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const finalOptions = {
          ...options,
          signal: controller.signal,
        };

        console.log(`📤 Intento ${attempt} de enviar a WhatsApp...`);

        const response: globalThis.Response = await fetch(url, finalOptions); // 🔥 Tipo explícito
        clearTimeout(timeoutId);

        if (response.ok) {
          console.log(`✅ Mensaje enviado exitosamente en intento ${attempt}`);
          return response;
        }

        // Si la respuesta no es exitosa, lanzar error
        const errorText = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${response.statusText} - ${errorText}`
        );
      } catch (error: any) {
        clearTimeout(timeoutId);
        console.error(`❌ Intento ${attempt} fallido:`, error.message);

        // No reintentar si el usuario abortó o si son errores 4xx (excepto 429)
        if (
          error.name === "AbortError" ||
          (error.message.includes("HTTP 4") &&
            !error.message.includes("HTTP 429"))
        ) {
          throw error;
        }

        // Si es el último intento, lanzar el error
        if (attempt === maxRetries) {
          throw new Error(
            `Fallido después de ${maxRetries} intentos: ${error.message}`
          );
        }

        // Esperar con backoff exponencial más jitter
        const delay =
          baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.log(`⏳ Reintentando en ${Math.round(delay)}ms...`);
        await this.wait(delay, controller.signal);
      }
    }

    throw new Error("Todos los reintentos fallaron");
  };

  // 🔄 ACTUALIZADO: Enviar mensaje simple a WhatsApp CON REINTENTOS
  private sendWhatsAppMessage = async (
    to: string,
    text: string
  ): Promise<void> => {
    try {
      console.log(
        `📤 Intentando enviar mensaje a ${to}: "${text.substring(0, 50)}..."`
      );

      const response: globalThis.Response = await this.fetchWithRetry(
        // 🔥 Tipo explícito
        `https://graph.facebook.com/v18.0/${config.whatsapp.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.whatsapp.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: to,
            text: { body: text },
          }),
        },
        3, // 3 reintentos
        1000 // delay base de 1 segundo
      );

      const data = await response.json();
    } catch (error: any) {
      console.error(
        "❌ Error crítico enviando mensaje después de todos los reintentos:",
        error
      );

      // 🔥 MÉTRICAS PARA DIAGNÓSTICO
      console.error("📊 Métricas de fallo:", {
        destinatario: to,
        timestamp: new Date().toISOString(),
        intentos: 3,
        error: error.message,
        longitudMensaje: text.length,
      });
    }
  };
}
