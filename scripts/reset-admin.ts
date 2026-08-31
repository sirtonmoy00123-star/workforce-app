import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const envContent = fs.readFileSync('.env.local', 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
  const idx = line.indexOf('=');
  if (idx > 0) env[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
});

const supabase = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

async function main() {
  const { data: users, error: e1 } = await supabase
    .from('users')
    .select('id, username, auth_user_id, role, business_id')
    .eq('role', 'admin')
    .limit(5);

  if (e1) { console.log('Query error:', e1.message); return; }
  console.log('Admin users found:', users?.length);
  users?.forEach(u => console.log(' -', u.username, '|', u.role, '|', u.auth_user_id));

  if (users && users.length > 0) {
    const admin = users[0];
    const { error } = await supabase.auth.admin.updateUserById(admin.auth_user_id, {
      password: process.argv[2] || (() => { throw new Error('Usage: npx ts-node scripts/reset-admin.ts <new-password>'); })()
    });
    if (error) console.log('Reset error:', error.message);
    else console.log('Password reset OK for:', admin.username);
  }
}

main();
