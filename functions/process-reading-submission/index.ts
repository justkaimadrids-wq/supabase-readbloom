import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

type SubmissionRow = {
  id: string;
  student_id: string;
  video_path: string | null;
  audio_path: string | null;
  passage_text_snapshot: string;
};

type AlignmentToken = {
  expected: string | null;
  spoken: string | null;
  expectedIndex: number | null;
  spokenIndex: number | null;
  status: 'match' | 'missing' | 'extra' | 'substituted';
};

type RemarkKey = 'omission' | 'repetition' | 'selfCorrection' | 'mispronunciation';

type RemarkSuggestion = {
  label: string;
  count: number;
  transcriptIndexes: number[];
  expectedIndexes: number[];
  words: string[];
  confidence: 'high' | 'medium' | 'low';
};

type SuggestedReadingRemarks = {
  version: 1 | 2;
  source: 'deterministic_alignment' | 'deterministic_alignment_with_ai_review';
  remarks: Record<RemarkKey, RemarkSuggestion>;
  review?: {
    aiProvider: string;
    aiModel: string;
    deterministicFallbackUsed: boolean;
    error?: string;
  };
};

type AlignmentResult = {
  tokens: AlignmentToken[];
  matchCount: number;
  missingCount: number;
  extraCount: number;
  substitutionCount: number;
  overallAccuracy: number;
  normalizedExpected: string;
  normalizedTranscript: string;
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

  let submissionId = '';
  try {
    const body = await req.json();
    submissionId = typeof body.submission_id === 'string'
      ? body.submission_id
      : typeof body.submissionId === 'string'
      ? body.submissionId
      : '';
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  if (!submissionId) {
    return jsonResponse({ error: 'submission_id is required.' }, 400);
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role,status')
      .eq('id', caller.id)
      .single();

    if (profileError || !profile || profile.status !== 'active') {
      return jsonResponse({ error: 'Account is not active.' }, 403);
    }

    const { data: submissionData, error: submissionError } = await supabase
      .from('reading_submissions')
      .select('id,student_id,video_path,audio_path,passage_text_snapshot')
      .eq('id', submissionId)
      .single();
    const submission = submissionData as SubmissionRow | null;

    if (submissionError || !submission) {
      return jsonResponse({ error: 'Reading submission was not found.' }, 404);
    }

    if (profile.role !== 'admin' && submission.student_id !== caller.id) {
      return jsonResponse({ error: 'Not allowed to process this submission.' }, 403);
    }

    await supabase
      .from('reading_submissions')
      .update({ status: 'processing' })
      .eq('id', submission.id);

    const mediaPath = submission.audio_path ?? submission.video_path;
    const bucket = submission.audio_path ? 'reading-audio' : 'reading-videos';
    if (!mediaPath) {
      throw new Error('Submission has no media path.');
    }

    const { data: mediaBlob, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(mediaPath);

    if (downloadError || !mediaBlob) {
      throw new Error(downloadError?.message ?? 'Unable to download recording.');
    }

    const mimeType = mediaBlob.type || mimeTypeForPath(mediaPath);
    const mediaBytes = new Uint8Array(await mediaBlob.arrayBuffer());
    const transcript = await transcribeWithGemini({
      apiKey: geminiApiKey,
      model: geminiModel,
      mimeType,
      displayName: `readbloom-${submission.id}`,
      mediaBytes,
    });

    const alignment = alignTranscript(
      submission.passage_text_snapshot,
      transcript,
    );
    const deterministicRemarks = detectReadingRemarks(alignment);
    const suggestedRemarks = await maybeReviewRemarksWithGemini({
      apiKey: geminiApiKey,
      model: geminiModel,
      passageText: submission.passage_text_snapshot,
      transcript,
      alignment,
      deterministicRemarks,
    });

    await supabase.from('transcript_results').upsert(
      {
        submission_id: submission.id,
        raw_transcript: transcript,
        normalized_transcript: alignment.normalizedTranscript,
        normalized_expected_text: alignment.normalizedExpected,
        alignment_json: {
          tokens: alignment.tokens,
          suggestedRemarks,
          generated_at: new Date().toISOString(),
        },
        match_count: alignment.matchCount,
        missing_count: alignment.missingCount,
        extra_count: alignment.extraCount,
        substitution_count: alignment.substitutionCount,
        overall_accuracy: alignment.overallAccuracy,
        suggested_remarks_json: suggestedRemarks,
        suggested_omission_count:
          suggestedRemarks.remarks.omission.count,
        suggested_repetition_count:
          suggestedRemarks.remarks.repetition.count,
        suggested_self_correction_count:
          suggestedRemarks.remarks.selfCorrection.count,
        suggested_mispronunciation_count:
          suggestedRemarks.remarks.mispronunciation.count,
        processing_provider: 'google_ai_studio',
        processing_model: geminiModel,
        processing_error: null,
      },
      { onConflict: 'submission_id' },
    );

    await supabase
      .from('reading_submissions')
      .update({ status: 'processed' })
      .eq('id', submission.id);

    try {
      await supabase.from('activity_logs').insert({
        actor_id: submission.student_id,
        actor_role: 'student',
        action: 'student.reading_processed',
        entity_type: 'reading_submission',
        entity_id: submission.id,
        metadata: {
          provider: 'google_ai_studio',
          model: geminiModel,
          match_count: alignment.matchCount,
          missing_count: alignment.missingCount,
          extra_count: alignment.extraCount,
          substitution_count: alignment.substitutionCount,
          overall_accuracy: alignment.overallAccuracy,
          suggested_omission_count:
            suggestedRemarks.remarks.omission.count,
          suggested_repetition_count:
            suggestedRemarks.remarks.repetition.count,
          suggested_self_correction_count:
            suggestedRemarks.remarks.selfCorrection.count,
          suggested_mispronunciation_count:
            suggestedRemarks.remarks.mispronunciation.count,
        },
      });
    } catch (_) {}

    return jsonResponse({
      submission_id: submission.id,
      status: 'processed',
      transcript,
      summary: {
        match_count: alignment.matchCount,
        missing_count: alignment.missingCount,
        extra_count: alignment.extraCount,
        substitution_count: alignment.substitutionCount,
        overall_accuracy: alignment.overallAccuracy,
      },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Unable to process reading submission.';

    await supabase.from('transcript_results').upsert(
      {
        submission_id: submissionId,
        raw_transcript: null,
        normalized_transcript: null,
        normalized_expected_text: null,
        alignment_json: null,
        processing_provider: 'google_ai_studio',
        processing_model: geminiModel,
        processing_error: message,
      },
      { onConflict: 'submission_id' },
    );

    await supabase
      .from('reading_submissions')
      .update({ status: 'failed' })
      .eq('id', submissionId);

    return jsonResponse({ error: message }, 500);
  }
});

async function transcribeWithGemini({
  apiKey,
  model,
  mimeType,
  displayName,
  mediaBytes,
}: {
  apiKey: string;
  model: string;
  mimeType: string;
  displayName: string;
  mediaBytes: Uint8Array;
}): Promise<string> {
  const maxInlineBytes = Number(
    Deno.env.get('GEMINI_MAX_INLINE_BYTES') ?? '15000000',
  );
  const mediaPart = mediaBytes.byteLength <= maxInlineBytes
    ? {
      inline_data: {
        mime_type: mimeType,
        data: bytesToBase64(mediaBytes),
      },
    }
    : await uploadGeminiFile({
      apiKey,
      mimeType,
      displayName,
      mediaBytes,
    });

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
              mediaPart,
              {
                text:
                  'Transcribe this student reading recording as accurately as possible. Return only the spoken words as plain text. Do not add explanations, labels, timestamps, punctuation commentary, or corrections.',
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini transcription failed: ${errorText}`);
  }

  const payload = await response.json();
  const textParts = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? '')
    ?.join(' ')
    ?.trim();

  if (!textParts) {
    throw new Error('Gemini returned an empty transcript.');
  }

  return textParts;
}

async function uploadGeminiFile({
  apiKey,
  mimeType,
  displayName,
  mediaBytes,
}: {
  apiKey: string;
  mimeType: string;
  displayName: string;
  mediaBytes: Uint8Array;
}) {
  const startResponse = await fetch(
    'https://generativelanguage.googleapis.com/upload/v1beta/files',
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(mediaBytes.byteLength),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: {
          display_name: displayName,
        },
      }),
    },
  );

  if (!startResponse.ok) {
    throw new Error(
      `Gemini file upload start failed: ${await startResponse.text()}`,
    );
  }

  const uploadUrl = startResponse.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini file upload did not return an upload URL.');
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(mediaBytes.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: mediaBytes,
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Gemini file upload failed: ${await uploadResponse.text()}`,
    );
  }

  const payload = await uploadResponse.json();
  const fileName = payload?.file?.name;
  const activeFile = await waitForGeminiFileActive({
    apiKey,
    fileName,
  });
  const fileUri = activeFile?.uri ?? payload?.file?.uri;
  const fileMimeType = activeFile?.mimeType ?? payload?.file?.mimeType ?? mimeType;
  if (!fileUri) {
    throw new Error('Gemini file upload did not return a file URI.');
  }

  return {
    file_data: {
      mime_type: fileMimeType,
      file_uri: fileUri,
    },
  };
}

async function waitForGeminiFileActive({
  apiKey,
  fileName,
}: {
  apiKey: string;
  fileName: string | undefined;
}) {
  if (!fileName) {
    throw new Error('Gemini file upload did not return a file name.');
  }

  const maxAttempts = Number(
    Deno.env.get('GEMINI_FILE_ACTIVE_MAX_ATTEMPTS') ?? '20',
  );
  const delayMs = Number(
    Deno.env.get('GEMINI_FILE_ACTIVE_POLL_DELAY_MS') ?? '1500',
  );

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}`,
      {
        headers: {
          'x-goog-api-key': apiKey,
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Gemini file status check failed: ${await response.text()}`,
      );
    }

    const payload = await response.json();
    const file = payload?.file ?? payload;
    const state = file?.state;
    if (state === 'ACTIVE') return file;
    if (state === 'FAILED') {
      throw new Error('Gemini file processing failed.');
    }

    await sleep(delayMs);
  }

  throw new Error('Gemini file did not become active in time.');
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function alignTranscript(expectedText: string, transcript: string): AlignmentResult {
  const expected = normalizeWords(expectedText);
  const spoken = normalizeWords(transcript);
  const dp = buildEditDistanceMatrix(expected, spoken);
  const tokens: AlignmentToken[] = [];

  let i = expected.length;
  let j = spoken.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expected[i - 1] === spoken[j - 1]) {
      tokens.push({
        expected: expected[i - 1],
        spoken: spoken[j - 1],
        expectedIndex: i - 1,
        spokenIndex: j - 1,
        status: 'match',
      });
      i--;
      j--;
      continue;
    }

    if (
      i > 0 &&
      j > 0 &&
      dp[i][j] === dp[i - 1][j - 1] + 1
    ) {
      tokens.push({
        expected: expected[i - 1],
        spoken: spoken[j - 1],
        expectedIndex: i - 1,
        spokenIndex: j - 1,
        status: 'substituted',
      });
      i--;
      j--;
      continue;
    }

    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      tokens.push({
        expected: expected[i - 1],
        spoken: null,
        expectedIndex: i - 1,
        spokenIndex: nearestSpokenIndex(j, spoken.length),
        status: 'missing',
      });
      i--;
      continue;
    }

    tokens.push({
      expected: null,
      spoken: spoken[j - 1],
      expectedIndex: nearestExpectedIndex(i, expected.length),
      spokenIndex: j - 1,
      status: 'extra',
    });
    j--;
  }

  tokens.reverse();

  const matchCount = tokens.filter((token) => token.status === 'match').length;
  const missingCount = tokens.filter((token) => token.status === 'missing').length;
  const extraCount = tokens.filter((token) => token.status === 'extra').length;
  const substitutionCount = tokens.filter((token) =>
    token.status === 'substituted'
  ).length;

  return {
    tokens,
    matchCount,
    missingCount,
    extraCount,
    substitutionCount,
    overallAccuracy: expected.length === 0 ? 0 : matchCount / expected.length,
    normalizedExpected: expected.join(' '),
    normalizedTranscript: spoken.join(' '),
  };
}

function detectReadingRemarks(alignment: AlignmentResult): SuggestedReadingRemarks {
  const suggestions: SuggestedReadingRemarks = {
    version: 1,
    source: 'deterministic_alignment',
    remarks: {
      omission: emptySuggestion('Omission', 'high'),
      repetition: emptySuggestion('Repetition', 'medium'),
      selfCorrection: emptySuggestion('Self-Correction', 'medium'),
      mispronunciation: emptySuggestion('Possible Mispronunciation', 'low'),
    },
  };

  const spokenTokens = alignment.tokens
    .filter((token) => token.spoken !== null && token.spokenIndex !== null)
    .sort((a, b) => (a.spokenIndex ?? 0) - (b.spokenIndex ?? 0));

  for (const token of alignment.tokens) {
    if (token.status === 'missing' && token.expected) {
      addSuggestion(suggestions.remarks.omission, {
        word: token.expected,
        transcriptIndex: token.spokenIndex,
        expectedIndex: token.expectedIndex,
      });
    }
  }

  for (let index = 1; index < spokenTokens.length; index++) {
    const previous = spokenTokens[index - 1];
    const current = spokenTokens[index];
    if (previous.spoken && current.spoken && previous.spoken === current.spoken) {
      addSuggestion(suggestions.remarks.repetition, {
        word: current.spoken,
        transcriptIndex: current.spokenIndex,
        expectedIndex: current.expectedIndex,
      });
    }
  }

  for (const phraseLength of [4, 3, 2]) {
    for (let index = phraseLength; index + phraseLength <= spokenTokens.length; index++) {
      const previousPhrase = spokenTokens
        .slice(index - phraseLength, index)
        .map((token) => token.spoken)
        .join(' ');
      const currentPhrase = spokenTokens
        .slice(index, index + phraseLength)
        .map((token) => token.spoken)
        .join(' ');
      if (previousPhrase && previousPhrase === currentPhrase) {
        for (const token of spokenTokens.slice(index, index + phraseLength)) {
          if (token.spoken) {
            addSuggestion(suggestions.remarks.repetition, {
              word: token.spoken,
              transcriptIndex: token.spokenIndex,
              expectedIndex: token.expectedIndex,
            });
          }
        }
      }
    }
  }

  const selfCorrectionSpokenIndexes = new Set<number>();
  for (let index = 0; index < alignment.tokens.length; index++) {
    const token = alignment.tokens[index];
    if (
      token.status !== 'substituted' &&
      token.status !== 'extra'
    ) {
      continue;
    }
    const correction = findNearbyCorrection(alignment.tokens, index);
    if (correction?.spoken && correction.spokenIndex !== null) {
      selfCorrectionSpokenIndexes.add(correction.spokenIndex);
      addSuggestion(suggestions.remarks.selfCorrection, {
        word: correction.spoken,
        transcriptIndex: correction.spokenIndex,
        expectedIndex: correction.expectedIndex,
      });
    }
  }

  for (const token of alignment.tokens) {
    if (
      token.status === 'substituted' &&
      token.expected &&
      token.spokenIndex !== null &&
      !selfCorrectionSpokenIndexes.has(token.spokenIndex)
    ) {
      addSuggestion(suggestions.remarks.mispronunciation, {
        word: token.expected,
        transcriptIndex: token.spokenIndex,
        expectedIndex: token.expectedIndex,
      });
    }
  }

  for (const suggestion of Object.values(suggestions.remarks)) {
    suggestion.count = suggestion.words.length;
  }

  return suggestions;
}

async function maybeReviewRemarksWithGemini({
  apiKey,
  model,
  passageText,
  transcript,
  alignment,
  deterministicRemarks,
}: {
  apiKey: string;
  model: string;
  passageText: string;
  transcript: string;
  alignment: AlignmentResult;
  deterministicRemarks: SuggestedReadingRemarks;
}): Promise<SuggestedReadingRemarks> {
  const enabled =
    Deno.env.get('READBLOOM_AI_REMARK_REVIEW_ENABLED')?.toLowerCase() ===
      'true';
  if (!enabled || !transcript.trim()) return deterministicRemarks;

  const maxAlignmentTokens = Number(
    Deno.env.get('READBLOOM_AI_REMARK_MAX_ALIGNMENT_TOKENS') ?? '800',
  );
  if (alignment.tokens.length > maxAlignmentTokens) return deterministicRemarks;

  try {
    const aiRemarks = await reviewRemarksWithGemini({
      apiKey,
      model,
      passageText,
      transcript,
      alignment,
      deterministicRemarks,
    });
    return mergeRemarkSuggestions(deterministicRemarks, aiRemarks, model);
  } catch (error) {
    return {
      ...cloneRemarks(deterministicRemarks),
      review: {
        aiProvider: 'google_ai_studio',
        aiModel: model,
        deterministicFallbackUsed: true,
        error: error instanceof Error ? error.message : 'AI review failed.',
      },
    };
  }
}

async function reviewRemarksWithGemini({
  apiKey,
  model,
  passageText,
  transcript,
  alignment,
  deterministicRemarks,
}: {
  apiKey: string;
  model: string;
  passageText: string;
  transcript: string;
  alignment: AlignmentResult;
  deterministicRemarks: SuggestedReadingRemarks;
}): Promise<SuggestedReadingRemarks> {
  const compactAlignment = alignment.tokens.map((token) => ({
    expected: token.expected,
    spoken: token.spoken,
    expectedIndex: token.expectedIndex,
    spokenIndex: token.spokenIndex,
    status: token.status,
  }));

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
                  'You review oral reading assessment data for ReadBloom.',
                  'Return only valid JSON. Do not include markdown.',
                  'Classify only likely reading remarks from the provided passage, transcript, and alignment.',
                  'Use the deterministic suggestions as hints, but correct them if the context clearly suggests a better classification.',
                  'Do not invent words that do not appear in either the expected passage or transcript.',
                  'Use transcriptIndexes for words that can be highlighted in the transcript.',
                  'Use expectedIndexes for omitted expected words.',
                  'Treat pronunciation as possible mispronunciation because transcript-only evidence is uncertain.',
                  'When unsure, leave the item out.',
                  '',
                  'Return JSON using exactly this schema:',
                  '{"remarks":{"omission":{"transcriptIndexes":[],"expectedIndexes":[],"words":[],"confidence":"high","reason":""},"repetition":{"transcriptIndexes":[],"expectedIndexes":[],"words":[],"confidence":"medium","reason":""},"selfCorrection":{"transcriptIndexes":[],"expectedIndexes":[],"words":[],"confidence":"medium","reason":""},"mispronunciation":{"transcriptIndexes":[],"expectedIndexes":[],"words":[],"confidence":"low","reason":""}}}',
                  '',
                  `Expected passage: ${passageText}`,
                  `Raw transcript: ${transcript}`,
                  `Alignment JSON: ${JSON.stringify(compactAlignment)}`,
                  `Deterministic suggestions JSON: ${
                    JSON.stringify(deterministicRemarks)
                  }`,
                ].join('\n'),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          response_mime_type: 'application/json',
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini remark review failed: ${await response.text()}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? '')
    ?.join('')
    ?.trim();
  if (!text) throw new Error('Gemini returned empty remark review.');

  const raw = JSON.parse(stripJsonFence(text));
  return validateAiRemarkReview(raw, alignment);
}

function validateAiRemarkReview(
  raw: unknown,
  alignment: AlignmentResult,
): SuggestedReadingRemarks {
  if (!raw || typeof raw !== 'object') {
    throw new Error('AI remark review is malformed.');
  }
  const remarks = (raw as Record<string, unknown>).remarks;
  if (!remarks || typeof remarks !== 'object') {
    throw new Error('AI remark review has no remarks.');
  }
  const remarkMap = remarks as Record<string, unknown>;
  return {
    version: 2,
    source: 'deterministic_alignment_with_ai_review',
    remarks: {
      omission: validateAiRemark(
        remarkMap.omission,
        'Omission',
        'high',
        alignment,
      ),
      repetition: validateAiRemark(
        remarkMap.repetition,
        'Repetition',
        'medium',
        alignment,
      ),
      selfCorrection: validateAiRemark(
        remarkMap.selfCorrection,
        'Self-Correction',
        'medium',
        alignment,
      ),
      mispronunciation: validateAiRemark(
        remarkMap.mispronunciation,
        'Possible Mispronunciation',
        'low',
        alignment,
      ),
    },
  };
}

function validateAiRemark(
  raw: unknown,
  label: string,
  fallbackConfidence: RemarkSuggestion['confidence'],
  alignment: AlignmentResult,
): RemarkSuggestion {
  if (!raw || typeof raw !== 'object') {
    return emptySuggestion(label, fallbackConfidence);
  }
  const data = raw as Record<string, unknown>;
  const transcriptIndexes = uniqueIntsInRange(
    data.transcriptIndexes,
    alignment.normalizedTranscript.split(' ').filter(Boolean).length,
  ).slice(0, 50);
  const expectedIndexes = uniqueIntsInRange(
    data.expectedIndexes,
    alignment.normalizedExpected.split(' ').filter(Boolean).length,
  ).slice(0, 50);
  const allowedWords = new Set(
    [
      ...alignment.normalizedTranscript.split(' '),
      ...alignment.normalizedExpected.split(' '),
    ].filter(Boolean),
  );
  const words = Array.isArray(data.words)
    ? data.words
      .map((word) => normalizeWords(String(word))[0] ?? '')
      .filter((word) => word && allowedWords.has(word))
      .slice(0, 50)
    : [];
  const confidence = normalizeConfidence(data.confidence, fallbackConfidence);
  return {
    label,
    count: Math.max(transcriptIndexes.length, expectedIndexes.length, words.length),
    transcriptIndexes,
    expectedIndexes,
    words,
    confidence,
  };
}

function mergeRemarkSuggestions(
  deterministic: SuggestedReadingRemarks,
  ai: SuggestedReadingRemarks,
  model: string,
): SuggestedReadingRemarks {
  const merged: SuggestedReadingRemarks = {
    version: 2,
    source: 'deterministic_alignment_with_ai_review',
    remarks: {
      omission: mergeRemarks(
        deterministic.remarks.omission,
        ai.remarks.omission,
        'Omission',
        'high',
        true,
      ),
      repetition: mergeRemarks(
        deterministic.remarks.repetition,
        ai.remarks.repetition,
        'Repetition',
        'medium',
        true,
      ),
      selfCorrection: mergeRemarks(
        emptySuggestion('Self-Correction', 'medium'),
        ai.remarks.selfCorrection,
        'Self-Correction',
        'medium',
        false,
      ),
      mispronunciation: mergeRemarks(
        emptySuggestion('Possible Mispronunciation', 'low'),
        ai.remarks.mispronunciation,
        'Possible Mispronunciation',
        ai.remarks.mispronunciation.confidence === 'high' ? 'medium' : 'low',
        false,
      ),
    },
    review: {
      aiProvider: 'google_ai_studio',
      aiModel: model,
      deterministicFallbackUsed: false,
    },
  };

  removeConflictingIndexes(merged);
  for (const suggestion of Object.values(merged.remarks)) {
    suggestion.count = Math.max(
      suggestion.transcriptIndexes.length,
      suggestion.expectedIndexes.length,
      suggestion.words.length,
    );
  }
  return merged;
}

function mergeRemarks(
  base: RemarkSuggestion,
  ai: RemarkSuggestion,
  label: string,
  confidence: RemarkSuggestion['confidence'],
  keepBase: boolean,
): RemarkSuggestion {
  const merged = emptySuggestion(label, confidence);
  if (keepBase) appendRemark(merged, base);
  appendRemark(merged, ai);
  merged.confidence = confidence;
  merged.count = Math.max(
    merged.transcriptIndexes.length,
    merged.expectedIndexes.length,
    merged.words.length,
  );
  return merged;
}

function appendRemark(target: RemarkSuggestion, source: RemarkSuggestion) {
  for (const index of source.transcriptIndexes) {
    if (!target.transcriptIndexes.includes(index)) {
      target.transcriptIndexes.push(index);
    }
  }
  for (const index of source.expectedIndexes) {
    if (!target.expectedIndexes.includes(index)) {
      target.expectedIndexes.push(index);
    }
  }
  for (const word of source.words) {
    if (!target.words.includes(word)) target.words.push(word);
  }
}

function removeConflictingIndexes(suggestions: SuggestedReadingRemarks) {
  const claimed = new Set<number>();
  for (const key of ['selfCorrection', 'repetition', 'omission', 'mispronunciation'] as RemarkKey[]) {
    const suggestion = suggestions.remarks[key];
    suggestion.transcriptIndexes = suggestion.transcriptIndexes.filter((index) => {
      if (claimed.has(index)) return false;
      claimed.add(index);
      return true;
    });
  }
}

function cloneRemarks(remarks: SuggestedReadingRemarks): SuggestedReadingRemarks {
  return {
    version: remarks.version,
    source: remarks.source,
    remarks: {
      omission: cloneRemark(remarks.remarks.omission),
      repetition: cloneRemark(remarks.remarks.repetition),
      selfCorrection: cloneRemark(remarks.remarks.selfCorrection),
      mispronunciation: cloneRemark(remarks.remarks.mispronunciation),
    },
  };
}

function cloneRemark(remark: RemarkSuggestion): RemarkSuggestion {
  return {
    label: remark.label,
    count: remark.count,
    transcriptIndexes: [...remark.transcriptIndexes],
    expectedIndexes: [...remark.expectedIndexes],
    words: [...remark.words],
    confidence: remark.confidence,
  };
}

function uniqueIntsInRange(value: unknown, maxExclusive: number) {
  if (!Array.isArray(value) || maxExclusive <= 0) return [];
  return [...new Set(
    value
      .map((item) => Number(item))
      .filter((item) =>
        Number.isInteger(item) && item >= 0 && item < maxExclusive
      ),
  )];
}

function normalizeConfidence(
  value: unknown,
  fallback: RemarkSuggestion['confidence'],
): RemarkSuggestion['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low'
    ? value
    : fallback;
}

function stripJsonFence(text: string) {
  return text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function findNearbyCorrection(tokens: AlignmentToken[], tokenIndex: number) {
  const expected = tokens[tokenIndex].expected;
  if (!expected) return null;
  const originSpokenIndex = tokens[tokenIndex].spokenIndex;
  for (
    let index = tokenIndex + 1;
    index < tokens.length && index <= tokenIndex + 4;
    index++
  ) {
    const candidate = tokens[index];
    if (
      candidate.status === 'match' &&
      candidate.spoken === expected &&
      candidate.spokenIndex !== null &&
      (originSpokenIndex === null ||
        (originSpokenIndex !== null &&
          candidate.spokenIndex - originSpokenIndex <= 3))
    ) {
      return candidate;
    }
  }
  return null;
}

function emptySuggestion(
  label: string,
  confidence: RemarkSuggestion['confidence'],
): RemarkSuggestion {
  return {
    label,
    count: 0,
    transcriptIndexes: [],
    expectedIndexes: [],
    words: [],
    confidence,
  };
}

function addSuggestion(
  suggestion: RemarkSuggestion,
  item: {
    word: string;
    transcriptIndex: number | null;
    expectedIndex: number | null;
  },
) {
  const transcriptKey = item.transcriptIndex ?? -1;
  const expectedKey = item.expectedIndex ?? -1;
  const duplicate = suggestion.words.some((word, index) =>
    word === item.word &&
    (suggestion.transcriptIndexes[index] ?? -1) === transcriptKey &&
    (suggestion.expectedIndexes[index] ?? -1) === expectedKey
  );
  if (duplicate) return;

  suggestion.words.push(item.word);
  if (item.transcriptIndex !== null) {
    suggestion.transcriptIndexes.push(item.transcriptIndex);
  }
  if (item.expectedIndex !== null) {
    suggestion.expectedIndexes.push(item.expectedIndex);
  }
}

function nearestSpokenIndex(position: number, spokenLength: number) {
  if (spokenLength === 0) return null;
  if (position <= 0) return 0;
  if (position >= spokenLength) return spokenLength - 1;
  return position;
}

function nearestExpectedIndex(position: number, expectedLength: number) {
  if (expectedLength === 0) return null;
  if (position <= 0) return 0;
  if (position >= expectedLength) return expectedLength - 1;
  return position;
}

function buildEditDistanceMatrix(expected: string[], spoken: string[]) {
  const dp = Array.from({ length: expected.length + 1 }, () =>
    Array<number>(spoken.length + 1).fill(0)
  );

  for (let i = 0; i <= expected.length; i++) dp[i][0] = i;
  for (let j = 0; j <= spoken.length; j++) dp[0][j] = j;

  for (let i = 1; i <= expected.length; i++) {
    for (let j = 1; j <= spoken.length; j++) {
      if (expected[i - 1] === spoken[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j - 1] + 1,
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
        );
      }
    }
  }

  return dp;
}

function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function mimeTypeForPath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'm4a') return 'audio/mp4';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'ogg') return 'audio/ogg';
  return 'video/webm';
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
