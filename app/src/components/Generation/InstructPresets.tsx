import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  applyInstructPreset,
  INSTRUCT_PRESET_GROUPS,
  INSTRUCT_PRESETS,
  selectedInstructPreset,
} from '@/lib/constants/instructPresets';

// 与主生成框、历史编辑框共用，直接写入原有 instruct 字段，旧数据库无需额外迁移。
export function InstructPresets({
  value,
  onChange,
  disabled = false,
  maxLength = 500,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  maxLength?: number;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const chinese = i18n.language.startsWith('zh');
  return (
    <div className="grid grid-cols-3 gap-2">
      {INSTRUCT_PRESET_GROUPS.map((group) => (
        <div key={group} className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-${group}`} className="text-xs text-muted-foreground">
            {t(`generation.instruct.presets.${group}`)}
          </Label>
          <Select
            value={selectedInstructPreset(value, group)}
            disabled={disabled}
            onValueChange={(choice) => {
              const next = applyInstructPreset(value, group, choice, chinese);
              if (next.length <= maxLength) onChange(next);
            }}
          >
            <SelectTrigger id={`${id}-${group}`} className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('generation.instruct.presets.none')}</SelectItem>
              {INSTRUCT_PRESETS[group].map((option) => (
                <SelectItem
                  key={option.id}
                  value={option.id}
                  disabled={
                    applyInstructPreset(value, group, option.id, chinese).length > maxLength
                  }
                >
                  {t(`generation.instruct.presets.${option.id}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
