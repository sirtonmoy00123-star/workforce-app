import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
const envContent = fs.readFileSync('.env.local', 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => { const idx = line.indexOf('='); if (idx > 0) env[line.substring(0, idx).trim()] = line.substring(idx + 1).trim(); });
const supabase = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

async function main() {
  const { data, error } = await supabase.from('users').select('id, username, role, is_platform_admin, business_id').limit(15);
  if (error) { console.log('Error:', error.message); return; }
  console.log('All users:');
  data?.forEach(u => console.log(`  ${u.username} | role: ${u.role} | platform: ${u.is_platform_admin} | biz: ${u.business_id}`));
}
main();
