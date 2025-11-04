import { GoogleGenerativeAI } from "@google/generative-ai";
import { pool } from "../../utils/database";

export interface PatientData {
  firstName: string;
  lastName: string;
  maternalSurname?: string;
  identityCard: string;
}

export class PatientService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    this.genAI = new GoogleGenerativeAI(
      "AIzaSyBtGWszEkKmnHaKdYNPGWgmAXXgAo1xrhM"
    );
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  }

  /**
   * Parsea el mensaje del usuario para extraer datos del paciente usando Gemini
   */
  async parsePatientData(message: string): Promise<PatientData | null> {
    try {
      console.log("🔍 Parseando mensaje con Gemini:", message);

      // Prompt específico para identificar nombres y apellidos
      const prompt = `
Analiza el siguiente mensaje e identifica EXACTAMENTE:

1. NOMBRE DE PILA (primer nombre, puede ser compuesto como "Maria Jose")
2. APELLIDO PATERNO  
3. APELLIDO MATERNO (si está presente)
4. NÚMERO DE CARNET DE IDENTIDAD (solo números)

Mensaje: "${message}"

Responde SOLO en formato JSON, sin texto adicional:

{
  "firstName": "nombre de pila aquí",
  "lastName": "apellido paterno aquí", 
  "maternalSurname": "apellido materno aquí o null si no existe",
  "identityCard": "número de carnet aquí"
}

Ejemplos:
- "Salet Gutierre, 13594439" → {"firstName": "Salet", "lastName": "Gutierre", "maternalSurname": null, "identityCard": "13594439"}
- "Santiago Marco Peres Perez Pereira 12453423" → {"firstName": "Santiago Marco", "lastName": "Peres", "maternalSurname": "Perez Pereira", "identityCard": "12453423"}
- "Yaminidei Carla Jose Losada Martinez 15453490" → {"firstName": "Yaminidei Carla Jose", "lastName": "Losada", "maternalSurname": "Martinez", "identityCard": "15453490"}
`;

      try {
        // Usar Gemini para parseo inteligente
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        const jsonText = response.text().trim();

        console.log("🤖 Respuesta de Gemini:", jsonText);

        // Extraer JSON de la respuesta (por si Gemini agrega texto adicional)
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.log("❌ No se pudo extraer JSON de la respuesta");
          return this.fallbackParse(message);
        }

        const parsedData = JSON.parse(jsonMatch[0]);

        // Validar datos mínimos
        if (
          !parsedData.firstName ||
          !parsedData.lastName ||
          !parsedData.identityCard
        ) {
          console.log("❌ Datos incompletos en parseo Gemini");
          return this.fallbackParse(message);
        }

        // Capitalizar nombres
        const patientData: PatientData = {
          firstName: this.capitalizeName(parsedData.firstName),
          lastName: this.capitalizeName(parsedData.lastName),
          maternalSurname: parsedData.maternalSurname
            ? this.capitalizeName(parsedData.maternalSurname)
            : undefined,
          identityCard: parsedData.identityCard,
        };

        console.log("✅ Datos parseados con Gemini:", patientData);
        return patientData;
      } catch (geminiError) {
        console.error("❌ Error con Gemini, usando fallback:", geminiError);
        return this.fallbackParse(message);
      }
    } catch (error) {
      console.error("❌ Error parseando datos del paciente:", error);
      return null;
    }
  }

  /**
   * Parseo de respaldo si Gemini falla
   */
  private fallbackParse(message: string): PatientData | null {
    try {
      const cleanMessage = message
        .toLowerCase()
        .replace(/[^\w\s,]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      console.log("🔄 Usando parseo de respaldo:", cleanMessage);

      // Buscar número de carnet
      const ciMatch = cleanMessage.match(/\b(\d{5,10})\b/);
      if (!ciMatch) {
        return null;
      }

      const identityCard = ciMatch[1];
      const textWithoutCI = cleanMessage
        .replace(/\b\d{5,10}\b/, "")
        .replace(/,/g, "")
        .trim();
      const words = textWithoutCI
        .split(/\s+/)
        .filter((word) => word.length > 0);

      if (words.length < 2) {
        return null;
      }

      // Lógica simple de respaldo
      let firstName: string,
        lastName: string,
        maternalSurname: string | undefined;

      if (words.length === 2) {
        firstName = words[0];
        lastName = words[1];
      } else if (words.length === 3) {
        firstName = words[0];
        lastName = words[1];
        maternalSurname = words[2];
      } else {
        // Para 4+ palabras, asumir que el último es apellido materno, el penúltimo paterno, y el resto nombres
        maternalSurname = words.pop()!;
        lastName = words.pop()!;
        firstName = words.join(" ");
      }

      // 🔥 CORRECCIÓN: Asegurar que lastName siempre tenga un valor
      if (!lastName) {
        console.log("❌ No se pudo determinar el apellido");
        return null;
      }

      return {
        firstName: this.capitalizeName(firstName),
        lastName: lastName ? this.capitalizeName(lastName) : "", // 🔥 Asegurar que no sea undefined
        maternalSurname: maternalSurname
          ? this.capitalizeName(maternalSurname)
          : undefined,
        identityCard,
      };
    } catch (error) {
      console.error("Error en parseo de respaldo:", error);
      return null;
    }
  }

  /**
   * Busca paciente en la base de datos
   */
  async findPatient(patientData: PatientData) {
    try {
      console.log("🔍 Buscando paciente en BD:", patientData);

      const result = await pool.query(
        'SELECT * FROM "Patients" WHERE "IdentityCard" = $1',
        [patientData.identityCard]
      );

      if (result.rows.length === 0) {
        console.log(
          "❌ No se encontró paciente con CI:",
          patientData.identityCard
        );
        return null;
      }

      const patient = result.rows[0];

      // 🔥 CONVERTIR el ID a string para consistencia
      const patientWithStringId = {
        ...patient,
        Id: patient.Id.toString(), // Asegurar que sea string
      };

      console.log("✅ Paciente encontrado:", {
        Id: patientWithStringId.Id,
        Names: patientWithStringId.Names,
        LastNamePaternal: patientWithStringId.LastNamePaternal,
        IdentityCard: patientWithStringId.IdentityCard,
      });

      const nameMatch = this.verifyNameMatch(patient, patientData);

      return {
        ...patientWithStringId,
        nameMatch: nameMatch,
      };
    } catch (error) {
      console.error("❌ Error buscando paciente:", error);
      throw error;
    }
  }

  /**
   * Verifica coincidencia de nombres (aproximada)
   */
  private verifyNameMatch(dbPatient: any, parsedData: PatientData): boolean {
    try {
      const dbFirstName = (dbPatient.FirstName || "").toLowerCase();
      const dbLastName = (dbPatient.LastName || "").toLowerCase();

      const parsedFirstName = parsedData.firstName.toLowerCase();
      const parsedLastName = parsedData.lastName.toLowerCase();

      // Coincidencia simple - podrías hacerlo más sofisticado
      const firstNameMatch =
        dbFirstName.includes(parsedFirstName) ||
        parsedFirstName.includes(dbFirstName);

      const lastNameMatch =
        dbLastName.includes(parsedLastName) ||
        parsedLastName.includes(dbLastName);

      return firstNameMatch && lastNameMatch;
    } catch (error) {
      console.error("Error verificando nombres:", error);
      return false;
    }
  }

  /**
   * Capitaliza nombres (primera letra mayúscula)
   */
  private capitalizeName(name: string): string {
    return name.replace(
      /\w\S*/g,
      (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  }

  /**
   * Procesa mensaje completo: parsea y busca en BD
   */
  async processPatientMessage(message: string) {
    try {
      // 1. Parsear datos del mensaje (AHORA CON AWAIT)
      const patientData = await this.parsePatientData(message);

      if (!patientData) {
        return {
          success: false,
          message:
            "No pude entender tus datos. Por favor escribe: Nombre Apellido CarnetDeIdentidad",
        };
      }

      // 2. Buscar en base de datos
      const patient = await this.findPatient(patientData);

      if (!patient) {
        return {
          success: false,
          message: `No se encontró ningún paciente registrado con CI: ${patientData.identityCard}`,
        };
      }

      // 3. Formatear datos para mostrar
      const formattedData = this.formatPatientData(patient);

      return {
        success: true,
        patient: patient,
        parsedData: patientData,
        formattedData: formattedData,
        message: this.buildConfirmationMessage(patient, formattedData),
      };
    } catch (error) {
      console.error("❌ Error procesando mensaje de paciente:", error);
      return {
        success: false,
        message: "Error al buscar en el sistema. Por favor intenta nuevamente.",
      };
    }
  }

  /**
   * Formatea los datos del paciente para mostrar
   */
  private formatPatientData(patient: any) {
    // Formatear género
    const genderMap: { [key: string]: string } = {
      F: "Femenino",
      M: "Masculino",
      FEMENINO: "Femenino",
      MASCULINO: "Masculino",
    };

    const formattedGender = genderMap[patient.Gender] || patient.Gender;

    // Formatear fecha de nacimiento
    let formattedDateOfBirth = "No especificada";
    if (patient.DateOfBirth) {
      const date = new Date(patient.DateOfBirth);
      formattedDateOfBirth = date.toISOString().split("T")[0];
    }

    // 🔥 CORRECCIÓN: Construir nombre completo correctamente
    let fullName = patient.Names; // Solo el nombre de pila
    if (patient.LastNamePaternal) {
      fullName += ` ${patient.LastNamePaternal}`;
    }
    if (patient.LastNameMaternal && patient.LastNameMaternal !== "null") {
      fullName += ` ${patient.LastNameMaternal}`;
    }

    return {
      fullName,
      names: patient.Names, // Solo nombre(s) de pila
      lastNamePaternal: patient.LastNamePaternal, // Solo apellido paterno
      lastNameMaternal: patient.LastNameMaternal, // Solo apellido materno
      identityCard: patient.IdentityCard,
      mobileNumber: patient.MobileNumber || "No especificado",
      phoneNumber: patient.PhoneNumber || "No especificado",
      age: patient.Age,
      gender: formattedGender,
      dateOfBirth: formattedDateOfBirth,
    };
  }

  /**
   * Construye mensaje de confirmación con el formato solicitado
   */
  private buildConfirmationMessage(patient: any, formattedData: any): string {
    let message = `🔍 *¿Eres este paciente?*\n\n`;

    message += `👤 *Nombre(s):* ${formattedData.names}\n`;

    // Construir apellidos
    let apellidos = formattedData.lastNamePaternal;
    if (
      formattedData.lastNameMaternal &&
      formattedData.lastNameMaternal !== "null"
    ) {
      apellidos += ` ${formattedData.lastNameMaternal}`;
    }
    message += `👨‍👩‍👧‍👦 *Apellido(s):* ${apellidos}\n`;

    message += `🆔 *Carnet de identidad:* ${formattedData.identityCard}\n`;
    message += `🎂 *Edad:* ${formattedData.age} años\n`;
    message += `👫 *Género:* ${formattedData.gender}\n`;
    message += `📅 *Fecha de nacimiento:* ${formattedData.dateOfBirth}\n`;

    if (formattedData.mobileNumber !== "No especificado") {
      message += `📱 *Celular:* ${formattedData.mobileNumber}\n`;
    }

    message += `\n¿Estos son tus datos correctos?`;

    return message;
  }
}
