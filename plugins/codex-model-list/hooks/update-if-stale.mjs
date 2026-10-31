import { update } from './update.mjs';

const result = await update({ timeout: 5000, fetchTimeout: 120000 });
process.stdout.write(`${JSON.stringify(result)}\n`);
