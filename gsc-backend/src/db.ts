import 'dotenv/config';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 requires a driver adapter for the client (the CLI/migrations do not).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// One shared client for the whole app — never create a new PrismaClient per request,
// each one opens its own connection pool and Postgres will run out of connections.
export const prisma = new PrismaClient({ adapter });
