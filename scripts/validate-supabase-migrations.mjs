#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

function printHelp() {
  console.log(`Usage: npm run db:validate-migrations [-- --keep-temp] [-- --debug]

Validates Supabase migrations by applying them to a disposable local database.

Options:
  --debug      Pass --debug to Supabase CLI commands.
  --keep-temp  Leave the temporary Supabase project on disk for troubleshooting.
  --help       Show this help text.
`);
}

function log(message = '') {
  process.stderr.write(`${message}\n`);
}

function parseArgs(argv) {
  const options = {
    debug: false,
    keepTemp: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--debug') {
      options.debug = true;
      continue;
    }

    if (arg === '--keep-temp') {
      options.keepTemp = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function run(command, args, { allowFailure = false, stdio = 'pipe' } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio,
    shell: false,
  });

  if (result.error) {
    if (allowFailure) {
      return result;
    }

    throw result.error;
  }

  if (!allowFailure && result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
    error.result = result;
    throw error;
  }

  return result;
}

function requireCommand(command, args, installHint) {
  const result = run(command, args, { allowFailure: true });

  if (result.error && result.error.code === 'ENOENT') {
    throw new Error(`${command} is not installed or is not on PATH. ${installHint}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : '';
    throw new Error(`${command} check failed.${stderr}`);
  }

  return result.stdout.trim();
}

function getMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Supabase migrations directory not found: ${migrationsDir}`);
  }

  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolve(address.port);
        } else {
          reject(new Error('Unable to allocate a local port.'));
        }
      });
    });
  });
}

async function getDistinctPorts(count) {
  const ports = new Set();

  while (ports.size < count) {
    ports.add(await getFreePort());
  }

  return [...ports];
}

function writeTempSupabaseProject(tempRoot, projectId, dbPort, shadowPort) {
  const tempSupabaseDir = path.join(tempRoot, 'supabase');
  fs.mkdirSync(tempSupabaseDir, { recursive: true });

  fs.cpSync(migrationsDir, path.join(tempSupabaseDir, 'migrations'), {
    recursive: true,
  });

  const config = `project_id = "${projectId}"

[db]
port = ${dbPort}
shadow_port = ${shadowPort}
major_version = 15
`;

  fs.writeFileSync(path.join(tempSupabaseDir, 'config.toml'), config, 'utf8');
  fs.writeFileSync(path.join(tempSupabaseDir, 'seed.sql'), '', 'utf8');
}

function stopSupabase(tempRoot, debug) {
  const args = ['stop', '--workdir', tempRoot, '--no-backup'];

  if (debug) {
    args.push('--debug');
  }

  const result = run('supabase', args, { allowFailure: true });

  if (result.error || result.status !== 0) {
    log('WARN: Unable to stop the disposable Supabase stack cleanly.');
    if (result.stdout) {
      log(result.stdout.trim());
    }
    if (result.stderr) {
      log(result.stderr.trim());
    }
  }

  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const migrationFiles = getMigrationFiles();
  if (migrationFiles.length === 0) {
    throw new Error('No Supabase migration files found.');
  }

  const supabaseVersion = requireCommand(
    'supabase',
    ['--version'],
    'Install the Supabase CLI before running migration validation.'
  );
  const dockerVersion = requireCommand(
    'docker',
    ['info', '--format', '{{.ServerVersion}}'],
    'Install Docker and start the Docker daemon before running migration validation.'
  );

  const [dbPort, shadowPort] = await getDistinctPorts(2);
  const projectId = `bj-migrations-${crypto.randomBytes(4).toString('hex')}`;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomjoy-supabase-migrations-'));

  log(`Supabase CLI: ${supabaseVersion}`);
  log(`Docker Engine: ${dockerVersion}`);
  log(`Validating ${migrationFiles.length} migration file(s) in disposable project ${projectId}.`);
  log(`Temporary workdir: ${tempRoot}`);

  let validationError;

  try {
    writeTempSupabaseProject(tempRoot, projectId, dbPort, shadowPort);

    const args = ['db', 'start', '--workdir', tempRoot];
    if (options.debug) {
      args.push('--debug');
    }

    run('supabase', args, { stdio: 'inherit' });
    log('\nSupabase migration apply validation passed.');
  } catch (error) {
    validationError = error;
  } finally {
    if (options.keepTemp) {
      log(`Keeping temporary workdir for troubleshooting: ${tempRoot}`);
      log(`Stop the disposable stack with: supabase stop --workdir "${tempRoot}" --no-backup`);
    } else {
      stopSupabase(tempRoot, options.debug);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  if (validationError) {
    throw validationError;
  }
}

main().catch((error) => {
  console.error('\nSupabase migration apply validation failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
