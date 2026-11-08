import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { engineSupportsInstruct } from '@/components/Generation/EngineModelSelector';
import { InstructPresets } from '@/components/Generation/InstructPresets';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiClient } from '@/lib/api/client';
import type { GenerationVersionResponse, HistoryResponse } from '@/lib/api/types';
import { formatEngineName } from '@/lib/utils/format';

// 每次打开使用选中版本初始化；请求失败时保留当前输入，避免丢稿。
export function EditGenerationDialog({
  generation,
  draft,
  onClose,
  onStarted,
}: {
  generation: HistoryResponse;
  draft?: GenerationVersionResponse;
  onClose: () => void;
  onStarted: (version: GenerationVersionResponse) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(draft?.text ?? generation.text);
  const [instruct, setInstruct] = useState(
    draft ? (draft.instruct ?? '') : (generation.instruct ?? ''),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(draft?.error ?? '');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const version = await apiClient.editGeneration(generation.id, {
        text: text.trim(),
        instruct: instruct.trim() || null,
      });
      onStarted(version);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('history.edit.title')}</DialogTitle>
          <DialogDescription>
            {generation.profile_name} · {formatEngineName(generation.engine)} ·{' '}
            {generation.language}
            {generation.model_size ? ` · ${generation.model_size}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="revision-text">{t('history.edit.text')}</Label>
          <Textarea
            id="revision-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={7}
            maxLength={50000}
            disabled={busy}
            className="max-h-80 resize-y"
          />
        </div>
        {engineSupportsInstruct(generation.engine) && (
          <div className="space-y-2">
            <Label htmlFor="revision-instruct">{t('history.edit.instruct')}</Label>
            {/* 编辑旧台词也复用相同预设，保留该版本原有的自由说明。 */}
            <InstructPresets
              value={instruct}
              onChange={setInstruct}
              disabled={busy}
              maxLength={2000}
            />
            <Textarea
              id="revision-instruct"
              value={instruct}
              onChange={(event) => setInstruct(event.target.value)}
              rows={2}
              maxLength={2000}
              disabled={busy}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !text.trim()} onClick={submit}>
            {t(busy ? 'history.edit.generating' : 'history.edit.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
