import { pool } from './config/db.js';
import { generateEmbedding } from './services/embeddingService.js';
async function test() {
  try {
    const text = 'test text for embedding';
    const emb = await generateEmbedding(text);
    console.log('generated emb length', emb ? emb.length : 'null');
    const q = 'UPDATE profiles SET intent_embedding = COALESCE($1::vector, intent_embedding) WHERE username=\'devimran78\' RETURNING intent_embedding';
    const res = await pool.query(q, [emb ? JSON.stringify(emb) : null]);
    console.log('update res', res.rows[0].intent_embedding ? 'got vector string' : 'null');
    process.exit(0);
  } catch(e) {
    console.error('err', e);
    process.exit(1);
  }
}
test();
