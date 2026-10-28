// Trägt deinen GitHub-Namen überall ein, wo noch der Platzhalter steht.
//   npm run set-repo -- <dein-github-name> [repo-name]
// Beispiel: npm run set-repo -- leon-dev signal
const fs = require('fs');
const path = require('path');

const [user, repo = 'signal'] = process.argv.slice(2);
if (!user || !/^[A-Za-z0-9-]+$/.test(user)) {
  console.error('Aufruf: npm run set-repo -- <github-name> [repo-name]');
  process.exit(1);
}
const root = path.resolve(__dirname, '..');
const files = [
  'package.json', 'README.md', 'PRIVACY.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
  'docs/ENTWICKLUNG.md', 'docs/VEROEFFENTLICHEN.md', 'docs/STORE.md', '.github/ISSUE_TEMPLATE/config.yml',
];
let changed = 0;
for (const f of files) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  const before = fs.readFileSync(p, 'utf8');
  const after = before
    .replaceAll('DEIN-GITHUB-NAME/signal', `${user}/${repo}`)
    .replaceAll('DEIN-GITHUB-NAME', user);
  if (after !== before) { fs.writeFileSync(p, after); changed++; console.log('angepasst:', f); }
}
console.log(changed ? `Fertig: github.com/${user}/${repo}` : 'Nichts zu ändern, der Name ist schon eingetragen.');
