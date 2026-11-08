import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import templates from '../../../../presets/designed-voices.zh.json';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { apiClient } from '@/lib/api/client';
import { useProfiles } from '@/lib/hooks/useProfiles';
import { useUIStore } from '@/stores/uiStore';

const MODEL = 'qwen-voice-design-1.7B';
const DISMISSED = 'voiceboxplus-getting-started-v1';

export function GettingStarted() {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const queryClient = useQueryClient();
  const { data: profiles } = useProfiles();
  const [manualOpen, setManualOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED) === '1');
  const [selected, setSelected] = useState(templates[0].name);
  const ui = useUIStore();
  // 仅空档案库自动引导；旧用户可随时从入口打开，不打断已有工作。
  const open = manualOpen || (!dismissed && profiles?.length === 0);
  const close = () => {
    localStorage.setItem(DISMISSED, '1');
    setDismissed(true);
    setManualOpen(false);
  };
  const models = useQuery({
    queryKey: ['modelStatus'],
    queryFn: () => apiClient.getModelStatus(),
    enabled: open,
    refetchInterval: open ? 3000 : false,
  });
  const tasks = useQuery({
    queryKey: ['activeTasks'],
    queryFn: () => apiClient.getActiveTasks(),
    enabled: open,
    refetchInterval: open ? 1500 : false,
  });
  const model = models.data?.models.find((item) => item.model_name === MODEL);
  const task = tasks.data?.downloads.find((item) => item.model_name === MODEL);
  const download = useMutation({
    mutationFn: () => apiClient.triggerModelDownload(MODEL),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modelStatus'] });
      queryClient.invalidateQueries({ queryKey: ['activeTasks'] });
    },
  });
  const busy = download.isPending || model?.downloading || task?.status === 'downloading';
  const ready = !!model?.downloaded;
  const failure =
    download.error?.message || (!ready && task?.status === 'error' ? task.error : null);
  const existing = profiles?.find((item) => item.name === selected);
  const useProfile = (id: string) => {
    ui.setSelectedProfileId(id);
    ui.setSelectedEngine('qwen_voice_design');
    close();
  };
  const addTemplate = useMutation({
    mutationFn: async () => {
      // 使用原有保存接口生成独立试音；不在首次启动时下载或批量推理。
      if (existing) return existing;
      const template = templates.find((item) => item.name === selected)!;
      return apiClient.createProfile({
        ...template,
        voice_type: 'designed',
        language: 'zh',
        default_engine: 'qwen_voice_design',
      });
    },
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      useProfile(profile.id);
    },
  });
  const design = () => {
    // 保留草稿内容，仅切换到用户明确选择的设计模式。
    ui.setProfileFormDraft({
      name: '',
      description: '',
      language: zh ? 'zh' : 'en',
      personality: '',
      referenceText: '',
      sampleMode: 'upload',
      ...ui.profileFormDraft,
      voiceSource: 'design',
    });
    close();
    ui.setEditingProfileId(null);
    ui.setProfileDialogOpen(true);
  };
  return (
    <>
      <Button variant="outline" onClick={() => setManualOpen(true)}>
        <BookOpen className="mr-2 size-4" />
        {zh ? '入门与模板' : 'Quick start'}
      </Button>
      <Dialog open={open} onOpenChange={(value) => (value ? setManualOpen(true) : close())}>
        <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{zh ? '开始设计你的声音' : 'Design your first voice'}</DialogTitle>
            <DialogDescription>
              {zh
                ? '下载一个模型，选择模板或描述你想要的声音。'
                : 'Download one model, then choose a template or describe a voice.'}
            </DialogDescription>
          </DialogHeader>
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="font-medium">1. Qwen VoiceDesign 1.7B</h3>
            <p className="text-sm text-muted-foreground">
              {zh
                ? '约 3.5 GB，首次下载需要联网。模型保存在本机，无需下载其他引擎。'
                : 'About 3.5 GB. Internet required for the first download; no other engine is needed.'}
            </p>
            <div className="flex items-center gap-3">
              {ready ? (
                <span className="flex items-center gap-2 text-sm">
                  <Check className="size-4" />
                  {zh ? '模型已就绪' : 'Model ready'}
                </span>
              ) : (
                <Button disabled={!model || busy} onClick={() => download.mutate()}>
                  {busy ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 size-4" />
                  )}
                  {busy
                    ? zh
                      ? '正在下载'
                      : 'Downloading'
                    : failure
                      ? zh
                        ? '重新下载'
                        : 'Retry download'
                      : zh
                        ? '下载模型'
                        : 'Download model'}
                </Button>
              )}
              {models.isLoading && (
                <span className="text-sm text-muted-foreground">
                  {zh ? '检查模型…' : 'Checking models…'}
                </span>
              )}
            </div>
            {busy && (
              <div className="space-y-1" role="status">
                <Progress
                  value={task?.progress ?? 0}
                  aria-label={zh ? '模型下载进度' : 'Model download progress'}
                />
                <p className="text-xs text-muted-foreground tabular-nums">
                  {task?.progress != null
                    ? `${Math.round(task.progress)}%`
                    : zh
                      ? '准备下载…'
                      : 'Preparing download…'}
                  {task?.filename ? ` · ${task.filename}` : ''}
                </p>
              </div>
            )}
            {(failure || models.error || tasks.error) && (
              <div role="alert" className="space-y-2 text-sm text-destructive">
                <p>{failure || models.error?.message || tasks.error?.message}</p>
                <p>
                  {zh
                    ? '请检查网络和磁盘空间。可在「模型」页面管理下载。'
                    : 'Check your network and free disk space. Downloads can also be managed on the Models page.'}
                </p>
                {(models.error || tasks.error) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      models.refetch();
                      tasks.refetch();
                    }}
                  >
                    {zh ? '重试连接' : 'Retry connection'}
                  </Button>
                )}
              </div>
            )}
          </section>
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="font-medium">
              {zh ? '2. 选择一个中文主播模板' : '2. Choose a Chinese presenter template'}
            </h3>
            <label htmlFor="presenter-template" className="sr-only">
              {zh ? '主播模板' : 'Presenter template'}
            </label>
            <select
              id="presenter-template"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                addTemplate.reset();
              }}
            >
              {templates.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
            <p className="text-sm text-muted-foreground">
              {templates.find((item) => item.name === selected)?.description}
            </p>
            <Button
              disabled={!ready || addTemplate.isPending || !profiles}
              onClick={() => addTemplate.mutate()}
            >
              {addTemplate.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {existing
                ? zh
                  ? '使用已有音色'
                  : 'Use existing voice'
                : zh
                  ? '添加音色并生成试音'
                  : 'Add voice and generate preview'}
            </Button>
            {addTemplate.error && (
              <p role="alert" className="text-sm text-destructive">
                {addTemplate.error.message}
              </p>
            )}
          </section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" disabled={!ready} onClick={design}>
              {zh ? '自己描述音色' : 'Describe your own voice'}
            </Button>
            <a
              className="text-sm underline underline-offset-4"
              href={`https://github.com/badboy-tian/VoiceBoxPlus/blob/voiceboxplus/docs/${zh ? 'getting-started.zh-CN' : 'getting-started'}.md`}
              target="_blank"
              rel="noreferrer"
            >
              {zh ? '完整安装教程' : 'Installation guide'}
            </a>
            <Button variant="ghost" onClick={close}>
              {zh ? '稍后设置' : 'Set up later'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
