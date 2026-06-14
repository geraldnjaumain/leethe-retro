import postcss from 'postcss';
import cascadeLayers from '@csstools/postcss-cascade-layers';

const css = '@layer utilities { .foo { color: red; } }';
postcss([cascadeLayers()])
  .process(css, { from: 'style.css' })
  .then(result => console.log(result.css));
