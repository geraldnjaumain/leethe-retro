import postcss from 'postcss';
import cascadeLayers from '@csstools/postcss-cascade-layers';
import presetEnv from 'postcss-preset-env';
import fs from 'fs';
import { globSync } from 'glob';

const plugins = [
  cascadeLayers(),
  presetEnv({ 
    features: { 'oklab-function': true, 'custom-properties': true },
    browsers: 'safari >= 14'
  })
];

const files = globSync('dist/client/assets/*.css');
for (const file of files) {
  const css = fs.readFileSync(file, 'utf8');
  postcss(plugins)
    .process(css, { from: file, to: file })
    .then(result => {
      fs.writeFileSync(file, result.css);
      console.log(`Transpiled ${file}`);
    });
}
