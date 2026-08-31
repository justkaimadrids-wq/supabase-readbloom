import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

type CreateUserRequest = {
  full_name?: string;
  name?: string;
  email?: string;
  password?: string;
  role?: string;
  grade_level?: string;
  gradeLevel?: string;
  section_id?: string;
  sectionId?: string;
  teacher_section_ids?: string[];
  teacherSectionIds?: string[];
};

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

  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
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
    return jsonResponse({ error: 'Only active admins can create accounts.' }, 403);
  }

  let body: CreateUserRequest;
  try {
    body = await req.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const fullName = clean(body.full_name ?? body.name);
  const email = clean(body.email).toLowerCase();
  const password = body.password ?? '';
  const role = clean(body.role).toLowerCase();
  const gradeLevel = clean(body.grade_level ?? body.gradeLevel);
  const sectionId = clean(body.section_id ?? body.sectionId);
  const teacherSectionIds =
    body.teacher_section_ids ?? body.teacherSectionIds ?? [];

  if (!fullName || !email || !password || !role) {
    return jsonResponse(
      { error: 'Full name, email, password, and role are required.' },
      400,
    );
  }

  if (!['student', 'teacher', 'admin'].includes(role)) {
    return jsonResponse({ error: 'Role must be student, teacher, or admin.' }, 400);
  }

  if (role === 'student' && (!gradeLevel || !sectionId)) {
    return jsonResponse(
      { error: 'Student accounts require a grade and section.' },
      400,
    );
  }

  if (role === 'teacher' && teacherSectionIds.length === 0) {
    return jsonResponse(
      { error: 'Teacher accounts require at least one assigned section.' },
      400,
    );
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });

  if (createError || !created.user) {
    return jsonResponse(
      { error: createError?.message ?? 'Unable to create Auth user.' },
      400,
    );
  }

  const newUserId = created.user.id;

  try {
    await insertProfileRows({
      supabase,
      userId: newUserId,
      fullName,
      email,
      role,
      gradeLevel,
      sectionId,
      teacherSectionIds,
    });

    await supabase.from('activity_logs').insert({
      actor_id: caller.id,
      actor_role: 'admin',
      action: 'admin_created_user',
      entity_type: 'profile',
      entity_id: newUserId,
      metadata: {
        actor_name: adminProfile.full_name,
        created_user_name: fullName,
        created_user_email: email,
        created_user_role: role,
      },
    });

    return jsonResponse({
      id: newUserId,
      full_name: fullName,
      email,
      role,
      status: 'active',
    });
  } catch (error) {
    await supabase.auth.admin.deleteUser(newUserId);
    return jsonResponse({ error: errorMessage(error) }, 400);
  }
});

async function insertProfileRows({
  supabase,
  userId,
  fullName,
  email,
  role,
  gradeLevel,
  sectionId,
  teacherSectionIds,
}: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  fullName: string;
  email: string;
  role: string;
  gradeLevel: string;
  sectionId: string;
  teacherSectionIds: string[];
}) {
  const { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    role,
    email,
    full_name: fullName,
    status: 'active',
  });
  if (profileError) throw new Error(profileError.message);

  if (role === 'student') {
    const { data: section, error: sectionError } = await supabase
      .from('sections')
      .select('id,grade_level')
      .eq('id', sectionId)
      .single();
    if (sectionError || !section) throw new Error('Selected section was not found.');
    if (section.grade_level !== gradeLevel) {
      throw new Error('Selected section does not match the selected grade.');
    }

    const { error: studentError } = await supabase.from('student_profiles').insert({
      profile_id: userId,
      grade_level: gradeLevel,
      section_id: sectionId,
    });
    if (studentError) throw new Error(studentError.message);
  }

  if (role === 'teacher') {
    const { data: firstSection, error: sectionError } = await supabase
      .from('sections')
      .select('school_id')
      .eq('id', teacherSectionIds[0])
      .single();
    if (sectionError || !firstSection) {
      throw new Error('Selected teacher section was not found.');
    }

    const { error: teacherError } = await supabase.from('teacher_profiles').insert({
      profile_id: userId,
      school_id: firstSection.school_id,
    });
    if (teacherError) throw new Error(teacherError.message);

    const assignments = teacherSectionIds.map((id) => ({
      teacher_id: userId,
      section_id: id,
    }));
    const { error: assignmentError } = await supabase
      .from('teacher_sections')
      .insert(assignments);
    if (assignmentError) throw new Error(assignmentError.message);
  }
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to create account.';
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
