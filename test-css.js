import { transform, browserslistToTargets } from 'lightningcss';
import fs from 'fs';
import browserslist from 'browserslist';

const css = fs.readFileSync('dist/client/assets/styles-BuGc6ApI.css');
const targets = browserslistToTargets(browserslist('safari >= 14'));

const { code } = transform({
  filename: 'style.css',
  code: css,
  targets,
  drafts: {
    customMedia: true
  }
});

fs.writeFileSync('test-out.css', code);
console.log("Done");
