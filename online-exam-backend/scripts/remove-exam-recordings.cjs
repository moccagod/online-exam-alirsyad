// Run only after the backend upload endpoint has been removed in production.
// Preview: node scripts/remove-exam-recordings.cjs
// Delete:  node scripts/remove-exam-recordings.cjs --execute
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const bucket = 'exam-recordings';
const execute = process.argv.includes('--execute');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL dan service role key diperlukan');
if (execute && process.env.RECORDING_CLEANUP_CONFIRM !== bucket) {
  throw new Error(`Set RECORDING_CLEANUP_CONFIRM=${bucket} sebelum penghapusan`);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function listAll(prefix = '') {
  const paths = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 1000, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    for (const item of data || []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) paths.push(path);
      else paths.push(...await listAll(path));
    }
    if (!data || data.length < 1000) break;
  }
  return paths;
}

async function main() {
  const { data: existing, error: bucketError } = await supabase.storage.getBucket(bucket);
  if (bucketError) throw bucketError;
  if (!existing) throw new Error('Bucket rekaman tidak ditemukan');
  const paths = await listAll();
  console.log(`${paths.length} objek rekaman ditemukan di ${bucket}.`);
  if (!execute) {
    console.log('Pratinjau saja. Tidak ada objek yang dihapus.');
    return;
  }
  for (let index = 0; index < paths.length; index += 1000) {
    const batch = paths.slice(index, index + 1000);
    const { error } = await supabase.storage.from(bucket).remove(batch);
    if (error) throw error;
    console.log(`${Math.min(index + batch.length, paths.length)}/${paths.length} objek dihapus.`);
  }
  const remaining = await listAll();
  if (remaining.length) throw new Error(`${remaining.length} objek masih ada; bucket tidak dihapus`);
  const { error: deleteError } = await supabase.storage.deleteBucket(bucket);
  if (deleteError) throw deleteError;
  console.log('Bucket rekaman dihapus. Terapkan migrasi penghapusan kolom setelah ini.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
