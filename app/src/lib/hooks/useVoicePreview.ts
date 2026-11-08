import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { VoiceProfileResponse } from '@/lib/api/types';
import { usePlayerStore } from '@/stores/playerStore';

export function useVoicePreview() {
  return useMutation({
    mutationFn: async (profile: VoiceProfileResponse) => {
      // 试听严格只读专属资源；生成由新增或编辑档案触发。
      if (profile.preview_status !== 'ready' || !profile.preview_revision) return;
      const id = `preview:${profile.id}:${profile.preview_revision}`;
      const player = usePlayerStore.getState();
      if (player.audioId === id) player.restartCurrentAudio();
      else
        player.setAudioWithAutoPlay(
          apiClient.getProfilePreviewUrl(profile.id, profile.preview_revision),
          id,
          profile.id,
          profile.name,
        );
    },
  });
}
