// Creates <overlay>/secrets.env with random values for the "ecommerce-secrets" Secret.
//   node kubernetes/generate-secrets.js kubernetes/overlays/local
// An existing file is never overwritten (the database password must stay the same as
// long as the database volume exists). The file is ignored by Git.
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const overlay = process.argv[2];
if (!overlay || !fs.existsSync(path.join(overlay, 'kustomization.yaml'))) {
  console.error('Usage: node kubernetes/generate-secrets.js <overlay directory>');
  process.exit(1);
}

const file = path.join(overlay, 'secrets.env');
if (fs.existsSync(file)) {
  console.log(`${file} already exists; keeping it.`);
  process.exit(0);
}

const random = bytes => randomBytes(bytes).toString('hex');
const adminPassword = `Adm-${randomBytes(12).toString('base64url')}`;
const lines = [
  `POSTGRES_PASSWORD=${random(24)}`,
  `JWT_SECRET=${random(32)}`,
  `INTERNAL_SERVICE_TOKEN=${random(32)}`,
  'ADMIN_EMAIL=admin@example.com',
  `ADMIN_PASSWORD=${adminPassword}`
];
fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
console.log(`Created ${file}. Admin login: admin@example.com (password in that file).`);
