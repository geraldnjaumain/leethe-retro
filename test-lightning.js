import { transform, browserslistToTargets } from 'lightningcss';
import browserslist from 'browserslist';

const css = '@layer utilities { .foo { color: red; } }';
const targets = browserslistToTargets(browserslist('safari >= 14'));

const { code } = transform({
  filename: 'style.css',
  code: Buffer.from(css),
  targets
});

console.log(code.toString());
