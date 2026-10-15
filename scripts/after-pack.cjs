// Signs the MCP launcher (Contents/MacOS/jaffloop-mcp) BEFORE electron-builder signs the app: codesign refuses to sign the
// main executable while another executable next to it is still unsigned. electron-builder signs it again afterwards (--force).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const launcher = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/MacOS/jaffloop-mcp');
  let identity = process.env.CSC_NAME;
  if (!identity) {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
    identity = /"(Developer ID Application:[^"]+)"/.exec(out)?.[1];
  }
  if (!identity) { console.log('afterPack: no Developer ID identity, launcher left unsigned'); return; }
  execFileSync('codesign', ['--sign', identity, '--force', '--timestamp', '--options', 'runtime', launcher], { stdio: 'inherit' });
  console.log(`afterPack: signed ${path.basename(launcher)}`);
};
