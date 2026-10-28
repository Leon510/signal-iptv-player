// Baut die gepatchte mpegts.js-Version neu, die Signal in renderer/vendor/ mitliefert.
// Nur nötig, wenn du mpegts.js aktualisierst oder den Patch änderst:
//   npm run build:mpegts
// Voraussetzungen: Node.js 20+, Git (für "git apply").
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'node_modules', 'mpegts.js');
const patch = path.join(root, 'patches', 'mpegts.js-1.8.2-signal.patch');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-mpegts-'));
const run = (cmd, cwd = work) => execSync(cmd, { cwd, stdio: 'inherit' });

console.log('Arbeitsordner:', work);
fs.cpSync(src, work, { recursive: true });
run(`git init -q`);
run(`git apply --whitespace=nowarn "${patch}"`);
run('npm install --no-audit --no-fund');
run('npx webpack --mode=production');
// Hinweis auf die Änderungen voranstellen (Apache-2.0, Abschnitt 4b)
const banner = `/*!
 * mpegts.js 1.8.2 – Copyright (C) 2016 Bilibili, Copyright (C) 2021 magicxqq.
 * Licensed under the Apache License, Version 2.0 (see licenses/mpegts.js-Apache-2.0.txt).
 *
 * MODIFIED for Signal: audio track selection (PMT audio list, preferred PID/language,
 * skipping unsupported codecs, DVB AC-3/E-AC-3 detection) and smoothing of timestamp
 * discontinuities in live streams. See patches/mpegts.js-1.8.2-signal.patch.
 * Bundles es6-promise (MIT) and events (MIT).
 */
`;
const built = fs.readFileSync(path.join(work, 'dist', 'mpegts.js'), 'utf8');
fs.writeFileSync(path.join(root, 'renderer', 'vendor', 'mpegts.js'), banner + built);
console.log('Fertig: renderer/vendor/mpegts.js aktualisiert.');
