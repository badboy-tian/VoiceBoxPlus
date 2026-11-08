import { describe, expect, test } from 'bun:test';
import { applyInstructPreset, selectedInstructPreset } from '../app/src/lib/constants/instructPresets';

// 组合替换不能丢失用户手写稿，也不能积累互相冲突的旧预设。
describe('delivery presets', () => {
  test('combines dimensions and preserves manual instructions', () => {
    let text = '品牌名要读清楚。';
    text = applyInstructPreset(text, 'tone', 'friendly', true);
    text = applyInstructPreset(text, 'emotion', 'happy', true);
    text = applyInstructPreset(text, 'pace', 'slow', true);
    expect(text.startsWith('品牌名要读清楚。')).toBe(true);
    expect(selectedInstructPreset(text, 'tone')).toBe('friendly');
    expect(selectedInstructPreset(text, 'emotion')).toBe('happy');
    expect(selectedInstructPreset(text, 'pace')).toBe('slow');
    const changed = applyInstructPreset(text, 'pace', 'brisk', true);
    expect(changed).not.toContain('语速稍慢');
    expect(selectedInstructPreset(changed, 'emotion')).toBe('happy');
    expect(selectedInstructPreset(changed, 'pace')).toBe('brisk');
  });
  test('clears only the selected group and avoids duplicates', () => {
    const original = applyInstructPreset('自定义说明', 'tone', 'gentle', true);
    expect(applyInstructPreset(original, 'tone', 'gentle', true)).toBe(original);
    expect(applyInstructPreset(original, 'tone', 'none', true)).toBe('自定义说明');
  });
  test('recognizes saved English presets and replaces across UI languages', () => {
    const english = applyInstructPreset('Read NASA clearly.', 'tone', 'professional', false);
    expect(selectedInstructPreset(english, 'tone')).toBe('professional');
    const chinese = applyInstructPreset(english, 'tone', 'friendly', true);
    expect(chinese).not.toContain('professional');
    expect(chinese).toContain('Read NASA clearly.');
  });
  test('manual edits are not mistaken for preset-owned instructions', () => {
    const manual = '使用自然日常的语气，但最后一句要压低声音';
    expect(selectedInstructPreset(manual, 'tone')).toBe('none');
    expect(applyInstructPreset(manual, 'emotion', 'sad', true)).toContain(manual);
  });
});
