import { createRequire } from 'node:module';
import postcss from 'postcss';
import nested from 'postcss-nested';
import tailwindcss from 'tailwindcss';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);

it('uses patched tooling dependency versions', () => {
  expect(require('@grpc/grpc-js/package.json').version).toBe('1.13.6');
  for (const consumer of ['tailwindcss', 'postcss-nested']) {
    const consumerRequire = createRequire(require.resolve(consumer));
    expect(consumerRequire('postcss-selector-parser/package.json').version).toBe('6.1.5');
  }
});

it('preserves the selector unescape helper consumed directly by Tailwind', () => {
  const tailwindRequire = createRequire(require.resolve('tailwindcss'));
  const unescape = tailwindRequire('postcss-selector-parser/dist/util/unesc');
  expect(unescape('sm\\:hover\\:text-white')).toBe('sm:hover:text-white');
});

it('preserves nested selectors through the PostCSS pipeline', async () => {
  const result = await postcss([nested()]).process('.parent { &:hover { color: red; } > .child { color: blue; } }', { from: undefined });
  expect(result.css).toContain('.parent:hover');
  expect(result.css).toContain('.parent > .child');
});

it('preserves Tailwind responsive/hover/arbitrary variants and apply', async () => {
  const result = await postcss([tailwindcss({
    content: [{ raw: '<div class="sm:hover:text-white [&>span]:text-red-500"></div>', extension: 'html' }],
    corePlugins: { preflight: false },
  })]).process('@tailwind utilities; .applied { @apply text-white; }', { from: undefined });
  expect(result.css).toContain('@media (min-width: 640px)');
  expect(result.css).toContain('.sm\\:hover\\:text-white:hover');
  expect(result.css).toContain('>span');
  expect(result.css).toContain('.applied');
  expect(result.css).toContain('255 255 255');
  expect(result.css).not.toContain('@apply');
});
