// Runs every service's unit tests (npm test). Installs dependencies with "npm ci" first
// when a service has no node_modules yet. Exits non-zero if any service fails, so CI
// (Jenkins) can stop the pipeline.
//
//   npm run test:unit                    all services
//   npm run test:unit -- search-service  only the named services
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const requested = process.argv.slice(2);
const services = fs.readdirSync(root)
  .filter(name => name.endsWith('-service'))
  .filter(name => !requested.length || requested.includes(name))
  .filter(name => {
    const manifest = path.join(root, name, 'package.json');
    return fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).scripts?.test;
  })
  .sort();

if (!services.length) {
  console.error('No services with a test script found.');
  process.exit(1);
}

function run(command, cwd) {
  const result = spawnSync(command, { cwd, shell: true, stdio: 'inherit' });
  return result.status === 0;
}

const results = [];
for (const service of services) {
  const cwd = path.join(root, service);
  console.log(`\n=== ${service} ===`);
  if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
    if (!run('npm ci --no-audit --no-fund', cwd)) {
      results.push({ service, ok: false, reason: 'npm ci failed' });
      continue;
    }
  }
  const ok = run('npm test', cwd);
  results.push({ service, ok, reason: ok ? '' : 'tests failed' });
}

console.log('\n=== Summary ===');
for (const { service, ok, reason } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${service}${reason ? `  (${reason})` : ''}`);
}
process.exit(results.every(result => result.ok) ? 0 : 1);
