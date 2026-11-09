import { mkdirSync, writeFileSync } from 'node:fs';
import { createDemo } from '../packages/core/src/demo';
import { csvTemplate } from '../packages/core/src/import';
mkdirSync('examples', { recursive: true });
writeFileSync('examples/demo-dataset.json', JSON.stringify(createDemo(), null, 2));
writeFileSync('examples/import-template.csv', '\uFEFF' + csvTemplate);
console.log('Examples generated in examples/');
