// Run `npm exec nx run api:build` before preparing the deployment artifact.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'tmp/vercel-api');
fs.mkdirSync(path.join(target, 'prisma'), { recursive: true });

let bundle = fs.readFileSync(path.join(root, 'dist/apps/api/main.js'), 'utf8');
const listen = "await app.listen(port, '0.0.0.0');";
if (!bundle.includes(listen) || !bundle.includes('bootstrap();')) {
  throw new Error('Backend bootstrap changed; review the serverless adapter.');
}
bundle = bundle.replace(listen, 'await app.init();\n    return app.getHttpAdapter().getInstance();');
bundle = bundle.replace('bootstrap();', `let appPromise;
module.exports = async (req, res) => {
  appPromise ||= bootstrap();
  const handler = await appPromise;
  return handler(req, res);
};`);
// Vercel's CommonJS loader cannot require Nest 12's ESM packages. Load the
// external modules through an ESM entrypoint before invoking the Nx bundle.
const externalModules = [...new Set([...bundle.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1]))];
bundle = bundle.replace(/require\("([^"]+)"\)/g, (_, name) => `globalThis.__nkModules[${JSON.stringify(name)}]`);
fs.writeFileSync(path.join(target, 'main.js'), bundle);
fs.writeFileSync(path.join(target, 'handler.mjs'), `globalThis.__nkModules = Object.fromEntries(await Promise.all([\n${externalModules.map(name => `  import(${JSON.stringify(name)}).then(m => [${JSON.stringify(name)}, m.default ?? m])`).join(',\n')}\n]));\nconst { default: handler } = await import('./main.js');\nexport default handler;\n`);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'dist/apps/api/package.json'), 'utf8'));
pkg.dependencies.prisma = '6.19.3';
pkg.engines = { node: '22.x' };
pkg.scripts = { postinstall: 'prisma generate', start: 'node main.js' };
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
fs.copyFileSync(path.join(root, 'prisma/schema.prisma'), path.join(target, 'prisma/schema.prisma'));
fs.writeFileSync(path.join(target, 'vercel.json'), JSON.stringify({
  version: 2,
  builds: [{ src: 'handler.mjs', use: '@vercel/node' }],
  routes: [{ src: '/(.*)', dest: '/handler.mjs' }],
}, null, 2) + '\n');
console.log('Prepared tmp/vercel-api. Deploy that directory to nattukoottam-api.');
