import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing required Edge Function secrets.' }, 500);
  }

  const jwt = (req.headers.get('authorization') ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!jwt) {
    return jsonResponse({ error: 'Missing authorization token.' }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  const caller = userData.user;
  if (userError || !caller) {
    return jsonResponse({ error: 'Invalid authorization token.' }, 401);
  }

  const { data: adminProfile, error: adminError } = await supabase
    .from('profiles')
    .select('id,role,status,full_name')
    .eq('id', caller.id)
    .single();

  if (
    adminError ||
    !adminProfile ||
    adminProfile.role !== 'admin' ||
    adminProfile.status !== 'active'
  ) {
    return jsonResponse({ error: 'Only active admins can delete accounts.' }, 403);
  }

  let userId = '';
  try {
    const body = await req.json();
    userId =
      typeof body.user_id === 'string'
        ? body.user_id.trim()
        : typeof body.userId === 'string'
        ? body.userId.trim()
        : '';
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  if (!userId) {
    return jsonResponse({ error: 'user_id is required.' }, 400);
  }

  if (userId === caller.id) {
    return jsonResponse({ error: 'Admins cannot delete their own account.' }, 400);
  }

  const { data: target, error: targetError } = await supabase
    .from('profiles')
    .select('id,email,full_name,role')
    .eq('id', userId)
    .single();

  if (targetError || !target) {
    return jsonResponse({ error: 'Account was not found.' }, 404);
  }

  if (!['student', 'teacher'].includes(target.role)) {
    return jsonResponse(
      { error: 'Only student and teacher accounts can be deleted here.' },
      400,
    );
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
  if (deleteError) {
    return jsonResponse({ error: deleteError.message }, 400);
  }

  await supabase.from('activity_logs').insert({
    actor_id: caller.id,
    actor_role: 'admin',
    action: 'admin_deleted_user',
    entity_type: 'profile',
    entity_id: userId,
    metadata: {
      actor_name: adminProfile.full_name,
      deleted_user_name: target.full_name,
      deleted_user_email: target.email,
      deleted_user_role: target.role,
    },
  });

  return jsonResponse({ success: true });
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
