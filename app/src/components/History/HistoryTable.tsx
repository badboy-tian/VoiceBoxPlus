import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AudioLines,
  Download,
  FileArchive,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  Square,
  Star,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioBars } from '@/components/AudioBars';
import { EffectsChainEditor } from '@/components/Effects/EffectsChainEditor';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type {
  EffectConfig,
  GenerationExportFormat,
  GenerationVersionResponse,
  HistoryResponse,
} from '@/lib/api/types';
import { BOTTOM_SAFE_AREA_PADDING } from '@/lib/constants/ui';
import {
  useClearFailedGenerations,
  useDeleteGeneration,
  useExportGeneration,
  useExportGenerationAudio,
  useHistory,
  useImportGeneration,
} from '@/lib/hooks/useHistory';
import { cn } from '@/lib/utils/cn';
import { formatDate, formatDuration, formatEngineName } from '@/lib/utils/format';
import { useGenerationStore } from '@/stores/generationStore';
import { usePlayerStore } from '@/stores/playerStore';
import { EditGenerationDialog } from './EditGenerationDialog';

export function HistoryTable() {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [allHistory, setAllHistory] = useState<HistoryResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [generationToDelete, setGenerationToDelete] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [effectsDialogOpen, setEffectsDialogOpen] = useState(false);
  const [effectsTargetId, setEffectsTargetId] = useState<string | null>(null);
  const [effectsTargetVersions, setEffectsTargetVersions] = useState<GenerationVersionResponse[]>(
    [],
  );
  const [effectsSourceVersionId, setEffectsSourceVersionId] = useState<string | null>(null);
  const [effectsChain, setEffectsChain] = useState<EffectConfig[]>([]);
  const [applyingEffects, setApplyingEffects] = useState(false);
  const [expandedVersionsId, setExpandedVersionsId] = useState<string | null>(null);
  // 草稿仅在对话框内编辑，已完成历史不会被直接改写。
  const [editTarget, setEditTarget] = useState<{
    generation: HistoryResponse;
    draft?: GenerationVersionResponse;
  } | null>(null);
  const limit = 20;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: historyData,
    isLoading,
    isFetching,
  } = useHistory({
    limit,
    offset: page * limit,
  });

  const deleteGeneration = useDeleteGeneration();
  const clearFailed = useClearFailedGenerations();
  const [clearFailedDialogOpen, setClearFailedDialogOpen] = useState(false);
  const exportGeneration = useExportGeneration();
  const exportGenerationAudio = useExportGenerationAudio();
  const importGeneration = useImportGeneration();
  const cancelGeneration = useMutation({
    mutationFn: (generationId: string) => apiClient.cancelGeneration(generationId),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['history'] });
      toast({
        title: 'Cancelling generation',
        description: data.message,
      });
    },
    onError: (error) => {
      toast({
        title: 'Cancel failed',
        description: error instanceof Error ? error.message : 'Could not cancel generation',
        variant: 'destructive',
      });
    },
  });
  const addPendingGeneration = useGenerationStore((state) => state.addPendingGeneration);
  const setAudioWithAutoPlay = usePlayerStore((state) => state.setAudioWithAutoPlay);
  const restartCurrentAudio = usePlayerStore((state) => state.restartCurrentAudio);
  const currentAudioId = usePlayerStore((state) => state.audioId);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const audioUrl = usePlayerStore((state) => state.audioUrl);
  const isPlayerVisible = !!audioUrl;

  // Update accumulated history when new data arrives
  useEffect(() => {
    if (historyData?.items) {
      setTotal(historyData.total);
      if (page === 0) {
        // Reset to first page
        setAllHistory(historyData.items);
      } else {
        // Append new items, avoiding duplicates
        setAllHistory((prev) => {
          const existingIds = new Set(prev.map((item) => item.id));
          const newItems = historyData.items.filter((item) => !existingIds.has(item.id));
          // 分页刷新也更新已有记录，确保版本与台词不会停留在旧缓存。
          const updates = new Map(historyData.items.map((item) => [item.id, item]));
          return [...prev.map((item) => updates.get(item.id) ?? item), ...newItems];
        });
      }
    }
  }, [historyData, page]);

  // 直接刷新正在编辑的记录，分页到其他位置也不会漏掉任务完成状态。
  const pendingRevisionIds = allHistory
    .filter((item) => item.versions?.some((v) => v.status === 'generating'))
    .map((item) => item.id)
    .join(',');
  useEffect(() => {
    if (!pendingRevisionIds) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const results = await Promise.allSettled(
        pendingRevisionIds.split(',').map((id) => apiClient.getGeneration(id)),
      );
      if (disposed) return;
      const updates = new Map(
        results.flatMap((result) =>
          result.status === 'fulfilled' ? [[result.value.id, result.value] as const] : [],
        ),
      );
      setAllHistory((items) => items.map((item) => updates.get(item.id) ?? item));
      timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [pendingRevisionIds]);

  // Reset to page 0 when deletions, imports, or generation completions occur
  const pendingCount = useGenerationStore((state) => state.pendingGenerationIds.size);
  const prevPendingCountRef = useRef(pendingCount);
  useEffect(() => {
    if (deleteGeneration.isSuccess || importGeneration.isSuccess || clearFailed.isSuccess) {
      setPage(0);
      setAllHistory([]);
    }
  }, [deleteGeneration.isSuccess, importGeneration.isSuccess, clearFailed.isSuccess]);

  useEffect(() => {
    // A generation finished (pending count decreased) — scroll back to show it
    if (
      prevPendingCountRef.current > 0 &&
      pendingCount < prevPendingCountRef.current &&
      page !== 0
    ) {
      setPage(0);
      setAllHistory([]);
    }
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, page]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const loadMoreEl = loadMoreRef.current;
    if (!loadMoreEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting && !isFetching && allHistory.length < total) {
          setPage((prev) => prev + 1);
        }
      },
      {
        root: scrollRef.current,
        rootMargin: '100px',
        threshold: 0.1,
      },
    );

    observer.observe(loadMoreEl);
    return () => observer.disconnect();
  }, [isFetching, allHistory.length, total]);

  // Track scroll position for gradient effect
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const handleScroll = () => {
      setIsScrolled(scrollEl.scrollTop > 0);
    };

    scrollEl.addEventListener('scroll', handleScroll);
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, []);

  const handlePlay = (audioId: string, text: string, profileId: string) => {
    // 使用不可变版本地址，避免同一历史 ID 缓存到切换前的声音。
    const gen = allHistory.find((item) => item.id === audioId);
    const version = gen?.versions?.find((item) => item.is_default);
    const url = version ? apiClient.getVersionAudioUrl(version.id) : apiClient.getAudioUrl(audioId);
    if (currentAudioId === audioId && audioUrl === url) restartCurrentAudio();
    else setAudioWithAutoPlay(url, audioId, profileId, text.substring(0, 50));
  };

  const handleDownloadAudio = (
    generationId: string,
    text: string,
    format: GenerationExportFormat = 'wav',
  ) => {
    exportGenerationAudio.mutate(
      { generationId, text, format },
      {
        onError: (error) => {
          toast({
            title: 'Failed to download audio',
            description: error.message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleExportPackage = (generationId: string, text: string) => {
    exportGeneration.mutate(
      { generationId, text },
      {
        onError: (error) => {
          toast({
            title: 'Failed to export generation',
            description: error.message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleDeleteClick = (generationId: string, profileName: string) => {
    setGenerationToDelete({ id: generationId, name: profileName });
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (generationToDelete) {
      deleteGeneration.mutate(generationToDelete.id);
      setDeleteDialogOpen(false);
      setGenerationToDelete(null);
    }
  };

  const handleRetry = async (generationId: string) => {
    try {
      const result = await apiClient.retryGeneration(generationId);
      addPendingGeneration(result.id);
      queryClient.invalidateQueries({ queryKey: ['history'] });
    } catch (error) {
      toast({
        title: 'Retry failed',
        description: error instanceof Error ? error.message : 'Could not retry generation',
        variant: 'destructive',
      });
    }
  };

  const handleRegenerate = async (generationId: string) => {
    try {
      await apiClient.regenerateGeneration(generationId);
      addPendingGeneration(generationId);
      queryClient.invalidateQueries({ queryKey: ['history'] });
    } catch (error) {
      toast({
        title: 'Regenerate failed',
        description: error instanceof Error ? error.message : 'Could not regenerate',
        variant: 'destructive',
      });
    }
  };

  const handleToggleFavorite = async (generationId: string) => {
    try {
      await apiClient.toggleFavorite(generationId);
      queryClient.invalidateQueries({ queryKey: ['history'] });
    } catch (error) {
      toast({
        title: 'Failed to update favorite',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleApplyEffects = (generationId: string) => {
    const gen = allHistory.find((g) => g.id === generationId);
    const versions = gen?.versions ?? [];
    setEffectsTargetId(generationId);
    setEffectsTargetVersions(versions);
    // Default to clean/original version (no effects chain)
    const cleanVersion = versions.find((v) => !v.effects_chain || v.effects_chain.length === 0);
    setEffectsSourceVersionId(cleanVersion?.id ?? null);
    setEffectsChain([]);
    setEffectsDialogOpen(true);
  };

  const handleApplyEffectsConfirm = async () => {
    if (!effectsTargetId || effectsChain.length === 0) return;
    setApplyingEffects(true);
    try {
      const newVersion = await apiClient.applyEffectsToGeneration(effectsTargetId, {
        effects_chain: effectsChain,
        source_version_id: effectsSourceVersionId ?? undefined,
        set_as_default: true,
      });
      queryClient.invalidateQueries({ queryKey: ['history'] });

      // If the player is currently on this generation, reload with the new version audio
      if (currentAudioId === effectsTargetId) {
        const gen = allHistory.find((g) => g.id === effectsTargetId);
        if (gen) {
          const versionUrl = apiClient.getVersionAudioUrl(newVersion.id);
          setAudioWithAutoPlay(
            versionUrl,
            effectsTargetId,
            gen.profile_id,
            gen.text.substring(0, 50),
          );
        }
      }

      setEffectsDialogOpen(false);
      toast({ title: 'Effects applied', description: 'A new version has been created.' });
    } catch (error) {
      toast({
        title: 'Failed to apply effects',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setApplyingEffects(false);
    }
  };

  const handleSwitchVersion = async (generationId: string, versionId: string) => {
    try {
      await apiClient.setDefaultVersion(generationId, versionId);
      // 当前分页可能不包含这条记录，因此同时更新本地展开列表。
      const updated = await apiClient.getGeneration(generationId);
      setAllHistory((items) => items.map((item) => (item.id === generationId ? updated : item)));
      queryClient.invalidateQueries({ queryKey: ['history'] });
    } catch (error) {
      toast({
        title: 'Failed to switch version',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handlePlayVersion = (
    generationId: string,
    versionId: string,
    text: string,
    profileId: string,
  ) => {
    const audioUrl = apiClient.getVersionAudioUrl(versionId);
    setAudioWithAutoPlay(audioUrl, generationId, profileId, text.substring(0, 50));
  };

  const handleImportConfirm = () => {
    if (selectedFile) {
      importGeneration.mutate(selectedFile, {
        onSuccess: (data) => {
          setImportDialogOpen(false);
          setSelectedFile(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          toast({
            title: 'Generation imported',
            description: data.message || 'Generation imported successfully',
          });
        },
        onError: (error) => {
          toast({
            title: 'Failed to import generation',
            description: error.message,
            variant: 'destructive',
          });
        },
      });
    }
  };

  if (isLoading && page === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const history = allHistory;
  const hasMore = allHistory.length < total;
  const failedCount = history.filter((g) => g.status === 'failed').length;

  const handleClearFailedConfirm = () => {
    clearFailed.mutate(undefined, {
      onSuccess: (data) => {
        setClearFailedDialogOpen(false);
        toast({
          title: 'Cleared failed generations',
          description: `${data.deleted} failed ${data.deleted === 1 ? 'generation' : 'generations'} removed.`,
        });
      },
      onError: (error) => {
        setClearFailedDialogOpen(false);
        toast({
          title: 'Failed to clear',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {history.length === 0 ? (
        <div className="text-center py-12 px-5 border-2 border-dashed mb-5 border-muted rounded-md text-muted-foreground flex-1 flex items-center justify-center">
          {t('history.empty')}
        </div>
      ) : (
        <>
          {failedCount > 0 && (
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-xs text-muted-foreground">
                {failedCount} failed {failedCount === 1 ? 'generation' : 'generations'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setClearFailedDialogOpen(true)}
                disabled={clearFailed.isPending}
              >
                <Trash2 className="h-3 w-3 mr-1.5" />
                {clearFailed.isPending ? 'Clearing...' : 'Clear failed'}
              </Button>
            </div>
          )}
          {isScrolled && (
            <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
          )}
          <div
            ref={scrollRef}
            className={cn(
              'flex-1 min-h-0 overflow-y-auto space-y-2 pb-4',
              isPlayerVisible && BOTTOM_SAFE_AREA_PADDING,
            )}
          >
            {history.map((gen) => {
              const isCurrentlyPlaying = currentAudioId === gen.id && isPlaying;
              const isInProgress = gen.status === 'loading_model' || gen.status === 'generating';
              const isGenerating = isInProgress;
              const isFailed = gen.status === 'failed';
              const isPlayable = !isGenerating && !isFailed;
              const isEditing = gen.versions?.some((v) => v.status === 'generating');
              const hasVersions = gen.versions && gen.versions.length > 1;
              const isVersionsExpanded = expandedVersionsId === gen.id;
              const isCancelling =
                cancelGeneration.isPending && cancelGeneration.variables === gen.id;
              return (
                <div
                  key={gen.id}
                  className={cn(
                    'border rounded-md bg-card transition-colors text-left w-full',
                    isCurrentlyPlaying && 'bg-muted/70',
                  )}
                >
                  {/* 行内包含菜单和收藏按钮，不能嵌套在原生 button 内。 */}
                  {/* biome-ignore lint/a11y/useSemanticElements: 保留行内独立按钮与文本选择能力 */}
                  <div
                    role="button"
                    aria-disabled={!isPlayable}
                    tabIndex={isPlayable ? 0 : undefined}
                    className={cn(
                      'flex items-stretch gap-4 h-26 p-3 outline-none',
                      isPlayable && 'hover:bg-muted/70 cursor-pointer rounded-md',
                      isVersionsExpanded && 'rounded-b-none',
                    )}
                    aria-label={
                      isGenerating
                        ? `Generating speech for ${gen.profile_name}...`
                        : isFailed
                          ? `Generation failed for ${gen.profile_name}`
                          : isCurrentlyPlaying
                            ? `Sample from ${gen.profile_name}, ${formatDuration(gen.duration ?? 0)}, ${formatDate(gen.created_at)}. Playing. Press Enter to restart.`
                            : `Sample from ${gen.profile_name}, ${formatDuration(gen.duration ?? 0)}, ${formatDate(gen.created_at)}. Press Enter to play.`
                    }
                    onMouseDown={(e) => {
                      if (!isPlayable) return;
                      const target = e.target as HTMLElement;
                      if (target.closest('textarea') || window.getSelection()?.toString()) {
                        return;
                      }
                      handlePlay(gen.id, gen.text, gen.profile_id);
                    }}
                    onKeyDown={(e) => {
                      if (!isPlayable) return;
                      const target = e.target as HTMLElement;
                      if (target.closest('textarea') || target.closest('button')) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handlePlay(gen.id, gen.text, gen.profile_id);
                      }
                    }}
                  >
                    {/* Status icon */}
                    <div className="flex items-center shrink-0 w-10 justify-center overflow-hidden">
                      <AudioBars
                        mode={isGenerating ? 'generating' : isCurrentlyPlaying ? 'playing' : 'idle'}
                      />
                    </div>

                    {/* Left side - Meta information */}
                    <div className="flex flex-col gap-1.5 w-48 shrink-0 justify-center">
                      <div className="font-medium text-sm truncate" title={gen.profile_name}>
                        {gen.profile_name}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{gen.language}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatEngineName(gen.engine, gen.model_size)}
                        </span>
                        {isFailed ? (
                          <span className="text-xs text-destructive">Failed</span>
                        ) : !isGenerating ? (
                          <span className="text-xs text-muted-foreground">
                            {formatDuration(gen.duration ?? 0)}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {isInProgress ? (
                          <span className="text-accent">
                            {gen.status === 'loading_model' ? 'Loading model...' : 'Generating...'}
                          </span>
                        ) : (
                          formatDate(gen.created_at)
                        )}
                      </div>
                    </div>

                    {/* Right side - Transcript textarea */}
                    <div className="flex-1 min-w-0 flex">
                      <Textarea
                        value={gen.text}
                        className="flex-1 resize-none text-sm text-muted-foreground select-text"
                        readOnly
                        aria-label={`Transcript for sample from ${gen.profile_name}, ${formatDuration(gen.duration ?? 0)}`}
                      />
                    </div>

                    {/* 操作区阻止冒泡，键盘选择版本时不应额外播放整行。 */}
                    <div
                      role="toolbar"
                      aria-label={t('history.edit.title')}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="shrink-0 flex flex-col justify-center items-center gap-0.5"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          'h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground',
                          gen.is_favorited && 'text-accent hover:text-accent',
                        )}
                        aria-label={gen.is_favorited ? 'Unfavorite' : 'Favorite'}
                        onClick={() => handleToggleFavorite(gen.id)}
                      >
                        <Star
                          className="h-2 w-2"
                          fill={gen.is_favorited ? 'currentColor' : 'none'}
                        />
                      </Button>
                      {hasVersions && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            'h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground',
                            isVersionsExpanded && 'text-accent hover:text-accent',
                          )}
                          aria-label="Toggle versions"
                          onClick={() => setExpandedVersionsId(isVersionsExpanded ? null : gen.id)}
                        >
                          <AudioLines className="h-2 w-2" />
                        </Button>
                      )}

                      {isFailed ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground"
                            aria-label="Retry generation"
                            onClick={() => handleRetry(gen.id)}
                          >
                            <RotateCcw className="h-2 w-2" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground"
                            aria-label="Delete generation"
                            disabled={deleteGeneration.isPending}
                            onClick={() => handleDeleteClick(gen.id, gen.profile_name)}
                          >
                            <Trash2 className="h-2 w-2" />
                          </Button>
                        </>
                      ) : isGenerating ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground"
                          aria-label="Cancel generation"
                          disabled={isCancelling}
                          onClick={() => cancelGeneration.mutate(gen.id)}
                        >
                          {isCancelling ? (
                            <Loader2 className="h-2 w-2 animate-spin" />
                          ) : (
                            <Square className="h-2 w-2" />
                          )}
                        </Button>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground"
                              aria-label={t('history.actions.menu')}
                              disabled={isGenerating}
                            >
                              <MoreHorizontal className="h-2 w-2" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handlePlay(gen.id, gen.text, gen.profile_id)}
                            >
                              <Play className="mr-2 h-4 w-4" />
                              {t('history.actions.play')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDownloadAudio(gen.id, gen.text)}
                              disabled={exportGenerationAudio.isPending}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              {t('history.actions.exportAudio')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDownloadAudio(gen.id, gen.text, 'mp3')}
                              disabled={exportGenerationAudio.isPending}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              {t('history.actions.exportAudioMp3')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleExportPackage(gen.id, gen.text)}
                              disabled={exportGeneration.isPending}
                            >
                              <FileArchive className="mr-2 h-4 w-4" />
                              {t('history.actions.exportPackage')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleApplyEffects(gen.id)}>
                              <Wand2 className="mr-2 h-4 w-4" />
                              {t('history.actions.applyEffects')}
                            </DropdownMenuItem>
                            {/* 编辑入口保留原声，生成完成后才选中新版本。 */}
                            <DropdownMenuItem
                              disabled={isEditing}
                              onClick={() => setEditTarget({ generation: gen })}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              {t('history.edit.title')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={isEditing}
                              onClick={() => handleRegenerate(gen.id)}
                            >
                              <RotateCcw className="mr-2 h-4 w-4" />
                              {t('history.actions.regenerate')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDeleteClick(gen.id, gen.profile_name)}
                              disabled={deleteGeneration.isPending}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t('common.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  {/* Expandable versions panel */}
                  <AnimatePresence>
                    {isVersionsExpanded && gen.versions && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-border/50">
                          <div className="divide-y divide-border/40">
                            {gen.versions.map((v) => {
                              // 未完成版本只能查看草稿或重试，不提供无效播放入口。
                              const ready = !v.status || v.status === 'completed';
                              return (
                                <div key={v.id} className="flex items-center gap-2 px-3 py-2">
                                  <button
                                    type="button"
                                    disabled={!ready}
                                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
                                    onClick={() => {
                                      handlePlayVersion(
                                        gen.id,
                                        v.id,
                                        v.text ?? gen.text,
                                        gen.profile_id,
                                      );
                                      if (!v.is_default) handleSwitchVersion(gen.id, v.id);
                                    }}
                                  >
                                    {v.status === 'generating' ? (
                                      <Loader2 className="size-3 shrink-0 animate-spin" />
                                    ) : (
                                      <AudioLines className="size-3 shrink-0 text-muted-foreground" />
                                    )}
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-xs font-medium">
                                        {v.label}
                                        {v.is_default ? ` · ${t('history.edit.active')}` : ''}
                                      </span>
                                      <span className="block truncate text-xs text-muted-foreground">
                                        {v.text ?? gen.text}
                                      </span>
                                    </span>
                                    {!ready && (
                                      <span className="text-xs">
                                        {t(
                                          v.status === 'failed'
                                            ? 'history.edit.failed'
                                            : 'history.edit.generating',
                                        )}
                                      </span>
                                    )}
                                  </button>
                                  {v.status === 'failed' && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={isEditing}
                                      title={v.error ?? undefined}
                                      onClick={() => setEditTarget({ generation: gen, draft: v })}
                                    >
                                      {t('history.edit.retry')}
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {/* Load more trigger element */}
            {hasMore && (
              <div ref={loadMoreRef} className="flex items-center justify-center py-4">
                {isFetching && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
              </div>
            )}

            {/* End of list indicator */}
            {!hasMore && history.length > 0 && (
              <div className="text-center py-4 text-xs text-muted-foreground">
                You've reached the end
              </div>
            )}
          </div>
        </>
      )}

      {editTarget && (
        <EditGenerationDialog
          key={editTarget.draft?.id ?? editTarget.generation.id}
          generation={editTarget.generation}
          draft={editTarget.draft}
          onClose={() => setEditTarget(null)}
          onStarted={(version) => {
            // 立即插入草稿以启动轮询，原音频继续保持可播放状态。
            setAllHistory((items) =>
              items.map((item) =>
                item.id === version.generation_id
                  ? { ...item, versions: [...(item.versions ?? []), version] }
                  : item,
              ),
            );
            setExpandedVersionsId(version.generation_id);
          }}
        />
      )}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('history.deleteDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('history.deleteDialog.body', { name: generationToDelete?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setGenerationToDelete(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteGeneration.isPending}
            >
              {deleteGeneration.isPending ? t('history.deleteDialog.deleting') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clearFailedDialogOpen} onOpenChange={setClearFailedDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('history.clearFailedDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('history.clearFailedDialog.body', { count: failedCount })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearFailedDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearFailedConfirm}
              disabled={clearFailed.isPending}
            >
              {clearFailed.isPending
                ? t('history.clearFailedDialog.clearing')
                : t('history.clearFailedDialog.clearAll')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('history.importDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('history.importDialog.body', { name: selectedFile?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportDialogOpen(false);
                setSelectedFile(null);
                if (fileInputRef.current) {
                  fileInputRef.current.value = '';
                }
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleImportConfirm}
              disabled={importGeneration.isPending || !selectedFile}
            >
              {importGeneration.isPending
                ? t('history.importDialog.importing')
                : t('history.importDialog.action')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={effectsDialogOpen} onOpenChange={setEffectsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('history.effectsDialog.title')}</DialogTitle>
            <DialogDescription>{t('history.effectsDialog.body')}</DialogDescription>
          </DialogHeader>
          {effectsTargetVersions.length > 1 && (
            <div className="space-y-1.5">
              {/* 关联原有选择器，确保辅助技术读出来源字段。 */}
              <label
                htmlFor="effects-source-version"
                className="text-xs font-medium text-muted-foreground"
              >
                {t('history.effectsDialog.sourceLabel')}
              </label>
              <Select
                value={effectsSourceVersionId ?? ''}
                onValueChange={(val) => setEffectsSourceVersionId(val || null)}
              >
                <SelectTrigger id="effects-source-version" className="h-8 text-xs">
                  <SelectValue placeholder={t('history.effectsDialog.sourcePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {effectsTargetVersions
                    .filter((v) => !v.status || v.status === 'completed')
                    .map((v) => (
                      <SelectItem key={v.id} value={v.id} className="text-xs">
                        {v.label}
                        {v.effects_chain && v.effects_chain.length > 0 && (
                          <span className="text-muted-foreground ml-1.5">
                            ({v.effects_chain.map((e) => e.type).join(' + ')})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="py-2 max-h-80 overflow-y-auto">
            <EffectsChainEditor value={effectsChain} onChange={setEffectsChain} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEffectsDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleApplyEffectsConfirm}
              disabled={applyingEffects || effectsChain.length === 0}
            >
              {applyingEffects
                ? t('history.effectsDialog.applying')
                : t('history.effectsDialog.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
