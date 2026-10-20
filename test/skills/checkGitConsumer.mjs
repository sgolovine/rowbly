import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
assert(dir, 'pass the consumer fixture directory');
const json = (path) => JSON.parse(readFileSync(join(dir, '.rowbly', path), 'utf8'));
assert.equal(json('rowbly.config.json').plugins.git.enabled, true);
assert.deepEqual(json('local.json').plugins.git, {
  frequency: 'interval',
  intervalSeconds: 600,
  authorName: 'Rowbly Bot',
  authorEmail: 'bot@example.com',
});
const stories = readdirSync(join(dir, '.rowbly/boards/web/stories')).map((key) =>
  json(`boards/web/stories/${key}/story.json`),
);
assert.equal(stories.filter((story) => story.name === 'Consumer Git check').length, 1);
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
assert.equal(git('rev-list', '--count', 'HEAD'), '1', 'interval mode must leave the baseline as HEAD');
assert.equal(git('diff', '--cached', '--name-only'), 'unrelated.txt');
assert.equal(git('show', ':unrelated.txt'), 'Keep this staged, outside automatic commits.');
assert.equal(git('ls-files', '--', '.rowbly/local.json'), '');
console.log('Git consumer task passed');
