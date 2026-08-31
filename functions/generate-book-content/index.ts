import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

type GenerateRequest = {
  prompt: string;
  gradeLevel: string;
  sectionId: string;
  quizCount: number;
  passageLength: 'short' | 'medium' | 'long';
};

type GeneratedQuestion = {
  questionText: string;
  options: string[];
  correctOptionIndex: number;
};

type GeneratedBookDraft = {
  title: string;
  passageText: string;
  questions: GeneratedQuestion[];
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
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  const geminiModel = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash';

  if (!supabaseUrl || !serviceRoleKey || !geminiApiKey) {
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

  let body: GenerateRequest;
  try {
    body = parseRequest(await req.json());
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role,status')
    .eq('id', caller.id)
    .single();

  if (
    profileError ||
    !profile ||
    profile.role !== 'teacher' ||
    profile.status !== 'active'
  ) {
    return jsonResponse({ error: 'Only active teachers can generate books.' }, 403);
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from('teacher_sections')
    .select('section_id,sections!inner(grade_level)')
    .eq('teacher_id', caller.id)
    .eq('section_id', body.sectionId)
    .eq('sections.grade_level', body.gradeLevel)
    .maybeSingle();

  if (assignmentError || !assignment) {
    return jsonResponse({ error: 'Teacher is not assigned to this section.' }, 403);
  }

  try {
    const generated = await generateWithGemini({
      apiKey: geminiApiKey,
      model: geminiModel,
      request: body,
    });

    try {
      await supabase.from('activity_logs').insert({
        actor_id: caller.id,
        actor_role: 'teacher',
        action: 'teacher.generated_book_draft',
        entity_type: 'book',
        metadata: {
          grade_level: body.gradeLevel,
          section_id: body.sectionId,
          quiz_count: body.quizCount,
          passage_length: body.passageLength,
        },
      });
    } catch (_) {}

    return jsonResponse(generated);
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 500);
  }
});

function parseRequest(raw: unknown): GenerateRequest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid JSON body.');
  }
  const body = raw as Record<string, unknown>;
  const prompt = stringField(body.prompt, 'prompt');
  const gradeLevel = stringField(body.gradeLevel, 'gradeLevel');
  const sectionId = stringField(body.sectionId, 'sectionId');
  const quizCount = Number(body.quizCount);
  const passageLength = stringField(body.passageLength, 'passageLength');

  if (prompt.length > 1000) {
    throw new Error('Prompt must be 1000 characters or fewer.');
  }
  if (!Number.isInteger(quizCount) || quizCount < 1 || quizCount > 3) {
    throw new Error('quizCount must be between 1 and 3.');
  }
  if (!['short', 'medium', 'long'].includes(passageLength)) {
    throw new Error('passageLength must be short, medium, or long.');
  }

  return {
    prompt,
    gradeLevel,
    sectionId,
    quizCount,
    passageLength: passageLength as GenerateRequest['passageLength'],
  };
}

async function generateWithGemini({
  apiKey,
  model,
  request,
}: {
  apiKey: string;
  model: string;
  request: GenerateRequest;
}): Promise<GeneratedBookDraft> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  'You generate child-appropriate reading practice content for ReadBloom.',
                  'Return only valid JSON. Do not include markdown.',
                  'The passage must be suitable for the requested grade level.',
                  'The questions must be answerable from the passage.',
                  'The choices must be clear and age-appropriate.',
                  'Do not include sensitive personal data, violent content, sexual content, profanity, or copyrighted text.',
                  '',
                  `Teacher prompt: ${request.prompt}`,
                  `Grade level: ${request.gradeLevel}`,
                  `Passage length: ${request.passageLength}`,
                  `Number of quiz questions: ${request.quizCount}`,
                  '',
                  'Return JSON using exactly this schema:',
                  '{"title":string,"passageText":string,"questions":[{"questionText":string,"options":string[],"correctOptionIndex":number}]}',
                ].join('\n'),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          response_mime_type: 'application/json',
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini generation failed: ${await response.text()}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? '')
    ?.join('')
    ?.trim();

  if (!text) {
    throw new Error('Gemini returned empty generated content.');
  }

  return validateDraft(JSON.parse(stripJsonFence(text)), request.quizCount);
}

function validateDraft(raw: unknown, expectedQuizCount: number): GeneratedBookDraft {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Generated book content is malformed.');
  }
  const data = raw as Record<string, unknown>;
  const title = stringField(data.title, 'title').slice(0, 160);
  const passageText = stringField(data.passageText, 'passageText');
  const rawQuestions = data.questions;
  if (!Array.isArray(rawQuestions)) {
    throw new Error('Generated questions are malformed.');
  }

  const questions = rawQuestions.slice(0, expectedQuizCount).map((question) => {
    if (!question || typeof question !== 'object') {
      throw new Error('Generated question is malformed.');
    }
    const questionData = question as Record<string, unknown>;
    const questionText = stringField(questionData.questionText, 'questionText');
    const optionsValue = questionData.options;
    if (!Array.isArray(optionsValue)) {
      throw new Error('Generated options are malformed.');
    }
    const options = optionsValue
      .map((option) => String(option).trim())
      .filter(Boolean)
      .slice(0, 4);
    const correctOptionIndex = Number(questionData.correctOptionIndex);
    if (
      options.length < 2 ||
      !Number.isInteger(correctOptionIndex) ||
      correctOptionIndex < 0 ||
      correctOptionIndex >= options.length
    ) {
      throw new Error('Generated quiz answer is invalid.');
    }
    return { questionText, options, correctOptionIndex };
  });

  if (questions.length < 1 || questions.length > 3) {
    throw new Error('Generated quiz count is invalid.');
  }

  return { title, passageText, questions };
}

function stringField(value: unknown, name: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

function stripJsonFence(text: string) {
  return text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to generate book content.';
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
