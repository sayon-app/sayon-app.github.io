const fs = require('fs');
module.exports = async ctx => {
  await ctx.route(/fonts\.googleapis\.com/, r => r.fulfill({ body: fs.readFileSync((process.env.FONTS_DIR || '/tmp/fonts') + '/fonts.css'), contentType: 'text/css' }));
  await ctx.route(/fonts\.gstatic\.com\/local\//, r => { const m = r.request().url().match(/local\/([^/]+)\/(.+)$/); r.fulfill({ body: fs.readFileSync(`${process.env.FONTS_DIR || '/tmp/fonts'}/fontsource-${m[1]}/package/files/${m[2]}`), contentType: m[2].endsWith('woff2') ? 'font/woff2' : 'font/woff' }); });
};
