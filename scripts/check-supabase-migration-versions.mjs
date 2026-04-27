import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const migrationsDir = path.resolve(process.cwd(), 'supabase', 'migrations');

if (!fs.existsSync(migrationsDir)) {
  console.error(`Supabase migrations directory not found: ${migrationsDir}`);
  process.exit(1);
}

const migrationFiles = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort();

const versions = new Map();
const invalidNames = [];

for (const fileName of migrationFiles) {
  const match = fileName.match(/^(\d+)_.*\.sql$/);

  if (!match) {
    invalidNames.push(fileName);
    continue;
  }

  const version = match[1];
  const filesForVersion = versions.get(version) ?? [];
  filesForVersion.push(fileName);
  versions.set(version, filesForVersion);
}

const duplicateVersions = [...versions.entries()].filter(([, files]) => files.length > 1);

if (invalidNames.length > 0 || duplicateVersions.length > 0) {
  console.error('Supabase migration version check failed.');

  if (invalidNames.length > 0) {
    console.error('\nMigration files must start with a numeric version followed by an underscore:');
    for (const fileName of invalidNames) {
      console.error(`- ${fileName}`);
    }
  }

  if (duplicateVersions.length > 0) {
    console.error('\nDuplicate migration versions:');
    for (const [version, files] of duplicateVersions) {
      console.error(`- ${version}`);
      for (const fileName of files) {
        console.error(`  - ${fileName}`);
      }
    }
  }

  process.exit(1);
}

console.log(`Checked ${migrationFiles.length} Supabase migrations; no duplicate versions found.`);
