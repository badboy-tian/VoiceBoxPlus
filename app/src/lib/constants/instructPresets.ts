// 使用可读的自然语言指令，三个维度只替换自己的完整行，避免覆盖用户自由填写的内容。
export const INSTRUCT_PRESETS = {
  tone: [
    { id: 'natural', zh: '使用自然日常的语气', en: 'Use a natural, conversational tone' },
    { id: 'friendly', zh: '使用亲切友好的语气', en: 'Use a friendly, welcoming tone' },
    { id: 'gentle', zh: '使用温柔轻声的语气', en: 'Use a gentle, soft-spoken tone' },
    { id: 'professional', zh: '使用专业正式的语气', en: 'Use a professional, formal tone' },
    { id: 'storytelling', zh: '使用娓娓道来的讲述语气', en: 'Use an engaging storytelling tone' },
    { id: 'whisper', zh: '使用贴近耳边的低语', en: 'Speak in a close, quiet whisper' },
    { id: 'confident', zh: '使用坚定自信的语气', en: 'Use a firm, confident tone' },
    { id: 'playful', zh: '使用轻松幽默的语气', en: 'Use a light, playful tone' },
  ],
  emotion: [
    { id: 'calm', zh: '情感平静放松', en: 'Express calm, relaxed feelings' },
    { id: 'happy', zh: '表达开心愉悦的情感', en: 'Express happiness and joy' },
    { id: 'excited', zh: '表达兴奋期待的情感', en: 'Express excitement and anticipation' },
    { id: 'sad', zh: '表达低落伤感的情感', en: 'Express sadness and melancholy' },
    { id: 'angry', zh: '表达克制的生气与不满', en: 'Express restrained anger and frustration' },
    { id: 'surprised', zh: '表达惊讶好奇的情感', en: 'Express surprise and curiosity' },
    { id: 'serious', zh: '情感严肃认真', en: 'Express seriousness and sincerity' },
    { id: 'comforting', zh: '表达安慰与关怀的情感', en: 'Express comfort and care' },
  ],
  pace: [
    { id: 'steady', zh: '语速适中，节奏平稳', en: 'Speak at a moderate, steady pace' },
    { id: 'slow', zh: '语速稍慢，节奏舒缓', en: 'Speak slowly with an unhurried rhythm' },
    { id: 'brisk', zh: '语速稍快，节奏轻快', en: 'Speak slightly faster with a lively rhythm' },
    { id: 'pauses', zh: '句间停顿分明，留出思考空间', en: 'Use distinct pauses between sentences' },
    { id: 'crisp', zh: '使用短句节奏，表达干脆利落', en: 'Use a crisp rhythm with short phrases' },
    {
      id: 'expressive',
      zh: '节奏富有起伏，重点词适当强调',
      en: 'Vary the rhythm and emphasize key words',
    },
  ],
} as const;

export type InstructPresetGroup = keyof typeof INSTRUCT_PRESETS;
export const INSTRUCT_PRESET_GROUPS = Object.keys(INSTRUCT_PRESETS) as InstructPresetGroup[];

export function selectedInstructPreset(text: string, group: InstructPresetGroup): string {
  const lines = text.split('\n').map((line) => line.trim());
  return (
    INSTRUCT_PRESETS[group].find((option) => lines.includes(option.zh) || lines.includes(option.en))
      ?.id ?? 'none'
  );
}

export function applyInstructPreset(
  text: string,
  group: InstructPresetGroup,
  id: string,
  chinese: boolean,
): string {
  const options = INSTRUCT_PRESETS[group];
  const phrases = new Set<string>(options.flatMap((option) => [option.zh, option.en]));
  const remaining = text
    .split('\n')
    .filter((line) => !phrases.has(line.trim()))
    .join('\n');
  const choice = options.find((option) => option.id === id);
  // 不指定只移除本组预设；手写内容以及另外两个维度保持原样。
  return choice
    ? `${remaining}${remaining && !remaining.endsWith('\n') ? '\n' : ''}${chinese ? choice.zh : choice.en}`
    : remaining;
}
