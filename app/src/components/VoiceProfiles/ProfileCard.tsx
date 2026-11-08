import { Download, Edit, Loader2, Sparkles, Trash2, Volume2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CircleButton } from '@/components/ui/circle-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { VoiceProfileResponse } from '@/lib/api/types';
import { useDeleteProfile, useExportProfile } from '@/lib/hooks/useProfiles';
import { cn } from '@/lib/utils/cn';
import { useUIStore } from '@/stores/uiStore';

/** Human-readable display names for preset engine badges. */
const ENGINE_DISPLAY_NAMES: Record<string, string> = {
  kokoro: 'Kokoro',
  qwen_custom_voice: 'CustomVoice',
  qwen_voice_design: 'VoiceDesign',
};

interface ProfileCardProps {
  profile: VoiceProfileResponse;
  disabled?: boolean;
  onPreview: () => void;
  previewPending: boolean;
  previewDisabled: boolean;
}

export function ProfileCard({
  profile,
  disabled,
  onPreview,
  previewPending,
  previewDisabled,
}: ProfileCardProps) {
  const { t } = useTranslation();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const deleteProfile = useDeleteProfile();
  const exportProfile = useExportProfile();
  const setEditingProfileId = useUIStore((state) => state.setEditingProfileId);
  const setProfileDialogOpen = useUIStore((state) => state.setProfileDialogOpen);
  const selectedProfileId = useUIStore((state) => state.selectedProfileId);
  const setSelectedProfileId = useUIStore((state) => state.setSelectedProfileId);

  const isSelected = selectedProfileId === profile.id;

  const handleSelect = () => {
    if (disabled && isSelected) {
      setSelectedProfileId(null);
      setTimeout(() => setSelectedProfileId(profile.id), 0);
      return;
    }
    setSelectedProfileId(isSelected ? null : profile.id);
  };

  const handleEdit = () => {
    setEditingProfileId(profile.id);
    setProfileDialogOpen(true);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    deleteProfile.mutate(profile.id);
    setDeleteDialogOpen(false);
  };

  const handleExport = (e: React.MouseEvent) => {
    e.stopPropagation();
    exportProfile.mutate(profile.id);
  };

  const selectLabel = t(
    isSelected ? 'profiles.card.selectLabelSelected' : 'profiles.card.selectLabel',
    { name: profile.name, language: profile.language },
  );

  return (
    <>
      <Card
        className={cn(
          'relative cursor-pointer transition-all flex flex-col h-[162px]',
          'hover:shadow-md',
          isSelected && !disabled && 'ring-2 border-transparent ring-accent shadow-md',
        )}
      >
        {/* 卡片选择与试听是独立按钮，键盘和读屏都能分别访问。 */}
        <button
          type="button"
          className="absolute inset-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={handleSelect}
          aria-label={selectLabel}
          aria-pressed={isSelected}
        />
        <CardHeader className={cn('p-3 pb-2', disabled && 'opacity-40')}>
          <CardTitle className="text-base font-medium">
            <span className="break-words">{profile.name}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 flex flex-col flex-1">
          <p
            className={cn(
              'text-xs text-muted-foreground mb-1.5 line-clamp-2 leading-relaxed',
              disabled && 'opacity-40',
            )}
          >
            {profile.description || t('profiles.card.noDescription')}
          </p>
          <div className={cn('mb-2 flex items-center gap-1.5', disabled && 'opacity-40')}>
            <Badge variant="outline" className="text-xs h-5 px-1.5 text-muted-foreground">
              {profile.language}
            </Badge>
            {profile.voice_type === 'preset' && (
              <Badge variant="secondary" className="text-xs h-5 px-1.5">
                {ENGINE_DISPLAY_NAMES[profile.preset_engine ?? ''] ?? profile.preset_engine}
              </Badge>
            )}
            {profile.voice_type === 'designed' && (
              <Badge variant="secondary" className="text-xs h-5 px-1.5">
                {t('profiles.card.designed')}
              </Badge>
            )}
            {profile.effects_chain && profile.effects_chain.length > 0 && (
              <Sparkles className="h-3.5 w-3.5 text-accent fill-accent" />
            )}
            {profile.personality?.trim() && <Wand2 className="h-3.5 w-3.5 text-accent" />}
          </div>
          <div className="relative z-10 pointer-events-none flex gap-0.5 justify-end items-end mt-auto [&_button]:pointer-events-auto">
            {/* 试听跟随音色，不受当前生成模型的兼容性筛选影响。 */}
            <CircleButton
              className={cn(
                'mr-auto [&>svg]:text-foreground',
                previewPending && '[&>svg]:animate-spin',
              )}
              icon={previewPending ? Loader2 : Volume2}
              onClick={(event) => {
                event.stopPropagation();
                onPreview();
              }}
              disabled={previewDisabled}
              aria-busy={previewPending}
              aria-label={t('profiles.card.preview', { name: profile.name })}
              // 未就绪时解释如何恢复，避免可见按钮点不了却没有原因。
              title={
                profile.preview_status === 'ready'
                  ? t('profiles.card.preview', { name: profile.name })
                  : profile.preview_status === 'generating'
                    ? t('profiles.card.previewPreparing', {
                        defaultValue: 'Preparing voice preview…',
                      })
                    : t('profiles.card.previewUnavailable', {
                        defaultValue: 'Edit and save this voice to prepare its preview.',
                      })
              }
            />
            <CircleButton
              icon={Download}
              onClick={handleExport}
              disabled={exportProfile.isPending}
              aria-label={t('profiles.card.export')}
            />
            <CircleButton
              icon={Edit}
              onClick={(e) => {
                e.stopPropagation();
                handleEdit();
              }}
              aria-label={t('profiles.card.edit')}
            />
            <CircleButton
              icon={Trash2}
              onClick={handleDeleteClick}
              disabled={deleteProfile.isPending}
              aria-label={t('profiles.card.delete')}
            />
          </div>
        </CardContent>
      </Card>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('profiles.deleteDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('profiles.deleteDialog.body', { name: profile.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteProfile.isPending}
            >
              {deleteProfile.isPending ? t('profiles.deleteDialog.deleting') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
