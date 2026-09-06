import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

/**
 * Phil-IRI (Philippine Informal Reading Inventory) standards & guidelines.
 * Defines grade-specific targets for word count, syntax complexity, vocabulary,
 * and cognitive developmental expectations for elementary English learners.
 */
interface PhilIriGradeRule {
  gradeDisplay: string;
  defaultWordCount: number;
  minWordCount: number;
  maxWordCount: number;
  paragraphCountGuide: string;
  sentenceLengthGuide: string;
  sentenceComplexity: string;
  vocabularyGuidelines: string;
  cognitiveTheme: string;
  behaviorRules: string[];
}

const PHIL_IRI_GRADE_RULES: Record<string, PhilIriGradeRule> = {
  'grade 4': {
    gradeDisplay: 'Grade 4',
    defaultWordCount: 80, // Phil-IRI Grade 4 standard: approximately 80 words (70-95 word range)
    minWordCount: 70,
    maxWordCount: 95,
    paragraphCountGuide: '1 to 2 short paragraphs',
    sentenceLengthGuide: '6 to 10 words per sentence',
    sentenceComplexity:
      'Use short, simple declarative and interrogative sentences (Subject-Verb-Object). Use coordinating conjunctions ("and", "but") sparingly.',
    vocabularyGuidelines:
      'Use high-frequency words (Dolch/Fry list) and concrete nouns. Avoid abstract words, jargon, and complex idioms.',
    cognitiveTheme:
      'Concrete ideas, direct cause-and-effect, chronological sequence, simple dialogue, and familiar everyday themes.',
    behaviorRules: [
      'Strictly maintain length around 80 words (between 70 and 95 words).',
      'Focus on tangible, concrete experiences (home, school, family pets, simple tasks).',
      'Sentences must be concise and easily readable by a beginning intermediate learner.',
      'Incorporate authentic Philippine context naturally (e.g., barangay, ate/kuya, mango tree, slippers, rice meal).',
    ],
  },
  'grade 5': {
    gradeDisplay: 'Grade 5',
    defaultWordCount: 275, // Phil-IRI Grade 5 standard: 250 to 300 words
    minWordCount: 240,
    maxWordCount: 310,
    paragraphCountGuide: '2 to 3 well-developed paragraphs',
    sentenceLengthGuide: '10 to 15 words per sentence',
    sentenceComplexity:
      'Introduce moderate complexity: compound sentences with coordinating conjunctions ("and", "but", "so") and simple complex sentences using "because", "when", "if", or "although".',
    vocabularyGuidelines:
      'Use descriptive adjectives, sensory adverbs, common Filipino idioms/expressions, and basic figurative expressions (e.g., similes using "as" or "like").',
    cognitiveTheme:
      'Moderate complexity, descriptive situations, character feelings, community cooperation (Bayanihan), and basic problem-solution scenarios.',
    behaviorRules: [
      'Maintain length strictly between 250 and 300 words.',
      'Develop 2 to 3 cohesive paragraphs with clear topic progression.',
      'Use vivid sensory descriptions and relatable character dialogue.',
      'Feature authentic Philippine settings (e.g., provincial town, school vegetable garden, community fiesta, typhoon preparation).',
    ],
  },
  'grade 6': {
    gradeDisplay: 'Grade 6',
    defaultWordCount: 225, // Phil-IRI Grade 6 standard: 150 to 300 words
    minWordCount: 150,
    maxWordCount: 300,
    paragraphCountGuide: '3 to 4 structured paragraphs (introduction, body, conclusion)',
    sentenceLengthGuide: '12 to 18 words per sentence',
    sentenceComplexity:
      'Allow more complex structures: compound-complex sentences, subordinate clauses, participial phrases, and transitional adverbs ("furthermore", "consequently", "on the other hand").',
    vocabularyGuidelines:
      'Richer academic and domain vocabulary, contextual context clues, figurative expressions (metaphors, personification, proverbs).',
    cognitiveTheme:
      'Abstract ideas, ethical decisions, historical or environmental awareness, community responsibility, and deeper inferential reasoning.',
    behaviorRules: [
      'Maintain length strictly between 150 and 300 words.',
      'Develop cohesive paragraphs with clear transitions and thematic depth.',
      'Challenge students to reflect on decisions, social empathy, or scientific curiosity.',
      'Incorporate rich Philippine heritage, nature, historical landmarks, or contemporary Filipino youth experiences.',
    ],
  },
};

/**
 * Child-safety restricted words & sensitive terms for elementary reading content.
 * Enforces zero-tolerance for profanity, insults, violence, substances, sexual themes,
 * and gambling in reading materials for students.
 */
const RESTRICTED_WORDS: readonly string[] = [
  // Profanity & Vulgarity
  'fuck',
  'fucking',
  'fucker',
  'shit',
  'shitty',
  'bitch',
  'bastard',
  'asshole',
  'cunt',
  'dick',
  'pussy',
  'cock',
  'slut',
  'whore',
  'damn',
  'dammit',
  'crap',
  'bullshit',

  // Insults, Slurs & Bullying
  'retard',
  'idiot',
  'moron',
  'imbecile',
  'stupid',
  'dumb',
  'loser',

  // Violence, Self-Harm, Weapons & Gore
  'suicide',
  'kill',
  'killing',
  'killer',
  'murder',
  'murderer',
  'murdering',
  'slaughter',
  'decapitate',
  'behead',
  'stab',
  'stabbing',
  'stabbed',
  'knife',
  'gun',
  'guns',
  'pistol',
  'rifle',
  'shotgun',
  'firearm',
  'weapon',
  'weapons',
  'bullet',
  'bullets',
  'blood',
  'bloody',
  'bloodshed',
  'gore',
  'gory',
  'corpse',

  // Drugs, Alcohol, Tobacco & Vices
  'marijuana',
  'weed',
  'cannabis',
  'cocaine',
  'heroin',
  'meth',
  'methamphetamine',
  'narcotics',
  'illegal drugs',
  'beer',
  'wine',
  'liquor',
  'whiskey',
  'vodka',
  'alcohol',
  'alcoholic',
  'drunk',
  'drunken',
  'hangover',
  'cigarette',
  'cigarettes',
  'tobacco',
  'vape',
  'vaping',
  'e-cigarette',
  'gambling',
  'casino',

  // Sexual, Adult & Explicit Content
  'sex',
  'sexual',
  'sexuality',
  'sexy',
  'porn',
  'pornography',
  'nude',
  'nudity',
  'naked',
  'erotic',
  'rape',
  'rapist',
  'molest',
  'molestation',
];

/**
 * Scans text for any child-safety restricted word using boundary-aware regex.
 * Returns the matched word pattern if found, or null if safe.
 */
function findRestrictedWord(text: string): string | null {
  if (!text || typeof text !== 'string') return null;
  const normalized = text.toLowerCase();
  for (const pattern of RESTRICTED_WORDS) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9_])${escaped}(?:$|[^a-zA-Z0-9_])`, 'i');
    if (regex.test(normalized)) {
      return pattern;
    }
  }
  return null;
}

type GenerateRequest = {
  prompt: string;
  gradeLevel: string;
  sectionId: string;
  quizCount: number;
  passageLength: 'short' | 'medium' | 'long';
  customWordLimit?: number;
  philIriConfig?: {
    customWordLimit?: number;
    passageType?: 'narrative' | 'expository';
    genreFocus?: string;
  };
};

type GeneratedQuestion = {
  questionText: string;
  options: string[];
  correctOptionIndex: number;
  type?: 'literal' | 'inferential' | 'critical';
};

type GeneratedBookDraft = {
  title: string;
  passageText: string;
  wordCount: number;
  gradeLevel: string;
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
          actual_word_count: generated.wordCount,
          phil_iri_grade: generated.gradeLevel,
          phil_iri_aligned: true,
        },
      });
    } catch (_) { }

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

  const restrictedPromptWord = findRestrictedWord(prompt);
  if (restrictedPromptWord) {
    throw new Error(
      `The prompt contains restricted content ("${restrictedPromptWord}") not suitable for elementary students.`,
    );
  }
  if (!Number.isInteger(quizCount) || quizCount < 1 || quizCount > 3) {
    throw new Error('quizCount must be between 1 and 3.');
  }
  if (!['short', 'medium', 'long'].includes(passageLength)) {
    throw new Error('passageLength must be short, medium, or long.');
  }

  let customWordLimit: number | undefined;
  if (typeof body.customWordLimit === 'number' && body.customWordLimit > 0) {
    customWordLimit = Number(body.customWordLimit);
  } else if (typeof body.targetWordCount === 'number' && body.targetWordCount > 0) {
    customWordLimit = Number(body.targetWordCount);
  }

  let philIriConfig: GenerateRequest['philIriConfig'];
  if (body.philIriConfig && typeof body.philIriConfig === 'object') {
    const pConfig = body.philIriConfig as Record<string, unknown>;
    const limit = typeof pConfig.customWordLimit === 'number' && pConfig.customWordLimit > 0
      ? Number(pConfig.customWordLimit)
      : customWordLimit;
    const passageType = pConfig.passageType === 'expository' ? 'expository' : 'narrative';
    const genreFocus = typeof pConfig.genreFocus === 'string' ? pConfig.genreFocus : undefined;
    philIriConfig = { customWordLimit: limit, passageType, genreFocus };
  }

  return {
    prompt,
    gradeLevel,
    sectionId,
    quizCount,
    passageLength: passageLength as GenerateRequest['passageLength'],
    customWordLimit,
    philIriConfig,
  };
}

function resolvePhilIriTarget(
  rawGrade: string,
  passageLength: 'short' | 'medium' | 'long',
  customLimit?: number,
) {
  const normalized = rawGrade.toLowerCase().trim();
  let rule = PHIL_IRI_GRADE_RULES['grade 4'];

  if (normalized.includes('6')) {
    rule = PHIL_IRI_GRADE_RULES['grade 6'];
  } else if (normalized.includes('5')) {
    rule = PHIL_IRI_GRADE_RULES['grade 5'];
  } else if (normalized.includes('4')) {
    rule = PHIL_IRI_GRADE_RULES['grade 4'];
  }

  let targetWords = rule.defaultWordCount;
  let minWords = rule.minWordCount;
  let maxWords = rule.maxWordCount;

  // If a custom word limit is explicitly provided, it serves as the target ceiling
  if (typeof customLimit === 'number' && customLimit > 0) {
    const clamped = Math.min(Math.max(50, customLimit), 450);
    targetWords = clamped;
    minWords = Math.max(50, Math.floor(clamped * 0.85));
    maxWords = Math.floor(clamped * 1.15);
  } else {
    // Nuance within Phil-IRI standard boundaries based on teacher selection
    if (passageLength === 'short') {
      targetWords = Math.round(minWords + (targetWords - minWords) * 0.4);
    } else if (passageLength === 'long') {
      targetWords = Math.round(targetWords + (maxWords - targetWords) * 0.75);
    }
  }

  return {
    rule,
    targetWords,
    minWords,
    maxWords,
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
  const customLimit = request.philIriConfig?.customWordLimit ?? request.customWordLimit;
  const config = resolvePhilIriTarget(
    request.gradeLevel,
    request.passageLength,
    customLimit,
  );
  const rule = config.rule;

  const promptText = [
    'You are an expert reading curriculum developer in the Philippines creating child-appropriate reading passages and comprehension quizzes.',
    'You must strictly follow the Philippine Informal Reading Inventory (Phil-IRI) standards for elementary reading assessment.',
    '',
    `=== TARGET LEARNER LEVEL: ${rule.gradeDisplay} ===`,
    `Behavior & Readability Rules:`,
    `- Length Requirement: Exactly between ${config.minWords} and ${config.maxWords} words (Target: approximately ${config.targetWords} words). Do not exceed ${config.maxWords} words.`,
    `- Paragraph Structure: ${rule.paragraphCountGuide}.`,
    `- Sentence Structure: ${rule.sentenceComplexity} (Target sentence length: ${rule.sentenceLengthGuide}).`,
    `- Vocabulary Rules: ${rule.vocabularyGuidelines}.`,
    `- Cognitive Theme: ${rule.cognitiveTheme}.`,
    ...rule.behaviorRules.map((r) => `- ${r}`),
    '',
    `=== PHILIPPINE CULTURAL CONTEXT & EDUCATIONAL VALUES ===`,
    '- Set the story or passage naturally in an authentic Philippine context (e.g., local barangay, community garden, public elementary school, rural farming village, coastal town, or family gathering).',
    '- Highlight positive Filipino values such as Bayanihan (unity/helping one another), respect for elders (using "po/opo", pagmamano), sibling care (Ate/Kuya), perseverance, and care for nature.',
    '- Use authentic, relatable Filipino character names (e.g., Lito, Maya, Mateo, Aling Rosa, Mang Jose).',
    '- Keep content wholesome, educational, safe, and free from violence, sensitive issues, product brands, or copyrighted text.',
    '',
    `=== STRICT CHILD SAFETY & PROHIBITED CONTENT ===`,
    '- The target readers are elementary school children (Grades 4-6). You must uphold zero tolerance for inappropriate content.',
    '- ABSOLUTELY NO profanity, swear words, vulgar slang, or obscenity (e.g., no "damn", "shit", "bitch", "idiot", "stupid", etc.).',
    '- ABSOLUTELY NO depictions or mentions of violence, physical harm, weapons (guns, knives), blood, gore, murder, death, or bullying.',
    '- ABSOLUTELY NO references to alcohol (beer, wine, liquor), illegal drugs, tobacco, cigarettes, vaping, or gambling.',
    '- ABSOLUTELY NO romantic, sexual, adult, or mature content.',
    '- Content must be 100% wholesome, emotionally uplifting, safe, and supportive of young readers.',
    '',
    `=== COMPREHENSION QUIZ RULES (${request.quizCount} Questions) ===`,
    'Formulate multiple-choice questions aligned with Phil-IRI cognitive question typologies:',
    ...(request.quizCount >= 1
      ? ['- Question 1: Literal (direct recall of factual information explicitly stated in the text - who, what, where, when).']
      : []),
    ...(request.quizCount >= 2
      ? ['- Question 2: Inferential (reading between the lines - character motivation, cause-and-effect, feelings, or implied meaning).']
      : []),
    ...(request.quizCount >= 3
      ? ['- Question 3: Critical/Applied (evaluative thinking - judging a character\'s decision, practical life application, or moral lesson).']
      : []),
    'Each question must have exactly 4 clear options (A, B, C, D) with plausible distractors and exactly 1 correct answer index (0, 1, 2, or 3).',
    '',
    `=== TEACHER INPUT ===`,
    `Teacher Topic/Prompt: "${request.prompt}"`,
    `Grade Level: ${rule.gradeDisplay}`,
    `Passage Length Setting: ${request.passageLength} (Target: ~${config.targetWords} words)`,
    `Desired Quiz Questions: ${request.quizCount}`,
    '',
    'Return ONLY valid JSON matching this structure without markdown fences:',
    '{"title":string,"passageText":string,"questions":[{"questionText":string,"options":[string,string,string,string],"correctOptionIndex":number,"type":"literal"|"inferential"|"critical"}]}',
  ].join('\n');

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
            parts: [{ text: promptText }],
          },
        ],
        generationConfig: {
          temperature: 0.35,
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

  return validateDraft(
    JSON.parse(stripJsonFence(text)),
    request.quizCount,
    rule.gradeDisplay,
  );
}

function validateDraft(
  raw: unknown,
  expectedQuizCount: number,
  gradeDisplay: string,
): GeneratedBookDraft {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Generated book content is malformed.');
  }
  const data = raw as Record<string, unknown>;
  const title = stringField(data.title, 'title').slice(0, 160);
  const passageText = stringField(data.passageText, 'passageText');

  // Compute actual word count
  const words = passageText.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const rawQuestions = data.questions;
  if (!Array.isArray(rawQuestions)) {
    throw new Error('Generated questions are malformed.');
  }

  const questions: GeneratedQuestion[] = rawQuestions
    .slice(0, expectedQuizCount)
    .map((question, index) => {
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

      let qType: 'literal' | 'inferential' | 'critical' = 'literal';
      if (index === 1) qType = 'inferential';
      if (index === 2) qType = 'critical';
      if (
        questionData.type === 'literal' ||
        questionData.type === 'inferential' ||
        questionData.type === 'critical'
      ) {
        qType = questionData.type;
      }

      return {
        questionText,
        options,
        correctOptionIndex,
        type: qType,
      };
    });

  if (questions.length < 1 || questions.length > 3) {
    throw new Error('Generated quiz count is invalid.');
  }

  // Verify that generated content does not contain any restricted words
  const safetyChecks: { field: string; text: string }[] = [
    { field: 'title', text: title },
    { field: 'passage', text: passageText },
  ];
  for (const q of questions) {
    safetyChecks.push({ field: 'question', text: q.questionText });
    for (const opt of q.options) {
      safetyChecks.push({ field: 'quiz option', text: opt });
    }
  }

  for (const check of safetyChecks) {
    const matched = findRestrictedWord(check.text);
    if (matched) {
      throw new Error(
        `Generated content contains restricted word ("${matched}") not suitable for students. Please try a different topic.`,
      );
    }
  }

  return {
    title,
    passageText,
    wordCount,
    gradeLevel: gradeDisplay,
    questions,
  };
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
