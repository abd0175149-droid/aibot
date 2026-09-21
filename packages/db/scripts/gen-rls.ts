import { writeFileSync } from 'node:fs';
import { rlsMigrationSql } from '../src/rls.js';

writeFileSync(new URL('../migrations/0002_rls.sql', import.meta.url), rlsMigrationSql() + '\n');
console.log('migrations/0002_rls.sql مكتوب');
