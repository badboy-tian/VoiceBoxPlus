import { Info, Mic, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isProfileCompatibleWithEngine } from '@/components/Generation/EngineModelSelector';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useProfiles } from '@/lib/hooks/useProfiles';
import { useVoicePreview } from '@/lib/hooks/useVoicePreview';
import { useUIStore } from '@/stores/uiStore';
import { ProfileCard } from './ProfileCard';
import { ProfileForm } from './ProfileForm';

// 分类只筛选显示，不更改选中的音色，也不按当前模型重新排序。
const VOICE_FILTERS = ['all', 'cloned', 'designed', 'preset'] as const;
type VoiceFilter = (typeof VOICE_FILTERS)[number];

export function ProfileList() {
  const { t } = useTranslation();
  const { data: profiles, isLoading, error } = useProfiles();
  // 试听只切换播放器，不改变当前选中的配音音色。
  const preview = useVoicePreview();
  const setDialogOpen = useUIStore((state) => state.setProfileDialogOpen);
  const selectedEngine = useUIStore((state) => state.selectedEngine);
  const [voiceFilter, setVoiceFilter] = useState<VoiceFilter>('all');

  if (isLoading) {
    return null;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-destructive">
          {t('profiles.list.errorLoading', { message: error.message })}
        </div>
      </div>
    );
  }

  const allProfiles = profiles || [];

  /** Whether a profile is supported by the currently selected engine. */
  const isSupported = (p: (typeof allProfiles)[number]) =>
    isProfileCompatibleWithEngine(p, selectedEngine);

  // 沿用数据库返回的创建顺序；旧档案没有类型时按克隆分类。
  const visibleProfiles = allProfiles.filter(
    (profile) => voiceFilter === 'all' || (profile.voice_type || 'cloned') === voiceFilter,
  );
  const hasUnsupported = visibleProfiles.some((profile) => !isSupported(profile));

  return (
    <div className="flex flex-col">
      <Tabs
        className="shrink-0"
        value={voiceFilter}
        onValueChange={(value) => setVoiceFilter(value as VoiceFilter)}
      >
        {/* 沿用现有 Tabs 保留键盘导航；分类名称已足够解释操作。 */}
        <TabsList aria-label={t('profiles.filters.label')}>
          {VOICE_FILTERS.map((filter) => (
            <TabsTrigger key={filter} value={filter}>
              {t(`profiles.filters.${filter}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={voiceFilter} className="mt-4">
          {visibleProfiles.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Mic className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">
                  {t(allProfiles.length === 0 ? 'profiles.list.empty' : 'profiles.filters.empty')}
                </p>
                <Button onClick={() => setDialogOpen(true)}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t('profiles.list.createVoice')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="flex gap-4 overflow-x-auto p-1 pb-1 lg:grid lg:grid-cols-3 lg:auto-rows-auto lg:overflow-x-visible lg:pb-[150px]">
              {visibleProfiles.map((profile) => (
                <div key={profile.id} className="shrink-0 w-[200px] lg:w-auto lg:shrink">
                  <ProfileCard
                    profile={profile}
                    disabled={!isSupported(profile)}
                    onPreview={() => preview.mutate(profile)}
                    previewPending={profile.preview_status === 'generating'}
                    previewDisabled={profile.preview_status !== 'ready'}
                  />
                </div>
              ))}
              {hasUnsupported && (
                <div className="col-span-full flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  <span>{t('profiles.list.unsupportedNote')}</span>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ProfileForm />
    </div>
  );
}
