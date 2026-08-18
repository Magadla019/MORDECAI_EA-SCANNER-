import Database from 'better-sqlite3';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const dbPath = process.env.DB_PATH || './mordecai.db';
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
db.exec(schema);

export default db;
