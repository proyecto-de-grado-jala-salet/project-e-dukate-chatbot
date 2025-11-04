// src/layers/services/real-patient.service.ts
import { config } from "../../utils/config";
import { pool } from "../../utils/database";

export interface RealPatientData {
  Names: string;
  LastNamePaternal: string;
  LastNameMaternal?: string;
  MobileNumber: string;
  IdentityCard: number;
  PhoneNumber?: string;
  Age: number;
  Gender: string;
  DateOfBirth: string;
  Address: string;
}

export interface CreateRealPatientRequest {
  patientData: RealPatientData;
}

export class RealPatientService {
  private baseUrl = config.api.baseUrl;

  async createRealPatient(request: CreateRealPatientRequest): Promise<string> {
    try {
      console.log('📝 Creando paciente REAL en el backend...');
      
      const response = await fetch(`https://${this.baseUrl}/Patients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request.patientData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error creating real patient: ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ Paciente REAL creado. Response:', result);

      // 🔥 OPCIÓN 1: Si el backend retorna el ID directamente
      if (result.id) {
        console.log(`✅ ID del paciente obtenido del response: ${result.id}`);
        return result.id;
      }
      
      if (result.patientId) {
        console.log(`✅ ID del paciente obtenido del response: ${result.patientId}`);
        return result.patientId;
      }

      // 🔥 OPCIÓN 2: Si no retorna ID, buscar por CI
      console.log('🔄 Backend no retornó ID, buscando por CI...');
      const identityCard = request.patientData.IdentityCard;
      const patientFromDB = await this.searchPatientByIdentityCard(identityCard);
      
      if (patientFromDB && patientFromDB.Id) {
        console.log(`✅ ID del paciente obtenido de BD: ${patientFromDB.Id}`);
        return patientFromDB.Id;
      }

      throw new Error('No se pudo obtener el ID del paciente después de crearlo');
      
    } catch (error) {
      console.error('❌ Error in createRealPatient:', error);
      throw error;
    }
  }

  async searchPatientByIdentityCard(identityCard: number): Promise<any> {
    try {
      console.log(`🔍 Buscando paciente en BD con CI: ${identityCard}`);
      
      const result = await pool.query(`
        SELECT 
          "Id", 
          "MedicalHistoryId", 
          "Names", 
          "LastNamePaternal", 
          "LastNameMaternal", 
          "MobileNumber", 
          "IdentityCard", 
          "PhoneNumber", 
          "Age", 
          "Gender", 
          "DateOfBirth", 
          "Address"
        FROM "Patients" 
        WHERE "IdentityCard" = $1
        ORDER BY "Id" DESC
        LIMIT 1
      `, [identityCard]);

      if (result.rows.length === 0) {
        console.log(`❌ No se encontró paciente con CI: ${identityCard}`);
        return null;
      }

      const patient = result.rows[0];
      console.log(`✅ Paciente encontrado en BD:`, {
        Id: patient.Id,
        Names: patient.Names,
        IdentityCard: patient.IdentityCard
      });

      return patient;
    } catch (error) {
      console.error('❌ Error searching patient in database:', error);
      return null;
    }
  }

  async getPatientById(patientId: string): Promise<any> {
    try {
      console.log(`🔍 Obteniendo paciente por ID: ${patientId}`);
      
      const result = await pool.query(`
        SELECT 
          "Id", 
          "MedicalHistoryId", 
          "Names", 
          "LastNamePaternal", 
          "LastNameMaternal", 
          "MobileNumber", 
          "IdentityCard", 
          "PhoneNumber", 
          "Age", 
          "Gender", 
          "DateOfBirth", 
          "Address"
        FROM "Patients" 
        WHERE "Id" = $1
      `, [patientId]);

      if (result.rows.length === 0) {
        console.log(`❌ No se encontró paciente con ID: ${patientId}`);
        return null;
      }

      return result.rows[0];
    } catch (error) {
      console.error('❌ Error getting patient by ID:', error);
      return null;
    }
  }
}