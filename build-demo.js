// Membuat dist/demo.html: satu file mode demo (tanpa Supabase), untuk dicoba/dibagikan.
const fs = require('fs'), path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const inline = s => '<script>\n' + s.replace(/<\/script/gi, '<\\/script') + '\n</script>';
let html = read('index.html');
html = html.replace('<script src="config.js"></script>', () => inline("window.KN_CONFIG = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };"));
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>\n?/, '');
for (const f of ['js/world.js', 'js/net.js', 'js/game.js']) html = html.replace(`<script src="${f}"></script>`, () => inline(read(f)));
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'demo.html'), html);
console.log('dist/demo.html', html.length, 'bytes');
