// 樣式檔改了就自動換 index.html 裡的版本號（tailwind.css?v=內容雜湊），瀏覽器才不會沿用舊的樣式檔
const fs = require('fs');
const crypto = require('crypto');
const css = fs.readFileSync('assets/tailwind.css');
const hash = crypto.createHash('sha1').update(css).digest('hex').slice(0, 8);
const html = fs.readFileSync('index.html', 'utf8');
const next = html.replace(/assets\/tailwind\.css\?v=[\w-]+/, `assets/tailwind.css?v=${hash}`);
if (next === html && !html.includes(`tailwind.css?v=${hash}`)) {
    console.error('index.html 裡找不到 tailwind.css?v=…');
    process.exit(1);
}
fs.writeFileSync('index.html', next);
