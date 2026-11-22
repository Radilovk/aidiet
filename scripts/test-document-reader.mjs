#!/usr/bin/env node
/** document-reader.js: заявката към Claude (модел, PDF/снимка, JSON по схема, резервен модел) и отговорът. Без мрежа. */
import assert from 'node:assert/strict';
import { readLabsWithClaude, assessDocumentWithClaude, READER_MODEL, claudeReaderAvailable } from '../document-reader.js';

let last;
const fake = (reply, stop = 'end_turn') => ({ beta: { messages: { stream: (req) => { last = req; return { finalMessage: async () => ({
  stop_reason: stop, usage: { input_tokens: 1000, output_tokens: 200 }, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(reply) }] }) }; } } } });
let n = 0; const ok = async (name, f) => { await f(); n++; console.log('✅', name); };

await ok('без ключ — не е наличен (минава се на досегашния път)', async () => {
  assert.equal(claudeReaderAvailable({}), false); assert.equal(claudeReaderAvailable({ ANTHROPIC_API_KEY: 'x' }), true);
});
await ok('PDF се праща като document, а снимката — като image; модел, схема, резервен модел', async () => {
  const { result, usd } = await readLabsWithClaude({}, { prompt: 'p', base64: 'AAA', mimeType: 'application/pdf', client: fake({ date: null, markers: [] }) });
  assert.deepEqual(result, { date: null, markers: [] });
  assert.equal(last.model, READER_MODEL); assert.equal(last.messages[0].content[0].type, 'document');
  assert.equal(last.output_config.format.type, 'json_schema'); assert.equal(last.fallbacks, 'default');
  assert.ok(Math.abs(usd - 0.008) < 1e-9);
  await readLabsWithClaude({}, { prompt: 'p', base64: 'AAA', mimeType: 'image/png', client: fake({ date: null, markers: [] }) });
  assert.equal(last.messages[0].content[0].type, 'image'); assert.equal(last.messages[0].content[0].source.media_type, 'image/png');
});
await ok('документ като текст — без файл', async () => {
  await assessDocumentWithClaude({}, { prompt: 'текст', client: fake({ relevant: true }) });
  assert.equal(last.messages[0].content.length, 1); assert.equal(last.messages[0].content[0].type, 'text');
  assert.ok(last.output_config.format.schema.required.includes('impact'));
});
await ok('отказ или прекъсване → грешка (извикващият минава на резервния път)', async () => {
  await assert.rejects(readLabsWithClaude({}, { prompt: 'p', client: fake({}, 'refusal') }));
  await assert.rejects(readLabsWithClaude({}, { prompt: 'p', client: fake({}, 'max_tokens') }));
});
console.log(`\nВсички ${n} проверки минаха`);
