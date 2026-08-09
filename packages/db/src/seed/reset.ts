import { config } from 'dotenv';
import { resetDb } from './db';

config({ path: '../../.env' });

(async () => {
    try {
        if (!process.env.DATABASE_URL) {
            throw new Error('Missing environment variable: DATABASE_URL');
        }

        await resetDb();
        process.exit(0);
    } catch (error) {
        console.error('Error clearing database:', error);
        process.exit(1);
    }
})();
