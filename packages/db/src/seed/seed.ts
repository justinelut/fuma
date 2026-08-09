import { config } from 'dotenv';
import { seedAuthUser } from './auth';
import { resetDb, seedDb } from './db';

config({ path: '../../.env' });

(async () => {
    try {
        if (!process.env.DATABASE_URL) {
            throw new Error('Missing environment variable: DATABASE_URL');
        }

        await resetDb();
        await seedAuthUser();
        await seedDb();
        process.exit(0);
    } catch (error) {
        console.error('Error seeding database:', error);
        process.exit(1);
    }
})();
