import { Pool } from 'pg';

export const pool = new Pool({
  host: "shortline.proxy.rlwy.net",
  port: 40013,
  database: "railway",
  user: "postgres",
  password: "xlBFQtBPbXEdtmrgIyueIyOFlNnZmVBI",
});

pool.on('connect', () => {
  console.log('✅ Conectado a PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ Error en conexión PostgreSQL:', err);
});


export interface Patient {
  id: string;
  names: string;
  lastnamepaternal: string;
  lastnamematernal: string | null;
  mobilenumber: string;
  identitycard: number;
  phonenumber: string | null;
  age: number;
  gender: string;
  dateofbirth: string;
  address: string;
  medicalhistoryid: string;
}